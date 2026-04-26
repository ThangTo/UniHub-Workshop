import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { RedisService } from '../../infra/redis/redis.service';
import { RATE_LIMIT_KEY, RateLimitOptions } from '../decorators/rate-limit.decorator';
import { AuthenticatedUser } from '../types/auth.types';

/**
 * Lua Token Bucket theo rate-limiting.md §C.
 * Chạy atomic trên Redis, trả [allowed, tokensLeft, retryAfter].
 */
const TOKEN_BUCKET_LUA = `
local data = redis.call("HMGET", KEYS[1], "tokens", "last_refill")
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local tokens = tonumber(data[1]) or capacity
local last = tonumber(data[2]) or now_ms
local elapsed = (now_ms - last) / 1000.0

tokens = math.min(capacity, tokens + elapsed * refill)

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call("HMSET", KEYS[1], "tokens", tokens, "last_refill", now_ms)
redis.call("EXPIRE", KEYS[1], math.ceil(capacity / refill) * 2 + 60)

local retry_after = 0
if allowed == 0 then
  retry_after = math.ceil((cost - tokens) / refill)
end

return { allowed, math.floor(tokens), retry_after }
`;

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const opts = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!opts) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const res = ctx.switchToHttp().getResponse<Response>();

    const identifier =
      opts.scope === 'user' && req.user
        ? `user:${req.user.id}`
        : `ip:${this.getIp(req)}`;

    const key = `ratelimit:${identifier}:${opts.bucket}`;
    const cost = opts.cost ?? 1;
    const nowMs = Date.now();

    try {
      const result = (await this.redis
        .getClient()
        .eval(
          TOKEN_BUCKET_LUA,
          1,
          key,
          opts.capacity,
          opts.refillPerSec,
          nowMs,
          cost,
        )) as [number, number, number];

      const [allowed, remaining, retryAfter] = result;

      res.setHeader('X-RateLimit-Limit', opts.capacity);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));

      if (!allowed) {
        res.setHeader('Retry-After', retryAfter);
        throw new HttpException(
          { code: 'rate_limited', message: 'Too many requests', retryAfter },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      return true;
    } catch (e) {
      if (e instanceof HttpException) throw e;
      // Redis down fallback
      this.logger.warn(`Rate limit Redis error: ${(e as Error).message}`);
      if (opts.failClosed) {
        throw new HttpException(
          { code: 'rate_limited', message: 'Service temporarily unavailable' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      // fail-open cho read endpoints (catalog)
      return true;
    }
  }

  private getIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
    return req.ip ?? req.socket.remoteAddress ?? 'unknown';
  }
}
