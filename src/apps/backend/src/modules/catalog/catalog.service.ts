import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, WorkshopStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { OutboxService } from '../outbox/outbox.service';
import { AuditService } from '../audit/audit.service';
import { CreateWorkshopDto } from './dto/create-workshop.dto';
import { UpdateWorkshopDto } from './dto/update-workshop.dto';
import { AuthenticatedUser } from '../../common/types/auth.types';

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
    private readonly audit: AuditService,
  ) {}

  // ==================== PUBLIC READ ====================
  async list(filters: { day?: string; page?: number; limit?: number }) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const cacheKey = `${CACHE_PREFIX}:public-list-v2:${filters.day ?? 'all'}:p${page}:l${limit}`;
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
    const items = await Promise.all(workshops.map((w) => this.toPublicWorkshopResponse(w)));

    const result = { items, total, page, limit, totalPages: Math.ceil(total / limit) };
    await this.safeRedisSet(cacheKey, JSON.stringify(result), CACHE_TTL);
    return result;
  }

  async detail(id: string) {
    const cacheKey = `${CACHE_PREFIX}:public-detail-v2:${id}`;
    const cached = await this.safeRedisGet(cacheKey);
    if (cached) return JSON.parse(cached);

    const w = await this.prisma.workshop.findUnique({
      where: { id },
      include: { speaker: true, room: true },
    });
    if (!w || w.status !== 'PUBLISHED') throw new NotFoundException('workshop_not_found');

    const result = await this.toPublicWorkshopResponse(w);
    await this.safeRedisSet(cacheKey, JSON.stringify(result), CACHE_TTL);
    return result;
  }

  async adminList(
    filters: { page?: number; limit?: number; status?: WorkshopStatus },
    user: AuthenticatedUser,
  ) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 50, 100);
    const skip = (page - 1) * limit;
    const where: Prisma.WorkshopWhereInput = {};

    if (filters.status) where.status = filters.status;
    if (!user.roles.includes('SYS_ADMIN')) where.createdBy = user.id;

    const [workshops, total] = await Promise.all([
      this.prisma.workshop.findMany({
        where,
        include: { speaker: true, room: true },
        orderBy: { startAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.workshop.count({ where }),
    ]);

    const items = await Promise.all(workshops.map((w) => this.toWorkshopResponse(w)));
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async adminDetail(id: string, user: AuthenticatedUser) {
    const w = await this.prisma.workshop.findUnique({
      where: { id },
      include: { speaker: true, room: true },
    });
    if (!w) throw new NotFoundException('workshop_not_found');

    const isSysAdmin = user.roles.includes('SYS_ADMIN');
    if (!isSysAdmin && w.createdBy !== user.id) {
      throw new ForbiddenException('not_workshop_owner');
    }

    return this.toWorkshopResponse(w);
  }

  async adminOptions() {
    const [speakers, rooms] = await Promise.all([
      this.prisma.speaker.findMany({
        select: { id: true, name: true, title: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.room.findMany({
        select: { id: true, code: true, name: true, capacity: true, mapUrl: true },
        orderBy: { code: 'asc' },
      }),
    ]);

    return { speakers, rooms };
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
    await this.audit.log({
      actorId: createdBy,
      action: 'workshop_created',
      resource: 'workshop',
      resourceId: workshop.id,
      metadata: { title: workshop.title, status: workshop.status },
    });

    return workshop;
  }

  async publish(id: string, user: AuthenticatedUser) {
    const w = await this.prisma.workshop.findUnique({ where: { id } });
    if (!w) throw new NotFoundException('workshop_not_found');
    this.assertCanManageWorkshop(w, user);
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
    await this.audit.log({
      actorId: user.id,
      action: 'workshop_published',
      resource: 'workshop',
      resourceId: id,
      metadata: { previousStatus: w.status, status: updated.status },
    });
    return updated;
  }

  async update(
    id: string,
    dto: UpdateWorkshopDto,
    expectedVersion: number,
    user: AuthenticatedUser,
  ) {
    const w = await this.prisma.workshop.findUnique({ where: { id } });
    if (!w) throw new NotFoundException('workshop_not_found');
    this.assertCanManageWorkshop(w, user);

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
      if (dto.status === 'CANCELLED' && w.status !== 'CANCELLED') {
        await tx.$executeRaw`
        UPDATE "registrations"
        SET "status" = 'CANCELLED'::"registration_status",
            "updated_at" = now()
        WHERE "workshop_id" = ${id}::uuid
          AND "status" IN ('CONFIRMED'::"registration_status", 'PENDING_PAYMENT'::"registration_status")
      `;
      }
      await this.outbox.append(tx, {
        aggregate: 'workshop',
        aggregateId: id,
        eventType: 'workshop.updated',
        payload: { workshopId: id, changes: dto },
      });
      return u;
    });

    await this.invalidateCache();
    await this.audit.log({
      actorId: user.id,
      action: 'workshop_updated',
      resource: 'workshop',
      resourceId: id,
      metadata: { expectedVersion, newVersion: updated.version, changes: dto },
    });
    return updated;
  }

  async cancel(id: string, reason: string, user: AuthenticatedUser) {
    const w = await this.prisma.workshop.findUnique({ where: { id } });
    if (!w) throw new NotFoundException('workshop_not_found');
    this.assertCanManageWorkshop(w, user);
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.workshop.update({
        where: { id },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });

      const activeRegs = await tx.$queryRaw<Array<{ id: string; studentId: string }>>(Prisma.sql`
        UPDATE "registrations"
        SET "status" = 'CANCELLED'::"registration_status",
            "cancelled_at" = NOW()
        WHERE "workshop_id" = ${id}::uuid
          AND "status" IN ('CONFIRMED'::"registration_status", 'PENDING_PAYMENT'::"registration_status")
        RETURNING "id"::text AS "id", "student_id"::text AS "studentId"
      `);

      await this.outbox.append(tx, {
        aggregate: 'workshop',
        aggregateId: id,
        eventType: 'workshop.cancelled',
        payload: { workshopId: id, reason, registrations: activeRegs },
      });

      return u;
    });

    // Seat = 0
    await this.redis.getClient().set(`seat:${id}`, 0).catch(() => {});
    await this.invalidateCache();
    await this.audit.log({
      actorId: user.id,
      action: 'workshop_cancelled',
      resource: 'workshop',
      resourceId: id,
      metadata: { reason, previousStatus: w.status },
    });
    return updated;
  }

  async deletePermanent(id: string, user: AuthenticatedUser) {
    const w = await this.prisma.workshop.findUnique({ where: { id } });
    if (!w) throw new NotFoundException('workshop_not_found');
    this.assertCanManageWorkshop(w, user);

    const result = await this.prisma.$transaction(async (tx) => {
      const registrations = await tx.registration.findMany({
        where: { workshopId: id },
        select: { id: true },
      });
      const registrationIds = registrations.map((registration) => registration.id);

      let deletedRefunds = 0;
      let deletedPayments = 0;
      let deletedCheckins = 0;
      let deletedRegistrations = 0;

      if (registrationIds.length > 0) {
        const payments = await tx.payment.findMany({
          where: { registrationId: { in: registrationIds } },
          select: { id: true },
        });
        const paymentIds = payments.map((payment) => payment.id);

        if (paymentIds.length > 0) {
          deletedRefunds = (
            await tx.paymentRefund.deleteMany({ where: { paymentId: { in: paymentIds } } })
          ).count;
        }

        deletedPayments = (
          await tx.payment.deleteMany({ where: { registrationId: { in: registrationIds } } })
        ).count;
        deletedCheckins = (
          await tx.checkin.deleteMany({ where: { registrationId: { in: registrationIds } } })
        ).count;
        deletedRegistrations = (
          await tx.registration.deleteMany({ where: { id: { in: registrationIds } } })
        ).count;
      }

      const deletedAssignments = (
        await tx.staffRoomAssignment.deleteMany({ where: { workshopId: id } })
      ).count;
      await tx.workshop.delete({ where: { id } });

      await this.outbox.append(tx, {
        aggregate: 'workshop',
        aggregateId: id,
        eventType: 'workshop.deleted_permanent',
        payload: { workshopId: id, title: w.title },
      });

      return {
        deletedAssignments,
        deletedRegistrations,
        deletedCheckins,
        deletedPayments,
        deletedRefunds,
      };
    });

    await this.redis.getClient().del(`seat:${id}`).catch(() => {});
    await this.invalidateCache();
    await this.audit.log({
      actorId: user.id,
      action: 'workshop_deleted_permanent',
      resource: 'workshop',
      resourceId: id,
      metadata: { title: w.title, status: w.status, ...result },
    });

    return { deleted: true, workshopId: id, ...result };
  }

  async markEndedWorkshops(now = new Date()): Promise<number> {
    const result = await this.prisma.workshop.updateMany({
      where: {
        status: WorkshopStatus.PUBLISHED,
        endAt: { lte: now },
      },
      data: {
        status: WorkshopStatus.ENDED,
        version: { increment: 1 },
      },
    });

    if (result.count > 0) {
      this.logger.log(`Marked ${result.count} workshop(s) as ENDED`);
      await this.invalidateCache();
    }

    return result.count;
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

  async publishedSeatSnapshot(): Promise<Record<string, number>> {
    const workshops = await this.prisma.workshop.findMany({
      where: { status: WorkshopStatus.PUBLISHED },
      select: { id: true, capacity: true },
      orderBy: { startAt: 'asc' },
    });
    if (workshops.length === 0) return {};

    try {
      const keys = workshops.map((w) => `seat:${w.id}`);
      const vals = await this.redis.getClient().mget(...keys);
      return workshops.reduce<Record<string, number>>((acc, workshop, index) => {
        const parsed = parseInt(vals[index] ?? '', 10);
        acc[workshop.id] = Number.isFinite(parsed)
          ? Math.max(0, parsed)
          : workshop.capacity;
        return acc;
      }, {});
    } catch {
      const entries = await Promise.all(
        workshops.map(async (workshop) => [
          workshop.id,
          await this.getSeatsLeft(workshop.id, workshop.capacity),
        ] as const),
      );
      return Object.fromEntries(entries);
    }
  }

  private async toWorkshopResponse(
    workshop: Prisma.WorkshopGetPayload<{ include: { speaker: true; room: true } }>,
  ) {
    const seatsLeft = await this.getSeatsLeft(workshop.id, workshop.capacity);
    const highlights = Array.isArray(workshop.summaryHighlights)
      ? workshop.summaryHighlights
      : undefined;

    return {
      ...workshop,
      seatsLeft,
      speakerName: workshop.speaker?.name ?? null,
      roomName: workshop.room?.name ?? workshop.room?.code ?? null,
      highlights,
    };
  }

  private async toPublicWorkshopResponse(
    workshop: Prisma.WorkshopGetPayload<{ include: { speaker: true; room: true } }>,
  ) {
    const seatsLeft = await this.getSeatsLeft(workshop.id, workshop.capacity);
    return {
      id: workshop.id,
      title: workshop.title,
      description: workshop.description,
      startAt: workshop.startAt,
      endAt: workshop.endAt,
      capacity: workshop.capacity,
      seatsLeft,
      feeAmount: workshop.feeAmount,
      status: workshop.status,
      speakerName: workshop.speaker?.name ?? null,
      roomName: workshop.room?.name ?? workshop.room?.code ?? null,
    };
  }

  private assertCanManageWorkshop(
    workshop: { createdBy: string | null },
    user: AuthenticatedUser,
  ): void {
    if (user.roles.includes('SYS_ADMIN')) return;
    if (workshop.createdBy !== user.id) {
      throw new ForbiddenException('not_workshop_owner');
    }
  }

  // ==================== CACHE ====================
  private async invalidateCache(): Promise<void> {
    try {
      const keys = await this.scanKeys(`${CACHE_PREFIX}:*`);
      if (keys.length > 0) await this.redis.getClient().del(...keys);
    } catch { /* best effort */ }
  }

  /**
   * SCAN thay cho KEYS — không block Redis single-thread.
   * Trả về tất cả key match pattern (dùng cho cache invalidation).
   */
  private async scanKeys(pattern: string): Promise<string[]> {
    const client = this.redis.getClient();
    const result: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      result.push(...batch);
    } while (cursor !== '0');
    return result;
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
