import { Controller, Get } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CatalogService } from './catalog.service';

@Controller('workshop-form-options')
@Roles('ORGANIZER', 'SYS_ADMIN')
export class WorkshopOptionsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  async list() {
    return this.catalog.adminOptions();
  }
}
