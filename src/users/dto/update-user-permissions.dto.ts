import { IsArray, IsNumber, IsOptional } from 'class-validator';

export class UpdateUserPermissionsDto {
  @IsArray()
  @IsNumber({}, { each: true })
  roleIds: number[];

  @IsArray()
  @IsNumber({}, { each: true })
  @IsOptional()
  permissionIds?: number[];
}
