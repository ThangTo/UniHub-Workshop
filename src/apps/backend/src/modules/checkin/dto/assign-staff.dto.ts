import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class AssignStaffDto {
  @IsUUID()
  staffId!: string;

  @IsUUID()
  workshopId!: string;

  @IsUUID()
  @IsOptional()
  roomId?: string;

  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  endsAt!: string;
}
