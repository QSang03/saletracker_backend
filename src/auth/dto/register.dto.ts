import { Type } from 'class-transformer';
import { IsArray, IsInt, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  username: string;

  @IsString()
  @MinLength(6, { message: 'Password phải có ít nhất 6 ký tự' })
  password: string;

  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  roleIds: number[];
}
