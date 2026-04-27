import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { Prisma, SummaryStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MinioService } from '../../infra/minio/minio.service';
import { OutboxService } from '../outbox/outbox.service';

/** Subset of Express.Multer.File mà controller pass xuống. */
export interface UploadedPdf {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname: string;
}

const MAX_PDF_SIZE = 20 * 1024 * 1024; // 20MB
const PDF_MAGIC = Buffer.from('%PDF-', 'utf8');

/**
 * AiSummaryService — handle HTTP upload theo specs/ai-summary.md §Luồng chính.
 *
 *   1. Validate size + MIME + magic bytes.
 *   2. Compute SHA-256.
 *   3. Cache hit (`ai_summary_cache`): re-use summary, status=READY ngay.
 *   4. Cache miss: PUT MinIO + UPDATE workshop + INSERT outbox `pdf.uploaded`.
 *
 * Worker (xem ai-summary.worker.ts) sẽ xử lý phần extract + AI sinh tóm tắt async.
 */
@Injectable()
export class AiSummaryService {
  private readonly logger = new Logger(AiSummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Xử lý upload PDF cho 1 workshop.
   * Trả về `{ summaryStatus, cacheHit }` để controller chọn 200 (READY) hoặc 202 (PENDING).
   */
  async uploadPdf(workshopId: string, organizerId: string, file: UploadedPdf) {
    // 1. Validate
    this.validateFile(file);

    // 2. Compute SHA-256
    const sha = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const objectKey = `workshops/${workshopId}/${sha}.pdf`;

    // Workshop existence + ownership check (organizer phải sở hữu OR là sys_admin — controller đã guard ROLE)
    const ws = await this.prisma.workshop.findUnique({ where: { id: workshopId } });
    if (!ws) throw new NotFoundException('workshop_not_found');

    // 3. Cache hit?
    const cache = await this.prisma.aiSummaryCache.findUnique({ where: { pdfSha256: sha } });
    if (cache) {
      // Đảm bảo file vẫn ở MinIO (best effort) — nếu workshop chưa từng upload bản này.
      try {
        const exists = await this.minio.statObject(objectKey);
        if (!exists) {
          await this.minio.putObject(objectKey, file.buffer, 'application/pdf', {
            'x-amz-meta-uploader': organizerId,
            'x-amz-meta-workshop': workshopId,
          });
        }
      } catch (e) {
        this.logger.warn(`MinIO cache-hit upload best-effort failed: ${(e as Error).message}`);
      }

      await this.prisma.workshop.update({
        where: { id: workshopId },
        data: {
          pdfObjectKey: objectKey,
          pdfSha256: sha,
          summary: cache.summary,
          summaryHighlights: (cache.summaryHighlights ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          summaryStatus: SummaryStatus.READY,
        },
      });

      this.logger.log(`PDF cache hit sha=${sha.slice(0, 12)} workshop=${workshopId}`);
      return { summaryStatus: SummaryStatus.READY, cacheHit: true, sha256: sha };
    }

    // 4. Cache miss — upload lên MinIO trước, rồi commit DB + outbox trong 1 TX.
    try {
      await this.minio.putObject(objectKey, file.buffer, 'application/pdf', {
        'x-amz-meta-uploader': organizerId,
        'x-amz-meta-workshop': workshopId,
      });
    } catch (e) {
      this.logger.error(`MinIO putObject failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException({
        code: 'storage_unavailable',
        message: 'Storage hiện không khả dụng. Vui lòng thử lại.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.workshop.update({
        where: { id: workshopId },
        data: {
          pdfObjectKey: objectKey,
          pdfSha256: sha,
          summary: null,
          summaryHighlights: Prisma.JsonNull,
          summaryStatus: SummaryStatus.PENDING,
        },
      });
      await this.outbox.append(tx, {
        aggregate: 'workshop',
        aggregateId: workshopId,
        eventType: 'workshop.pdf.uploaded',
        payload: { workshopId, objectKey, sha, uploadedBy: organizerId },
      });
    });

    this.logger.log(`PDF queued sha=${sha.slice(0, 12)} workshop=${workshopId}`);
    return { summaryStatus: SummaryStatus.PENDING, cacheHit: false, sha256: sha };
  }

  /**
   * Manual retry cho summary FAILED — đẩy lại event `workshop.pdf.uploaded`,
   * status về PENDING. Yêu cầu workshop đã có `pdfObjectKey`.
   */
  async retrySummary(workshopId: string, organizerId: string) {
    const ws = await this.prisma.workshop.findUnique({ where: { id: workshopId } });
    if (!ws) throw new NotFoundException('workshop_not_found');
    if (!ws.pdfObjectKey || !ws.pdfSha256) {
      throw new ForbiddenException({ code: 'no_pdf_uploaded', message: 'Workshop chưa có PDF.' });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.workshop.update({
        where: { id: workshopId },
        data: {
          summary: null,
          summaryHighlights: Prisma.JsonNull,
          summaryStatus: SummaryStatus.PENDING,
        },
      });
      await this.outbox.append(tx, {
        aggregate: 'workshop',
        aggregateId: workshopId,
        eventType: 'workshop.pdf.uploaded',
        payload: {
          workshopId,
          objectKey: ws.pdfObjectKey,
          sha: ws.pdfSha256,
          uploadedBy: organizerId,
          retry: true,
        },
      });
    });

    return { summaryStatus: SummaryStatus.PENDING };
  }

  /**
   * Trả status hiện tại cho polling (admin web 5s).
   */
  async getStatus(workshopId: string) {
    const ws = await this.prisma.workshop.findUnique({
      where: { id: workshopId },
      select: {
        id: true,
        summary: true,
        summaryHighlights: true,
        summaryStatus: true,
        pdfObjectKey: true,
        pdfSha256: true,
      },
    });
    if (!ws) throw new NotFoundException('workshop_not_found');
    return ws;
  }

  // ==================== Validation ====================
  private validateFile(file: UploadedPdf): void {
    if (!file?.buffer || file.size === 0) {
      throw new UnsupportedMediaTypeException({ code: 'empty_file', message: 'File rỗng.' });
    }
    if (file.size > MAX_PDF_SIZE) {
      throw new PayloadTooLargeException({
        code: 'file_too_large',
        message: 'File vượt giới hạn 20MB.',
      });
    }
    const mime = (file.mimetype ?? '').toLowerCase();
    if (mime !== 'application/pdf') {
      throw new UnsupportedMediaTypeException({
        code: 'unsupported_media_type',
        message: 'Chỉ chấp nhận application/pdf.',
      });
    }
    // Magic bytes check — chống đổi đuôi .exe → .pdf.
    const head = file.buffer.subarray(0, 5);
    if (!head.equals(PDF_MAGIC)) {
      throw new UnsupportedMediaTypeException({
        code: 'unsupported_media_type',
        message: 'Magic bytes không phải PDF (%PDF-).',
      });
    }
  }
}
