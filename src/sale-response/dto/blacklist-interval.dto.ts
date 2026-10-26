import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class BlacklistIntervalDto {
  @IsNumber()
  userId: number;

  @IsNotEmpty()
  @IsString()
  zaloContactId: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
