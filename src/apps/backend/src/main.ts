import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfigService } from './common/config/app-config.service';
import { GlobalExceptionFilter } from './common/exceptions/global-exception.filter';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });
  const cfg = app.get(AppConfigService);
  const logger = new Logger('Bootstrap');

  app.use(helmet());
  app.enableCors({
    origin: cfg.corsOrigins,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(app.get(IdempotencyInterceptor));
  app.setGlobalPrefix('', { exclude: ['health', 'metrics'] });

  const port = cfg.backendPort;
  await app.listen(port, '0.0.0.0');
  logger.log(`UniHub backend listening on :${port} (env=${cfg.nodeEnv})`);
}

void bootstrap();
