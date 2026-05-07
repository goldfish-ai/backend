import { IsOptional, IsString, MaxLength, MinLength, IsObject } from 'class-validator';

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

  @IsOptional()
  @IsString()
  @MaxLength(200)
  module?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  kind?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  decision_type?: string;
}
