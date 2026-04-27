import { Module } from '@nestjs/common';
import { AiSummaryController } from './ai-summary.controller';
import { AiSummaryService } from './ai-summary.service';
import { AiProviderClient } from './ai-provider.client';
import { AiSummaryWorker } from './ai-summary.worker';

/**
 * AiSummaryModule — Phase 4 (specs/ai-summary.md):
 *   - Controller: upload PDF + retry + status.
 *   - Service:   validate, hash, MinIO put, outbox event.
 *   - Worker:    consume `workshop.pdf.uploaded` → mock-ai → DB update.
 *   - Client:    HTTP + retry/backoff cho mock-ai.
 *
 * Phụ thuộc MinioModule (global) + OutboxModule + AmqpModule (đã global hoá).
 */
@Module({
  controllers: [AiSummaryController],
  providers: [AiSummaryService, AiProviderClient, AiSummaryWorker],
  exports: [AiSummaryService],
})
export class AiSummaryModule {}
