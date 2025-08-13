import { IsArray, IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ToggleAutoReplyBulkDto {
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  contactIds?: number[] | 'ALL';

  @IsBoolean()
  enabled: boolean;
}

export class AssignPersonaDto {
  @IsOptional()
  @IsNumber()
  personaId?: number | null;
}

export class AssignPersonaBulkDto {
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  contactIds?: number[] | 'ALL';

  @IsOptional()
  @IsNumber()
  personaId?: number | null;
}

export class RenameContactDto {
  @IsString()
  @IsNotEmpty()
  newName: string;
}
