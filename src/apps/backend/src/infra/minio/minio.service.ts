import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client as MinioClient } from 'minio';
import { Readable } from 'stream';
import { AppConfigService } from '../../common/config/app-config.service';

/**
 * MinIO wrapper cho UniHub Workshop.
 *
 * - Bucket được tạo idempotent lúc start (specs/ai-summary.md §A).
 * - Object key cho PDF: `workshops/{workshopId}/{sha256}.pdf`.
 * - Server-side thực hiện get/put/stat; presigned URL cho download có TTL ngắn.
 */
@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private client!: MinioClient;
  private bucketName!: string;
  private ready = false;

  constructor(private readonly cfg: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    const m = this.cfg.minio;
    this.bucketName = m.bucket;
    this.client = new MinioClient({
      endPoint: m.endpoint,
      port: m.port,
      useSSL: m.useSSL,
      accessKey: m.accessKey,
      secretKey: m.secretKey,
    });
    await this.ensureBucket();
  }

  private async ensureBucket(): Promise<void> {
    try {
      const exists = await this.client.bucketExists(this.bucketName);
      if (!exists) {
        await this.client.makeBucket(this.bucketName, 'us-east-1');
        this.logger.log(`MinIO bucket created: ${this.bucketName}`);
      } else {
        this.logger.log(`MinIO bucket ready: ${this.bucketName}`);
      }
      this.ready = true;
    } catch (e) {
      this.logger.error(`MinIO ensureBucket failed: ${(e as Error).message}; will retry lazily`);
      this.ready = false;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  bucket(): string {
    return this.bucketName;
  }

  /** Upload buffer with metadata. Idempotent — same key overwrites. */
  async putObject(
    objectKey: string,
    buffer: Buffer,
    contentType: string,
    metadata: Record<string, string> = {},
  ): Promise<void> {
    if (!this.ready) await this.ensureBucket();
    await this.client.putObject(this.bucketName, objectKey, buffer, buffer.length, {
      'Content-Type': contentType,
      ...metadata,
    });
  }

  /** Download object as Buffer. */
  async getObject(objectKey: string): Promise<Buffer> {
    const stream: Readable = await this.client.getObject(this.bucketName, objectKey);
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  /** Stat object (for idempotency check before re-upload). Returns null if missing. */
  async statObject(objectKey: string): Promise<{ size: number; etag: string } | null> {
    try {
      const stat = await this.client.statObject(this.bucketName, objectKey);
      return { size: stat.size, etag: stat.etag };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'NotFound' || code === 'NoSuchKey') return null;
      throw e;
    }
  }

  /** Generate presigned GET URL with TTL (seconds). Default 5 minutes. */
  async presignedGetUrl(objectKey: string, ttlSec = 300): Promise<string> {
    return this.client.presignedGetObject(this.bucketName, objectKey, ttlSec);
  }
}
