import { IsOptional, IsString, MaxLength, MinLength, IsObject } from 'class-validator';

export class SeedDocumentDto {
  /** Raw text to embed and store. The first line is used as the title. */
  @IsString()
  @MinLength(1)
  text: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  author?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
