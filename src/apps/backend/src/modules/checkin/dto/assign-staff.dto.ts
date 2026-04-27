import { IsISO8601, IsUUID } from 'class-validator';

export class AssignStaffDto {
  @IsUUID()
  staffId!: string;

  @IsUUID()
  workshopId!: string;

  @IsUUID()
  roomId!: string;

  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  endsAt!: string;
}
