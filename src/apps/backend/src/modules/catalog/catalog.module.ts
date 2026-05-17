import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { WorkshopOptionsController } from './workshop-options.controller';
import { WorkshopEndedJob } from './jobs/workshop-ended.job';

@Module({
  controllers: [CatalogController, WorkshopOptionsController],
  providers: [CatalogService, WorkshopEndedJob],
  exports: [CatalogService],
})
export class CatalogModule {}
