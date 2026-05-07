import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ChatFiltersDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sources?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  modules?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  authors?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  kinds?: string[];

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export type ChatMode = 'qa' | 'decision' | 'onboarding' | 'history';

export class CreateMessageDto {
  @IsString()
  @MinLength(1)
  content: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 5;

  @IsOptional()
  @Type(() => Number)
  threshold?: number = 0.15;

  @IsOptional()
  @IsIn(['qa', 'decision', 'onboarding', 'history'])
  mode?: ChatMode;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ChatFiltersDto)
  filters?: ChatFiltersDto;
}
