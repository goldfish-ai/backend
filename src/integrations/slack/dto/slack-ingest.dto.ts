import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SlackIngestDto {
  @IsString()
  channelId: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number = 200;

  /** Override the project DB token for this request only */
  @IsOptional()
  @IsString()
  token?: string;
}
