import { IsNotEmpty, IsNumber, IsOptional, IsString, IsEnum } from 'class-validator';

export class CreateAnalysisBlockDto {
  @IsNotEmpty()
  @IsNumber()
  userId: number;

  @IsNotEmpty()
  @IsString()
  zaloContactId: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsNotEmpty()
  @IsEnum(['analysis', 'reporting', 'stats'])
  blockType: 'analysis' | 'reporting' | 'stats';
}

export class CreateAnalysisBlockRequestDto {
  @IsNotEmpty()
  @IsString()
  zaloContactId: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsNotEmpty()
  @IsEnum(['analysis', 'reporting', 'stats'])
  blockType: 'analysis' | 'reporting' | 'stats';
}

export class UpdateAnalysisBlockDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsEnum(['analysis', 'reporting', 'stats'])
  blockType?: 'analysis' | 'reporting' | 'stats';
}

export class FindAnalysisBlockDto {
  @IsOptional()
  @IsNumber()
  userId?: number;

  @IsOptional()
  @IsString()
  zaloContactId?: string;

  @IsOptional()
  @IsEnum(['analysis', 'reporting', 'stats'])
  blockType?: 'analysis' | 'reporting' | 'stats';

  @IsOptional()
  @IsNumber()
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  limit?: number = 10;
}
