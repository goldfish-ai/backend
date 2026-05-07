import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class OpenAIService {
  private readonly logger = new Logger(OpenAIService.name);
  private readonly client: OpenAI;
  private readonly embeddingModel = 'text-embedding-3-small';
  private readonly chatModel = 'gpt-4o-mini';

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set');
    }
    this.client = new OpenAI({ apiKey });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.embeddingModel,
      input: text,
    });
    return response.data[0].embedding;
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model: this.embeddingModel,
      input: texts,
    });
    return response.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }

  async summarize(text: string, opts?: { maxWords?: number }): Promise<string> {
    const maxWords = opts?.maxWords ?? 120;
    const response = await this.client.chat.completions.create({
      model: this.chatModel,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content:
            'You are a precise technical writer. Summarize the user-provided document into a clear, concise summary preserving key facts, decisions, and reasoning. Use plain prose, no markdown headers.',
        },
        {
          role: 'user',
          content: `Summarize the following in roughly ${maxWords} words:\n\n${text}`,
        },
      ],
    });
    return response.choices[0]?.message?.content?.trim() ?? '';
  }

  async chatWithContext(
    userMessage: string,
    contextBlock: string,
    history: { role: 'user' | 'assistant'; content: string }[] = [],
    mode: 'qa' | 'decision' | 'onboarding' | 'history' = 'qa',
  ): Promise<string> {
    const systemPrompt = contextBlock
      ? this.buildContextSystemPrompt(mode, contextBlock)
      : `You are Project Memory, an AI assistant for software teams. 
No relevant documents were found. Answer based on general knowledge and be transparent about it.`;

    const response = await this.client.chat.completions.create({
      model: this.chatModel,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userMessage },
      ],
    });
    return response.choices[0]?.message?.content?.trim() ?? '';
  }

  private buildContextSystemPrompt(
    mode: 'qa' | 'decision' | 'onboarding' | 'history',
    contextBlock: string,
  ): string {
    const base =
      "You are Project Memory, an AI assistant with access to your team's institutional knowledge. " +
      'Answer using ONLY the context below. Cite sources by their number like [Source N]. ' +
      'If the context is insufficient, say so honestly.';

    const modeInstruction = {
      qa: '',
      decision:
        '\n\nThis is a DECISION ARCHAEOLOGY query. Structure your answer to surface:\n' +
        '  • What was decided and when (date from sources).\n' +
        '  • Who decided / who participated.\n' +
        '  • What alternatives were considered and rejected, with reasons.\n' +
        '  • Concerns or dissent raised during the debate — quote dissenting voices verbatim when present.\n' +
        '  • Trade-offs that were accepted.\n' +
        'If thread replies or PR review comments are in the context, weave them into the narrative.',
      onboarding:
        '\n\nThis is an ONBOARDING query from a new engineer. ' +
        'Explain how the system works concretely:\n' +
        '  • Cite file paths, function names, or module names from source metadata when available.\n' +
        '  • Describe the data flow step by step.\n' +
        '  • Point to the canonical place to start reading.\n' +
        'Be specific, not abstract.',
      history:
        '\n\nThis is a HISTORY / "has anyone seen this before?" query. ' +
        'Summarize prior occurrences in chronological order:\n' +
        '  • Group by date (oldest → newest).\n' +
        '  • Note who reported / who resolved each instance.\n' +
        '  • Call out unresolved or recurring issues explicitly.',
    }[mode];

    return `${base}${modeInstruction}\n\nContext:\n${contextBlock}`;
  }

  getEmbeddingModel() {
    return this.embeddingModel;
  }
}
