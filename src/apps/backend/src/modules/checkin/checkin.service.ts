import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, RegistrationStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { OutboxService } from '../outbox/outbox.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../../common/types/auth.types';
import { QrTokenService, QrTokenPayload } from '../registration/qr-token.service';
import {
  BatchCheckinDto,
  BatchCheckinResponse,
  CheckinItemDto,
  CheckinItemResult,
  CheckinResultCode,
} from './dto/batch-checkin.dto';

const QR_REVOKED_PREFIX = 'qr:revoked:';
const POST_END_GRACE_MS = 60 * 60 * 1000; // 1h sau endAt vẫn check-in được (specs §E)

interface SingleVerifyResult {
  registration: {
    id: string;
    studentName: string;
    studentCode: string | null;
    workshopId: string;
    workshopTitle: string;
    workshopRoomId: string | null;
    startAt: Date;
    endAt: Date;
    status: RegistrationStatus;
  };
  alreadyCheckedIn: boolean;
  checkedInAt?: Date;
}

@Injectable()
export class CheckinService {
  private readonly logger = new Logger(CheckinService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly qr: QrTokenService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Check chi tiết SV từ regId (specs/checkin.md §D) — staff xem trước khi confirm.
   */
  async verifySingle(regId: string, staff: AuthenticatedUser): Promise<SingleVerifyResult> {
    const reg = await this.prisma.registration.findUnique({
      where: { id: regId },
      include: {
        workshop: { select: { title: true, roomId: true, startAt: true, endAt: true } },
        student: { select: { fullName: true, studentCode: true } },
        checkin: { select: { scannedAt: true } },
      },
    });
    if (!reg) {
      throw new NotFoundException('registration_not_found');
    }
    if (!staff.roles.includes('SYS_ADMIN')) {
      const assignment = await this.prisma.staffRoomAssignment.findFirst({
        where: {
          staffId: staff.id,
          workshopId: reg.workshopId,
          roomId: reg.workshop.roomId ?? undefined,
        },
      });
      if (!assignment) {
        throw new ForbiddenException({
          code: 'not_assigned',
          message: 'staff không được phân công workshop/phòng này',
        });
      }
    }
    return {
      registration: {
        id: reg.id,
        studentName: reg.student.fullName,
        studentCode: reg.student.studentCode ?? null,
        workshopId: reg.workshopId,
        workshopTitle: reg.workshop.title,
        workshopRoomId: reg.workshop.roomId,
        startAt: reg.workshop.startAt,
        endAt: reg.workshop.endAt,
        status: reg.status,
      },
      alreadyCheckedIn: !!reg.checkin,
      checkedInAt: reg.checkin?.scannedAt,
    };
  }

  async myWorkshops(staff: AuthenticatedUser) {
    if (staff.roles.includes('SYS_ADMIN')) {
      const workshops = await this.prisma.workshop.findMany({
        where: { status: { in: ['DRAFT', 'PUBLISHED', 'ENDED'] } },
        include: { room: true, speaker: true },
        orderBy: { startAt: 'asc' },
        take: 100,
      });
      return {
        items: workshops.map((workshop) => ({
          id: workshop.id,
          title: workshop.title,
          description: workshop.description,
          startAt: workshop.startAt,
          endAt: workshop.endAt,
          status: workshop.status,
          roomName: workshop.room?.name ?? workshop.room?.code ?? null,
          roomCode: workshop.room?.code ?? null,
          speakerName: workshop.speaker?.name ?? null,
          assignmentStartsAt: null,
          assignmentEndsAt: null,
        })),
      };
    }

    const assignments = await this.prisma.staffRoomAssignment.findMany({
      where: { staffId: staff.id },
      include: {
        workshop: { include: { room: true, speaker: true } },
        room: true,
      },
      orderBy: { startsAt: 'asc' },
    });

    return {
      items: assignments.map((assignment) => ({
        id: assignment.workshop.id,
        title: assignment.workshop.title,
        description: assignment.workshop.description,
        startAt: assignment.workshop.startAt,
        endAt: assignment.workshop.endAt,
        status: assignment.workshop.status,
        roomName: assignment.room.name ?? assignment.workshop.room?.name ?? null,
        roomCode: assignment.room.code ?? assignment.workshop.room?.code ?? null,
        speakerName: assignment.workshop.speaker?.name ?? null,
        assignmentStartsAt: assignment.startsAt,
        assignmentEndsAt: assignment.endsAt,
      })),
    };
  }

  async workshopStudents(workshopId: string, staff: AuthenticatedUser) {
    await this.assertCanCheckWorkshop(workshopId, staff);
    const registrations = await this.prisma.registration.findMany({
      where: { workshopId },
      include: {
        student: { select: { id: true, fullName: true, email: true, studentCode: true } },
        checkin: { select: { scannedAt: true, deviceId: true, staff: { select: { fullName: true } } } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    });

    return {
      items: registrations.map((registration) => ({
        registrationId: registration.id,
        studentId: registration.student.id,
        studentName: registration.student.fullName,
        studentCode: registration.student.studentCode,
        email: registration.student.email,
        registrationStatus: registration.status,
        qrStatus: registration.checkin ? 'CONFIRMED' : 'NOT_CONFIRMED',
        checkedInAt: registration.checkin?.scannedAt ?? null,
        checkedBy: registration.checkin?.staff.fullName ?? null,
        deviceId: registration.checkin?.deviceId ?? null,
      })),
    };
  }

  /**
   * Batch check-in (specs/checkin.md §A,§C). Mỗi item xử lý độc lập:
   * - Verify QR (signature + window)
   * - Check Redis revoke
   * - Check registration status
   * - INSERT idempotent theo `idempotencyKey` UNIQUE
   *
   * Trả {accepted, duplicates, invalid} — partial success cho phép app retry phần còn lại.
   */
  async batch(staff: AuthenticatedUser, dto: BatchCheckinDto): Promise<BatchCheckinResponse> {
    const startedAt = Date.now();
    const accepted: CheckinItemResult[] = [];
    const duplicates: CheckinItemResult[] = [];
    const invalid: CheckinItemResult[] = [];

    // Demo-friendly: kiểm tra staff có phân công workshop/phòng, không khóa theo giờ ca.
    const assignments = staff.roles.includes('SYS_ADMIN')
      ? null
      : await this.prisma.staffRoomAssignment.findMany({
          where: { staffId: staff.id },
        });

    for (const item of dto.items) {
      const res = await this.processItem(staff.id, item, assignments);
      if (res.result === 'accepted') accepted.push(res);
      else if (res.result === 'duplicate') duplicates.push(res);
      else invalid.push(res);
    }

    void this.audit.log({
      actorId: staff.id,
      action: 'checkin_batch',
      resource: 'checkin',
      metadata: {
        total: dto.items.length,
        accepted: accepted.length,
        duplicates: duplicates.length,
        invalid: invalid.length,
      },
    });
    void this.recordBatchMetrics({
      accepted: accepted.length,
      duplicate: duplicates.length,
      invalid: invalid.length,
      durationMs: Date.now() - startedAt,
    });

    return { accepted, duplicates, invalid };
  }

  // --- Private ---

  private async processItem(
    staffId: string,
    item: CheckinItemDto,
    assignments: Array<{ workshopId: string; roomId: string }> | null,
  ): Promise<CheckinItemResult> {
    let payload: QrTokenPayload;
    try {
      payload = this.qr.verify(item.qrToken);
    } catch (e) {
      const msg = (e as Error).message;
      const code: CheckinResultCode =
        msg.includes('expired') || msg.includes('jwt expired') ? 'expired' : 'invalid_signature';
      return { idempotencyKey: item.idempotencyKey, result: code, message: msg };
    }

    const scannedMs = new Date(item.scannedAt).getTime();
    if (Number.isNaN(scannedMs)) {
      return {
        idempotencyKey: item.idempotencyKey,
        result: 'unknown_error',
        message: 'invalid_scannedAt',
      };
    }

    // Demo-friendly: không chặn check-in trước giờ workshop; JWT signature vẫn được kiểm tra.
    const validToMs = payload.validTo * 1000 + POST_END_GRACE_MS;
    if (scannedMs > validToMs) {
      return { idempotencyKey: item.idempotencyKey, regId: payload.regId, result: 'expired' };
    }

    // Revoke check
    const revoked = await this.redis.getClient().get(QR_REVOKED_PREFIX + payload.regId);
    if (revoked) {
      return { idempotencyKey: item.idempotencyKey, regId: payload.regId, result: 'revoked' };
    }

    // Registration status check
    const reg = await this.prisma.registration.findUnique({
      where: { id: payload.regId },
      include: { workshop: { select: { roomId: true } } },
    });
    if (!reg) {
      return {
        idempotencyKey: item.idempotencyKey,
        regId: payload.regId,
        result: 'invalid_registration',
      };
    }
    if (reg.status !== RegistrationStatus.CONFIRMED) {
      return {
        idempotencyKey: item.idempotencyKey,
        regId: payload.regId,
        result: 'invalid_registration',
        message: `status=${reg.status}`,
      };
    }

    if (assignments) {
      const matchingAssignment = assignments.find((assignment) => (
        assignment.workshopId === payload.workshopId &&
        (!reg.workshop.roomId || assignment.roomId === reg.workshop.roomId)
      ));
      if (!matchingAssignment) {
        const hasWorkshopAssignment = assignments.some((assignment) => assignment.workshopId === payload.workshopId);
        if (!hasWorkshopAssignment) {
          return {
            idempotencyKey: item.idempotencyKey,
            regId: payload.regId,
            result: 'not_assigned',
            message: 'staff không được phân công workshop này',
          };
        }
        return {
          idempotencyKey: item.idempotencyKey,
          regId: payload.regId,
          result: 'wrong_room',
          message: 'workshop không thuộc phòng staff đang trực',
        };
      }
    }

    // Idempotent INSERT
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.checkin.create({
          data: {
            registrationId: reg.id,
            scannedAt: new Date(scannedMs),
            deviceId: item.deviceId,
            staffId,
            idempotencyKey: item.idempotencyKey,
          },
        });
        await this.outbox.append(tx, {
          aggregate: 'checkin',
          aggregateId: reg.id,
          eventType: 'checkin.confirmed',
          payload: {
            regId: reg.id,
            studentId: reg.studentId,
            workshopId: reg.workshopId,
            scannedAt: new Date(scannedMs).toISOString(),
            staffId,
          },
        });
      });
      return {
        idempotencyKey: item.idempotencyKey,
        regId: reg.id,
        result: 'accepted',
        scannedAt: new Date(scannedMs).toISOString(),
      };
    } catch (e) {
      // P2002: unique violation trên (registration_id) hoặc (idempotency_key) — đã check-in
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.checkin.findUnique({
          where: { registrationId: reg.id },
        });
        return {
          idempotencyKey: item.idempotencyKey,
          regId: reg.id,
          result: 'duplicate',
          scannedAt: existing?.scannedAt.toISOString(),
        };
      }
      this.logger.error(`Checkin INSERT error reg=${reg.id}: ${(e as Error).message}`);
      return {
        idempotencyKey: item.idempotencyKey,
        regId: reg.id,
        result: 'unknown_error',
        message: (e as Error).message,
      };
    }
  }

  private async recordBatchMetrics(metrics: {
    accepted: number;
    duplicate: number;
    invalid: number;
    durationMs: number;
  }): Promise<void> {
    try {
      await this.redis
        .getClient()
        .multi()
        .incrby('metrics:checkin_total:accepted', metrics.accepted)
        .incrby('metrics:checkin_total:duplicate', metrics.duplicate)
        .incrby('metrics:checkin_total:invalid', metrics.invalid)
        .set('metrics:checkin_sync_duration_ms', metrics.durationMs)
        .exec();
    } catch {
      // metrics are best effort
    }
  }

  private async assertCanCheckWorkshop(
    workshopId: string,
    staff: AuthenticatedUser,
  ): Promise<void> {
    if (staff.roles.includes('SYS_ADMIN')) return;
    const assignment = await this.prisma.staffRoomAssignment.findFirst({
      where: {
        staffId: staff.id,
        workshopId,
      },
    });
    if (!assignment) {
      throw new ForbiddenException({
        code: 'not_assigned',
        message: 'staff không được phân công workshop này',
      });
    }
  }
}
