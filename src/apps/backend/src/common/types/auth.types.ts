import { RoleName } from './role.enum';

/**
 * Payload chứa trong JWT access token.
 * Khớp với spec auth.md §B.4.
 */
export interface JwtAccessPayload {
  sub: string; // userId
  roles: RoleName[];
  jti: string; // dùng để blacklist khi logout
  iat?: number;
  exp?: number;
}

/**
 * Object gắn vào `request.user` sau khi qua JwtAuthGuard.
 */
export interface AuthenticatedUser {
  id: string;
  roles: RoleName[];
  jti: string;
}
