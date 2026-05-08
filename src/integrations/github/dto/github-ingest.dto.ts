import { IsArray, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export type GithubIngestType = 'commits' | 'pulls' | 'issues' | 'files' | 'all';

export class GithubIngestDto {
  @IsString()
  owner: string;

  @IsString()
  repo: string;

  @IsOptional()
  @IsEnum(['commits', 'pulls', 'issues', 'files', 'all'])
  type?: GithubIngestType = 'all';

  /**
   * Max number of items to fetch per data type.
   * When omitted, all pages are fetched (full historical sync).
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsEnum(['open', 'closed', 'all'])
  state?: 'open' | 'closed' | 'all' = 'all';

  /**
   * Branch/tag/SHA to fetch commits and files from. Defaults to the repo's default branch.
   * Example: "development"
   */
  @IsOptional()
  @IsString()
  branch?: string;

  /**
   * Specific file paths to ingest (for type="files").
   * When omitted, all .md/.txt/doc files in the repo are ingested.
   * Example: ["README.md", "docs/architecture.md"]
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  filePaths?: string[];

  /** Override the project DB token for this request only */
  @IsOptional()
  @IsString()
  token?: string;
}
