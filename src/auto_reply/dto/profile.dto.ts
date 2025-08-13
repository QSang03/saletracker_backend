import { IsOptional, IsString } from 'class-validator';

export class ProfilePatchDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  toneHints?: string;

  @IsOptional()
  @IsString()
  aovThreshold?: string | null;
}
