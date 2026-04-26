import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './infra/prisma/prisma.module';
import { RedisModule } from './infra/redis/redis.module';
import { AmqpModule } from './infra/amqp/amqp.module';
import { AppConfigModule } from './common/config/app-config.module';
import { HealthModule } from './health/health.module';
import { AuditModule } from './modules/audit/audit.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env'],
    }),
    ScheduleModule.forRoot(),
    // Infra
    PrismaModule,
    RedisModule,
    AmqpModule,
    AppConfigModule,
    // Cross-cutting
    AuditModule,
    OutboxModule,
    // Auth & RBAC (global guards JwtAuth + Roles + RateLimit registered here)
    AuthModule,
    // Domain modules
    UsersModule,
    CatalogModule,
    // Health check
    HealthModule,
  ],
  providers: [IdempotencyInterceptor],
})
export class AppModule {}
