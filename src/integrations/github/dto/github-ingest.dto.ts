import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export type GithubIngestType = 'commits' | 'pulls' | 'issues' | 'all';

export class GithubIngestDto {
  @IsString()
  owner: string;

  @IsString()
  repo: string;

  @IsOptional()
  @IsEnum(['commits', 'pulls', 'issues', 'all'])
  type?: GithubIngestType = 'all';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 30;

  @IsOptional()
  @IsEnum(['open', 'closed', 'all'])
  state?: 'open' | 'closed' | 'all' = 'all';

  /** Override env GITHUB_TOKEN */
  @IsOptional()
  @IsString()
  token?: string;
}
