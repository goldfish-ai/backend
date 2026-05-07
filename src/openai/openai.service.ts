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
  ): Promise<string> {
    const systemPrompt = contextBlock
      ? `You are Project Memory, an AI assistant with access to your team's institutional knowledge. 
Answer questions using ONLY the context provided below. Cite sources by their number [Source N]. 
If the context does not contain enough information, say so honestly.

Context:
${contextBlock}`
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

  getEmbeddingModel() {
    return this.embeddingModel;
  }
}
