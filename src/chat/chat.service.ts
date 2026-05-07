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

    // 4. Run filtered semantic search (with thread expansion when needed)
    const searchResults = await this.search.search(dto.content, searchOpts);

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

    // 6. Get recent history (last 10 turns)
    const history = await this.db.query<ChatMessage>(
      `SELECT role, content FROM chat_messages
       WHERE session_id = $1 AND id < $2
       ORDER BY created_at DESC LIMIT 10`,
      [sessionId, userMsg.id],
    );
    const historyMessages = history.rows.reverse().map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // 7. Generate AI response with mode-specific system prompt
    const answer = await this.openai.chatWithContext(
      dto.content,
      contextBlock,
      historyMessages,
      mode,
    );

    // 8. Save assistant message with rich source citations
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

    // 9. Touch session updated_at + auto-title on first user turn
    await this.db.query(
      `UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1`,
      [sessionId],
    );
    const count = await this.db.query(
      'SELECT COUNT(*) FROM chat_messages WHERE session_id = $1',
      [sessionId],
    );
    if (parseInt(count.rows[0].count) <= 2) {
      const shortTitle = dto.content.slice(0, 80);
      await this.db.query(
        `UPDATE chat_sessions SET title = $1 WHERE id = $2`,
        [shortTitle, sessionId],
      );
    }

    return { userMessage: userMsg, assistantMessage: assistantMsg, mode };
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
        opts.kinds = f.kinds ?? ['decision', 'pr', 'thread', 'doc'];
        opts.expandThreads = true;
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
