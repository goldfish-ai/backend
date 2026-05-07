import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface TimelineQuery {
  modules?: string[];
  sources?: string[];
  kinds?: string[];
  authors?: string[];
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export interface TimelineEvent {
  id: number;
  title: string;
  summary: string | null;
  source: string;
  kind: string;
  module: string | null;
  author: string | null;
  created_at: Date;
  metadata: Record<string, any>;
}

export interface TimelineResponse {
  events: TimelineEvent[];
  facets: {
    modules: Record<string, number>;
    sources: Record<string, number>;
    kinds: Record<string, number>;
    authors: Record<string, number>;
  };
  total: number;
}

@Injectable()
export class TimelineService {
  constructor(private readonly db: DatabaseService) {}

  async getTimeline(q: TimelineQuery): Promise<TimelineResponse> {
    const where: string[] = ['1=1'];
    const params: any[] = [];
    const addParam = (v: any) => {
      params.push(v);
      return `$${params.length}`;
    };

    if (q.modules?.length) where.push(`d.module = ANY(${addParam(q.modules)})`);
    if (q.sources?.length) where.push(`d.source = ANY(${addParam(q.sources)})`);
    if (q.kinds?.length)   where.push(`d.kind   = ANY(${addParam(q.kinds)})`);
    if (q.authors?.length) where.push(`d.author = ANY(${addParam(q.authors)})`);
    if (q.dateFrom)        where.push(`d.created_at >= ${addParam(q.dateFrom)}`);
    if (q.dateTo)          where.push(`d.created_at <= ${addParam(q.dateTo)}`);

    const whereSql = where.join(' AND ');
    const limit = Math.min(q.limit ?? 100, 500);
    const offset = q.offset ?? 0;

    const eventsSql = `
      SELECT id, title, summary, source, kind, module, author, created_at, metadata
        FROM documents d
       WHERE ${whereSql}
       ORDER BY created_at DESC
       LIMIT ${addParam(limit)} OFFSET ${addParam(offset)}
    `;
    const events = (await this.db.query<TimelineEvent>(eventsSql, params)).rows;

    // facets reuse the filter params (without LIMIT/OFFSET)
    const facetParams = params.slice(0, params.length - 2);

    const [moduleAgg, sourceAgg, kindAgg, authorAgg, totalRes] = await Promise.all([
      this.db.query<{ key: string; count: string }>(
        `SELECT COALESCE(module,'(none)') AS key, COUNT(*)::text AS count
           FROM documents d WHERE ${whereSql}
           GROUP BY 1 ORDER BY 2 DESC LIMIT 30`,
        facetParams,
      ),
      this.db.query<{ key: string; count: string }>(
        `SELECT source AS key, COUNT(*)::text AS count
           FROM documents d WHERE ${whereSql}
           GROUP BY 1 ORDER BY 2 DESC LIMIT 30`,
        facetParams,
      ),
      this.db.query<{ key: string; count: string }>(
        `SELECT kind AS key, COUNT(*)::text AS count
           FROM documents d WHERE ${whereSql}
           GROUP BY 1 ORDER BY 2 DESC LIMIT 30`,
        facetParams,
      ),
      this.db.query<{ key: string; count: string }>(
        `SELECT COALESCE(author,'(unknown)') AS key, COUNT(*)::text AS count
           FROM documents d WHERE ${whereSql}
           GROUP BY 1 ORDER BY 2 DESC LIMIT 30`,
        facetParams,
      ),
      this.db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM documents d WHERE ${whereSql}`,
        facetParams,
      ),
    ]);

    const toMap = (
      rows: { key: string; count: string }[],
    ): Record<string, number> =>
      Object.fromEntries(rows.map((r) => [r.key, parseInt(r.count, 10)]));

    return {
      events,
      facets: {
        modules: toMap(moduleAgg.rows),
        sources: toMap(sourceAgg.rows),
        kinds: toMap(kindAgg.rows),
        authors: toMap(authorAgg.rows),
      },
      total: parseInt(totalRes.rows[0].count, 10),
    };
  }
}
