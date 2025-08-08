import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateOrderBlacklistDto {
  @IsNotEmpty()
  @IsNumber()
  userId: number;

  @IsNotEmpty()
  @IsString()
  zaloContactId: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateOrderBlacklistDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class FindOrderBlacklistDto {
  @IsOptional()
  @IsNumber()
  userId?: number;

  @IsOptional()
  @IsString()
  zaloContactId?: string;

  @IsOptional()
  @IsNumber()
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  limit?: number = 10;
}
