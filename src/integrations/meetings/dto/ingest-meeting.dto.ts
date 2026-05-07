import {
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TranscriptEntryDto {
  @IsString()
  speaker: string;

  @IsDateString()
  timestamp: string;

  @IsArray()
  @IsString({ each: true })
  text: string[];
}

export class IngestMeetingDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  duration?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TranscriptEntryDto)
  transcript: TranscriptEntryDto[];
}
