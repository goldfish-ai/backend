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

  /** Override env NOTION_TOKEN */
  @IsOptional()
  @IsString()
  token?: string;
}
