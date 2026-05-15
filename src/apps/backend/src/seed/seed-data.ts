export const students = [
  { code: '21120001', name: 'Nguyen Minh Anh', faculty: 'Computer Science', cohort: '2021' },
  { code: '21120002', name: 'Tran Bao Chau', faculty: 'Computer Science', cohort: '2021' },
  { code: '21120003', name: 'Le Gia Huy', faculty: 'Software Engineering', cohort: '2021' },
  { code: '21120004', name: 'Pham Khanh Linh', faculty: 'Computer Science', cohort: '2021' },
  { code: '21120005', name: 'Hoang Nhat Nam', faculty: 'Information Systems', cohort: '2021' },
  { code: '21120006', name: 'Dang Thao Nhi', faculty: 'Software Engineering', cohort: '2021' },
  { code: '21120007', name: 'Vo Quoc Bao', faculty: 'Computer Networks', cohort: '2021' },
  { code: '21120008', name: 'Bui Ngoc Han', faculty: 'Data Science', cohort: '2021' },
  { code: '21120009', name: 'Do Minh Quan', faculty: 'Computer Science', cohort: '2021' },
  { code: '21120010', name: 'Huynh Phuong Vy', faculty: 'Information Systems', cohort: '2021' },
  { code: '22120001', name: 'Nguyen Duc Anh', faculty: 'Computer Science', cohort: '2022' },
  { code: '22120002', name: 'Tran My Duyen', faculty: 'Data Science', cohort: '2022' },
  { code: '22120003', name: 'Le Thanh Dat', faculty: 'Software Engineering', cohort: '2022' },
  { code: '22120004', name: 'Pham Ha My', faculty: 'Computer Science', cohort: '2022' },
  { code: '22120005', name: 'Hoang Tuan Kiet', faculty: 'Information Systems', cohort: '2022' },
  { code: '22120006', name: 'Dang Phuong Linh', faculty: 'Data Science', cohort: '2022' },
  { code: '22120007', name: 'Vo Hoai Nam', faculty: 'Computer Networks', cohort: '2022' },
  { code: '22120008', name: 'Bui Anh Thu', faculty: 'Software Engineering', cohort: '2022' },
  { code: '23120001', name: 'Do Gia Bao', faculty: 'Computer Science', cohort: '2023' },
  { code: '23120002', name: 'Huynh Minh Chau', faculty: 'Data Science', cohort: '2023' },
  { code: '23120003', name: 'Nguyen Thanh Lam', faculty: 'Software Engineering', cohort: '2023' },
  { code: '23120004', name: 'Tran Ngoc Mai', faculty: 'Information Systems', cohort: '2023' },
  { code: '23120005', name: 'Le Quang Vinh', faculty: 'Computer Networks', cohort: '2023' },
  { code: '23120006', name: 'Pham Tue Nghi', faculty: 'Computer Science', cohort: '2023' },
  { code: '24120001', name: 'Hoang Minh Khoi', faculty: 'Computer Science', cohort: '2024' },
  { code: '24120002', name: 'Dang Bao Ngoc', faculty: 'Data Science', cohort: '2024' },
  { code: '24120003', name: 'Vo Anh Khoa', faculty: 'Software Engineering', cohort: '2024' },
  { code: '24120004', name: 'Bui Quynh Anh', faculty: 'Information Systems', cohort: '2024' },
  { code: '24120005', name: 'Do Nhat Minh', faculty: 'Computer Networks', cohort: '2024' },
  { code: '24120006', name: 'Huynh Gia Han', faculty: 'Computer Science', cohort: '2024' },
  { code: '24120007', name: 'Nguyen Phuc Long', faculty: 'Software Engineering', cohort: '2024' },
  { code: '24120008', name: 'Tran Minh Thu', faculty: 'Data Science', cohort: '2024' },
] as const;

