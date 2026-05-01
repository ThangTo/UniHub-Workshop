export type RoleName = 'STUDENT' | 'ORGANIZER' | 'CHECKIN_STAFF' | 'SYS_ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  roles: RoleName[];
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user?: AuthUser;
  userId?: string;
  fullName?: string;
  roles?: RoleName[];
}

export type WorkshopStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'ENDED' | 'COMPLETED';
export type SummaryStatus = 'NONE' | 'PENDING' | 'READY' | 'FAILED';

export interface WorkshopSummary {
  id: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  capacity: number;
  seatsLeft: number;
  feeAmount: number;
  status: WorkshopStatus;
  speakerName?: string | null;
  roomName?: string | null;
  speakerId?: string | null;
  roomId?: string | null;
  summaryStatus: SummaryStatus;
  summary?: string | null;
  highlights?: string[];
  version?: number;
}

export interface CreateWorkshopInput {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  capacity: number;
  feeAmount: number;
  speakerId?: string | null;
  roomId?: string | null;
}

export type ImportJobStatus = 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';

export interface ImportJob {
  id: string;
  fileName: string;
  fileSha256: string;
  sourceExportedAt?: string | null;
  totalRows?: number | null;
  insertedRows?: number | null;
  updatedRows?: number | null;
  failedRows?: number | null;
  status: ImportJobStatus;
  startedAt: string;
  finishedAt?: string | null;
  errorLog?: { reason?: string; failedRows?: { line: number; reason: string; raw?: string }[] } | null;
}

export interface StaffAssignment {
  id: string;
  staffId: string;
  staffName?: string;
  roomId: string;
  roomName?: string;
  workshopId?: string | null;
  workshopTitle?: string | null;
  startsAt: string;
  endsAt: string;
}

export interface AdminRegistration {
  id: string;
  workshopId: string;
  workshopTitle?: string;
  studentId: string;
  studentName?: string;
  studentCode?: string | null;
  status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'WAITLIST';
  feeAmount: number;
  createdAt: string;
  checkedIn?: boolean;
  checkedInAt?: string | null;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}
