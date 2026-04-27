import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { AuthenticatedUser } from '../../common/types/auth.types';
import { AiSummaryService, UploadedPdf } from './ai-summary.service';

/**
 * AI Summary endpoints (specs/ai-summary.md §B + §C):
 *
 *   POST /workshops/:id/pdf            — upload PDF (ORGANIZER, multipart, max 20MB)
 *   POST /workshops/:id/summary/retry  — đẩy lại job (ORGANIZER)
 *   GET  /workshops/:id/summary        — polling status cho admin web (ORGANIZER)
 */
@Controller('workshops')
export class AiSummaryController {
  constructor(private readonly summary: AiSummaryService) {}

  @Roles('ORGANIZER', 'SYS_ADMIN')
  @RateLimit({
    scope: 'user',
    bucket: 'pdf-upload',
    capacity: 10,
    refillPerSec: 1 / 60,
    failClosed: true,
  })
  @Post(':id/pdf')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024, files: 1 },
    }),
  )
  async uploadPdf(
    @Param('id', ParseUUIDPipe) workshopId: string,
    @UploadedFile() file: UploadedPdf | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException({ code: 'missing_file', message: 'Field "file" là bắt buộc.' });
    }
    const result = await this.summary.uploadPdf(workshopId, user.id, file);
    // Cache hit → 200 READY; cache miss → 202 PENDING
    return result;
  }

  @Roles('ORGANIZER', 'SYS_ADMIN')
  @RateLimit({
    scope: 'user',
    bucket: 'pdf-retry',
    capacity: 5,
    refillPerSec: 1 / 60,
  })
  @Post(':id/summary/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  async retry(
    @Param('id', ParseUUIDPipe) workshopId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.summary.retrySummary(workshopId, user.id);
  }

  @Roles('ORGANIZER', 'SYS_ADMIN')
  @Get(':id/summary')
  async status(@Param('id', ParseUUIDPipe) workshopId: string) {
    return this.summary.getStatus(workshopId);
  }
}
