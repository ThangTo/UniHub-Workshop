import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../infra/redis/redis.service';
import { ALLOCATE_SEAT_LUA, RELEASE_SEAT_LUA } from './lua/scripts';

export type AllocateResult =
  | { ok: true; seatsLeft: number }
  | { ok: false; reason: 'sold_out' }
  | { ok: false; reason: 'already_holding'; existingRequestId: string };

export type ReleaseResult =
  | { ok: true; seatsLeft: number }
  | { ok: false; reason: 'no_hold' | 'mismatch' };

/**
 * Wrapper Lua scripts cho seat allocation/release (specs/registration.md §A,§C).
 *
 * Đảm bảo atomicity: 1000 SV cùng `allocate` workshop còn 1 ghế → đúng 1 SV thắng,
 * nhờ Redis EVAL chạy single-threaded.
 */
@Injectable()
export class SeatService {
  private readonly logger = new Logger(SeatService.name);
  private readonly allocateSrc = ALLOCATE_SEAT_LUA;
  private readonly releaseSrc = RELEASE_SEAT_LUA;

  constructor(private readonly redis: RedisService) {}

  static seatKey(workshopId: string): string {
    return `seat:${workshopId}`;
  }
  static holdKey(workshopId: string, studentId: string): string {
    return `hold:${workshopId}:${studentId}`;
  }

  /**
   * Atomic allocate seat. Khi seat key chưa tồn tại, init = capacity.
   * @param ttlSeconds 15*60 thường, 5*60 khi payment circuit Open.
   */
  async allocate(
    workshopId: string,
    studentId: string,
    requestId: string,
    capacity: number,
    ttlSeconds: number,
  ): Promise<AllocateResult> {
    const result = (await this.redis
      .getClient()
      .eval(
        this.allocateSrc,
        2,
        SeatService.seatKey(workshopId),
        SeatService.holdKey(workshopId, studentId),
        requestId,
        String(ttlSeconds),
        String(capacity),
      )) as [number, string | number, string?];

    if (result[0] === 1) {
      return { ok: true, seatsLeft: Number(result[1]) };
    }
    if (result[1] === 'already_holding') {
      return { ok: false, reason: 'already_holding', existingRequestId: result[2] ?? '' };
    }
    return { ok: false, reason: 'sold_out' };
  }

  /**
   * Atomic release. requestId='' để skip check (dùng cho admin/sweeper force release).
   */
  async release(workshopId: string, studentId: string, requestId: string): Promise<ReleaseResult> {
    const result = (await this.redis
      .getClient()
      .eval(
        this.releaseSrc,
        2,
        SeatService.seatKey(workshopId),
        SeatService.holdKey(workshopId, studentId),
        requestId,
      )) as [number, string | number];

    if (result[0] === 1) {
      return { ok: true, seatsLeft: Number(result[1]) };
    }
    return { ok: false, reason: result[1] as 'no_hold' | 'mismatch' };
  }

  /**
   * Lấy số ghế còn lại real-time. Trả null nếu Redis chưa có key (chưa ai đăng ký).
   */
  async getSeatsLeft(workshopId: string): Promise<number | null> {
    const v = await this.redis.getClient().get(SeatService.seatKey(workshopId));
    return v == null ? null : Number(v);
  }

  /**
   * Set seatsLeft trực tiếp (dùng bởi reconcile job).
   */
  async setSeatsLeft(workshopId: string, seatsLeft: number): Promise<void> {
    await this.redis.getClient().set(SeatService.seatKey(workshopId), String(seatsLeft));
  }
}
