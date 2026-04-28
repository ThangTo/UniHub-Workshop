import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ImportJobStatus, Prisma } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CsvSyncService } from './csv-sync.service';

/**
 * Admin endpoints cho CSV sync (specs/csv-sync.md §C):
 *
 *   POST /admin/csv-sync/run         — trigger 1 lần (SYS_ADMIN), 202.
 *   GET  /admin/import-jobs          — danh sách job (filter theo status).
 *   GET  /admin/import-jobs/:id      — chi tiết, kèm errorLog.
 */
@Roles('SYS_ADMIN')
@Controller('admin')
export class CsvSyncController {
  constructor(
    private readonly svc: CsvSyncService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('csv-sync/run')
  @HttpCode(HttpStatus.ACCEPTED)
  async runNow() {
    // Fire-and-forget — admin nhận 202 ngay, log/audit thông qua import_jobs.
    this.svc.runOnce().catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[csv-sync] runOnce failed:', e);
    });
    return { status: 'accepted' };
  }

  @Get('import-jobs')
  async list(
    @Query('status') statusRaw?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number = 50,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number = 0,
  ) {
    const where: Prisma.ImportJobWhereInput = {};
    if (statusRaw) {
      const upper = statusRaw.toUpperCase();
      if (!(upper in ImportJobStatus)) {
        throw new BadRequestException({
          code: 'invalid_status',
          message: `status phải thuộc ${Object.keys(ImportJobStatus).join('|')}`,
        });
      }
      where.status = upper as ImportJobStatus;
    }
    const cappedLimit = Math.min(Math.max(limit, 1), 200);
    const [items, total] = await Promise.all([
      this.prisma.importJob.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: cappedLimit,
        skip: Math.max(offset, 0),
        // Không trả errorLog ở list để tránh response lớn — dùng /:id để xem chi tiết.
        select: {
          id: true,
          fileName: true,
          fileSha256: true,
          sourceExportedAt: true,
          totalRows: true,
          insertedRows: true,
          updatedRows: true,
          failedRows: true,
          status: true,
          startedAt: true,
          finishedAt: true,
        },
      }),
      this.prisma.importJob.count({ where }),
    ]);
    return { items, total, limit: cappedLimit, offset };
  }

  @Get('import-jobs/:id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const job = await this.prisma.importJob.findUnique({ where: { id } });
    if (!job) {
      throw new NotFoundException({
        code: 'not_found',
        message: `import job ${id} không tồn tại.`,
      });
    }
    return job;
  }
}
