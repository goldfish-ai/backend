import { IsOptional, IsString } from 'class-validator';

export class NotionIngestDto {
  /** Ingest all pages in a Notion database */
  @IsOptional()
  @IsString()
  databaseId?: string;

  /** Ingest a single Notion page */
  @IsOptional()
  @IsString()
  pageId?: string;

  /** Override the project DB token for this request only */
  @IsOptional()
  @IsString()
  token?: string;
}
