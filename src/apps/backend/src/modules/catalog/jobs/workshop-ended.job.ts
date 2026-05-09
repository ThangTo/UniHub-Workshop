import { Injectable, Logger } from '@nestjs/common';
import { Interval, Timeout } from '@nestjs/schedule';
import { CatalogService } from '../catalog.service';

@Injectable()
export class WorkshopEndedJob {
  private readonly logger = new Logger(WorkshopEndedJob.name);
  private running = false;

  constructor(private readonly catalog: CatalogService) {}

  @Timeout(10_000)
  async bootstrap(): Promise<void> {
    await this.tick();
  }

  @Interval(5 * 60 * 1000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.catalog.markEndedWorkshops();
    } catch (e) {
      this.logger.warn(`Workshop ended sweep failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
