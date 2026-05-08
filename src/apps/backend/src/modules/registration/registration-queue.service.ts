import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { RedisService } from '../../infra/redis/redis.service';
import { AppConfigService } from '../../common/config/app-config.service';

const ACTIVE_WORKSHOPS_KEY = 'regqueue:active_workshops';
const PROCESSING_PREFIX = 'regqueue:processing';
const GLOBAL_RATE_PREFIX = 'ratelimit:global:registrations';
const STATUS_TTL_SECONDS = 5 * 60;

export interface RegistrationQueueItem {
  processingId: string;
  userId: string;
  workshopId: string;
  paymentCircuitOpen: boolean;
  queuedAt: string;
  expiresAt: string;
}

export interface RegistrationQueueStatus {
  processingId: string;
  userId: string;
  workshopId: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED';
  queuedAt: string;
  updatedAt: string;
  httpStatus?: number;
  response?: unknown;
  error?: unknown;
}

@Injectable()
export class RegistrationQueueService {
  private readonly logger = new Logger(RegistrationQueueService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly cfg: AppConfigService,
  ) {}

  async shouldProcessSynchronously(): Promise<boolean> {
    const limit = this.cfg.rateLimit.globalRegistrationRps;
    if (limit <= 0) return true;

    try {
      const client = this.redis.getClient();
      const nowSec = Math.floor(Date.now() / 1000);
      const key = `${GLOBAL_RATE_PREFIX}:${nowSec}`;
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, 2);
      return count <= limit;
    } catch (e) {
      this.logger.warn(`Global registration rate check failed; processing inline: ${(e as Error).message}`);
      return true;
    }
  }

  async enqueue(input: {
    userId: string;
    workshopId: string;
    paymentCircuitOpen: boolean;
  }): Promise<RegistrationQueueStatus> {
    const client = this.redis.getClient();
    const cfg = this.cfg.rateLimit;
    const queueKey = this.queueKey(input.workshopId);
    const queuedTotal = await this.totalQueuedItems();
    if (queuedTotal >= cfg.regQueueMaxItems) {
      throw new ServiceUnavailableException({
        code: 'registration_queue_full',
        message: 'Registration queue is full. Please retry shortly.',
        retryAfterSec: cfg.regQueueTtlSec,
      });
    }

    const now = new Date();
    const item: RegistrationQueueItem = {
      processingId: uuid(),
      userId: input.userId,
      workshopId: input.workshopId,
      paymentCircuitOpen: input.paymentCircuitOpen,
      queuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + cfg.regQueueTtlSec * 1000).toISOString(),
    };
    const status: RegistrationQueueStatus = {
      processingId: item.processingId,
      userId: item.userId,
      workshopId: item.workshopId,
      status: 'QUEUED',
      queuedAt: item.queuedAt,
      updatedAt: item.queuedAt,
      httpStatus: 202,
      response: {
        status: 'QUEUED',
        processingId: item.processingId,
        pollUrl: `/registrations/processing/${item.processingId}`,
        retryAfterSec: 1,
      },
    };

    await client
      .multi()
      .lpush(queueKey, JSON.stringify(item))
      .sadd(ACTIVE_WORKSHOPS_KEY, input.workshopId)
      .set(this.statusKey(item.processingId), JSON.stringify(status), 'EX', STATUS_TTL_SECONDS)
      .expire(queueKey, STATUS_TTL_SECONDS)
      .exec();

    return status;
  }

  async getStatusForUser(processingId: string, userId: string): Promise<RegistrationQueueStatus> {
    const raw = await this.redis.getClient().get(this.statusKey(processingId));
    if (!raw) throw new NotFoundException('registration_processing_not_found');
    const status = JSON.parse(raw) as RegistrationQueueStatus;
    if (status.userId !== userId) throw new ForbiddenException('not_owner');
    return status;
  }

  async nextBatch(limit: number): Promise<RegistrationQueueItem[]> {
    const client = this.redis.getClient();
    let workshopIds = await client.smembers(ACTIVE_WORKSHOPS_KEY);
    const items: RegistrationQueueItem[] = [];

    while (items.length < limit && workshopIds.length > 0) {
      const nextWorkshopIds: string[] = [];
      for (const workshopId of workshopIds) {
        if (items.length >= limit) {
          nextWorkshopIds.push(workshopId);
          continue;
        }
        const queueKey = this.queueKey(workshopId);
        const raw = await client.rpop(queueKey);
        if (!raw) {
          await client.srem(ACTIVE_WORKSHOPS_KEY, workshopId);
          continue;
        }
        items.push(JSON.parse(raw) as RegistrationQueueItem);
        const remaining = await client.llen(queueKey);
        if (remaining === 0) {
          await client.srem(ACTIVE_WORKSHOPS_KEY, workshopId);
        } else {
          nextWorkshopIds.push(workshopId);
        }
      }
      workshopIds = nextWorkshopIds;
    }

    return items;
  }

  async markRunning(item: RegistrationQueueItem): Promise<void> {
    await this.updateStatus(item, { status: 'RUNNING', httpStatus: 202 });
  }

  async markSucceeded(item: RegistrationQueueItem, response: unknown): Promise<void> {
    await this.updateStatus(item, {
      status: 'SUCCEEDED',
      httpStatus: 201,
      response,
    });
  }

  async markFailed(item: RegistrationQueueItem, httpStatus: number, error: unknown): Promise<void> {
    await this.updateStatus(item, {
      status: httpStatus === 503 && this.isExpired(item) ? 'EXPIRED' : 'FAILED',
      httpStatus,
      error,
    });
  }

  isExpired(item: RegistrationQueueItem): boolean {
    return new Date(item.expiresAt).getTime() < Date.now();
  }

  private async updateStatus(
    item: RegistrationQueueItem,
    patch: Partial<RegistrationQueueStatus>,
  ): Promise<void> {
    const key = this.statusKey(item.processingId);
    const raw = await this.redis.getClient().get(key);
    const existing = raw
      ? (JSON.parse(raw) as RegistrationQueueStatus)
      : {
          processingId: item.processingId,
          userId: item.userId,
          workshopId: item.workshopId,
          queuedAt: item.queuedAt,
          status: 'QUEUED' as const,
          updatedAt: item.queuedAt,
        };
    const next: RegistrationQueueStatus = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.redis.getClient().set(key, JSON.stringify(next), 'EX', STATUS_TTL_SECONDS);
  }

  private async totalQueuedItems(): Promise<number> {
    const client = this.redis.getClient();
    const workshopIds = await client.smembers(ACTIVE_WORKSHOPS_KEY);
    let total = 0;
    for (const workshopId of workshopIds) {
      total += await client.llen(this.queueKey(workshopId));
    }
    return total;
  }

  private queueKey(workshopId: string): string {
    return `regqueue:${workshopId}`;
  }

  private statusKey(processingId: string): string {
    return `${PROCESSING_PREFIX}:${processingId}`;
  }
}
