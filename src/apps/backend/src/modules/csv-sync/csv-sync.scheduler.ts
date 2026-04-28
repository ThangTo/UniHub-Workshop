import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfigService } from '../../common/config/app-config.service';
import { CsvSyncService } from './csv-sync.service';

/**
 * Đăng ký cron CSV sync với expression từ env (mặc định `0 2 * * *`).
 * Dùng SchedulerRegistry thay vì @Cron decorator vì cron string động.
 *
 * Cron đặc biệt:
 *   - `disabled` / rỗng → bỏ qua (test/dev không muốn auto chạy).
 */
@Injectable()
export class CsvSyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(CsvSyncScheduler.name);
  private static readonly JOB_NAME = 'csv-sync.cron';

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly config: AppConfigService,
    private readonly svc: CsvSyncService,
  ) {}

  onModuleInit(): void {
    const expr = this.config.csv.cron.trim();
    if (!expr || expr.toLowerCase() === 'disabled') {
      this.logger.log('CSV sync cron disabled (CSV_CRON empty or "disabled")');
      return;
    }

    let job: CronJob;
    try {
      job = new CronJob(expr, () => {
        this.svc
          .runOnce()
          .catch((e) => this.logger.error(`runOnce error: ${(e as Error).message}`));
      });
    } catch (e) {
      this.logger.error(
        `Invalid CSV_CRON "${expr}": ${(e as Error).message}; cron disabled`,
      );
      return;
    }

    this.registry.addCronJob(CsvSyncScheduler.JOB_NAME, job as unknown as CronJob);
    job.start();
    this.logger.log(`CSV sync cron scheduled: "${expr}"`);
  }
}
