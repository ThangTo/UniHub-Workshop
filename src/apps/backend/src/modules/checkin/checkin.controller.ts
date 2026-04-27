import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { AuthenticatedUser } from '../../common/types/auth.types';
import { CheckinService } from './checkin.service';
import { BatchCheckinDto } from './dto/batch-checkin.dto';

/**
 * Check-in API (specs/checkin.md).
 *
 * Tất cả endpoints đều yêu cầu role CHECKIN_STAFF; SV không được tự check-in.
 */
@Controller()
export class CheckinController {
  constructor(private readonly svc: CheckinService) {}

  /**
   * Verify đơn (specs/checkin.md §D) — staff xem trước khi confirm.
   * Trả thông tin SV + alreadyCheckedIn.
   */
  @Roles('CHECKIN_STAFF', 'SYS_ADMIN')
  @Get('registrations/:id/verify')
  async verifyOne(@Param('id', ParseUUIDPipe) id: string) {
    try {
      return await this.svc.verifySingle(id);
    } catch (e) {
      if ((e as Error).message === 'registration_not_found') {
        throw new NotFoundException({ code: 'registration_not_found' });
      }
      throw e;
    }
  }

  /**
   * Batch check-in (specs/checkin.md §A,§C). Idempotent qua header `Idempotency-Key`
   * (ở batch level) + `idempotencyKey` của mỗi item (UNIQUE trong DB).
   */
  @Roles('CHECKIN_STAFF', 'SYS_ADMIN')
  @RateLimit({
    scope: 'user',
    bucket: 'checkin-batch',
    capacity: 30,
    refillPerSec: 1,
    failClosed: true,
  })
  @Idempotent({ required: true })
  @Post('checkin/batch')
  @HttpCode(HttpStatus.OK)
  async batch(@Body() dto: BatchCheckinDto, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.batch(user.id, dto);
  }
}
