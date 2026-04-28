import { Module } from '@nestjs/common';
import { CsvSyncController } from './csv-sync.controller';
import { CsvSyncService } from './csv-sync.service';
import { CsvSyncScheduler } from './csv-sync.scheduler';

/**
 * CsvSyncModule — Phase 5 (specs/csv-sync.md):
 *   - Service:    streaming parse + batch upsert + advisory lock.
 *   - Scheduler:  cron `CSV_CRON` (default 02:00 hằng ngày).
 *   - Controller: POST /admin/csv-sync/run, GET /admin/import-jobs.
 *
 * Phụ thuộc PrismaModule (global) + AppConfigModule + ScheduleModule
 * (đã import ở app.module).
 */
@Module({
  controllers: [CsvSyncController],
  providers: [CsvSyncService, CsvSyncScheduler],
  exports: [CsvSyncService],
})
export class CsvSyncModule {}
