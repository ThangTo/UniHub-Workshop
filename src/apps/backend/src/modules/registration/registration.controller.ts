import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Sse,
} from '@nestjs/common';
import { Observable, interval, map, switchMap } from 'rxjs';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { AuthenticatedUser } from '../../common/types/auth.types';
import { CreateRegistrationDto } from './dto/create-registration.dto';
import { RegistrationService } from './registration.service';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Controller()
export class RegistrationController {
  constructor(
    private readonly svc: RegistrationService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Đăng ký workshop. Idempotent (header `Idempotency-Key`), rate-limited per-user.
   */
  @Roles('STUDENT')
  @RateLimit({
    scope: 'user',
    bucket: 'registrations',
    capacity: 10,
    refillPerSec: 1,
    failClosed: true,
  })
  @Idempotent({ required: true, intentFields: ['workshopId'] })
  @Post('registrations')
  async create(@Body() dto: CreateRegistrationDto, @CurrentUser() user: AuthenticatedUser) {
    const result = await this.svc.create(user.id, dto.workshopId);
    return {
      regId: result.registration.id,
      status: result.registration.status,
      paymentRequired: result.paymentRequired,
      holdExpiresAt: result.holdExpiresAt,
      qrToken: result.qrToken,
      qrImageDataUrl: result.qrImageDataUrl,
      paymentUnavailable: result.paymentUnavailable,
    };
  }

  @Roles('STUDENT')
  @Delete('registrations/:id')
  @HttpCode(200)
  async cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    const result = await this.svc.cancel(id, user.id);
    return { ok: true, refundRequired: result.refundRequired };
  }

  @Roles('STUDENT')
  @Get('me/registrations')
  async listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listMine(user.id);
  }

  @Roles('STUDENT')
  @Get('registrations/:id')
  async getOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.getById(id, user.id);
  }

  /**
   * SSE: stream status thay đổi (PENDING_PAYMENT → CONFIRMED hoặc EXPIRED).
   * Dùng cho UI hiển thị spinner khi user đang thanh toán.
   */
  @Roles('STUDENT')
  @Sse('registrations/:id/stream')
  stream(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Observable<{ data: unknown }> {
    return interval(2000).pipe(
      switchMap(async () => {
        const reg = await this.prisma.registration.findUnique({ where: { id } });
        if (!reg || reg.studentId !== user.id) {
          return { closed: true } as const;
        }
        return {
          regId: reg.id,
          status: reg.status,
          holdExpiresAt: reg.holdExpiresAt,
          confirmedAt: reg.confirmedAt,
          cancelledAt: reg.cancelledAt,
          qrToken: reg.qrToken,
        };
      }),
      map((data) => ({ data })),
    );
  }
}
