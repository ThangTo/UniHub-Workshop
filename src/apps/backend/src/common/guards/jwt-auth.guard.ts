import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedUser, JwtAccessPayload } from '../types/auth.types';
import { RedisService } from '../../infra/redis/redis.service';

/**
 * JwtAuthGuard theo blueprint auth.md §E:
 *
 * 1. Bỏ qua nếu @Public().
 * 2. Verify JWT RS256 signature + exp bằng JwksService (inject lazy qua module ref).
 * 3. Kiểm tra `jwt:blacklist:{jti}` trên Redis (logout invalidation).
 *    - Redis down → cho qua nhưng log warning (chấp nhận rủi ro nhỏ theo spec).
 * 4. Gắn `request.user: AuthenticatedUser`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  // JwksService inject lazy bên auth module → setter
  private verifyFn?: (token: string) => JwtAccessPayload;
  setVerifier(fn: (token: string) => JwtAccessPayload): void {
    this.verifyFn = fn;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('token_required');

    if (!this.verifyFn) {
      throw new UnauthorizedException('auth_not_initialized');
    }

    let payload: JwtAccessPayload;
    try {
      payload = this.verifyFn(token);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'unknown';
      if (msg.includes('expired')) throw new UnauthorizedException('token_expired');
      if (msg.includes('signature')) throw new UnauthorizedException('invalid_signature');
      throw new UnauthorizedException('invalid_token');
    }

    // Blacklist check (logout)
    try {
      const blacklisted = await this.redis.getClient().get(`jwt:blacklist:${payload.jti}`);
      if (blacklisted) throw new UnauthorizedException('token_revoked');
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      // Redis down → fail-open với warning (spec auth.md §Kịch bản lỗi)
      this.logger.warn(`Redis blacklist check failed for jti=${payload.jti}: ${(e as Error).message}`);
    }

    // Gắn vào request
    const user: AuthenticatedUser = {
      id: payload.sub,
      roles: payload.roles,
      jti: payload.jti,
    };
    (req as unknown as Record<string, unknown>)['user'] = user;
    return true;
  }

  private extractToken(req: Request): string | undefined {
    const auth = req.headers.authorization;
    if (!auth) return undefined;
    const [type, token] = auth.split(' ');
    return type === 'Bearer' ? token : undefined;
  }
}
