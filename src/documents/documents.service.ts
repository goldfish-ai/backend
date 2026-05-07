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
  data_created_at: Date | null;
  metadata: Record<string, any>;
  module: string | null;
  kind: string;
  decision_type: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Derive `module` and `kind` from a document's source + metadata + title.
 * Used by integrations and the documents endpoint when callers don't set them
 * explicitly.
 */
export function deriveModuleAndKind(input: {
  title: string;
  source: string;
  metadata?: Record<string, any>;
  module?: string | null;
  kind?: string | null;
}): { module: string | null; kind: string } {
  const md = input.metadata ?? {};
  const module =
    input.module ??
    md.module ??
    md.repo ??
    md.channel ??
    md.database_id ??
    null;

  let kind = input.kind ?? null;
  if (!kind) {
    const t = md.type;
    if (t === 'pull_request') kind = 'pr';
    else if (t === 'commit') kind = 'code';
    else if (t === 'issue') kind = 'issue';
    else if (t === 'thread') kind = 'thread';
    else if (t === 'message') kind = 'message';
    else if (input.source === 'notion') kind = 'doc';
    else if (/\b(adr|decision|rfc)\b/i.test(input.title)) kind = 'decision';
    else kind = 'note';
  }
  return { module, kind };
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

    const { module, kind } = deriveModuleAndKind({
      title: dto.title ?? '',
      source: dto.source ?? 'manual',
      metadata: dto.metadata,
      module: dto.module,
      kind: dto.kind,
    });

    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const docRes = await client.query<DocumentRow>(
        `INSERT INTO documents (title, content, source, author, metadata, module, kind, decision_type, data_created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          dto.title,
          dto.content,
          dto.source ?? 'manual',
          dto.author ?? null,
          dto.metadata ?? {},
          module,
          kind,
          dto.decision_type ?? null,
          dto.dataCreatedAt ?? null,
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
