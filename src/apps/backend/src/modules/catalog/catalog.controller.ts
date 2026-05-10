import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import { Observable, interval, map, switchMap, from } from 'rxjs';
import { CatalogService } from './catalog.service';
import { CreateWorkshopDto } from './dto/create-workshop.dto';
import { UpdateWorkshopDto } from './dto/update-workshop.dto';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { AuthenticatedUser } from '../../common/types/auth.types';

@Controller('workshops')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @RateLimit({ scope: 'ip', bucket: 'site', capacity: 60, refillPerSec: 0.5 })
  @Get()
  async list(
    @Query('day') day?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.catalog.list({
      day,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Public()
  @Get('stream')
  @Sse()
  seatStream(): Observable<MessageEvent> {
    return interval(2000).pipe(
      switchMap(() =>
        from(this.catalog.publishedSeatSnapshot()).pipe(
          map((seats) => ({ data: seats }) as MessageEvent),
        ),
      ),
    );
  }

  @Roles('ORGANIZER', 'SYS_ADMIN')
  @Get('admin/list')
  async adminList(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const normalizedStatus =
      status && ['DRAFT', 'PUBLISHED', 'CANCELLED', 'ENDED'].includes(status)
        ? (status as 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'ENDED')
        : undefined;

    return this.catalog.adminList({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      status: normalizedStatus,
    }, user);
  }

  @Roles('ORGANIZER', 'SYS_ADMIN')
  @Get('admin/:id')
  async adminDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.catalog.adminDetail(id, user);
  }

  @Public()
  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.detail(id);
  }

  @Roles('ORGANIZER', 'SYS_ADMIN')
  @Post()
  async create(@Body() dto: CreateWorkshopDto, @CurrentUser() user: AuthenticatedUser) {
    return this.catalog.create(dto, user.id);
  }

  @Roles('ORGANIZER', 'SYS_ADMIN')
  @Post(':id/publish')
  async publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.catalog.publish(id, user);
  }

  @Roles('ORGANIZER', 'SYS_ADMIN')
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkshopDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('if-match') ifMatch?: string,
  ) {
    const version = ifMatch ? parseInt(ifMatch.replace(/[^0-9]/g, ''), 10) : 0;
    return this.catalog.update(id, dto, version, user);
  }

  @Roles('ORGANIZER', 'SYS_ADMIN')
  @Post(':id/cancel')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body('reason') reason?: string,
  ) {
    return this.catalog.cancel(id, reason ?? 'No reason provided', user);
  }
}
