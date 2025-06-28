import { IsArray, IsNumber } from 'class-validator';

export class AssignUsersDto {
  @IsArray()
  @IsNumber({}, { each: true })
  userIds: number[];
}
