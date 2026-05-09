import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { WorkshopEndedJob } from './jobs/workshop-ended.job';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, WorkshopEndedJob],
  exports: [CatalogService],
})
export class CatalogModule {}
