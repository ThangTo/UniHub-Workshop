import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class InitiatePaymentDto {
  @IsUUID()
  @IsNotEmpty()
  registrationId!: string;

  @IsOptional()
  @IsString()
  @IsIn(['qr', 'card', 'wallet'])
  method?: string;
}
