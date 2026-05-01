/**
 * Dev seed script — chạy: `pnpm seed` từ src/apps/backend.
 *
 * Tạo dữ liệu mẫu để smoke test Phase 1:
 *   - 4 roles (BootstrapService cũng làm, nhưng idempotent upsert).
 *   - 1 SYS_ADMIN (BootstrapService cũng làm; ở đây skip nếu đã có).
 *   - 1 ORGANIZER, 1 CHECKIN_STAFF.
 *   - 5 students (MSSV) cho register flow.
 *   - 2 rooms, 2 speakers, 3 workshops (1 DRAFT, 2 PUBLISHED).
 *
 * Idempotent: chạy nhiều lần không lỗi.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

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
  const students = [
    { code: '21120001', name: 'Nguyễn Văn A', faculty: 'CNTT', cohort: '2021' },
    { code: '21120002', name: 'Trần Thị B',   faculty: 'CNTT', cohort: '2021' },
    { code: '21120003', name: 'Lê Văn C',     faculty: 'KTPM', cohort: '2021' },
    { code: '21120004', name: 'Demo Student 04', faculty: 'CNTT', cohort: '2021' },
    { code: '21120005', name: 'Demo Student 05', faculty: 'CNTT', cohort: '2021' },
    { code: '21120006', name: 'Demo Student 06', faculty: 'CNTT', cohort: '2021' },
    { code: '22120004', name: 'Phạm Thị D',   faculty: 'CNTT', cohort: '2022' },
    { code: '22120005', name: 'Hoàng Văn E',  faculty: 'HTTT', cohort: '2022' },
  ];
  for (const s of students) {
    await prisma.student.upsert({
      where: { studentCode: s.code },
      update: {},
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
    update: {},
    create: {
      email: 'organizer@unihub.local',
      passwordHash,
      fullName: 'Organizer Demo',
      roles: { create: { roleId: roleMap.get('ORGANIZER')! } },
    },
  });
  const checkinStaff = await prisma.user.upsert({
    where: { email: 'staff@unihub.local' },
    update: {},
    create: {
      email: 'staff@unihub.local',
      passwordHash,
      fullName: 'Checkin Staff Demo',
      roles: { create: { roleId: roleMap.get('CHECKIN_STAFF')! } },
    },
  });
  console.log(`  ✓ Users: ${organizer.email}, ${checkinStaff.email} (password: Test@12345)`);

  // 4. Rooms
  const roomA = await prisma.room.upsert({
    where: { code: 'A101' },
    update: {},
    create: { code: 'A101', name: 'Phòng A101 — Hội trường lớn', capacity: 200 },
  });
  const roomB = await prisma.room.upsert({
    where: { code: 'B205' },
    update: {},
    create: { code: 'B205', name: 'Phòng B205 — Lab CNTT', capacity: 50 },
  });
  console.log(`  ✓ Rooms: ${roomA.code}, ${roomB.code}`);

  // 5. Speakers
  const existingSpeakers = await prisma.speaker.findMany({ where: { name: { in: ['TS. Nguyễn Văn Khoa', 'ThS. Lê Hoài An'] } } });
  let speakerKhoa = existingSpeakers.find((s) => s.name === 'TS. Nguyễn Văn Khoa');
  let speakerAn = existingSpeakers.find((s) => s.name === 'ThS. Lê Hoài An');
  if (!speakerKhoa) {
    speakerKhoa = await prisma.speaker.create({
      data: { name: 'TS. Nguyễn Văn Khoa', title: 'Senior Engineer @ Google', bio: 'Chuyên gia ML/AI.' },
    });
  }
  if (!speakerAn) {
    speakerAn = await prisma.speaker.create({
      data: { name: 'ThS. Lê Hoài An', title: 'CTO @ Startup XYZ', bio: 'Chuyên gia hệ thống phân tán.' },
    });
  }
  console.log(`  ✓ Speakers: ${speakerKhoa.name}, ${speakerAn.name}`);

  // 6. Workshops
  const now = new Date();
  const inDays = (d: number, h = 9) => {
    const x = new Date(now);
    x.setDate(x.getDate() + d);
    x.setHours(h, 0, 0, 0);
    return x;
  };

  const workshops = [
    {
      title: 'Giới thiệu Machine Learning cho người mới bắt đầu',
      description: 'Workshop nhập môn ML, từ linear regression đến neural network.',
      speakerId: speakerKhoa.id,
      roomId: roomA.id,
      startAt: inDays(7, 9),
      endAt: inDays(7, 12),
      capacity: 100,
      feeAmount: 0,
      status: 'PUBLISHED' as const,
    },
    {
      title: 'Hệ thống phân tán: Từ lý thuyết đến thực tiễn',
      description: 'CAP theorem, microservices, event-driven architecture.',
      speakerId: speakerAn.id,
      roomId: roomB.id,
      startAt: inDays(14, 14),
      endAt: inDays(14, 17),
      capacity: 40,
      feeAmount: 50000,
      status: 'PUBLISHED' as const,
    },
    {
      title: 'Workshop nháp (DRAFT) — chưa publish',
      description: 'Demo state DRAFT, chưa hiển thị public.',
      speakerId: speakerKhoa.id,
      roomId: roomB.id,
      startAt: inDays(21, 9),
      endAt: inDays(21, 11),
      capacity: 30,
      feeAmount: 0,
      status: 'DRAFT' as const,
    },
  ];

  for (const w of workshops) {
    const existing = await prisma.workshop.findFirst({ where: { title: w.title } });
    if (existing) continue;
    await prisma.workshop.create({
      data: { ...w, createdBy: organizer.id },
    });
  }
  console.log(`  ✓ Workshops: ${workshops.length} (2 PUBLISHED, 1 DRAFT)`);

  console.log('\n✅ Seed completed.');
  console.log('\nLogin credentials (password: Test@12345):');
  console.log('  - admin@unihub.local      [SYS_ADMIN]    (created by BootstrapService)');
  console.log('  - organizer@unihub.local  [ORGANIZER]');
  console.log('  - staff@unihub.local      [CHECKIN_STAFF]');
  console.log('\nSample MSSVs for /auth/register: 21120001..21120006, 22120004..22120005');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
