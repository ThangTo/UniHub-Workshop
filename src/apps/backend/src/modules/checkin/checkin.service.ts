import { Injectable, Logger } from '@nestjs/common';
import { Prisma, RegistrationStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { OutboxService } from '../outbox/outbox.service';
import { AuditService } from '../audit/audit.service';
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
  async verifySingle(regId: string): Promise<SingleVerifyResult> {
    const reg = await this.prisma.registration.findUnique({
      where: { id: regId },
      include: {
        workshop: { select: { title: true, roomId: true, startAt: true, endAt: true } },
        student: { select: { fullName: true, studentCode: true } },
        checkin: { select: { scannedAt: true } },
      },
    });
    if (!reg) {
      throw new Error('registration_not_found');
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

  /**
   * Batch check-in (specs/checkin.md §A,§C). Mỗi item xử lý độc lập:
   * - Verify QR (signature + window)
   * - Check Redis revoke
   * - Check registration status
   * - INSERT idempotent theo `idempotencyKey` UNIQUE
   *
   * Trả {accepted, duplicates, invalid} — partial success cho phép app retry phần còn lại.
   */
  async batch(staffId: string, dto: BatchCheckinDto): Promise<BatchCheckinResponse> {
    const accepted: CheckinItemResult[] = [];
    const duplicates: CheckinItemResult[] = [];
    const invalid: CheckinItemResult[] = [];

    // Cache room assignments của staff trong giờ shift
    const now = new Date();
    const assignments = await this.prisma.staffRoomAssignment.findMany({
      where: { staffId, startsAt: { lte: now }, endsAt: { gte: now } },
    });
    const allowedRooms = new Set(assignments.map((a) => a.roomId));
    // Nếu staff không có shift active → vẫn cho check-in (không bắt buộc shift) nhưng log warn
    const staffHasShift = allowedRooms.size > 0;

    for (const item of dto.items) {
      const res = await this.processItem(staffId, item, allowedRooms, staffHasShift);
      if (res.result === 'accepted') accepted.push(res);
      else if (res.result === 'duplicate') duplicates.push(res);
      else invalid.push(res);
    }

    void this.audit.log({
      actorId: staffId,
      action: 'checkin_batch',
      resource: 'checkin',
      metadata: {
        total: dto.items.length,
        accepted: accepted.length,
        duplicates: duplicates.length,
        invalid: invalid.length,
      },
    });

    return { accepted, duplicates, invalid };
  }

  // --- Private ---

  private async processItem(
    staffId: string,
    item: CheckinItemDto,
    allowedRooms: Set<string>,
    staffHasShift: boolean,
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

    // Window kẹp [validFrom, validTo + 1h]
    const validFromMs = payload.validFrom * 1000;
    const validToMs = payload.validTo * 1000 + POST_END_GRACE_MS;
    if (scannedMs < validFromMs) {
      return { idempotencyKey: item.idempotencyKey, regId: payload.regId, result: 'not_yet_valid' };
    }
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

    // Wrong room (chỉ cảnh báo nếu staff có shift; nếu không có shift thì bỏ qua)
    if (staffHasShift && reg.workshop.roomId && !allowedRooms.has(reg.workshop.roomId)) {
      return {
        idempotencyKey: item.idempotencyKey,
        regId: payload.regId,
        result: 'wrong_room',
        message: 'workshop không thuộc phòng staff đang trực',
      };
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
}
