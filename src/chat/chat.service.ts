import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OpenAIService } from '../openai/openai.service';
import { SearchService, SearchOptions, SearchResult } from '../search/search.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { CreateMessageDto, ChatFiltersDto, ChatMode } from './dto/create-message.dto';

export interface ChatSession {
  id: number;
  user_id: number;
  title: string;
  created_at: Date;
  updated_at: Date;
}

export interface ChatMessage {
  id: number;
  session_id: number;
  role: 'user' | 'assistant';
  content: string;
  sources: any[];
  created_at: Date;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly db: DatabaseService,
    private readonly openai: OpenAIService,
    private readonly search: SearchService,
  ) {}

  async createSession(userId: number, dto: CreateSessionDto): Promise<ChatSession> {
    const res = await this.db.query<ChatSession>(
      `INSERT INTO chat_sessions (user_id, title)
       VALUES ($1, $2) RETURNING *`,
      [userId, dto.title ?? 'New Chat'],
    );
    return res.rows[0];
  }

  async listSessions(userId: number): Promise<ChatSession[]> {
    const res = await this.db.query<ChatSession>(
      `SELECT * FROM chat_sessions WHERE user_id = $1 ORDER BY updated_at DESC`,
      [userId],
    );
    return res.rows;
  }

  async getMessages(userId: number, sessionId: number): Promise<ChatMessage[]> {
    await this.assertOwner(userId, sessionId);
    const res = await this.db.query<ChatMessage>(
      `SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId],
    );
    return res.rows;
  }

  async addMessage(
    userId: number,
    sessionId: number,
    dto: CreateMessageDto,
  ): Promise<{
    userMessage: ChatMessage;
    assistantMessage: ChatMessage;
    mode: ChatMode;
  }> {
    await this.assertOwner(userId, sessionId);

    // 1. Save user message
    const userMsg = await this.saveMessage(sessionId, 'user', dto.content, []);

    // 2. Resolve mode (explicit > auto-detected from query keywords)
    const mode: ChatMode = dto.mode ?? this.detectMode(dto.content);

    // 3. Build SearchOptions from mode defaults + caller filters
    const searchOpts = this.buildSearchOptions(mode, dto);

    // 4a. Fetch recent history AND pre-compute embedding in parallel.
    //     Both are independent of each other — running concurrently saves one
    //     full OpenAI round-trip on the critical path.
    const [historyEarly, originalEmbedding] = await Promise.all([
      this.db.query<ChatMessage>(
        `SELECT role, content FROM chat_messages
         WHERE session_id = $1 AND id < $2
         ORDER BY created_at DESC LIMIT 10`,
        [sessionId, userMsg.id],
      ),
      this.openai.generateEmbedding(dto.content),
    ]);

    const historyMessages = historyEarly.rows.reverse().map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // 4b. Rewrite contextual follow-ups into a self-contained search query.
    //     When there is no history the call is skipped (returns original).
    //     If the query comes back unchanged we reuse the pre-computed embedding.
    const searchQuery = await this.openai.rewriteQuery(dto.content, historyMessages);

    if (searchQuery === dto.content) {
      // Query was not rewritten — reuse the embedding we already have
      searchOpts.precomputedEmbedding = originalEmbedding;
    }
    // Otherwise the query changed — search.search will generate a fresh embedding

    // 4c. Run filtered semantic search using the (possibly rewritten) query
    const searchResults = await this.search.search(searchQuery, searchOpts);

    // 5. Build context block — include rich provenance line per source
    const orderedResults =
      mode === 'history'
        ? [...searchResults].sort(
            (a, b) =>
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
          )
        : searchResults;

    const contextBlock = orderedResults
      .map((r, i) => this.formatSource(r, i + 1))
      .join('\n\n---\n\n');

    // 6. Generate AI response with mode-specific system prompt
    const answer = await this.openai.chatWithContext(
      dto.content,
      contextBlock,
      historyMessages,
      mode,
    );

    // 7. Save assistant message with rich source citations
    const sources = orderedResults.map((r) => ({
      document_id: r.document_id,
      title: r.title,
      source: r.source,
      author: r.author,
      module: r.module,
      kind: r.kind,
      created_at: r.created_at,
      similarity: r.similarity,
      snippet: (r.content ?? '').slice(0, 200),
      metadata: r.metadata ?? {},
    }));
    const assistantMsg = await this.saveMessage(
      sessionId,
      'assistant',
      answer,
      sources,
    );

    // 8. Touch session metadata (fire-and-forget — does not block the response)
    this.updateSessionMeta(sessionId, dto.content).catch(() => {});

    return { userMessage: userMsg, assistantMessage: assistantMsg, mode };
  }

  /** Updates session updated_at and sets auto-title on the first turn. */
  private async updateSessionMeta(sessionId: number, firstUserContent: string): Promise<void> {
    await this.db.query(
      `UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1`,
      [sessionId],
    );
    const count = await this.db.query(
      'SELECT COUNT(*) FROM chat_messages WHERE session_id = $1',
      [sessionId],
    );
    if (parseInt(count.rows[0].count) <= 2) {
      const shortTitle = firstUserContent.slice(0, 80);
      await this.db.query(
        `UPDATE chat_sessions SET title = $1 WHERE id = $2`,
        [shortTitle, sessionId],
      );
    }
  }

  /**
   * Endpoint 1 — sidebar list
   * Returns all sessions for the user with message count + last message preview.
   */
  async listSessionsForUI(userId: number) {
    const res = await this.db.query(
      `SELECT
         s.id          AS session_id,
         s.title,
         s.created_at,
         s.updated_at,
         COUNT(m.id)::int AS message_count,
         (
           SELECT regexp_replace(content, '<[^>]*>', '', 'g')
             FROM chat_messages
            WHERE session_id = s.id
            ORDER BY created_at DESC
            LIMIT 1
         ) AS last_message_preview
       FROM chat_sessions s
       LEFT JOIN chat_messages m ON m.session_id = s.id
       WHERE s.user_id = $1
       GROUP BY s.id
       ORDER BY s.updated_at DESC`,
      [userId],
    );

    return {
      total: res.rows.length,
      sessions: res.rows,
    };
  }

  /**
   * Endpoint 2 — paired request/response turns for one session
   */
  async getSessionHistory(userId: number, sessionId: number) {
    await this.assertOwner(userId, sessionId);

    const sessionRes = await this.db.query<ChatSession>(
      `SELECT * FROM chat_sessions WHERE id = $1`,
      [sessionId],
    );
    const session = sessionRes.rows[0];

    const msgRes = await this.db.query<ChatMessage>(
      `SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId],
    );
    const rows = msgRes.rows;

    const turns: Array<{
      turn: number;
      asked_at: Date;
      answered_at: Date | null;
      request: string;
      response: string | null;
      sources: any[];
    }> = [];

    let i = 0;
    let turn = 1;
    while (i < rows.length) {
      const current = rows[i];
      if (current.role === 'user') {
        const next = rows[i + 1];
        const hasReply = next?.role === 'assistant';
        turns.push({
          turn,
          asked_at: current.created_at,
          answered_at: hasReply ? next.created_at : null,
          request: current.content,
          response: hasReply ? next.content : null,
          sources: hasReply ? (next.sources ?? []) : [],
        });
        turn++;
        i += hasReply ? 2 : 1;
      } else {
        i++;
      }
    }

    return {
      session_id: session.id,
      title: session.title,
      created_at: session.created_at,
      updated_at: session.updated_at,
      total_turns: turns.length,
      turns,
    };
  }

  async deleteSession(userId: number, sessionId: number): Promise<void> {
    await this.assertOwner(userId, sessionId);
    await this.db.query('DELETE FROM chat_sessions WHERE id = $1', [sessionId]);
  }

  /**
   * Expand a single citation back to its full thread / PR / issue chain so
   * the UI can drill into a source without re-running the LLM.
   */
  async expandSource(
    userId: number,
    sessionId: number,
    messageId: number,
    sourceIndex: number,
  ): Promise<{ root: any; siblings: any[] }> {
    await this.assertOwner(userId, sessionId);
    const msgRes = await this.db.query<ChatMessage>(
      `SELECT * FROM chat_messages WHERE id = $1 AND session_id = $2`,
      [messageId, sessionId],
    );
    if (!msgRes.rows.length) throw new NotFoundException('Message not found');
    const sources = msgRes.rows[0].sources ?? [];
    const src = sources[sourceIndex];
    if (!src) throw new NotFoundException('Source index out of range');

    const md = src.metadata ?? {};
    let siblings: any[] = [];

    if (md.thread_ts) {
      const q = await this.db.query(
        `SELECT id, title, content, source, author, module, kind, metadata, created_at
           FROM documents
          WHERE source = 'slack' AND metadata->>'thread_ts' = $1 AND id <> $2
          ORDER BY created_at ASC LIMIT 100`,
        [String(md.thread_ts), src.document_id],
      );
      siblings = q.rows;
    } else if ((md.pr_number || md.issue_number) && md.repo) {
      const numKey = md.pr_number ? 'pr_number' : 'issue_number';
      const numVal = md.pr_number ?? md.issue_number;
      const q = await this.db.query(
        `SELECT id, title, content, source, author, module, kind, metadata, created_at
           FROM documents
          WHERE source = 'github'
            AND metadata->>'repo' = $1
            AND metadata->>'${numKey}' = $2
            AND id <> $3
          ORDER BY created_at ASC LIMIT 100`,
        [String(md.repo), String(numVal), src.document_id],
      );
      siblings = q.rows;
    }

    return { root: src, siblings };
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private detectMode(content: string): ChatMode {
    const q = content.toLowerCase();
    if (
      /\bwhy did (we|you|the team)\b/.test(q) ||
      /\bdecision\b/.test(q) ||
      /\bdebate\b|\bconcerns? raised\b|\balternatives?\b|\btrade[- ]offs?\b/.test(q) ||
      /\bpick(ed)? .* over\b|\bchose .* over\b/.test(q)
    ) {
      return 'decision';
    }
    if (
      /\bhas anyone\b|\bever seen\b|\bin the past\b|\bpreviously\b|\bbefore\b.*\bissue\b/.test(q)
    ) {
      return 'history';
    }
    if (
      /\bhow does\b|\bhow do i\b|\bwhere is\b|\bwhere does\b|\bwalk me through\b|\bonboard/.test(q)
    ) {
      return 'onboarding';
    }
    return 'qa';
  }

  private buildSearchOptions(
    mode: ChatMode,
    dto: CreateMessageDto,
  ): SearchOptions {
    const f: ChatFiltersDto = dto.filters ?? {};
    const opts: SearchOptions = {
      limit: dto.limit ?? 5,
      threshold: dto.threshold ?? 0.15,
      sources: f.sources,
      modules: f.modules,
      authors: f.authors,
      kinds: f.kinds,
      dateFrom: f.dateFrom,
      dateTo: f.dateTo,
    };

    switch (mode) {
      case 'decision':
        opts.kinds = f.kinds ?? ['decision', 'pr', 'thread', 'doc', 'note'];
        opts.expandThreads = true;
        opts.threshold = Math.max(opts.threshold ?? 0.15, 0.3);
        opts.limit = Math.max(opts.limit ?? 5, 10);
        break;
      case 'onboarding':
        opts.kinds = f.kinds ?? ['code', 'doc', 'pr', 'note'];
        opts.limit = Math.max(opts.limit ?? 5, 8);
        break;
      case 'history':
        opts.limit = Math.max(opts.limit ?? 5, 15);
        opts.threshold = Math.min(opts.threshold ?? 0.15, 0.1);
        break;
      case 'qa':
      default:
        opts.threshold = Math.min(opts.threshold ?? 0.15, 0.1);
        break;
    }
    return opts;
  }

  private formatSource(r: SearchResult, n: number): string {
    const date = r.created_at
      ? new Date(r.created_at).toISOString().slice(0, 10)
      : 'unknown';
    const sim = r.similarity != null ? `${(r.similarity * 100).toFixed(0)}%` : 'related';
    const parts = [
      `Source ${n}`,
      r.source,
      r.kind,
      r.module ? `module=${r.module}` : null,
      r.author ? `by ${r.author}` : null,
      date,
      sim,
    ].filter(Boolean);
    return `[${parts.join(' | ')}]\nTitle: ${r.title}\n${(r.content ?? '').slice(0, 800)}`;
  }

  private async saveMessage(
    sessionId: number,
    role: 'user' | 'assistant',
    content: string,
    sources: any[],
  ): Promise<ChatMessage> {
    const res = await this.db.query<ChatMessage>(
      `INSERT INTO chat_messages (session_id, role, content, sources)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [sessionId, role, content, JSON.stringify(sources)],
    );
    return res.rows[0];
  }

  private async assertOwner(userId: number, sessionId: number) {
    const res = await this.db.query(
      'SELECT user_id FROM chat_sessions WHERE id = $1',
      [sessionId],
    );
    if (!res.rows.length) throw new NotFoundException('Session not found');
    if (res.rows[0].user_id !== userId) throw new ForbiddenException();
  }
}
