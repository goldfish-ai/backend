import { IsDateString, IsOptional, IsString, MaxLength, MinLength, IsObject } from 'class-validator';

export class CreateDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title: string;

  @IsString()
  @MinLength(1)
  content: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  author?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  /** Original event timestamp (commit date, message time, transcript timestamp, etc.) */
  @IsOptional()
  @IsDateString()
  dataCreatedAt?: string;
}