export const rooms = [
  { code: 'A101', name: 'A101 - Main Auditorium', capacity: 200 },
  { code: 'A204', name: 'A204 - Product Studio', capacity: 80 },
  { code: 'B205', name: 'B205 - Computer Lab', capacity: 50 },
  { code: 'C301', name: 'C301 - Career Hub', capacity: 120 },
  { code: 'D402', name: 'D402 - Startup Lab', capacity: 60 },
  { code: 'E501', name: 'E501 - Seminar Room', capacity: 90 },
] as const;

export const speakers = [
  {
    name: 'TS. Nguyen Van Khoa',
    title: 'Senior Machine Learning Engineer @ Google',
    bio: 'Researches applied ML systems and production model reliability.',
  },
  {
    name: 'ThS. Le Hoai An',
    title: 'CTO @ Startup XYZ',
    bio: 'Builds distributed systems for high-growth SaaS products.',
  },
  {
    name: 'Nguyen Thanh Phuong',
    title: 'Engineering Manager @ ZaloPay',
    bio: 'Leads backend teams working on payment reliability and observability.',
  },
  {
    name: 'Tran Mai Khanh',
    title: 'Product Designer @ Figma Community VN',
    bio: 'Designs student-friendly onboarding, dashboards, and design systems.',
  },
  {
    name: 'Le Quoc Minh',
    title: 'Security Consultant @ VietSec',
    bio: 'Specializes in web security, identity, and incident response.',
  },
  {
    name: 'Pham Ngoc Diep',
    title: 'Data Scientist @ Shopee',
    bio: 'Works on recommendation systems and experimentation platforms.',
  },
  {
    name: 'Hoang Anh Tuan',
    title: 'DevOps Lead @ CloudOps Vietnam',
    bio: 'Runs Kubernetes, CI/CD, and production readiness programs.',
  },
  {
    name: 'Dang Minh Tri',
    title: 'Founder @ Campus Startup Lab',
    bio: 'Mentors early-stage student teams from idea validation to pitching.',
  },
] as const;

export interface SeedWorkshop {
  title: string;
  description: string;
  speakerName: (typeof speakers)[number]['name'];
  roomCode: (typeof rooms)[number]['code'];
  startAt: Date;
  endAt: Date;
  capacity: number;
  feeAmount: number;
  status: 'DRAFT' | 'PUBLISHED';
  summaryStatus?: 'NONE' | 'READY';
  summary?: string;
  summaryHighlights?: string[];
}

export interface DemoRegistrationPlan {
  studentCode: (typeof students)[number]['code'];
  workshopTitle: string;
  status: 'CONFIRMED' | 'PENDING_PAYMENT' | 'CANCELLED' | 'EXPIRED';
  paymentStatus?: 'SUCCESS' | 'PENDING' | 'FAILED' | 'REFUNDED';
  checkedIn?: boolean;
}

