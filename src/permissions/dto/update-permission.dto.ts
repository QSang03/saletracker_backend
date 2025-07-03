import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

export class UpdatePermissionDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  action?: string;
}
