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

export interface SpeakerOption {
  id: string;
  name: string;
  title?: string | null;
}

export interface RoomOption {
  id: string;
  code: string;
  name: string;
  capacity: number;
  mapUrl?: string | null;
}

export interface WorkshopFormOptions {
  speakers: SpeakerOption[];
  rooms: RoomOption[];
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
  staffId: string;
  staff?: {
    id: string;
    fullName: string;
    email: string;
  };
  workshopId: string;
  workshop?: {
    id: string;
    title: string;
  };
  roomId: string;
  room?: {
    id: string;
    name: string;
    code: string;
  };
  startsAt: string;
  endsAt: string;
}

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  studentCode?: string | null;
  isActive: boolean;
  roles: RoleName[];
  createdAt: string;
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
