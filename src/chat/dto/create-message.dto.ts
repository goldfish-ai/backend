import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

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
}
