import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../types/auth.types';
import { RoleName } from '../types/role.enum';

/**
 * RolesGuard theo auth.md §E:
 *
 * 1. Đọc `@Roles(...)` metadata.
 * 2. Nếu không có → cho qua (endpoint không yêu cầu role cụ thể).
 * 3. Nếu user.roles giao với required roles ≥ 1 → cho qua.
 * 4. Ngược lại → 403 `insufficient_permission`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<RoleName[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = req.user;
    if (!user) {
      throw new ForbiddenException('insufficient_permission');
    }

    const hasRole = user.roles.some((r) => requiredRoles.includes(r));
    if (!hasRole) {
      throw new ForbiddenException('insufficient_permission');
    }
    return true;
  }
}
