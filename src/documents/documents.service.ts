import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OpenAIService } from '../openai/openai.service';
import { CreateDocumentDto } from './dto/create-document.dto';

export interface DocumentRow {
  id: number;
  title: string;
  content: string;
  summary: string | null;
  source: string;
  author: string | null;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly openai: OpenAIService,
  ) {}

  async create(dto: CreateDocumentDto): Promise<DocumentRow> {
    const embedding = await this.openai.generateEmbedding(
      `${dto.title}\n\n${dto.content}`,
    );

    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const docRes = await client.query<DocumentRow>(
        `INSERT INTO documents (title, content, source, author, metadata)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          dto.title,
          dto.content,
          dto.source ?? 'manual',
          dto.author ?? null,
          dto.metadata ?? {},
        ],
      );
      const doc = docRes.rows[0];

      await client.query(
        `INSERT INTO embeddings (document_id, embedding, model_name)
         VALUES ($1, $2::vector, $3)`,
        [doc.id, this.toVectorLiteral(embedding), this.openai.getEmbeddingModel()],
      );

      await client.query('COMMIT');
      return doc;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async findAll(limit = 50): Promise<DocumentRow[]> {
    const res = await this.db.query<DocumentRow>(
      `SELECT * FROM documents ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return res.rows;
  }

  async findOne(id: number): Promise<DocumentRow> {
    const res = await this.db.query<DocumentRow>(
      `SELECT * FROM documents WHERE id = $1`,
      [id],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException(`Document ${id} not found`);
    }
    return res.rows[0];
  }

  async remove(id: number): Promise<void> {
    const res = await this.db.query(`DELETE FROM documents WHERE id = $1`, [id]);
    if (res.rowCount === 0) {
      throw new NotFoundException(`Document ${id} not found`);
    }
  }

  async updateSummary(id: number, summary: string): Promise<DocumentRow> {
    const res = await this.db.query<DocumentRow>(
      `UPDATE documents SET summary = $1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [summary, id],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException(`Document ${id} not found`);
    }
    return res.rows[0];
  }

  /** Convert number[] to pgvector text literal e.g. "[0.1,0.2,...]" */
  private toVectorLiteral(vec: number[]): string {
    return `[${vec.join(',')}]`;
  }
}
