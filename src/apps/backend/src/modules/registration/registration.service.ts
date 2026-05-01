import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PaymentStatus, Prisma, Registration, RegistrationStatus, WorkshopStatus } from '@prisma/client';
import { v4 as uuid } from 'uuid';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { AuditService } from '../audit/audit.service';
import { SeatService } from './seat.service';
import { QrTokenService } from './qr-token.service';
import { AuthenticatedUser } from '../../common/types/auth.types';

const HOLD_TTL_NORMAL = 15 * 60; // 15 phút
const HOLD_TTL_DEGRADED = 5 * 60; // 5 phút khi payment circuit Open
const CANCELLATION_WINDOW_HOURS = 1;

export interface RegistrationCreatedResult {
  registration: Registration;
  /** True khi workshop free → đã CONFIRMED + qrToken sẵn. */
  paymentRequired: boolean;
  qrToken?: string;
  qrImageDataUrl?: string;
  holdExpiresAt?: Date;
  paymentUnavailable?: boolean;
}

export interface RegistrationListItem {
  id: string;
  workshopId: string;
  workshopTitle: string;
  studentId: string;
  studentName?: string | null;
  studentCode?: string | null;
  status: RegistrationStatus;
  feeAmount: number;
  startAt: Date;
  endAt: Date;
  createdAt: Date;
  holdExpiresAt?: Date | null;
  confirmedAt?: Date | null;
  cancelledAt?: Date | null;
  qrToken?: string | null;
  paymentStatus?: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | null;
  checkedIn?: boolean;
  checkedInAt?: Date | null;
}

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly seats: SeatService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly qr: QrTokenService,
  ) {}

  /**
   * Đăng ký workshop (specs/registration.md §A,§B).
   *
   * Bước:
   *   1. Validate workshop (PUBLISHED, chưa diễn ra).
   *   2. Validate user là sinh viên active (có studentCode + Student.isActive).
   *   3. Check duplicate registration (DB UNIQUE).
   *   4. Lua allocateSeat (atomic).
   *   5. Insert registration + outbox event trong transaction.
   *   6. Free → CONFIRMED + qrToken; Paid → PENDING_PAYMENT.
   */
  async create(
    studentUserId: string,
    workshopId: string,
    opts: { paymentCircuitOpen?: boolean } = {},
  ): Promise<RegistrationCreatedResult> {
    // 1. Workshop
    const workshop = await this.prisma.workshop.findUnique({ where: { id: workshopId } });
    if (!workshop) throw new NotFoundException('workshop_not_found');
    if (workshop.status !== WorkshopStatus.PUBLISHED) {
      throw new GoneException('workshop_not_open');
    }
    if (workshop.startAt.getTime() <= Date.now()) {
      throw new GoneException('workshop_not_open');
    }

    // 2. Student status
    const user = await this.prisma.user.findUnique({
      where: { id: studentUserId },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new ForbiddenException('user_not_found');
    if (!user.studentCode) throw new ForbiddenException('student_code_missing');
    const student = await this.prisma.student.findUnique({
      where: { studentCode: user.studentCode },
    });
    if (!student?.isActive) throw new ForbiddenException('student_inactive');

    // 3. Duplicate?
    const existing = await this.prisma.registration.findUnique({
      where: { workshopId_studentId: { workshopId, studentId: studentUserId } },
    });
    if (existing && existing.status !== RegistrationStatus.CANCELLED && existing.status !== RegistrationStatus.EXPIRED) {
      throw new ConflictException({
        code: 'already_registered',
        regId: existing.id,
        status: existing.status,
      });
    }

    // 4. Lua allocate seat
    const requestId = uuid();
    const ttl = opts.paymentCircuitOpen && workshop.feeAmount > 0 ? HOLD_TTL_DEGRADED : HOLD_TTL_NORMAL;
    const allocated = await this.seats.allocate(
      workshopId,
      studentUserId,
      requestId,
      workshop.capacity,
      ttl,
    );
    if (!allocated.ok) {
      if (allocated.reason === 'sold_out') throw new ConflictException('sold_out');
      // already_holding → ai đó (có thể là crash trước đó), force release rồi retry 1 lần
      this.logger.warn(`Stale hold detected for ${workshopId}/${studentUserId}, force-releasing`);
      await this.seats.release(workshopId, studentUserId, '');
      const retry = await this.seats.allocate(workshopId, studentUserId, requestId, workshop.capacity, ttl);
      if (!retry.ok) throw new ConflictException('sold_out');
    }

    // 5. Insert registration + outbox trong cùng transaction
    const isFree = workshop.feeAmount === 0;
    const holdExpiresAt = new Date(Date.now() + ttl * 1000);
    let qrToken: string | undefined;
    let qrImageDataUrl: string | undefined;

    try {
      const registration = await this.prisma.$transaction(async (tx) => {
        // Nếu existing registration đã CANCELLED/EXPIRED → cập nhật lại thay vì insert
        let reg: Registration;
        if (existing) {
          reg = await tx.registration.update({
            where: { id: existing.id },
            data: {
              status: isFree ? RegistrationStatus.CONFIRMED : RegistrationStatus.PENDING_PAYMENT,
              feeAmount: workshop.feeAmount,
              holdExpiresAt: isFree ? null : holdExpiresAt,
              confirmedAt: isFree ? new Date() : null,
              cancelledAt: null,
              qrToken: null, // gen mới sau
            },
          });
        } else {
          reg = await tx.registration.create({
            data: {
              workshopId,
              studentId: studentUserId,
              status: isFree ? RegistrationStatus.CONFIRMED : RegistrationStatus.PENDING_PAYMENT,
              feeAmount: workshop.feeAmount,
              holdExpiresAt: isFree ? null : holdExpiresAt,
              confirmedAt: isFree ? new Date() : null,
            },
          });
        }

        // Free → ký QR ngay + outbox confirmed
        if (isFree) {
          qrToken = this.qr.sign({
            regId: reg.id,
            workshopId,
            studentId: studentUserId,
            startAt: workshop.startAt,
            endAt: workshop.endAt,
          });
          reg = await tx.registration.update({
            where: { id: reg.id },
            data: { qrToken },
          });
          await this.outbox.append(tx, {
            aggregate: 'registration',
            aggregateId: reg.id,
            eventType: 'registration.confirmed',
            payload: {
              regId: reg.id,
              workshopId,
              studentId: studentUserId,
              fee: 0,
            },
          });
        } else {
          await this.outbox.append(tx, {
            aggregate: 'registration',
            aggregateId: reg.id,
            eventType: 'registration.hold_created',
            payload: {
              regId: reg.id,
              workshopId,
              studentId: studentUserId,
              fee: workshop.feeAmount,
              holdExpiresAt: holdExpiresAt.toISOString(),
            },
          });
        }

        return reg;
      });

      if (qrToken) {
        qrImageDataUrl = await this.qr.toDataUrl(qrToken);
      }

      void this.audit.log({
        actorId: studentUserId,
        action: isFree ? 'registration_confirmed' : 'registration_hold_created',
        resource: 'registration',
        resourceId: registration.id,
        metadata: { workshopId, fee: workshop.feeAmount },
      });

      return {
        registration,
        paymentRequired: !isFree,
        qrToken,
        qrImageDataUrl,
        holdExpiresAt: isFree ? undefined : holdExpiresAt,
        paymentUnavailable: opts.paymentCircuitOpen,
      };
    } catch (e) {
      // DB INSERT fail sau khi đã giữ ghế → rollback seat
      this.logger.error(`Registration insert failed, releasing seat: ${(e as Error).message}`);
      await this.seats.release(workshopId, studentUserId, requestId);
      throw e;
    }
  }

  /**
   * Cancel registration (specs/registration.md §D).
   */
  async cancel(regId: string, studentUserId: string): Promise<{ refundRequired: boolean }> {
    const reg = await this.prisma.registration.findUnique({
      where: { id: regId },
      include: { workshop: true, payments: { where: { status: 'SUCCESS' } } },
    });
    if (!reg) throw new NotFoundException('registration_not_found');
    if (reg.studentId !== studentUserId) throw new ForbiddenException('not_owner');
    if (reg.status === RegistrationStatus.CANCELLED || reg.status === RegistrationStatus.EXPIRED) {
      return { refundRequired: false };
    }

    // Window check: chỉ cho cancel khi >= 1h trước startAt (chỉ áp dụng cho CONFIRMED).
    if (reg.status === RegistrationStatus.CONFIRMED) {
      const msToStart = reg.workshop.startAt.getTime() - Date.now();
      if (msToStart < CANCELLATION_WINDOW_HOURS * 60 * 60 * 1000) {
        throw new UnprocessableEntityException('cancellation_window_closed');
      }
    }

    const refundRequired = reg.payments.length > 0;

    await this.prisma.$transaction(async (tx) => {
      await tx.registration.update({
        where: { id: regId },
        data: {
          status: RegistrationStatus.CANCELLED,
          cancelledAt: new Date(),
        },
      });
      await this.outbox.append(tx, {
        aggregate: 'registration',
        aggregateId: regId,
        eventType: 'registration.cancelled',
        payload: {
          regId,
          workshopId: reg.workshopId,
          studentId: reg.studentId,
          refundRequired,
        },
      });
    });

    await this.seats.release(reg.workshopId, reg.studentId, '');

    void this.audit.log({
      actorId: studentUserId,
      action: 'registration_cancelled',
      resource: 'registration',
      resourceId: regId,
      metadata: { refundRequired },
    });

    return { refundRequired };
  }

  /**
   * Hiển thị registrations của user hiện tại.
   */
  async listMine(studentUserId: string): Promise<RegistrationListItem[]> {
    const regs = await this.prisma.registration.findMany({
      where: { studentId: studentUserId },
      orderBy: { createdAt: 'desc' },
      include: {
        workshop: {
          select: { id: true, title: true, startAt: true, endAt: true, feeAmount: true, status: true },
        },
        student: { select: { id: true, fullName: true, studentCode: true } },
        payments: {
          select: { status: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        checkin: { select: { scannedAt: true } },
      },
      take: 50,
    });

    return regs.map((reg) => this.toListItem(reg));
  }

  async getById(regId: string, studentUserId: string): Promise<RegistrationListItem> {
    const reg = await this.prisma.registration.findUnique({
      where: { id: regId },
      include: {
        workshop: { select: { id: true, title: true, startAt: true, endAt: true, feeAmount: true, status: true } },
        student: { select: { id: true, fullName: true, studentCode: true } },
        payments: { select: { status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        checkin: { select: { scannedAt: true } },
      },
    });
    if (!reg) throw new NotFoundException('registration_not_found');
    if (reg.studentId !== studentUserId) throw new ForbiddenException('not_owner');
    return this.toListItem(reg);
  }

  async listAdmin(
    user: AuthenticatedUser,
    filters: { workshopId?: string; status?: RegistrationStatus; limit?: number; offset?: number },
  ): Promise<RegistrationListItem[]> {
    const limit = Math.min(filters.limit ?? 100, 200);
    const isSysAdmin = user.roles.includes('SYS_ADMIN');

    const regs = await this.prisma.registration.findMany({
      where: {
        workshopId: filters.workshopId,
        status: filters.status,
        workshop: isSysAdmin ? undefined : { createdBy: user.id },
      },
      orderBy: { createdAt: 'desc' },
      skip: filters.offset ?? 0,
      take: limit,
      include: {
        workshop: { select: { id: true, title: true, startAt: true, endAt: true, feeAmount: true, status: true } },
        student: { select: { id: true, fullName: true, studentCode: true } },
        payments: { select: { status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        checkin: { select: { scannedAt: true } },
      },
    });

    return regs.map((reg) => this.toListItem(reg));
  }

  private toListItem(
    reg: Prisma.RegistrationGetPayload<{
      include: {
        workshop: { select: { id: true; title: true; startAt: true; endAt: true; feeAmount: true; status: true } };
        student: { select: { id: true; fullName: true; studentCode: true } };
        payments: { select: { status: true }; orderBy: { createdAt: 'desc' }; take: 1 };
        checkin: { select: { scannedAt: true } };
      };
    }>,
  ): RegistrationListItem {
    const payment = reg.payments[0];
    return {
      id: reg.id,
      workshopId: reg.workshopId,
      workshopTitle: reg.workshop.title,
      studentId: reg.studentId,
      studentName: reg.student.fullName,
      studentCode: reg.student.studentCode,
      status: reg.status,
      feeAmount: reg.feeAmount,
      startAt: reg.workshop.startAt,
      endAt: reg.workshop.endAt,
      createdAt: reg.createdAt,
      holdExpiresAt: reg.holdExpiresAt,
      confirmedAt: reg.confirmedAt,
      cancelledAt: reg.cancelledAt,
      qrToken: reg.qrToken,
      paymentStatus: payment ? this.toPaymentStatus(payment.status) : null,
      checkedIn: !!reg.checkin,
      checkedInAt: reg.checkin?.scannedAt ?? null,
    };
  }

  private toPaymentStatus(
    status: PaymentStatus,
  ): RegistrationListItem['paymentStatus'] {
    if (status === 'SUCCESS') return 'SUCCEEDED';
    if (status === 'REFUNDED') return 'REFUNDED';
    if (status === 'FAILED') return 'FAILED';
    return 'PENDING';
  }
}
