import { SetMetadata } from '@nestjs/common';
import { RoleName } from '../types/role.enum';

export const ROLES_KEY = 'requiredRoles';

/**
 * Yêu cầu user có ít nhất 1 trong các role chỉ định.
 * Dùng kèm `RolesGuard`.
 *
 * @example
 * @Roles('ORGANIZER', 'SYS_ADMIN')
 * @Post()
 * createWorkshop() {}
 */
export const Roles = (...roles: RoleName[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
