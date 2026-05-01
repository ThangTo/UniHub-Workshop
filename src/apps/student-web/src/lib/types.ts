/**
 * Domain types — duplicated minimally from backend Prisma to keep the
 * student web app standalone without a `packages/shared` dependency.
 *
 * Only fields actually consumed by UI are listed; `unknown`/`Record` is used
 * for opaque server-side data.
 */

export type RoleName = 'STUDENT' | 'ORGANIZER' | 'CHECKIN_STAFF' | 'SYS_ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  studentCode?: string | null;
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

export interface WorkshopListItem {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  capacity: number;
  seatsLeft: number;
  feeAmount: number;
  status: WorkshopStatus;
  speakerName?: string | null;
  roomName?: string | null;
}

export interface WorkshopDetail extends WorkshopListItem {
  description: string;
  summary?: string | null;
  summaryStatus: SummaryStatus;
  highlights?: string[];
}

export type RegistrationStatus =
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'WAITLIST';

export interface MyRegistration {
  id: string;
  workshopId: string;
  workshopTitle: string;
  status: RegistrationStatus;
  feeAmount: number;
  startAt: string;
  endAt: string;
  qrToken?: string | null;
  paymentStatus?: 'PENDING' | 'SUCCEEDED' | 'FAILED' | null;
}

export interface PaymentInitResponse {
  paymentId: string;
  redirectUrl?: string;
  status: 'success' | 'failed' | 'pending' | 'unavailable' | 'PENDING';
  qrToken?: string;
  qrImageDataUrl?: string;
  gatewayTxnId?: string | null;
  retryAfterSec?: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}
