import { IsNotEmpty, IsOptional, IsString, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class PersonaUpsertDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  personaPrompt: string;

  // Optional when no JWT; used to associate persona to a specific user
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  userId?: number;
}

export class PersonaPatchDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  personaPrompt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  userId?: number;
}
