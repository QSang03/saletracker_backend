import { IsString, IsOptional } from 'class-validator';

export class UpdateOrderInquiryPresetDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;
}
