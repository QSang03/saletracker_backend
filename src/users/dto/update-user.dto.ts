import {
  IsString,
  IsOptional,
  IsEmail,
  IsEnum,
  IsArray,
  IsNumber,
  IsBoolean,
  IsDate,
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
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsString()
  lastLogin?: boolean | string | null;

  @IsOptional()
  @IsString()
  fullName?: string;

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
}
