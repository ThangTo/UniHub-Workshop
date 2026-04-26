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

/**
 * Catalog endpoints theo specs/workshop-catalog.md.
 *
 * Public:
 *   GET  /workshops          — danh sách PUBLISHED (cache 5 phút)
 *   GET  /workshops/:id      — chi tiết 1 workshop
 *   SSE  /workshops/stream   — real-time seatsLeft mỗi 2 giây
 *
 * ORGANIZER:
 *   POST  /workshops                — tạo DRAFT
 *   POST  /workshops/:id/publish    — DRAFT → PUBLISHED
 *   PATCH /workshops/:id            — sửa (optimistic lock If-Match)
 *   POST  /workshops/:id/cancel     — huỷ
 */
@Controller('workshops')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // ==================== PUBLIC ====================
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
    // Gửi seatsLeft cho tất cả PUBLISHED workshops mỗi 2 giây
    return interval(2000).pipe(
      switchMap(() =>
        from(this.getAllSeats()).pipe(
          map((seats) => ({ data: seats }) as MessageEvent),
        ),
      ),
    );
  }

  @Public()
  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.detail(id);
  }

  // ==================== ORGANIZER ====================
  @Roles('ORGANIZER', 'SYS_ADMIN')
  @Post()
  async create(@Body() dto: CreateWorkshopDto, @CurrentUser() user: AuthenticatedUser) {
    return this.catalog.create(dto, user.id);
  }

  @Roles('ORGANIZER', 'SYS_ADMIN')
  @Post(':id/publish')
  async publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.publish(id);
  }

  @Roles('ORGANIZER', 'SYS_ADMIN')
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkshopDto,
    @Headers('if-match') ifMatch?: string,
  ) {
    const version = ifMatch ? parseInt(ifMatch.replace(/[^0-9]/g, ''), 10) : 0;
    return this.catalog.update(id, dto, version);
  }

  @Roles('ORGANIZER', 'SYS_ADMIN')
  @Post(':id/cancel')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason?: string,
  ) {
    return this.catalog.cancel(id, reason ?? 'No reason provided');
  }

  // ==================== SSE helper ====================
  private async getAllSeats(): Promise<Record<string, number>> {
    // Lấy tất cả PUBLISHED workshop ids rồi đọc seat counter
    // Trong production nên cache danh sách ids, ở đây đơn giản.
    try {
      const keys = await this.catalog['redis'].getClient().keys('seat:*');
      if (keys.length === 0) return {};
      const vals = await this.catalog['redis'].getClient().mget(...keys);
      const result: Record<string, number> = {};
      keys.forEach((k, i) => {
        const id = k.replace('seat:', '');
        result[id] = Math.max(0, parseInt(vals[i] ?? '0', 10));
      });
      return result;
    } catch {
      return {};
    }
  }
}
