import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { AuthenticatedUser } from '../../common/types/auth.types';
import { AppConfigService } from '../../common/config/app-config.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { PaymentService } from './payment.service';

@Controller()
export class PaymentController {
  constructor(
    private readonly svc: PaymentService,
    private readonly cfg: AppConfigService,
  ) {}

  /**
   * Khởi tạo payment cho registration. Bắt buộc Idempotency-Key.
   */
  @Roles('STUDENT')
  @RateLimit({ scope: 'user', bucket: 'payments', capacity: 5, refillPerSec: 0.5, failClosed: true })
  @Idempotent({ required: true, intentFields: ['registrationId'] })
  @Post('payments')
  async initiate(
    @Body() dto: InitiatePaymentDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idemKey: string,
  ) {
    const result = await this.svc.initiate(user.id, dto.registrationId, idemKey);
    return {
      status: result.status,
      paymentId: result.payment.id,
      attemptNo: result.payment.attemptNo,
      gatewayTxnId: result.payment.gatewayTxnId,
      qrToken: result.qrToken,
      qrImageDataUrl: result.qrImageDataUrl,
      retryAfterSec: result.retryAfterSec,
    };
  }

  @Roles('STUDENT')
  @Get('payments/:id')
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.svc.getForStudent(user.id, id);
  }

  /**
   * Webhook callback từ Mock Payment Gateway.
   * Verify HMAC `X-Mock-Pg-Signature` (sha256(secret, raw_body)).
   * Public: không cần JWT.
   */
  @Public()
  @Post('payments/webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-mock-pg-signature') signature: string,
    @Body() body: {
      type: string;
      chargeId: string;
      idempotencyKey: string;
      regId: string;
      status: 'SUCCESS' | 'FAILED' | 'PENDING';
      amount: number;
      failureReason?: string;
    },
  ) {
    if (!signature) throw new UnauthorizedException('missing_signature');
    if (!body || !body.idempotencyKey) throw new BadRequestException('invalid_payload');

    // Recompute HMAC từ JSON-stringified body (mock-pg dùng JSON.stringify, không có whitespace canonicalization).
    // Cho production thực sự cần raw body — ở đây JSON.stringify rebuild đủ chính xác cho mock.
    const expected = crypto
      .createHmac('sha256', this.cfg.payment.webhookSecret)
      .update(JSON.stringify(body))
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      throw new UnauthorizedException('invalid_signature');
    }

    await this.svc.handleWebhook(body);
    return { ok: true };
  }

  /**
   * Health của Circuit Breaker (specs/circuit-breaker.md §B).
   */
  @Public()
  @Get('system/health/payment')
  async health() {
    return this.svc.getHealth();
  }
}
