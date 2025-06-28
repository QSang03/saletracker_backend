import { IsArray, IsNumber } from 'class-validator';

export class AssignRolesDto {
  @IsArray()
  @IsNumber({}, { each: true })
  roleIds: number[];
}
