import {
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

export class SummaryDto {
  @ValidateIf((o) => !o.text)
  @IsInt()
  documentId?: number;

  @ValidateIf((o) => !o.documentId)
  @IsString()
  text?: string;

  @IsOptional()
  @IsInt()
  @Min(20)
  maxWords?: number;
}