export function buildWorkshops(now = new Date()): SeedWorkshop[] {
  const at = (days: number, hour: number, minute = 0) => {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    date.setHours(hour, minute, 0, 0);
    return date;
  };

  return [
    {
      title: 'AI Career Kickstart: Tu Python den Portfolio ML dau tien',
      description:
        'Lo trinh 3 gio giup sinh vien nam duoi hieu AI engineer can hoc gi, lam portfolio ra sao, va cach tranh hoc lan man.',
      speakerName: 'TS. Nguyen Van Khoa',
      roomCode: 'A101',
      startAt: at(4, 8, 30),
      endAt: at(4, 11, 30),
      capacity: 180,
      feeAmount: 0,
      status: 'PUBLISHED',
      summaryStatus: 'READY',
      summary:
        'Workshop gioi thieu lo trinh vao nghe AI theo huong thuc chien: nen nam Python, xac suat, machine learning co ban, cach doc paper vua du, va cach bien bai tap thanh portfolio co the demo. Sinh vien se duoc xem mot pipeline nho tu dataset den model va cach viet README de nha tuyen dung hieu nang luc.',
      summaryHighlights: [
        'Lo trinh hoc AI trong 12 tuan',
        'Checklist portfolio ML dau tien',
        'Demo pipeline training va evaluation',
        'Cach noi ve du an khi phong van',
      ],
    },
    {
      title: 'Backend at Scale: Redis, Queue va Idempotency trong he thong that',
      description:
        'Buoi thuc chien ve cach xu ly luong dang ky dot bien, retry an toan va tranh tao giao dich trung lap.',
      speakerName: 'ThS. Le Hoai An',
      roomCode: 'C301',
      startAt: at(4, 13, 30),
      endAt: at(4, 16, 30),
      capacity: 100,
      feeAmount: 50000,
      status: 'PUBLISHED',
      summaryStatus: 'READY',
      summary:
        'Noi dung tap trung vao cac mau thiet ke backend khi traffic tang dot bien: token bucket, Redis atomic operation, queue FIFO ngan han, transactional outbox va idempotency key. Dien gia giai thich vi sao cac request retry co the gay duplicate charge neu khong luu snapshot response va cach thiet ke API de client retry an toan.',
      summaryHighlights: [
        'Token bucket va global queue',
        'Idempotency key cho POST nguy hiem',
        'Outbox pattern cho event khong mat',
        'Checklist observability khi release',
      ],
    },
    {
      title: 'UX for Campus Apps: Thiet ke flow dang ky khong gay roi',
      description:
        'Phan tich cac loi UX thuong gap trong cong thong tin sinh vien va cach thiet ke form, empty state, loading state.',
      speakerName: 'Tran Mai Khanh',
      roomCode: 'A204',
      startAt: at(5, 9),
      endAt: at(5, 11),
      capacity: 70,
      feeAmount: 0,
      status: 'PUBLISHED',
      summaryStatus: 'READY',
      summary:
        'Workshop giup sinh vien nhin UI nhu mot chuoi quyet dinh thay vi chi la mau sac. Nguoi tham du hoc cach danh gia navigation, form validation, error copy, empty state va responsive layout cho cac ung dung van hanh trong truong dai hoc.',
      summaryHighlights: [
        'Heuristic review cho web app sinh vien',
        'Mau loi form validation nen tranh',
        'Cach viet empty state co hanh dong tiep theo',
      ],
    },
    {
      title: 'Cybersecurity 101: Tu JWT den phong chong tan cong API',
      description:
        'Nhap mon bao mat ung dung web voi cac vi du gan voi auth, RBAC, token leakage va API abuse.',
      speakerName: 'Le Quoc Minh',
      roomCode: 'B205',
      startAt: at(5, 14),
      endAt: at(5, 17),
      capacity: 12,
      feeAmount: 30000,
      status: 'PUBLISHED',
    },
    {
      title: 'CV & LinkedIn Clinic: Sua ho so trong 30 phut',
      description:
        'Session nho gom review CV, LinkedIn headline va cach viet project bullet cho sinh vien sap tim internship.',
      speakerName: 'Dang Minh Tri',
      roomCode: 'D402',
      startAt: at(5, 18),
      endAt: at(5, 20),
      capacity: 8,
      feeAmount: 0,
      status: 'PUBLISHED',
    },
    {
      title: 'Data Storytelling: Bien dashboard thanh cau chuyen ra quyet dinh',
      description:
        'Cach chon metric, ve chart va trinh bay insight cho ban to chuc su kien, san pham va van hanh.',
      speakerName: 'Pham Ngoc Diep',
      roomCode: 'E501',
      startAt: at(6, 8, 30),
      endAt: at(6, 11, 30),
      capacity: 80,
      feeAmount: 0,
      status: 'PUBLISHED',
    },
    {
      title: 'DevOps Clinic: Docker Compose, Healthcheck va Logging cho demo do an',
      description:
        'Buoi clinic giup nhom sinh vien dong goi project bang Docker, doc log nhanh va chuan bi demo it loi.',
      speakerName: 'Hoang Anh Tuan',
      roomCode: 'D402',
      startAt: at(6, 13, 30),
      endAt: at(6, 16),
      capacity: 55,
      feeAmount: 40000,
      status: 'PUBLISHED',
    },
    {
      title: 'Product Discovery Sprint: Tim problem dang lam truoc khi viet code',
      description:
        'Thuc hanh interview, problem framing, success metric va cach bien insight thanh backlog co uu tien.',
      speakerName: 'Dang Minh Tri',
      roomCode: 'A204',
      startAt: at(7, 9),
      endAt: at(7, 12),
      capacity: 75,
      feeAmount: 0,
      status: 'PUBLISHED',
    },
    {
      title: 'Payment Reliability Lab: Circuit Breaker va Reconcile Job',
      description:
        'Mo phong cong thanh toan cham/down, cach fail-fast, giu ghe, retry webhook va reconcile payment timeout.',
      speakerName: 'Nguyen Thanh Phuong',
      roomCode: 'C301',
      startAt: at(7, 14),
      endAt: at(7, 17),
      capacity: 100,
      feeAmount: 60000,
      status: 'PUBLISHED',
    },
    {
      title: 'Frontend Performance: Lam React app muot hon tren wifi truong',
      description:
        'Profiling, bundle size, loading state va cac pattern giup web app phan hoi tot trong dieu kien mang yeu.',
      speakerName: 'Tran Mai Khanh',
      roomCode: 'E501',
      startAt: at(8, 8, 30),
      endAt: at(8, 11),
      capacity: 85,
      feeAmount: 0,
      status: 'PUBLISHED',
    },
    {
      title: 'Career Panel: Intern Backend, Data, Security can chuan bi gi?',
      description:
        'Panel Q&A voi cac dien gia ve CV, portfolio, phong van technical va cach chon vi tri thuc tap phu hop.',
      speakerName: 'Dang Minh Tri',
      roomCode: 'A101',
      startAt: at(8, 14),
      endAt: at(8, 16, 30),
      capacity: 160,
      feeAmount: 0,
      status: 'PUBLISHED',
    },
    {
      title: 'Offline-first Mobile: SQLite Queue cho check-in su kien',
      description:
        'Thiet ke mobile app van chay khi mat mang: local queue, idempotent sync va xu ly duplicate scan.',
      speakerName: 'Hoang Anh Tuan',
      roomCode: 'B205',
      startAt: at(9, 9),
      endAt: at(9, 12),
      capacity: 45,
      feeAmount: 30000,
      status: 'PUBLISHED',
    },
    {
      title: 'Recommendation Systems Mini Bootcamp',
      description:
        'Gioi thieu collaborative filtering, ranking metrics va cach danh gia recommender tren du lieu nho.',
      speakerName: 'Pham Ngoc Diep',
      roomCode: 'C301',
      startAt: at(9, 13, 30),
      endAt: at(9, 17),
      capacity: 110,
      feeAmount: 70000,
      status: 'PUBLISHED',
    },
    {
      title: 'Workshop nhap mon Open Source Contribution',
      description:
        'Huong dan doc issue, tao pull request nho dau tien, viet commit message va giao tiep voi maintainer.',
      speakerName: 'Le Quoc Minh',
      roomCode: 'D402',
      startAt: at(10, 9),
      endAt: at(10, 11, 30),
      capacity: 50,
      feeAmount: 0,
      status: 'DRAFT',
    },
    {
      title: 'Mock Interview Day: System Design cho sinh vien nam 3',
      description:
        'Buoi phong van thu theo nhom nho, tap trung vao cach hoi lai requirement, ve kien truc va trade-off.',
      speakerName: 'Nguyen Thanh Phuong',
      roomCode: 'E501',
      startAt: at(10, 14),
      endAt: at(10, 17),
      capacity: 60,
      feeAmount: 80000,
      status: 'DRAFT',
    },
  ];
}

