import {
  IsString,
  IsOptional,
  IsEmail,
  IsEnum,
  IsArray,
  IsNumber,
  IsBoolean,
  ValidateIf,
} from 'class-validator';
import { UserStatus } from '../user-status.enum';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  currentPassword?: string;

  @ValidateIf(
    (obj) => obj.email !== '' && obj.email !== null && obj.email !== undefined,
  )
  @IsEmail({}, { message: 'email must be an email', each: false })
  @IsOptional()
  email?: string | null;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  lastLogin?: boolean | string | null;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  nickName?: string;

  @IsOptional()
  @IsBoolean()
  isBlock?: boolean;

  @IsOptional()
  @IsString()
  employeeCode?: string | null;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  departmentIds?: number[];

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  roleIds?: number[];

  @IsOptional()
  @IsString()
  deletedAt?: string | null;

  @IsOptional()
  zaloLinkStatus?: number;

  @IsOptional()
  @IsString()
  zaloName?: string;

  @IsOptional()
  @IsString()
  avatarZalo?: string;

  @IsOptional()
  @IsString()
  zaloGender?: string;

  @IsOptional()
  @IsString()
  refreshToken?: string;

  // Enable/disable user-level auto-reply
  @IsOptional()
  @IsBoolean()
  isAutoReplyEnabled?: boolean;
}
