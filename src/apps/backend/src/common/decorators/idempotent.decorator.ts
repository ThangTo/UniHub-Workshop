import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent';

/**
 * Bật `IdempotencyInterceptor` cho method.
 * - `required=true` (mặc định) → thiếu header `Idempotency-Key` trả 400.
 * - `required=false` → bỏ qua nếu không có header (vd: PDF upload).
 * - `intentFields` (optional) → chỉ định field nào tham gia hash; mặc định toàn body.
 */
export interface IdempotentOptions {
  required?: boolean;
  intentFields?: string[];
}

export const Idempotent = (
  opts: IdempotentOptions = { required: true },
): MethodDecorator & ClassDecorator => SetMetadata(IDEMPOTENT_KEY, opts);
