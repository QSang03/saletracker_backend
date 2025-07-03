import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  name?: string;
}
