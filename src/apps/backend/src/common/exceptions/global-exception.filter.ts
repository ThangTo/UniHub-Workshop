import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Chuẩn hoá mọi exception thành JSON response format:
 * { code: string, message: string, details?: any }
 *
 * - HttpException -> giữ status, lấy code từ payload nếu có.
 * - Lỗi không xác định -> 500 internal_error, log stack.
 * - Không bao giờ leak stack trace ra client trong production.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        code = this.guessCode(payload, status);
        message = payload;
      } else if (typeof payload === 'object' && payload !== null) {
        const p = payload as { code?: string; message?: string | string[]; details?: unknown };
        code = p.code ?? this.guessCode(undefined, status);
        const m = Array.isArray(p.message) ? p.message.join(', ') : (p.message ?? exception.message);
        message = m;
        details = p.details;
      }
    } else if (exception instanceof Error) {
      this.logger.error(`Unhandled error on ${req.method} ${req.url}: ${exception.message}`, exception.stack);
      message = exception.message || message;
    }

    res
      .status(status)
      .json({
        code,
        message,
        ...(details !== undefined ? { details } : {}),
        path: req.url,
        timestamp: new Date().toISOString(),
      });
  }

  private guessCode(text: string | undefined, status: number): string {
    if (text && /^[a-z0-9_]+$/.test(text)) return text;
    switch (status) {
      case 400: return 'bad_request';
      case 401: return 'unauthorized';
      case 403: return 'forbidden';
      case 404: return 'not_found';
      case 409: return 'conflict';
      case 422: return 'unprocessable';
      case 429: return 'rate_limited';
      default:  return 'internal_error';
    }
  }
}
