import { Injectable } from '@nestjs/common';
import { SearchService } from '../search/search.service';

export interface ExpertsQuery {
  topic: string;
  modules?: string[];
  sources?: string[];
  limit?: number;
}

export interface ExpertEntry {
  author: string;
  score: number;
  contributions: number;
  last_active: Date;
  sources_breakdown: Record<string, number>;
  modules_breakdown: Record<string, number>;
  top_documents: Array<{
    document_id: number;
    title: string;
    source: string;
    module: string | null;
    kind: string;
    similarity: number;
    created_at: Date;
  }>;
}

@Injectable()
export class ExpertsService {
  constructor(private readonly search: SearchService) {}

  /**
   * Rank authors by Σ(similarity × recency-decay) over a semantic search of the topic.
   * Half-life = 180 days.
   */
  async findExperts(q: ExpertsQuery): Promise<{
    topic: string;
    experts: ExpertEntry[];
  }> {
    const limit = q.limit ?? 5;

    const results = await this.search.search(q.topic, {
      limit: 50,
      threshold: 0.05,
      modules: q.modules,
      sources: q.sources,
    });

    const now = Date.now();
    const HALF_LIFE_MS = 180 * 24 * 60 * 60 * 1000;

    const byAuthor = new Map<string, {
      score: number;
      contributions: number;
      last_active: number;
      sources_breakdown: Record<string, number>;
      modules_breakdown: Record<string, number>;
      docs: ExpertEntry['top_documents'];
    }>();

    for (const r of results) {
      if (!r.author) continue;
      const ageMs = now - new Date(r.created_at).getTime();
      const decay = Math.exp(-Math.LN2 * (ageMs / HALF_LIFE_MS));
      // Boost siblings (similarity=0 from thread expansion) with a small floor.
      const sim = r.similarity > 0 ? r.similarity : 0.05;
      const contribution = sim * decay;

      const cur = byAuthor.get(r.author) ?? {
        score: 0,
        contributions: 0,
        last_active: 0,
        sources_breakdown: {},
        modules_breakdown: {},
        docs: [],
      };
      cur.score += contribution;
      cur.contributions += 1;
      cur.last_active = Math.max(cur.last_active, new Date(r.created_at).getTime());
      cur.sources_breakdown[r.source] = (cur.sources_breakdown[r.source] ?? 0) + 1;
      if (r.module)
        cur.modules_breakdown[r.module] = (cur.modules_breakdown[r.module] ?? 0) + 1;
      cur.docs.push({
        document_id: r.document_id,
        title: r.title,
        source: r.source,
        module: r.module,
        kind: r.kind,
        similarity: r.similarity,
        created_at: r.created_at,
      });
      byAuthor.set(r.author, cur);
    }

    const ranked: ExpertEntry[] = Array.from(byAuthor.entries())
      .map(([author, v]) => ({
        author,
        score: Number(v.score.toFixed(4)),
        contributions: v.contributions,
        last_active: new Date(v.last_active),
        sources_breakdown: v.sources_breakdown,
        modules_breakdown: v.modules_breakdown,
        top_documents: v.docs
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 3),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return { topic: q.topic, experts: ranked };
  }
}
