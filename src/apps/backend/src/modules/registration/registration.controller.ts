import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  Sse,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable, interval, map, switchMap } from 'rxjs';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { AuthenticatedUser } from '../../common/types/auth.types';
import { CreateRegistrationDto } from './dto/create-registration.dto';
import { RegistrationService } from './registration.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PaymentGatewayClient } from '../payment/payment-gateway.client';
import { RegistrationQueueService } from './registration-queue.service';

@Controller()
export class RegistrationController {
  constructor(
    private readonly svc: RegistrationService,
    private readonly prisma: PrismaService,
    private readonly paymentGateway: PaymentGatewayClient,
    private readonly queue: RegistrationQueueService,
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
  async create(
    @Body() dto: CreateRegistrationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const paymentCircuitOpen = this.paymentGateway.isOpen();
    const processNow = await this.queue.shouldProcessSynchronously();
    if (!processNow) {
      const queued = await this.queue.enqueue({
        userId: user.id,
        workshopId: dto.workshopId,
        paymentCircuitOpen,
      });
      res.status(HttpStatus.ACCEPTED);
      return queued.response;
    }

    res.status(HttpStatus.CREATED);
    const result = await this.svc.create(user.id, dto.workshopId, {
      paymentCircuitOpen,
    });
    return {
      regId: result.registration.id,
      registrationId: result.registration.id,
      status: result.registration.status,
      paymentRequired: result.paymentRequired,
      holdExpiresAt: result.holdExpiresAt,
      qrToken: result.qrToken,
      qrImageDataUrl: result.qrImageDataUrl,
      paymentUnavailable: result.paymentUnavailable,
    };
  }

  @Roles('STUDENT')
  @Get('registrations/processing/:processingId')
  async processingStatus(
    @Param('processingId') processingId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const status = await this.queue.getStatusForUser(processingId, user.id);
    res.status(status.httpStatus ?? (status.status === 'SUCCEEDED' ? HttpStatus.OK : HttpStatus.ACCEPTED));
    return {
      processingId: status.processingId,
      status: status.status,
      workshopId: status.workshopId,
      queuedAt: status.queuedAt,
      updatedAt: status.updatedAt,
      result: status.response,
      error: status.error,
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

  @Roles('ORGANIZER', 'SYS_ADMIN')
  @Get('admin/registrations')
  async listAdmin(
    @CurrentUser() user: AuthenticatedUser,
    @Query('workshopId') workshopId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const normalizedStatus =
      status && ['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED'].includes(status)
        ? (status as 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED')
        : undefined;

    return this.svc.listAdmin(user, {
      workshopId,
      status: normalizedStatus,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
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
