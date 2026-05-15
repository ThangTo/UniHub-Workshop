/**
 * Dev seed script — chạy: `pnpm seed` từ src/apps/backend.
 *
 * Tạo dữ liệu mẫu để smoke test Phase 1:
 *   - 4 roles (BootstrapService cũng làm, nhưng idempotent upsert).
 *   - 1 SYS_ADMIN (BootstrapService cũng làm; ở đây skip nếu đã có).
 *   - 1 ORGANIZER, 1 CHECKIN_STAFF.
 *   - 32 students (MSSV) cho register flow.
 *   - 6 rooms, 8 speakers, 14 workshops (12 PUBLISHED, 2 DRAFT).
 *
 * Idempotent: chạy nhiều lần không lỗi.
 */
import { PaymentStatus, PrismaClient, RegistrationStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import Redis from 'ioredis';
import { buildWorkshops, demoRegistrationPlans, rooms, speakers, students } from './seed-data';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding UniHub Workshop dev data...');

  // 1. Roles
  const roleNames = ['STUDENT', 'ORGANIZER', 'CHECKIN_STAFF', 'SYS_ADMIN'] as const;
  for (const name of roleNames) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
  }
  const roles = await prisma.role.findMany();
  const roleMap = new Map(roles.map((r) => [r.name, r.id]));
  console.log(`  ✓ Roles: ${roles.map((r) => r.name).join(', ')}`);

  // 2. Sample students (MSSV pre-loaded — needed for register flow)
  for (const s of students) {
    await prisma.student.upsert({
      where: { studentCode: s.code },
      update: {
        fullName: s.name,
        faculty: s.faculty,
        cohort: s.cohort,
        isActive: true,
      },
      create: {
        studentCode: s.code,
        fullName: s.name,
        faculty: s.faculty,
        cohort: s.cohort,
        isActive: true,
      },
    });
  }
  console.log(`  ✓ Students: ${students.length} MSSV`);

  // 3. ORGANIZER + CHECKIN_STAFF users
  const passwordHash = await bcrypt.hash('Test@12345', 10);

  const organizer = await prisma.user.upsert({
    where: { email: 'organizer@unihub.local' },
    update: {
      passwordHash,
      fullName: 'Organizer Demo',
      isActive: true,
    },
    create: {
      email: 'organizer@unihub.local',
      passwordHash,
      fullName: 'Organizer Demo',
      roles: { create: { roleId: roleMap.get('ORGANIZER')! } },
    },
  });
  const checkinStaff = await prisma.user.upsert({
    where: { email: 'staff@unihub.local' },
    update: {
      passwordHash,
      fullName: 'Checkin Staff Demo',
      isActive: true,
    },
    create: {
      email: 'staff@unihub.local',
      passwordHash,
      fullName: 'Checkin Staff Demo',
      roles: { create: { roleId: roleMap.get('CHECKIN_STAFF')! } },
    },
  });
  await prisma.userRole.createMany({
    data: [
      { userId: organizer.id, roleId: roleMap.get('ORGANIZER')! },
      { userId: checkinStaff.id, roleId: roleMap.get('CHECKIN_STAFF')! },
    ],
    skipDuplicates: true,
  });
  console.log(`  ✓ Users: ${organizer.email}, ${checkinStaff.email} (password: Test@12345)`);

  // 4. Rooms
  const roomRecords = [];
  for (const room of rooms) {
    roomRecords.push(
      await prisma.room.upsert({
        where: { code: room.code },
        update: { name: room.name, capacity: room.capacity },
        create: room,
      }),
    );
  }
  const roomMap = new Map(roomRecords.map((room) => [room.code, room]));
  console.log(`  ✓ Rooms: ${roomRecords.map((room) => room.code).join(', ')}`);

  // 5. Speakers
  const speakerRecords = [];
  for (const speaker of speakers) {
    const existing = await prisma.speaker.findFirst({ where: { name: speaker.name } });
    speakerRecords.push(
      existing
        ? await prisma.speaker.update({
            where: { id: existing.id },
            data: { title: speaker.title, bio: speaker.bio },
          })
        : await prisma.speaker.create({ data: speaker }),
    );
  }
  const speakerMap = new Map(speakerRecords.map((speaker) => [speaker.name, speaker]));
  console.log(`  ✓ Speakers: ${speakerRecords.length} professional speakers`);

  // 6. Workshops
  const workshops = buildWorkshops();
  const workshopRecords = [];
  for (const w of workshops) {
    const speaker = speakerMap.get(w.speakerName);
    const room = roomMap.get(w.roomCode);
    if (!speaker || !room) {
      throw new Error(`Missing seed relation for workshop "${w.title}"`);
    }
    const data = {
      title: w.title,
      description: w.description,
      speakerId: speaker.id,
      roomId: room.id,
      startAt: w.startAt,
      endAt: w.endAt,
      capacity: w.capacity,
      feeAmount: w.feeAmount,
      status: w.status,
      summaryStatus: w.summaryStatus ?? 'NONE',
      summary: w.summary ?? null,
      summaryHighlights: w.summaryHighlights ?? undefined,
      createdBy: organizer.id,
    };
    const existing = await prisma.workshop.findFirst({ where: { title: w.title } });
    workshopRecords.push(
      existing
        ? await prisma.workshop.update({ where: { id: existing.id }, data })
        : await prisma.workshop.create({ data }),
    );
  }
  const publishedCount = workshops.filter((w) => w.status === 'PUBLISHED').length;
  const draftCount = workshops.filter((w) => w.status === 'DRAFT').length;
  console.log(`  ✓ Workshops: ${workshops.length} (${publishedCount} PUBLISHED, ${draftCount} DRAFT)`);

  // 7. Staff assignments for the first demo week
  const assignmentWorkshops = workshopRecords
    .filter((w) => w.status === 'PUBLISHED')
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .slice(0, 8);
  await prisma.staffRoomAssignment.createMany({
    data: assignmentWorkshops.map((w) => ({
      staffId: checkinStaff.id,
      workshopId: w.id,
      roomId: w.roomId!,
      startsAt: w.startAt,
      endsAt: w.endAt,
    })),
    skipDuplicates: true,
  });
  console.log(`  ✓ Staff assignments: ${assignmentWorkshops.length} upcoming workshops`);

  // 8. Demo student accounts + registrations/payments/check-ins
  const studentRoleId = roleMap.get('STUDENT')!;
  const studentByCode = new Map(students.map((student) => [student.code, student]));
  const workshopByTitle = new Map(workshopRecords.map((workshop) => [workshop.title, workshop]));
  const demoUsers = new Map<string, { id: string; email: string }>();

  for (const s of students) {
    const existing = await prisma.user.findUnique({ where: { studentCode: s.code } });
    const email = existing?.email ?? `student.${s.code}@unihub.local`;
    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash,
            fullName: s.name,
            isActive: true,
          },
        })
      : await prisma.user.create({
          data: {
            email,
            passwordHash,
            fullName: s.name,
            studentCode: s.code,
            roles: { create: { roleId: studentRoleId } },
          },
        });
    await prisma.userRole.createMany({
      data: [{ userId: user.id, roleId: studentRoleId }],
      skipDuplicates: true,
    });
    demoUsers.set(s.code, { id: user.id, email: user.email });
  }

  let confirmedRegistrations = 0;
  let pendingRegistrations = 0;
  let inactiveRegistrations = 0;
  let paymentsSeeded = 0;
  let checkinsSeeded = 0;

  for (const plan of demoRegistrationPlans) {
    const student = studentByCode.get(plan.studentCode);
    const user = demoUsers.get(plan.studentCode);
    const workshop = workshopByTitle.get(plan.workshopTitle);
    if (!student || !user || !workshop) {
      throw new Error(`Invalid demo registration plan: ${plan.studentCode} -> ${plan.workshopTitle}`);
    }

    const status = plan.status as RegistrationStatus;
    const isActiveSeat = status === RegistrationStatus.CONFIRMED || status === RegistrationStatus.PENDING_PAYMENT;
    const holdExpiresAt =
      status === RegistrationStatus.PENDING_PAYMENT
        ? new Date(Date.now() + 15 * 60 * 1000)
        : status === RegistrationStatus.EXPIRED
          ? new Date(Date.now() - 15 * 60 * 1000)
          : null;
    const confirmedAt = status === RegistrationStatus.CONFIRMED ? new Date() : null;
    const cancelledAt =
      status === RegistrationStatus.CANCELLED || status === RegistrationStatus.EXPIRED ? new Date() : null;

    const existing = await prisma.registration.findUnique({
      where: {
        workshopId_studentId: {
          workshopId: workshop.id,
          studentId: user.id,
        },
      },
    });
    const registration = existing
      ? await prisma.registration.update({
          where: { id: existing.id },
          data: {
            status,
            feeAmount: workshop.feeAmount,
            holdExpiresAt,
            confirmedAt,
            cancelledAt,
          },
        })
      : await prisma.registration.create({
          data: {
            workshopId: workshop.id,
            studentId: user.id,
            status,
            feeAmount: workshop.feeAmount,
            holdExpiresAt,
            confirmedAt,
            cancelledAt,
          },
        });

    if (status === RegistrationStatus.CONFIRMED) confirmedRegistrations += 1;
    else if (status === RegistrationStatus.PENDING_PAYMENT) pendingRegistrations += 1;
    else inactiveRegistrations += 1;

    if (plan.paymentStatus) {
      const paymentStatus = plan.paymentStatus as PaymentStatus;
      const idempotencyKey = `seed:${registration.id}:payment`;
      const existingPayment = await prisma.payment.findUnique({ where: { idempotencyKey } });
      const paymentData = {
        registrationId: registration.id,
        attemptNo: 1,
        amount: workshop.feeAmount,
        currency: 'VND',
        gateway: 'mock-pg',
        gatewayTxnId:
          paymentStatus === PaymentStatus.SUCCESS || paymentStatus === PaymentStatus.REFUNDED
            ? `seed_txn_${registration.id.slice(0, 12)}`
            : null,
        status: paymentStatus,
        idempotencyKey,
        requestHash: 'seeded-demo-payment'.padEnd(64, '0').slice(0, 64),
        responseSnapshot: {
          seeded: true,
          studentCode: plan.studentCode,
          workshopTitle: plan.workshopTitle,
        },
        failureReason: paymentStatus === PaymentStatus.FAILED ? 'Seeded failed payment demo' : null,
      };
      existingPayment
        ? await prisma.payment.update({ where: { id: existingPayment.id }, data: paymentData })
        : await prisma.payment.create({ data: paymentData });
      paymentsSeeded += 1;
    }

    if (plan.checkedIn && status === RegistrationStatus.CONFIRMED) {
      const idempotencyKey = `${registration.id}${checkinStaff.id}`.replace(/-/g, '').padEnd(64, '0').slice(0, 64);
      await prisma.checkin.upsert({
        where: { registrationId: registration.id },
        update: {
          scannedAt: new Date(),
          deviceId: 'seed-checkin-device',
          staffId: checkinStaff.id,
          idempotencyKey,
        },
        create: {
          registrationId: registration.id,
          scannedAt: new Date(),
          deviceId: 'seed-checkin-device',
          staffId: checkinStaff.id,
          idempotencyKey,
        },
      });
      checkinsSeeded += 1;
    }
  }

  await reconcileRedisSeats(
    workshopRecords.map((workshop) => ({ id: workshop.id, capacity: workshop.capacity })),
  );
  console.log(
    `  ✓ Demo registrations: ${confirmedRegistrations} CONFIRMED, ${pendingRegistrations} PENDING_PAYMENT, ${inactiveRegistrations} inactive`,
  );
  console.log(`  ✓ Demo payments/check-ins: ${paymentsSeeded} payments, ${checkinsSeeded} check-ins`);

  console.log('\n✅ Seed completed.');
  console.log('\nLogin credentials (password: Test@12345):');
  console.log('  - admin@unihub.local      [SYS_ADMIN]    (created by BootstrapService)');
  console.log('  - organizer@unihub.local  [ORGANIZER]');
  console.log('  - staff@unihub.local      [CHECKIN_STAFF]');
  console.log('\nSample MSSVs for /auth/register: 21120001..21120010, 22120001..22120008, 23120001..23120006, 24120001..24120008');
  console.log('Demo student login format: student.<MSSV>@unihub.local / Test@12345');
}

async function reconcileRedisSeats(workshops: Array<{ id: string; capacity: number }>): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return;

  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await redis.connect();
    for (const workshop of workshops) {
      const active = await prisma.registration.count({
        where: {
          workshopId: workshop.id,
          status: { in: [RegistrationStatus.CONFIRMED, RegistrationStatus.PENDING_PAYMENT] },
        },
      });
      await redis.set(`seat:${workshop.id}`, String(Math.max(0, workshop.capacity - active)));
    }
  } catch (e) {
    console.warn(`  ! Redis seat reconcile skipped: ${(e as Error).message}`);
  } finally {
    redis.disconnect();
  }
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
