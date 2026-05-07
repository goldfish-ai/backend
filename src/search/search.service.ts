import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OpenAIService } from '../openai/openai.service';

export interface SearchResult {
  document_id: number;
  title: string;
  content: string;
  summary: string | null;
  source: string;
  similarity: number;
  created_at: Date;
}

@Injectable()
export class SearchService {
  constructor(
    private readonly db: DatabaseService,
    private readonly openai: OpenAIService,
  ) {}

  async search(query: string, limit = 5, threshold = 0.2): Promise<SearchResult[]> {
    const embedding = await this.openai.generateEmbedding(query);
    const vector = `[${embedding.join(',')}]`;

    const res = await this.db.query<SearchResult>(
      `SELECT
         d.id AS document_id,
         d.title,
         d.content,
         d.summary,
         d.source,
         d.created_at,
         1 - (e.embedding <=> $1::vector) AS similarity
       FROM embeddings e
       JOIN documents d ON d.id = e.document_id
       WHERE 1 - (e.embedding <=> $1::vector) > $2
       ORDER BY e.embedding <=> $1::vector
       LIMIT $3`,
      [vector, threshold, limit],
    );

    return res.rows;
  }
}
