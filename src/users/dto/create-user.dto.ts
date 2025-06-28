import { 
  IsString, 
  IsOptional, 
  IsNotEmpty, 
  IsArray, 
  IsNumber, 
  IsEmail,
  IsPhoneNumber,
  IsEnum
} from 'class-validator';

// Tạo enum cho trạng thái
export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsPhoneNumber(undefined)
  phone?: string;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsNumber()
  departmentId?: number;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  roleIds?: number[];
}
