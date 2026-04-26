import { IsArray, IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fullName!: string;

  @IsArray()
  @IsString({ each: true })
  roles!: string[]; // ['ORGANIZER', 'CHECKIN_STAFF']

  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;
}
