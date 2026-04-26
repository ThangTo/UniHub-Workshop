import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

/**
 * Cấu hình bucket theo spec rate-limiting.md §B.
 * - `scope=ip`   : key = ratelimit:ip:{ip}:{bucket}
 * - `scope=user` : key = ratelimit:user:{userId}:{bucket}, fallback ip nếu chưa auth
 * - `bucket`     : tên bucket (vd: 'site', 'registrations', 'payments', 'auth-login')
 * - `capacity`   : tokens tối đa
 * - `refillPerSec`: số token refill mỗi giây
 * - `cost`       : chi phí mỗi request (mặc định 1)
 * - `failClosed` : true → khi Redis lỗi, từ chối; false → cho qua (catalog read)
 */
export interface RateLimitOptions {
  scope: 'ip' | 'user';
  bucket: string;
  capacity: number;
  refillPerSec: number;
  cost?: number;
  failClosed?: boolean;
}

export const RateLimit = (opts: RateLimitOptions): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_KEY, opts);
