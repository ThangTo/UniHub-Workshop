import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Typed wrapper quanh `ConfigService` để tránh dùng string keys rải rác.
 * Mọi env var có giá trị mặc định an toàn cho dev và bắt buộc trong prod.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly raw: ConfigService) {}

  get nodeEnv(): string {
    return this.raw.get<string>('NODE_ENV', 'development');
  }

  get isProd(): boolean {
    return this.nodeEnv === 'production';
  }

  get backendPort(): number {
    return Number(this.raw.get<string>('BACKEND_PORT', '3000'));
  }

  get logLevel(): string {
    return this.raw.get<string>('LOG_LEVEL', this.isProd ? 'info' : 'debug');
  }

  get corsOrigins(): string[] {
    return this.raw
      .get<string>('CORS_ORIGINS', 'http://localhost:5173,http://localhost:5174')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // --- Database / Redis / RabbitMQ ---
  get databaseUrl(): string {
    return this.required('DATABASE_URL');
  }

  get redisUrl(): string {
    return this.raw.get<string>('REDIS_URL', 'redis://localhost:6379');
  }

  get rabbitmqUrl(): string {
    return this.raw.get<string>('RABBITMQ_URL', 'amqp://unihub:unihub@localhost:5672');
  }

  // --- MinIO ---
  get minio(): {
    endpoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    bucket: string;
    publicEndpoint: string;
  } {
    return {
      endpoint: this.raw.get<string>('MINIO_ENDPOINT', 'localhost'),
      port: Number(this.raw.get<string>('MINIO_PORT', '9000')),
      useSSL: this.raw.get<string>('MINIO_USE_SSL', 'false') === 'true',
      accessKey: this.raw.get<string>('MINIO_ROOT_USER', 'unihub'),
      secretKey: this.raw.get<string>('MINIO_ROOT_PASSWORD', 'unihub-secret'),
      bucket: this.raw.get<string>('MINIO_BUCKET', 'unihub'),
      publicEndpoint: this.raw.get<string>('MINIO_PUBLIC_ENDPOINT', 'http://localhost:9000'),
    };
  }

  // --- SMTP ---
  get smtp(): { host: string; port: number; from: string } {
    return {
      host: this.raw.get<string>('SMTP_HOST', 'localhost'),
      port: Number(this.raw.get<string>('SMTP_PORT', '1025')),
      from: this.raw.get<string>('SMTP_FROM', 'UniHub <no-reply@unihub.local>'),
    };
  }

  // --- Auth ---
  get auth(): {
    accessTtl: string;
    refreshTtl: string;
    issuer: string;
    privateKey: string;
    publicKey: string;
    bcryptCost: number;
    bootstrapAdminEmail: string;
    bootstrapAdminPassword: string;
    bootstrapAdminName: string;
  } {
    // Cho phép xuống dòng "\n" literal trong .env single-line (chuẩn dotenv).
    const decode = (raw: string): string => raw.replace(/\\n/g, '\n');
    return {
      accessTtl: this.raw.get<string>('JWT_ACCESS_TTL', '15m'),
      refreshTtl: this.raw.get<string>('JWT_REFRESH_TTL', '7d'),
      issuer: this.raw.get<string>('JWT_ISSUER', 'unihub-workshop'),
      privateKey: decode(this.raw.get<string>('JWT_PRIVATE_KEY', '')),
      publicKey: decode(this.raw.get<string>('JWT_PUBLIC_KEY', '')),
      bcryptCost: Number(this.raw.get<string>('BCRYPT_COST', '12')),
      bootstrapAdminEmail: this.raw.get<string>('BOOTSTRAP_ADMIN_EMAIL', ''),
      bootstrapAdminPassword: this.raw.get<string>('BOOTSTRAP_ADMIN_PASSWORD', ''),
      bootstrapAdminName: this.raw.get<string>('BOOTSTRAP_ADMIN_NAME', 'System Admin'),
    };
  }

  // --- Payment ---
  get payment(): {
    gatewayUrl: string;
    webhookSecret: string;
    timeoutMs: number;
    cbErrorThreshold: number;
    cbResetTimeoutMs: number;
    cbVolumeThreshold: number;
    cbRollingWindowMs: number;
  } {
    return {
      gatewayUrl: this.raw.get<string>('MOCK_PG_URL', 'http://localhost:4000'),
      webhookSecret: this.raw.get<string>('MOCK_PG_WEBHOOK_SECRET', 'mock-pg-secret'),
      timeoutMs: Number(this.raw.get<string>('PAYMENT_TIMEOUT_MS', '3000')),
      cbErrorThreshold: Number(this.raw.get<string>('PAYMENT_CB_ERROR_THRESHOLD', '50')),
      cbResetTimeoutMs: Number(this.raw.get<string>('PAYMENT_CB_RESET_MS', '30000')),
      cbVolumeThreshold: Number(this.raw.get<string>('PAYMENT_CB_VOLUME_THRESHOLD', '20')),
      cbRollingWindowMs: Number(this.raw.get<string>('PAYMENT_CB_ROLLING_MS', '10000')),
    };
  }

  // --- Rate limit ---
  get rateLimit(): { globalRegistrationRps: number; regQueueTtlSec: number } {
    return {
      globalRegistrationRps: Number(
        this.raw.get<string>('RATE_LIMIT_GLOBAL_REGISTRATION_RPS', '500'),
      ),
      regQueueTtlSec: Number(this.raw.get<string>('RATE_LIMIT_REGQUEUE_TTL_SECONDS', '10')),
    };
  }

  // --- Idempotency ---
  get idempotency(): { redisTtlSec: number } {
    return {
      redisTtlSec: Number(this.raw.get<string>('IDEMPOTENCY_REDIS_TTL_SECONDS', '86400')),
    };
  }

  // --- Circuit breaker (payment) ---
  get cbPayment(): {
    timeoutMs: number;
    errorThreshold: number;
    resetTimeoutMs: number;
    volumeThreshold: number;
  } {
    return {
      timeoutMs: Number(this.raw.get<string>('CB_PAYMENT_TIMEOUT_MS', '3000')),
      errorThreshold: Number(this.raw.get<string>('CB_PAYMENT_ERROR_THRESHOLD', '50')),
      resetTimeoutMs: Number(this.raw.get<string>('CB_PAYMENT_RESET_TIMEOUT_MS', '30000')),
      volumeThreshold: Number(this.raw.get<string>('CB_PAYMENT_VOLUME_THRESHOLD', '10')),
    };
  }

  // --- Mock services ---
  get mockPgUrl(): string {
    return this.raw.get<string>('MOCK_PG_URL', 'http://localhost:4000');
  }

  get mockPgWebhookSecret(): string {
    return this.raw.get<string>('MOCK_PG_WEBHOOK_SECRET', 'mock-pg-secret');
  }

  get mockAiUrl(): string {
    return this.raw.get<string>('MOCK_AI_URL', 'http://localhost:4100');
  }

  // --- CSV ---
  get csv(): {
    dropDir: string;
    quarantineDir: string;
    archiveDir: string;
    cron: string;
  } {
    return {
      dropDir: this.raw.get<string>('CSV_DROP_DIR', './data/csv-drop'),
      quarantineDir: this.raw.get<string>('CSV_QUARANTINE_DIR', './data/csv-quarantine'),
      archiveDir: this.raw.get<string>('CSV_ARCHIVE_DIR', './data/csv-archive'),
      cron: this.raw.get<string>('CSV_CRON', '0 2 * * *'),
    };
  }

  private required(key: string): string {
    const v = this.raw.get<string>(key);
    if (!v) {
      throw new Error(`Missing required env: ${key}`);
    }
    return v;
  }
}
