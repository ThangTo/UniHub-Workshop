import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { Observable, of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { createHash } from 'crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { AppConfigService } from '../config/app-config.service';
import { IDEMPOTENT_KEY, IdempotentOptions } from '../decorators/idempotent.decorator';
import { AuthenticatedUser } from '../types/auth.types';

/**
 * IdempotencyInterceptor theo blueprint specs/idempotency.md.
 *
 * Luồng:
 * 1. Đọc header `Idempotency-Key`.
 * 2. Tính `request_hash = sha256(canonical_body)`.
 * 3. Check Redis `idem:{endpoint}:{key}` → replay nếu completed.
 * 4. Fallback DB `idempotency_keys`.
 * 5. SET NX Redis + INSERT DB pending → xử lý business logic.
 * 6. Sau khi xong → update completed + snapshot.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly cfg: AppConfigService,
  ) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const opts = this.reflector.getAllAndOverride<IdempotentOptions | undefined>(
      IDEMPOTENT_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!opts) return next.handle();

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const res = ctx.switchToHttp().getResponse<Response>();

    const key = req.headers['idempotency-key'] as string | undefined;
    if (!key) {
      if (opts.required !== false) {
        throw new BadRequestException('idempotency_key_required');
      }
      return next.handle();
    }

    if (key.length > 128 || key.length < 1) {
      throw new BadRequestException('invalid_idempotency_key');
    }

    const endpoint = `${req.method} ${req.route?.path ?? req.path}`;
    const hash = this.canonicalHash(req.body, opts.intentFields);
    const redisKey = `idem:${endpoint}:${key}`;
    const ttl = this.cfg.idempotency.redisTtlSec;

    // --- 1. Check Redis ---
    const cached = await this.safeRedisGet(redisKey);
    if (cached) {
      const snap = JSON.parse(cached) as IdempotencySnapshot;
      if (snap.request_hash !== hash) {
        throw new UnprocessableEntityException('idempotency_key_reused');
      }
      if (snap.completed) {
        this.logger.debug(`Idempotency replay key=${key}`);
        res.status(snap.status_code);
        return of(snap.response_body);
      }
      // Chưa completed → đợi ngắn rồi check lại (tối đa 3 lần × 100ms)
      const replayed = await this.waitForCompletion(redisKey, hash, res);
      if (replayed !== null) return replayed;
    }

    // --- 2. Fallback DB ---
    const dbSnap = await this.prisma.idempotencyKey.findUnique({
      where: { key_endpoint: { key, endpoint } },
    });
    if (dbSnap) {
      if (dbSnap.requestHash !== hash) {
        throw new UnprocessableEntityException('idempotency_key_reused');
      }
      if (dbSnap.completed && dbSnap.statusCode != null) {
        await this.safeRedisSet(redisKey, {
          request_hash: hash,
          status_code: dbSnap.statusCode,
          response_body: dbSnap.responseBody,
          completed: true,
        }, ttl);
        res.status(dbSnap.statusCode);
        return of(dbSnap.responseBody);
      }
    }

    // --- 3. Claim key: Redis SET NX ---
    const claimed = await this.safeRedisSetNX(redisKey, {
      request_hash: hash,
      completed: false,
      created_at: new Date().toISOString(),
    }, ttl);

    if (!claimed) {
      // Race: ai đó đã claim → đợi
      const replayed = await this.waitForCompletion(redisKey, hash, res);
      if (replayed !== null) return replayed;
      // Nếu vẫn không xong, tiếp tục xử lý (fallback safe)
    }

    // --- 4. Insert pending row DB ---
    try {
      await this.prisma.idempotencyKey.create({
        data: {
          key,
          endpoint,
          userId: req.user?.id ?? null,
          requestHash: hash,
          completed: false,
          expiresAt: new Date(Date.now() + ttl * 1000),
        },
      });
    } catch {
      // Conflict = row đã tồn tại → coi như claimed bởi request khác
    }

    // --- 5. Execute business logic ---
    return next.handle().pipe(
      tap(async (body) => {
        const statusCode = res.statusCode ?? 200;
        await this.completeSnapshot(key, endpoint, hash, statusCode, body, ttl, redisKey);
      }),
      catchError(async (err) => {
        const statusCode = err?.status ?? 500;
        const responseBody = err?.response ?? { message: err?.message };
        await this.completeSnapshot(key, endpoint, hash, statusCode, responseBody, ttl, redisKey);
        throw err;
      }),
    );
  }

  private async completeSnapshot(
    key: string,
    endpoint: string,
    hash: string,
    statusCode: number,
    responseBody: unknown,
    ttl: number,
    redisKey: string,
  ): Promise<void> {
    try {
      await this.prisma.idempotencyKey.update({
        where: { key_endpoint: { key, endpoint } },
        data: {
          statusCode,
          responseBody: responseBody as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          completed: true,
        },
      });
    } catch (e) {
      this.logger.warn(`Idempotency DB update failed: ${(e as Error).message}`);
    }
    await this.safeRedisSet(redisKey, {
      request_hash: hash,
      status_code: statusCode,
      response_body: responseBody,
      completed: true,
    }, ttl);
  }

  private async waitForCompletion(
    redisKey: string,
    hash: string,
    res: Response,
  ): Promise<Observable<unknown> | null> {
    for (let i = 0; i < 3; i++) {
      await this.sleep(100);
      const raw = await this.safeRedisGet(redisKey);
      if (!raw) continue;
      const snap = JSON.parse(raw) as IdempotencySnapshot;
      if (snap.request_hash !== hash) {
        throw new UnprocessableEntityException('idempotency_key_reused');
      }
      if (snap.completed) {
        res.status(snap.status_code);
        return of(snap.response_body);
      }
    }
    return null;
  }

  private canonicalHash(body: unknown, intentFields?: string[]): string {
    let obj = body;
    if (intentFields && typeof body === 'object' && body !== null) {
      const filtered: Record<string, unknown> = {};
      for (const f of intentFields) {
        if (f in (body as Record<string, unknown>)) {
          filtered[f] = (body as Record<string, unknown>)[f];
        }
      }
      obj = filtered;
    }
    const sorted = JSON.stringify(obj, Object.keys(obj as Record<string, unknown>).sort());
    return createHash('sha256').update(sorted).digest('hex');
  }

  // --- Redis safe wrappers ---
  private async safeRedisGet(key: string): Promise<string | null> {
    try {
      return await this.redis.getClient().get(key);
    } catch {
      return null;
    }
  }

  private async safeRedisSet(key: string, data: IdempotencySnapshot, ttl: number): Promise<void> {
    try {
      await this.redis.getClient().set(key, JSON.stringify(data), 'EX', ttl);
    } catch { /* best effort */ }
  }

  private async safeRedisSetNX(key: string, data: object, ttl: number): Promise<boolean> {
    try {
      const result = await this.redis.getClient().set(key, JSON.stringify(data), 'EX', ttl, 'NX');
      return result === 'OK';
    } catch {
      return false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

interface IdempotencySnapshot {
  request_hash: string;
  status_code: number;
  response_body: unknown;
  completed: boolean;
}
