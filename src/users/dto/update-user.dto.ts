import {
  IsString,
  IsOptional,
  IsEmail,
  IsEnum,
  IsArray,
  IsNumber,
  IsBoolean,
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

  @IsOptional()
  @IsEmail()
  email?: string;

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
  employeeCode?: string;

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
  refreshToken?: string;
}
