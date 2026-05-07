import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Client } from '@notionhq/client';
import { DatabaseService } from '../database/database.service';
import { DocumentsService } from '../documents/documents.service';

@Injectable()
export class NotionPollService {
  private readonly logger = new Logger(NotionPollService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
    private readonly documents: DocumentsService,
  ) {}

  /** Poll every 15 minutes by default */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async pollAll() {
    const rawIds = this.config.get<string>('NOTION_POLL_DATABASES');
    if (!rawIds) return;

    const token = this.config.get<string>('NOTION_TOKEN');
    if (!token) return;

    const databaseIds = rawIds.split(',').map((s) => s.trim()).filter(Boolean);
    for (const dbId of databaseIds) {
      await this.pollDatabase(dbId, token);
    }
  }

  /** Manual trigger via HTTP */
  async triggerPoll(): Promise<{ ingested: number }> {
    const rawIds = this.config.get<string>('NOTION_POLL_DATABASES') ?? '';
    const token = this.config.get<string>('NOTION_TOKEN');
    if (!token || !rawIds) return { ingested: 0 };

    const databaseIds = rawIds.split(',').map((s) => s.trim()).filter(Boolean);
    let total = 0;
    for (const dbId of databaseIds) {
      const count = await this.pollDatabase(dbId, token);
      total += count;
    }
    return { ingested: total };
  }

  private async pollDatabase(databaseId: string, token: string): Promise<number> {
    const client = new Client({ auth: token });

    // Get last poll time from DB
    const lastPollRes = await this.db.query(
      `SELECT value FROM meta WHERE key = $1`,
      [`notion_last_poll_${databaseId}`],
    );
    const lastPoll = lastPollRes.rows[0]?.value ?? new Date(0).toISOString();

    let ingested = 0;
    try {
      const response = await client.databases.query({
        database_id: databaseId,
        filter: {
          timestamp: 'last_edited_time',
          last_edited_time: { after: lastPoll },
        },
      });

      for (const page of response.results) {
        if (!('properties' in page)) continue;

        // Check if already stored
        const exists = await this.db.query(
          `SELECT id FROM documents WHERE metadata->>'notion_id' = $1`,
          [page.id],
        );
        if (exists.rows.length) {
          // Update existing doc's content by deleting and re-embedding
          await this.db.query('DELETE FROM documents WHERE id = $1', [
            exists.rows[0].id,
          ]);
        }

        const title = this.getPageTitle(page);
        const blocksRes = await client.blocks.children.list({ block_id: page.id });
        const content = this.extractText(blocksRes.results as any[]);
        if (!content && !title) continue;

        await this.documents.create({
          title,
          content: content || title,
          source: 'notion',
          metadata: {
            notion_id: page.id,
            database_id: databaseId,
            url: (page as any).url,
            auto: true,
          },
        });
        ingested++;
      }
    } catch (err) {
      this.logger.error(`Notion poll failed for ${databaseId}:`, err as Error);
    }

    // Save poll time
    await this.db.query(
      `INSERT INTO meta (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [`notion_last_poll_${databaseId}`, new Date().toISOString()],
    );

    if (ingested > 0) {
      this.logger.log(`Notion: ingested ${ingested} updated page(s) from ${databaseId}`);
    }
    return ingested;
  }

  private getPageTitle(page: any): string {
    const props = page.properties || {};
    const titleProp = Object.values(props).find((p: any) => p.type === 'title') as any;
    return titleProp?.title?.map((t: any) => t.plain_text).join('') || 'Untitled';
  }

  private extractText(blocks: any[]): string {
    return blocks
      .map((block) => {
        const type = block.type as string;
        const content = (block as any)[type];
        if (!content) return '';
        if (content.rich_text) {
          const text = content.rich_text.map((t: any) => t.plain_text).join('');
          return type.startsWith('heading') ? `## ${text}` : text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
}
