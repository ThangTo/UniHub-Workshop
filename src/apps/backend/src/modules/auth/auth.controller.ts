import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { JwksService } from './jwks.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { AuthenticatedUser } from '../../common/types/auth.types';

/**
 * Auth endpoints theo specs/auth.md §A-D.
 *
 * POST /auth/register  — SV đăng ký (public, rate-limited 3/giờ/IP)
 * POST /auth/login     — Đăng nhập (public, rate-limited 10/phút/IP)
 * POST /auth/refresh   — Refresh token rotation (public)
 * POST /auth/logout    — Logout (authenticated)
 * GET  /auth/me        — Thông tin user hiện tại (authenticated)
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwks: JwksService,
  ) {}

  /**
   * Mobile cache public key này để verify QR token offline (specs/checkin.md §E).
   * Public — không cần auth.
   */
  @Public()
  @Get('jwks')
  jwksPublic() {
    return {
      alg: 'RS256',
      issuer: this.jwks.issuer(),
      publicKey: this.jwks.getPublicKey(),
    };
  }

  @Public()
  @RateLimit({
    scope: 'ip',
    bucket: 'auth-register',
    capacity: 3,
    refillPerSec: 3 / 3600,
    failClosed: true,
  })
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, req.ip);
  }

  @Public()
  @RateLimit({
    scope: 'ip',
    bucket: 'auth-login',
    capacity: 10,
    refillPerSec: 1 / 60,
    failClosed: true,
  })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, req.ip);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.authService.refresh(dto, req.ip);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    await this.authService.logout(user.id, user.jti, req.ip);
    return { message: 'Logged out' };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.id);
  }
}
