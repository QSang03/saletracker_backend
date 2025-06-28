import { IsString, IsOptional, IsEmail, IsEnum, IsArray, IsNumber } from 'class-validator';
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
  fullName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  departmentIds?: number[];

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  roleIds?: number[];
}
