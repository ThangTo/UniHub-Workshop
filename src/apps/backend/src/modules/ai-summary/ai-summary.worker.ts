import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, SummaryStatus } from '@prisma/client';
import { AmqpService } from '../../infra/amqp/amqp.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MinioService } from '../../infra/minio/minio.service';
import { RedisService } from '../../infra/redis/redis.service';
import { AiProviderClient, AiProviderError } from './ai-provider.client';
import { extractPdfText } from './pdf-extract';

interface OutboxEnvelope {
  id: string;
  aggregate: string;
  aggregateId: string;
  eventType: string;
  payload: {
    workshopId: string;
    objectKey: string;
    sha: string;
    uploadedBy?: string;
    retry?: boolean;
  };
  createdAt: string;
}

const QUEUE = 'ai.summary.generate';
const ROUTING_KEY = 'workshop.pdf.uploaded';
const MIN_WORDS = 100;
const MAX_TEXT_CHARS = 50_000;

/**
 * AI Summary Worker (specs/ai-summary.md §Luồng chính step 5–10).
 *
 *   pdf.uploaded → fetch MinIO → pdf-parse → clean text → Gemini API
 *     ↳ success: UPSERT ai_summary_cache + UPDATE workshop READY
 *     ↳ fail   : UPDATE workshop FAILED + reason
 *
 * RabbitMQ manual ack: throw để re-deliver khi error transient (ví dụ MinIO 503).
 * 4xx (text_too_short, ai_bad_request) → ack + mark FAILED, không retry.
 */
@Injectable()
export class AiSummaryWorker implements OnModuleInit {
  private readonly logger = new Logger(AiSummaryWorker.name);

  constructor(
    private readonly amqp: AmqpService,
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly redis: RedisService,
    private readonly ai: AiProviderClient,
  ) {}

  async onModuleInit(): Promise<void> {
    void this.bindConsumer();
  }

  private async bindConsumer(): Promise<void> {
    for (let i = 0; i < 30; i++) {
      try {
        await this.amqp.assertConsumer(QUEUE, [ROUTING_KEY]);
        await this.amqp.consume<OutboxEnvelope>(QUEUE, (evt) => this.handle(evt), {
          prefetch: 2,
        });
        this.logger.log(`Consuming ${QUEUE} ← ${ROUTING_KEY}`);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    this.logger.error('Failed to bind ai-summary consumer');
  }

  private async handle(evt: OutboxEnvelope): Promise<void> {
    const { workshopId, objectKey, sha } = evt.payload;
    const startedAt = Date.now();
    this.logger.log(`AI summary start workshop=${workshopId} sha=${sha.slice(0, 12)}`);

    // 1. Fetch PDF từ MinIO
    let buffer: Buffer;
    try {
      buffer = await this.minio.getObject(objectKey);
    } catch (e) {
      this.logger.warn(`MinIO get failed for ${objectKey}: ${(e as Error).message}; will retry`);
      throw e; // → nack → redeliver
    }

    // 2. Parse PDF
    let text: string;
    try {
      const raw = await extractPdfText(buffer);
      text = this.cleanText(raw);
    } catch (e) {
      const reason = `pdf_parse_failed: ${(e as Error).message}`;
      await this.markFailed(workshopId, reason);
      this.logger.warn(`PDF parse failed workshop=${workshopId}: ${reason}`);
      return; // ack — non-retryable
    }

    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount < MIN_WORDS) {
      await this.markFailed(workshopId, 'text_too_short');
      this.logger.warn(`Text too short workshop=${workshopId} words=${wordCount}`);
      return;
    }

    // 3. Gọi AI (retry 3 lần inside client)
    try {
      const result = await this.ai.summarize(text.slice(0, MAX_TEXT_CHARS), 280);

      // 4. UPSERT cache + UPDATE workshop trong 1 transaction
      await this.prisma.$transaction(async (tx) => {
        await tx.aiSummaryCache.upsert({
          where: { pdfSha256: sha },
          create: {
            pdfSha256: sha,
            summary: result.summary,
            summaryHighlights: result.highlights as unknown as Prisma.InputJsonValue,
            model: result.model,
          },
          update: {
            summary: result.summary,
            summaryHighlights: result.highlights as unknown as Prisma.InputJsonValue,
            model: result.model,
          },
        });
        await tx.workshop.update({
          where: { id: workshopId },
          data: {
            summary: result.summary,
            summaryHighlights: result.highlights as unknown as Prisma.InputJsonValue,
            summaryStatus: SummaryStatus.READY,
          },
        });
      });

      // Invalidate catalog detail/list cache để SV thấy summary mới ngay.
      await this.invalidateCatalogCache().catch((err) =>
        this.logger.warn(`cache invalidate failed: ${(err as Error).message}`),
      );

      this.logger.log(
        `AI summary READY workshop=${workshopId} words=${result.summary.split(/\s+/).length}`,
      );
      await this.recordDuration(startedAt);
    } catch (e) {
      if (e instanceof AiProviderError) {
        await this.markFailed(workshopId, e.message);
        this.logger.warn(`AI provider gave up workshop=${workshopId}: ${e.message}`);
        return;
      }
      // Lỗi không xác định — re-deliver để debug
      this.logger.error(
        `AI summary unexpected error workshop=${workshopId}: ${(e as Error).message}`,
      );
      throw e;
    }
  }

  private async markFailed(workshopId: string, reason: string): Promise<void> {
    await this.prisma.workshop
      .update({
        where: { id: workshopId },
        data: {
          summaryStatus: SummaryStatus.FAILED,
          summary: null,
          summaryHighlights: { error: reason } as unknown as Prisma.InputJsonValue,
        },
      })
      .catch((e) =>
        this.logger.warn(
          `markFailed update failed workshop=${workshopId}: ${(e as Error).message}`,
        ),
      );
    await this.incrementFailureMetric();
  }

  /**
   * Xoá Redis cache `cache:workshop:*` để client polling thấy summary ngay
   * thay vì chờ TTL 5 phút (catalog.service dùng cùng prefix).
   * Dùng SCAN thay cho KEYS để không block Redis single-thread.
   */
  private async invalidateCatalogCache(): Promise<void> {
    const client = this.redis.getClient();
    const pattern = 'cache:workshop:*';
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0');
    if (keys.length > 0) await client.del(...keys);
  }

  /** Loại header/footer rỗng + normalize whitespace + drop dòng quá ngắn. */
  private cleanText(raw: string): string {
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter((l) => l.length >= 3);
    return lines.join('\n').trim();
  }

  private async incrementFailureMetric(): Promise<void> {
    try {
      await this.redis.getClient().incr('metrics:ai_summary_failures_total');
    } catch {
      // metrics are best effort
    }
  }

  private async recordDuration(startedAt: number): Promise<void> {
    try {
      const seconds = Math.max(0, (Date.now() - startedAt) / 1000);
      const client = this.redis.getClient();
      await client
        .multi()
        .incrbyfloat('metrics:ai_summary_duration_seconds_sum', seconds)
        .incr('metrics:ai_summary_duration_seconds_count')
        .exec();
    } catch {
      // metrics are best effort
    }
  }
}
