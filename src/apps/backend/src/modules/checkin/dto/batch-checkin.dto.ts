import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';

/**
 * 1 lần quét QR. App ghi local rồi gửi batch để giảm round-trip.
 *
 * `idempotencyKey` = sha256(regId + deviceId + scannedAtMs) — UNIQUE trong DB,
 * cùng 1 lần quét gửi nhiều lần chỉ tạo 1 row (specs/checkin.md §F).
 */
export class CheckinItemDto {
  @IsString()
  @IsNotEmpty()
  qrToken!: string;

  @IsISO8601()
  scannedAt!: string;

  @IsString()
  @Length(1, 64)
  deviceId!: string;

  @IsString()
  @Length(64, 64) // sha256 hex = 64 chars
  idempotencyKey!: string;
}

export class BatchCheckinDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CheckinItemDto)
  items!: CheckinItemDto[];
}

export type CheckinResultCode =
  | 'accepted'
  | 'duplicate'
  | 'invalid_signature'
  | 'expired'
  | 'not_yet_valid'
  | 'revoked'
  | 'invalid_registration'
  | 'wrong_room'
  | 'unknown_error';

export interface CheckinItemResult {
  idempotencyKey: string;
  regId?: string;
  result: CheckinResultCode;
  message?: string;
  scannedAt?: string;
}

export interface BatchCheckinResponse {
  accepted: CheckinItemResult[];
  duplicates: CheckinItemResult[];
  invalid: CheckinItemResult[];
}
