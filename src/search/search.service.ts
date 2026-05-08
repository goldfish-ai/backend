import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OpenAIService } from '../openai/openai.service';

export interface SearchResult {
  document_id: number;
  title: string;
  content: string;
  summary: string | null;
  source: string;
  author: string | null;
  module: string | null;
  kind: string;
  metadata: Record<string, any>;
  similarity: number;
  created_at: Date;
  /** Resolved deep-link to the original source (GitHub commit/PR/issue, Slack message). */
  source_url: string | null;
}

export interface SearchOptions {
  limit?: number;
  threshold?: number;
  sources?: string[];
  modules?: string[];
  authors?: string[];
  kinds?: string[];
  dateFrom?: string | Date;
  dateTo?: string | Date;
  /** When true, sibling thread/PR/issue docs are appended to the result set. */
  expandThreads?: boolean;
  /** Pre-computed embedding for the query — skips the generateEmbedding API call. */
  precomputedEmbedding?: number[];
}

@Injectable()
export class SearchService {
  constructor(
    private readonly db: DatabaseService,
    private readonly openai: OpenAIService,
  ) {}

  /**
   * Semantic search over documents. Supports source/module/author/kind/date filters.
   * Back-compat: callers passing positional `(query, limit, threshold)` still work.
   */
  async search(
    query: string,
    optsOrLimit: SearchOptions | number = {},
    legacyThreshold?: number,
  ): Promise<SearchResult[]> {
    const opts: SearchOptions =
      typeof optsOrLimit === 'number'
        ? { limit: optsOrLimit, threshold: legacyThreshold }
        : optsOrLimit ?? {};

    const limit = opts.limit ?? 5;
    const threshold = opts.threshold ?? 0.2;

    const embedding = opts.precomputedEmbedding ?? await this.openai.generateEmbedding(query);
    const vector = `[${embedding.join(',')}]`;

    const where: string[] = [`1 - (e.embedding <=> $1::vector) > $2`];
    const params: any[] = [vector, threshold];
    const addParam = (v: any) => {
      params.push(v);
      return `$${params.length}`;
    };

    if (opts.sources?.length) where.push(`d.source = ANY(${addParam(opts.sources)})`);
    if (opts.modules?.length) where.push(`d.module = ANY(${addParam(opts.modules)})`);
    if (opts.authors?.length) where.push(`d.author = ANY(${addParam(opts.authors)})`);
    if (opts.kinds?.length)   where.push(`d.kind   = ANY(${addParam(opts.kinds)})`);
    if (opts.dateFrom)        where.push(`d.created_at >= ${addParam(opts.dateFrom)}`);
    if (opts.dateTo)          where.push(`d.created_at <= ${addParam(opts.dateTo)}`);

    const limitParam = addParam(limit);

    const sql = `
      SELECT
        d.id AS document_id,
        d.title,
        d.content,
        d.summary,
        d.source,
        d.author,
        d.module,
        d.kind,
        d.metadata,
        d.created_at,
        1 - (e.embedding <=> $1::vector) AS similarity
      FROM embeddings e
      JOIN documents d ON d.id = e.document_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.embedding <=> $1::vector
      LIMIT ${limitParam}
    `;

    const res = await this.db.query<SearchResult>(sql, params);
    let results = res.rows.map((r) => ({ ...r, source_url: this.resolveSourceUrl(r) }));

    if (opts.expandThreads && results.length) {
      const highQuality = results.filter((r) => r.similarity >= 0.3);
      results = await this.appendThreadSiblings(results, highQuality);
    }

    return results;
  }

  /**
   * Derive a direct deep-link URL from document source + metadata.
   * Returns null when insufficient metadata is available.
   */
  private resolveSourceUrl(r: { source: string; metadata: Record<string, any> }): string | null {
    const md = r.metadata ?? {};

    if (r.source === 'github') {
      const repo = md.repo as string | undefined;
      if (!repo) return null;
      const type = md.type as string | undefined;
      if (type === 'commit' && md.sha)
        return `https://github.com/${repo}/commit/${md.sha}`;
      if (type === 'pull_request' && md.pr_number)
        return `https://github.com/${repo}/pull/${md.pr_number}`;
      if (type === 'issue' && md.issue_number)
        return `https://github.com/${repo}/issues/${md.issue_number}`;
      if (type === 'issue_comment' && md.issue_number) {
        const anchor = md.comment_id ? `#issuecomment-${md.comment_id}` : '';
        const path = md.is_pr ? 'pull' : 'issues';
        return `https://github.com/${repo}/${path}/${md.issue_number}${anchor}`;
      }
    }

    if (r.source === 'slack') {
      const channelId = md.channel_id as string | undefined;
      const ts = (md.thread_ts ?? md.ts) as string | undefined;
      if (channelId && ts)
        return `https://slack.com/app_redirect?channel=${channelId}&message_ts=${ts}`;
    }

    return null;
  }

  /**
   * For each result that lives in a thread / PR / issue, fetch its siblings
   * (same Slack thread, same PR/issue number, same repo) and merge them at the
   * end of the list with similarity=0 so the LLM has the full debate context.
   */
  private async appendThreadSiblings(results: SearchResult[], seedResults?: SearchResult[]): Promise<SearchResult[]> {
    const seen = new Set(results.map((r) => r.document_id));
    const extras: SearchResult[] = [];
    const toExpand = seedResults ?? results;

    for (const r of toExpand) {
      const md = r.metadata ?? {};
      let rows: SearchResult[] = [];

      if (md.thread_ts) {
        const q = await this.db.query<SearchResult>(
          `SELECT id AS document_id, title, content, summary, source, author,
                  module, kind, metadata, created_at, 0::float AS similarity
             FROM documents
            WHERE source = 'slack'
              AND metadata->>'thread_ts' = $1
              AND id <> $2
            ORDER BY created_at ASC
            LIMIT 30`,
          [String(md.thread_ts), r.document_id],
        );
        rows = q.rows;
      } else if ((md.pr_number || md.issue_number) && md.repo) {
        const numKey = md.pr_number ? 'pr_number' : 'issue_number';
        const numVal = md.pr_number ?? md.issue_number;
        const q = await this.db.query<SearchResult>(
          `SELECT id AS document_id, title, content, summary, source, author,
                  module, kind, metadata, created_at, 0::float AS similarity
             FROM documents
            WHERE source = 'github'
              AND metadata->>'repo' = $1
              AND metadata->>'${numKey}' = $2
              AND id <> $3
            ORDER BY created_at ASC
            LIMIT 30`,
          [String(md.repo), String(numVal), r.document_id],
        );
        rows = q.rows;
      }

      for (const sib of rows) {
        if (!seen.has(sib.document_id)) {
          seen.add(sib.document_id);
          extras.push({ ...sib, source_url: this.resolveSourceUrl(sib) });
        }
      }
    }

    return [...results, ...extras];
  }
}
