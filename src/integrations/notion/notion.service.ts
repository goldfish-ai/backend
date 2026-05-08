import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@notionhq/client';
import { DocumentsService } from '../../documents/documents.service';
import { NotionIngestDto } from './dto/notion-ingest.dto';

@Injectable()
export class NotionService {
  private readonly logger = new Logger(NotionService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly documents: DocumentsService,
  ) {}

  private getClient(token?: string): Client {
    const t = token || this.config.get<string>('NOTION_TOKEN');
    if (!t) throw new BadRequestException('NOTION_TOKEN is required');
    return new Client({ auth: t });
  }

  async ingest(dto: NotionIngestDto, projectId = 1): Promise<{ stored: number[] }> {
    if (!dto.databaseId && !dto.pageId) {
      throw new BadRequestException('Provide databaseId or pageId');
    }

    const stored: number[] = [];

    if (dto.databaseId) {
      const ids = await this.ingestDatabase(dto.databaseId, dto.token, projectId);
      stored.push(...ids);
    }

    if (dto.pageId) {
      const id = await this.ingestPage(dto.pageId, dto.token, projectId);
      stored.push(id);
    }

    return { stored };
  }

  private extractText(blocks: any[]): string {
    return blocks
      .map((block) => {
        const type = block.type as string;
        const content = (block as any)[type];
        if (!content) return '';

        // Handle blocks with rich_text
        if (content.rich_text) {
          const text = content.rich_text.map((t: any) => t.plain_text).join('');
          return type === 'heading_1'
            ? `# ${text}`
            : type === 'heading_2'
              ? `## ${text}`
              : type === 'heading_3'
                ? `### ${text}`
                : type === 'bulleted_list_item' || type === 'numbered_list_item'
                  ? `- ${text}`
                  : text;
        }

        // Handle child_page blocks
        if (type === 'child_page') {
          return `[Page: ${content.title}]`;
        }

        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  private getPageTitle(page: any): string {
    const props = page.properties || {};
    const titleProp = Object.values(props).find((p: any) => p.type === 'title') as any;
    return titleProp?.title?.map((t: any) => t.plain_text).join('') || 'Untitled';
  }

  private async ingestDatabase(databaseId: string, token?: string, projectId = 1): Promise<number[]> {
    const client = this.getClient(token);
    const response = await client.databases.query({ database_id: databaseId });
    const stored: number[] = [];

    for (const page of response.results) {
      if (!('properties' in page)) continue;

      const title = this.getPageTitle(page);
      const blocksRes = await client.blocks.children.list({ block_id: page.id });
      const content = this.extractText(blocksRes.results as any[]);

      if (!content && !title) continue;

      const doc = await this.documents.create({
        title,
        content: content || title,
        source: 'notion',
        metadata: { notion_id: page.id, database_id: databaseId, url: (page as any).url },
      }, projectId);
      stored.push(doc.id);
    }

    return stored;
  }

  private async ingestPage(pageId: string, token?: string, projectId = 1): Promise<number> {
    const client = this.getClient(token);
    const page = await client.pages.retrieve({ page_id: pageId });
    const title = this.getPageTitle(page);
    const blocksRes = await client.blocks.children.list({ block_id: pageId });
    const content = this.extractText(blocksRes.results as any[]);

    const doc = await this.documents.create({
      title,
      content: content || title,
      source: 'notion',
      metadata: { notion_id: pageId, url: (page as any).url },
    }, projectId);

    return doc.id;
  }
}
