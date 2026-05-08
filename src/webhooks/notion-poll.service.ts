import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Client } from '@notionhq/client';
import { DatabaseService } from '../database/database.service';
import { DocumentsService } from '../documents/documents.service';

interface ProjectNotionConfig {
  projectId: number;
  token: string;
  databaseIds: string[];
}

@Injectable()
export class NotionPollService {
  private readonly logger = new Logger(NotionPollService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
    private readonly documents: DocumentsService,
  ) {}

  /** Poll every 30 minutes for all projects */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async pollAll() {
    const configs = await this.loadProjectConfigs();
    for (const cfg of configs) {
      for (const dbId of cfg.databaseIds) {
        await this.pollDatabase(dbId, cfg.token, cfg.projectId);
      }
    }
  }

  /** Manual trigger via HTTP — optionally scoped to a single project */
  async triggerPoll(projectId?: number): Promise<{ ingested: number }> {
    const configs = await this.loadProjectConfigs(projectId);
    let total = 0;
    for (const cfg of configs) {
      for (const dbId of cfg.databaseIds) {
        const count = await this.pollDatabase(dbId, cfg.token, cfg.projectId);
        total += count;
      }
    }
    return { ingested: total };
  }

  /**
   * Load Notion configs from project_integrations.
   * Falls back to env vars for project 1 when no DB rows exist for it.
   */
  private async loadProjectConfigs(projectId?: number): Promise<ProjectNotionConfig[]> {
    const whereClause = projectId
      ? `WHERE provider = 'notion' AND project_id = $1`
      : `WHERE provider = 'notion'`;
    const params = projectId ? [projectId] : [];

    const res = await this.db.query(
      `SELECT project_id, config FROM project_integrations ${whereClause}`,
      params,
    );

    const configs: ProjectNotionConfig[] = res.rows
      .map((row: any) => {
        const cfg = row.config ?? {};
        const token: string | undefined = cfg.token ?? cfg.access_token;
        const rawDbs: string | undefined = cfg.poll_databases;
        if (!token || !rawDbs) return null;
        const databaseIds = rawDbs.split(',').map((s: string) => s.trim()).filter(Boolean);
        if (!databaseIds.length) return null;
        return { projectId: row.project_id as number, token, databaseIds };
      })
      .filter((c: ProjectNotionConfig | null): c is ProjectNotionConfig => c !== null);

    // Env-var fallback for project 1 (only when it has no DB integration row)
    const hasProject1 = configs.some((c) => c.projectId === 1);
    if (!hasProject1 && (!projectId || projectId === 1)) {
      const envToken = this.config.get<string>('NOTION_TOKEN');
      const envDbs = this.config.get<string>('NOTION_POLL_DATABASES');
      if (envToken && envDbs) {
        const databaseIds = envDbs.split(',').map((s) => s.trim()).filter(Boolean);
        if (databaseIds.length) {
          configs.push({ projectId: 1, token: envToken, databaseIds });
        }
      }
    }

    return configs;
  }

  private async pollDatabase(databaseId: string, token: string, projectId: number): Promise<number> {
    const client = new Client({ auth: token });

    const lastPollRes = await this.db.query(
      `SELECT value FROM meta WHERE key = $1`,
      [`notion_last_poll_${projectId}_${databaseId}`],
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

        const exists = await this.db.query(
          `SELECT id FROM documents WHERE metadata->>'notion_id' = $1 AND project_id = $2`,
          [page.id, projectId],
        );
        if (exists.rows.length) {
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
        }, projectId);
        ingested++;
      }
    } catch (err) {
      this.logger.error(`Notion poll failed for project ${projectId} db ${databaseId}:`, err as Error);
    }

    await this.db.query(
      `INSERT INTO meta (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [`notion_last_poll_${projectId}_${databaseId}`, new Date().toISOString()],
    );

    if (ingested > 0) {
      this.logger.log(`Notion: ingested ${ingested} page(s) from db ${databaseId} (project ${projectId})`);
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