const firstYearCodes = students.slice(0, 12).map((student) => student.code);
const secondYearCodes = students.slice(12, 24).map((student) => student.code);
const seniorCodes = students.slice(24, 32).map((student) => student.code);

export const demoRegistrationPlans: DemoRegistrationPlan[] = [
  // Live demo workshop: has some activity, but still plenty of seats left.
  ...firstYearCodes.slice(0, 6).map((studentCode) => ({
    studentCode,
    workshopTitle: 'AI Career Kickstart: Tu Python den Portfolio ML dau tien',
    status: 'CONFIRMED' as const,
    checkedIn: false,
  })),

  // Paid workshop with successful payments and QR-ready registrations.
  ...firstYearCodes.slice(6, 11).map((studentCode) => ({
    studentCode,
    workshopTitle: 'Backend at Scale: Redis, Queue va Idempotency trong he thong that',
    status: 'CONFIRMED' as const,
    paymentStatus: 'SUCCESS' as const,
  })),
  {
    studentCode: firstYearCodes[11],
    workshopTitle: 'Backend at Scale: Redis, Queue va Idempotency trong he thong that',
    status: 'PENDING_PAYMENT',
    paymentStatus: 'PENDING',
  },

  // UX session: mixed confirmed/cancelled states for admin table coverage.
  ...secondYearCodes.slice(0, 5).map((studentCode) => ({
    studentCode,
    workshopTitle: 'UX for Campus Apps: Thiet ke flow dang ky khong gay roi',
    status: 'CONFIRMED' as const,
  })),
  {
    studentCode: secondYearCodes[5],
    workshopTitle: 'UX for Campus Apps: Thiet ke flow dang ky khong gay roi',
    status: 'CANCELLED',
  },

  // Nearly full: 12 capacity, 9 active registrations => 3 seats left.
  ...secondYearCodes.slice(0, 7).map((studentCode) => ({
    studentCode,
    workshopTitle: 'Cybersecurity 101: Tu JWT den phong chong tan cong API',
    status: 'CONFIRMED' as const,
    paymentStatus: 'SUCCESS' as const,
  })),
  ...secondYearCodes.slice(7, 9).map((studentCode) => ({
    studentCode,
    workshopTitle: 'Cybersecurity 101: Tu JWT den phong chong tan cong API',
    status: 'PENDING_PAYMENT' as const,
    paymentStatus: 'PENDING' as const,
  })),

  // Full: useful for testing the disabled "Het ghe" UI.
  ...seniorCodes.slice(0, 8).map((studentCode) => ({
    studentCode,
    workshopTitle: 'CV & LinkedIn Clinic: Sua ho so trong 30 phut',
    status: 'CONFIRMED' as const,
    checkedIn: studentCode === seniorCodes[0],
  })),

  // More paid/payment states for dashboard and metrics.
  ...firstYearCodes.slice(0, 4).map((studentCode) => ({
    studentCode,
    workshopTitle: 'Payment Reliability Lab: Circuit Breaker va Reconcile Job',
    status: 'PENDING_PAYMENT' as const,
    paymentStatus: 'PENDING' as const,
  })),
  ...firstYearCodes.slice(4, 7).map((studentCode) => ({
    studentCode,
    workshopTitle: 'Payment Reliability Lab: Circuit Breaker va Reconcile Job',
    status: 'CONFIRMED' as const,
    paymentStatus: 'SUCCESS' as const,
  })),
  {
    studentCode: firstYearCodes[7],
    workshopTitle: 'Payment Reliability Lab: Circuit Breaker va Reconcile Job',
    status: 'CANCELLED',
    paymentStatus: 'REFUNDED',
  },

  // Check-in-friendly registrations.
  ...secondYearCodes.slice(0, 4).map((studentCode, index) => ({
    studentCode,
    workshopTitle: 'Offline-first Mobile: SQLite Queue cho check-in su kien',
    status: 'CONFIRMED' as const,
    paymentStatus: 'SUCCESS' as const,
    checkedIn: index === 0,
  })),
];
