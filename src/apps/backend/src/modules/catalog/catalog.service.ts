import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, WorkshopStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { OutboxService } from '../outbox/outbox.service';
import { CreateWorkshopDto } from './dto/create-workshop.dto';
import { UpdateWorkshopDto } from './dto/update-workshop.dto';

const CACHE_TTL = 300; // 5 phút
const CACHE_PREFIX = 'cache:workshop';

/**
 * CatalogService theo specs/workshop-catalog.md.
 *
 * Read path: Redis cache → PostgreSQL fallback.
 * Write path: Prisma TX + Outbox event → invalidate cache.
 * Seat counter: Redis `seat:{workshopId}` (atomic).
 */
@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly outbox: OutboxService,
  ) {}

  // ==================== PUBLIC READ ====================
  async list(filters: { day?: string; page?: number; limit?: number }) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const cacheKey = `${CACHE_PREFIX}:list:${filters.day ?? 'all'}:p${page}:l${limit}`;
    const cached = await this.safeRedisGet(cacheKey);
    if (cached) return JSON.parse(cached);

    const where: Prisma.WorkshopWhereInput = { status: 'PUBLISHED' };
    if (filters.day) {
      const dayStart = new Date(filters.day);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      where.startAt = { gte: dayStart, lt: dayEnd };
    }

    const [workshops, total] = await Promise.all([
      this.prisma.workshop.findMany({
        where,
        include: { speaker: true, room: true },
        orderBy: { startAt: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.workshop.count({ where }),
    ]);

    // Ghép seatsLeft từ Redis
    const items = await Promise.all(
      workshops.map(async (w) => {
        const seatsLeft = await this.getSeatsLeft(w.id, w.capacity);
        return { ...w, seatsLeft };
      }),
    );

    const result = { items, total, page, limit, totalPages: Math.ceil(total / limit) };
    await this.safeRedisSet(cacheKey, JSON.stringify(result), CACHE_TTL);
    return result;
  }

  async detail(id: string) {
    const cacheKey = `${CACHE_PREFIX}:detail:${id}`;
    const cached = await this.safeRedisGet(cacheKey);
    if (cached) return JSON.parse(cached);

    const w = await this.prisma.workshop.findUnique({
      where: { id },
      include: { speaker: true, room: true },
    });
    if (!w) throw new NotFoundException('workshop_not_found');

    const seatsLeft = await this.getSeatsLeft(w.id, w.capacity);
    const result = { ...w, seatsLeft };
    await this.safeRedisSet(cacheKey, JSON.stringify(result), CACHE_TTL);
    return result;
  }

  // ==================== ORGANIZER CRUD ====================
  async create(dto: CreateWorkshopDto, createdBy: string) {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);

    if (startAt >= endAt) {
      throw new UnprocessableEntityException({ code: 'invalid_time_range', message: 'start_at phải trước end_at.' });
    }

    // Room capacity check
    if (dto.roomId) {
      const room = await this.prisma.room.findUnique({ where: { id: dto.roomId } });
      if (!room) throw new NotFoundException('room_not_found');
      if (dto.capacity > room.capacity) {
        throw new UnprocessableEntityException({ code: 'capacity_exceeds_room', message: `Capacity (${dto.capacity}) vượt sức chứa phòng (${room.capacity}).` });
      }

      // Trùng giờ trùng phòng
      const conflict = await this.prisma.workshop.findFirst({
        where: {
          roomId: dto.roomId,
          status: { in: ['DRAFT', 'PUBLISHED'] },
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
      });
      if (conflict) {
        throw new UnprocessableEntityException({
          code: 'room_time_conflict',
          message: 'Phòng đã bị chiếm trong khoảng thời gian này.',
          details: { conflictingWorkshopId: conflict.id },
        });
      }
    }

    const workshop = await this.prisma.$transaction(async (tx) => {
      const w = await tx.workshop.create({
        data: {
          title: dto.title,
          description: dto.description,
          speakerId: dto.speakerId,
          roomId: dto.roomId,
          startAt,
          endAt,
          capacity: dto.capacity,
          feeAmount: dto.feeAmount ?? 0,
          status: 'DRAFT',
          createdBy,
        },
      });

      await this.outbox.append(tx, {
        aggregate: 'workshop',
        aggregateId: w.id,
        eventType: 'workshop.created',
        payload: { workshopId: w.id, title: w.title, createdBy },
      });

      return w;
    });

    // Khởi tạo seat counter
    await this.redis.getClient().set(`seat:${workshop.id}`, workshop.capacity).catch(() => {});

    return workshop;
  }

  async publish(id: string) {
    const w = await this.prisma.workshop.findUnique({ where: { id } });
    if (!w) throw new NotFoundException('workshop_not_found');
    if (w.status !== 'DRAFT') {
      throw new UnprocessableEntityException({ code: 'invalid_state', message: `Chỉ workshop DRAFT mới publish được (hiện tại: ${w.status}).` });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.workshop.update({
        where: { id },
        data: { status: 'PUBLISHED', version: { increment: 1 } },
      });
      await this.outbox.append(tx, {
        aggregate: 'workshop',
        aggregateId: id,
        eventType: 'workshop.published',
        payload: { workshopId: id },
      });
      return u;
    });

    await this.invalidateCache();
    return updated;
  }

  async update(id: string, dto: UpdateWorkshopDto, expectedVersion: number) {
    const w = await this.prisma.workshop.findUnique({ where: { id } });
    if (!w) throw new NotFoundException('workshop_not_found');

    // Optimistic lock
    if (w.version !== expectedVersion) {
      throw new ConflictException({ code: 'concurrent_modification', message: 'Workshop đã bị sửa bởi người khác.' });
    }

    const startAt = dto.startAt ? new Date(dto.startAt) : w.startAt;
    const endAt = dto.endAt ? new Date(dto.endAt) : w.endAt;
    if (startAt >= endAt) {
      throw new UnprocessableEntityException({ code: 'invalid_time_range', message: 'start_at phải trước end_at.' });
    }

    const roomId = dto.roomId ?? w.roomId;
    if (roomId && (dto.roomId || dto.capacity)) {
      const room = await this.prisma.room.findUnique({ where: { id: roomId } });
      if (room && (dto.capacity ?? w.capacity) > room.capacity) {
        throw new UnprocessableEntityException({ code: 'capacity_exceeds_room', message: 'Capacity vượt sức chứa phòng.' });
      }
      // Room time conflict check
      const conflict = await this.prisma.workshop.findFirst({
        where: {
          id: { not: id },
          roomId,
          status: { in: ['DRAFT', 'PUBLISHED'] },
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
      });
      if (conflict) {
        throw new UnprocessableEntityException({
          code: 'room_time_conflict',
          message: 'Phòng đã bị chiếm.',
          details: { conflictingWorkshopId: conflict.id },
        });
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.workshop.update({
        where: { id, version: expectedVersion },
        data: {
          ...dto,
          startAt: dto.startAt ? new Date(dto.startAt) : undefined,
          endAt: dto.endAt ? new Date(dto.endAt) : undefined,
          version: { increment: 1 },
        },
      });
      await this.outbox.append(tx, {
        aggregate: 'workshop',
        aggregateId: id,
        eventType: 'workshop.updated',
        payload: { workshopId: id, changes: dto },
      });
      return u;
    });

    await this.invalidateCache();
    return updated;
  }

  async cancel(id: string, reason: string) {
    const w = await this.prisma.workshop.findUnique({ where: { id } });
    if (!w) throw new NotFoundException('workshop_not_found');

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.workshop.update({
        where: { id },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });

      // Cancel tất cả registration đang active
      await tx.registration.updateMany({
        where: {
          workshopId: id,
          status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
        },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });

      await this.outbox.append(tx, {
        aggregate: 'workshop',
        aggregateId: id,
        eventType: 'workshop.cancelled',
        payload: { workshopId: id, reason },
      });

      return u;
    });

    // Seat = 0
    await this.redis.getClient().set(`seat:${id}`, 0).catch(() => {});
    await this.invalidateCache();
    return updated;
  }

  // ==================== SEATS ====================
  async getSeatsLeft(workshopId: string, capacity?: number): Promise<number> {
    try {
      const val = await this.redis.getClient().get(`seat:${workshopId}`);
      if (val !== null) return Math.max(0, parseInt(val, 10));
    } catch { /* fallback DB */ }

    // Rebuild from DB
    const cap = capacity ?? (await this.prisma.workshop.findUnique({ where: { id: workshopId } }))?.capacity ?? 0;
    const active = await this.prisma.registration.count({
      where: {
        workshopId,
        status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
      },
    });
    const seats = Math.max(0, cap - active);
    await this.redis.getClient().set(`seat:${workshopId}`, seats).catch(() => {});
    return seats;
  }

  // ==================== CACHE ====================
  private async invalidateCache(): Promise<void> {
    try {
      const keys = await this.redis.getClient().keys(`${CACHE_PREFIX}:*`);
      if (keys.length > 0) await this.redis.getClient().del(...keys);
    } catch { /* best effort */ }
  }

  private async safeRedisGet(key: string): Promise<string | null> {
    try {
      return await this.redis.getClient().get(key);
    } catch {
      return null;
    }
  }

  private async safeRedisSet(key: string, val: string, ttl: number): Promise<void> {
    try {
      await this.redis.getClient().set(key, val, 'EX', ttl);
    } catch { /* best effort */ }
  }
}
