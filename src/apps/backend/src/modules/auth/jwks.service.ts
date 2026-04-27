import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import { AppConfigService } from '../../common/config/app-config.service';
import { JwtAccessPayload } from '../../common/types/auth.types';
import { RoleName } from '../../common/types/role.enum';

/**
 * JwksService — quản lý RSA keypair cho JWT RS256.
 *
 * Theo auth.md §A-D:
 * - Đọc keypair từ env (`JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`).
 * - Nếu thiếu → auto-generate trong RAM (dev only, sẽ mất khi restart).
 * - Access token TTL 15 phút; chứa sub, roles, jti.
 */
@Injectable()
export class JwksService implements OnModuleInit {
  private readonly logger = new Logger(JwksService.name);
  private privateKey!: string;
  private publicKey!: string;

  constructor(private readonly cfg: AppConfigService) {}

  onModuleInit(): void {
    const { privateKey, publicKey } = this.cfg.auth;
    if (privateKey && publicKey) {
      this.privateKey = privateKey;
      this.publicKey = publicKey;
      this.logger.log('JWT RSA keys loaded from env');
      return;
    }
    this.logger.warn(
      'JWT_PRIVATE_KEY / JWT_PUBLIC_KEY not set — generating ephemeral pair (dev only!)',
    );
    const generated = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    this.privateKey = generated.privateKey;
    this.publicKey = generated.publicKey;
  }

  /**
   * Tạo access token JWT RS256.
   */
  signAccessToken(
    userId: string,
    roles: RoleName[],
  ): { token: string; jti: string; expiresIn: string } {
    const jti = uuid();
    const expiresIn = this.cfg.auth.accessTtl; // '15m'
    const payload = { sub: userId, roles, jti };
    const token = jwt.sign(payload, this.privateKey, {
      algorithm: 'RS256',
      expiresIn: expiresIn as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      issuer: this.cfg.auth.issuer,
    } as jwt.SignOptions);
    return { token, jti, expiresIn };
  }

  /**
   * Verify + decode access token. Throws nếu invalid/expired.
   */
  verifyAccessToken(token: string): JwtAccessPayload {
    return jwt.verify(token, this.publicKey, {
      algorithms: ['RS256'],
      issuer: this.cfg.auth.issuer,
    } as jwt.VerifyOptions) as JwtAccessPayload;
  }

  getPublicKey(): string {
    return this.publicKey;
  }

  issuer(): string {
    return this.cfg.auth.issuer;
  }

  /**
   * Generic helper để các service khác (QrTokenService, ...) ký RS256 mà không cần
   * reach vào private field.
   */
  signRs256(payload: object, opts: jwt.SignOptions = {}): string {
    return jwt.sign(payload, this.privateKey, {
      algorithm: 'RS256',
      issuer: this.cfg.auth.issuer,
      ...opts,
    } as jwt.SignOptions);
  }

  verifyRs256<T extends object = jwt.JwtPayload>(token: string, opts: jwt.VerifyOptions = {}): T {
    return jwt.verify(token, this.publicKey, {
      algorithms: ['RS256'],
      issuer: this.cfg.auth.issuer,
      ...opts,
    } as jwt.VerifyOptions) as T;
  }
}
