import { IsString, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';

export class CreateOrderInquiryPresetDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsNumber()
  user_id?: number; // This will be set from the authenticated user
}
