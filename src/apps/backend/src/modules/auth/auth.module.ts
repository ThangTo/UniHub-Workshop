import { Module, OnModuleInit } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwksService } from './jwks.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { BootstrapService } from './bootstrap.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';

/**
 * AuthModule wires:
 * - JwksService (RSA keypair, sign/verify)
 * - AuthService (register/login/refresh/logout)
 * - BootstrapService (seed roles + admin)
 * - Global guards: JwtAuthGuard → RolesGuard → RateLimitGuard
 *
 * Sau khi JwksService init, inject verifier vào JwtAuthGuard.
 */
@Module({
  controllers: [AuthController],
  providers: [
    JwksService,
    AuthService,
    BootstrapService,
    // Concrete providers (injectable elsewhere)
    JwtAuthGuard,
    RolesGuard,
    RateLimitGuard,
    // Đăng ký global guards (cùng instance) — thứ tự áp dụng: JWT → Roles → RateLimit
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
    { provide: APP_GUARD, useExisting: RateLimitGuard },
  ],
  exports: [JwksService, AuthService],
})
export class AuthModule implements OnModuleInit {
  constructor(
    private readonly jwks: JwksService,
    private readonly jwtGuard: JwtAuthGuard,
  ) {}

  onModuleInit(): void {
    // Wire verifier lazy — JwksService đã load keys trong onModuleInit của nó
    this.jwtGuard.setVerifier((token) => this.jwks.verifyAccessToken(token));
  }
}
