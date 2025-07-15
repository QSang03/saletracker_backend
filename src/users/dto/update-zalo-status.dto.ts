import { IsNumber, IsNotEmpty } from 'class-validator';

export class UpdateZaloStatusDto {
  @IsNumber()
  @IsNotEmpty()
  userId: number;
}
