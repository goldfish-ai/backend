import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OpenAIService } from '../openai/openai.service';
import { SearchService } from '../search/search.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { CreateMessageDto } from './dto/create-message.dto';

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
  ): Promise<{ userMessage: ChatMessage; assistantMessage: ChatMessage }> {
    await this.assertOwner(userId, sessionId);

    // 1. Save user message
    const userMsg = await this.saveMessage(sessionId, 'user', dto.content, []);

    // 2. Semantic search for context
    const searchResults = await this.search.search(
      dto.content,
      dto.limit ?? 5,
      dto.threshold ?? 0.15,
    );

    // 3. Build context block from top results
    const contextBlock = searchResults
      .map(
        (r, i) =>
          `[Source ${i + 1} | ${r.source} | similarity: ${(r.similarity * 100).toFixed(0)}%]\nTitle: ${r.title}\n${r.content.slice(0, 800)}`,
      )
      .join('\n\n---\n\n');

    // 4. Get recent history (last 10 turns)
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

    // 5. Generate AI response
    const answer = await this.openai.chatWithContext(
      dto.content,
      contextBlock,
      historyMessages,
    );

    // 6. Save assistant message with sources
    const sources = searchResults.map((r) => ({
      document_id: r.document_id,
      title: r.title,
      source: r.source,
      similarity: r.similarity,
      snippet: r.content.slice(0, 200),
    }));
    const assistantMsg = await this.saveMessage(sessionId, 'assistant', answer, sources);

    // 7. Update session updated_at and auto-title if first message
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

    return { userMessage: userMsg, assistantMessage: assistantMsg };
  }

  async deleteSession(userId: number, sessionId: number): Promise<void> {
    await this.assertOwner(userId, sessionId);
    await this.db.query('DELETE FROM chat_sessions WHERE id = $1', [sessionId]);
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
