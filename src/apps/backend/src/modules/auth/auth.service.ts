import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { AppConfigService } from '../../common/config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { JwksService } from './jwks.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RoleName } from '../../common/types/role.enum';

/**
 * AuthService theo blueprint specs/auth.md.
 *
 * - Register: validate MSSV trong bảng students, tạo user + gán STUDENT.
 * - Login: bcrypt verify, lockout 5×15p, access+refresh token.
 * - Refresh: token rotation + revoke old.
 * - Logout: revoke refresh + blacklist jti trên Redis.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly cfg: AppConfigService,
    private readonly jwks: JwksService,
    private readonly audit: AuditService,
  ) {}

  // ==================== REGISTER ====================
  async register(dto: RegisterDto, ip?: string) {
    // 1. MSSV phải tồn tại trong bảng students
    const student = await this.prisma.student.findUnique({
      where: { studentCode: dto.studentCode },
    });
    if (!student) {
      throw new UnprocessableEntityException({
        code: 'student_not_found',
        message: 'MSSV không có trong hệ thống. Vui lòng liên hệ phòng đào tạo.',
      });
    }
    if (!student.isActive) {
      throw new UnprocessableEntityException({
        code: 'student_inactive',
        message: 'MSSV đã bị vô hiệu hoá (tốt nghiệp/nghỉ học).',
      });
    }

    // 2. Email chưa tồn tại
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException({ code: 'email_already_used', message: 'Email đã được sử dụng.' });
    }

    // 3. MSSV chưa link
    const linked = await this.prisma.user.findUnique({ where: { studentCode: dto.studentCode } });
    if (linked) {
      throw new ConflictException({ code: 'student_code_already_linked', message: 'MSSV đã được liên kết với tài khoản khác.' });
    }

    // 4. Tạo user + gán role STUDENT trong 1 transaction
    const passwordHash = await bcrypt.hash(dto.password, this.cfg.auth.bcryptCost);
    const studentRole = await this.prisma.role.findUnique({ where: { name: 'STUDENT' } });
    if (!studentRole) throw new Error('Role STUDENT not found — run seed first');

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        studentCode: dto.studentCode,
        phone: dto.phone ?? null,
        roles: { create: { roleId: studentRole.id } },
      },
    });

    // 5. Sinh token
    const tokens = await this.issueTokens(user.id, ['STUDENT']);

    await this.audit.log({ actorId: user.id, action: 'register_success', resource: 'user', resourceId: user.id, ipAddress: ip });

    return { userId: user.id, ...tokens };
  }

  // ==================== LOGIN ====================
  async login(dto: LoginDto, ip?: string) {
    const lockKey = `lockout:${dto.email}`;

    // Kiểm tra lockout
    const lockVal = await this.safeRedisGet(lockKey);
    if (lockVal) {
      const ttl = await this.redis.getClient().ttl(lockKey);
      throw new HttpException(
        { code: 'account_locked', message: 'Tài khoản bị khoá tạm thời do đăng nhập sai quá nhiều lần.' },
        423,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { roles: { include: { role: true } } },
    });
    if (!user || !user.isActive) {
      await this.incrementFailedAttempts(dto.email);
      await this.audit.log({ action: 'login_failed', metadata: { email: dto.email, reason: 'user_not_found' }, ipAddress: ip });
      throw new UnauthorizedException('invalid_credentials');
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.incrementFailedAttempts(dto.email);
      await this.audit.log({ actorId: user.id, action: 'login_failed', resource: 'user', resourceId: user.id, ipAddress: ip });
      throw new UnauthorizedException('invalid_credentials');
    }

    // Reset failed attempts
    await this.redis.getClient().del(`login_attempts:${dto.email}`).catch(() => {});

    const roles = user.roles.map((ur) => ur.role.name as RoleName);
    const tokens = await this.issueTokens(user.id, roles);

    await this.audit.log({ actorId: user.id, action: 'login_success', resource: 'user', resourceId: user.id, ipAddress: ip });

    return {
      userId: user.id,
      fullName: user.fullName,
      roles,
      ...tokens,
    };
  }

  // ==================== REFRESH ====================
  async refresh(dto: RefreshDto, ip?: string) {
    const tokenHash = this.hashToken(dto.refreshToken);

    const rt = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!rt || rt.revokedAt || rt.expiresAt < new Date()) {
      // Token theft suspected: nếu token đã revoke → revoke ALL
      if (rt?.revokedAt) {
        await this.prisma.refreshToken.updateMany({
          where: { userId: rt.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        this.logger.warn(`Refresh token reuse detected for user=${rt.userId} — revoked all tokens`);
        await this.audit.log({ actorId: rt.userId, action: 'refresh_reuse_detected', resource: 'user', resourceId: rt.userId, ipAddress: ip });
      }
      throw new UnauthorizedException('invalid_refresh_token');
    }

    // Token rotation: revoke old
    await this.prisma.refreshToken.update({
      where: { id: rt.id },
      data: { revokedAt: new Date() },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: rt.userId },
      include: { roles: { include: { role: true } } },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('user_inactive');
    }

    const roles = user.roles.map((ur) => ur.role.name as RoleName);
    const tokens = await this.issueTokens(user.id, roles);

    await this.audit.log({ actorId: user.id, action: 'refresh', resource: 'user', resourceId: user.id, ipAddress: ip });

    return { userId: user.id, roles, ...tokens };
  }

  // ==================== LOGOUT ====================
  async logout(userId: string, jti: string, ip?: string) {
    // Revoke tất cả refresh tokens
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    // Blacklist access token jti trên Redis (TTL = thời gian còn lại của token)
    // Fallback: TTL cố định = access token TTL max (15 phút = 900 giây)
    try {
      await this.redis.getClient().set(`jwt:blacklist:${jti}`, '1', 'EX', 900);
    } catch (e) {
      this.logger.warn(`Redis blacklist failed for jti=${jti}: ${(e as Error).message}`);
    }

    await this.audit.log({ actorId: userId, action: 'logout', resource: 'user', resourceId: userId, ipAddress: ip });
  }

  // ==================== ME ====================
  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new UnauthorizedException('user_not_found');

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      studentCode: user.studentCode,
      phone: user.phone,
      roles: user.roles.map((ur) => ur.role.name),
      createdAt: user.createdAt,
    };
  }

  // ==================== HELPERS ====================
  private async issueTokens(userId: string, roles: RoleName[]) {
    const { token: accessToken, jti, expiresIn } = this.jwks.signAccessToken(userId, roles);

    // Sinh refresh token raw
    const raw = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(raw);
    const refreshTtlMs = this.parseTtl(this.cfg.auth.refreshTtl);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + refreshTtlMs),
      },
    });

    return { accessToken, refreshToken: raw, expiresIn };
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private async incrementFailedAttempts(email: string): Promise<void> {
    const key = `login_attempts:${email}`;
    try {
      const count = await this.redis.getClient().incr(key);
      if (count === 1) {
        await this.redis.getClient().expire(key, 900); // 15 phút window
      }
      if (count >= 5) {
        // Khoá 30 phút
        await this.redis.getClient().set(`lockout:${email}`, '1', 'EX', 1800);
        await this.redis.getClient().del(key);
      }
    } catch (e) {
      this.logger.warn(`Redis lockout error: ${(e as Error).message}`);
    }
  }

  private async safeRedisGet(key: string): Promise<string | null> {
    try {
      return await this.redis.getClient().get(key);
    } catch {
      return null;
    }
  }

  private parseTtl(ttl: string): number {
    const match = ttl.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 24 * 3600 * 1000; // 7d fallback
    const n = parseInt(match[1], 10);
    switch (match[2]) {
      case 's': return n * 1000;
      case 'm': return n * 60 * 1000;
      case 'h': return n * 3600 * 1000;
      case 'd': return n * 86400 * 1000;
      default: return n * 1000;
    }
  }
}
