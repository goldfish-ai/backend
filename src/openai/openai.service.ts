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

  /**
   * Process a document into a clean, information-dense paragraph suitable for
   * semantic embedding. Returns the processed text to embed.
   *
   * For Slack messages: first runs a cheap relevance check. If the message is
   * casual chit-chat (hi, thanks, lol, etc.) returns null — the caller should
   * fall back to embedding the raw content as-is.
   *
   * For all other sources: always processes and returns the clean text.
   */
  async processDocument(doc: {
    title: string;
    content: string;
    source: string;
    kind?: string | null;
    module?: string | null;
    author?: string | null;
  }): Promise<string | null> {
    // Fast-path: very short Slack messages are almost always noise
    if (doc.source === 'slack') {
      const wordCount = doc.content.trim().split(/\s+/).length;
      if (wordCount < 4) return null;

      // LLM relevance check for Slack content
      const truncated = doc.content.length > 1200
        ? doc.content.slice(0, 1200) + '...'
        : doc.content;

      const relevanceRaw = await this.client.chat.completions.create({
        model: this.chatModel,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a relevance classifier for a software engineering team knowledge base. ' +
              'Respond ONLY with valid JSON.',
          },
          {
            role: 'user',
            content:
              `Classify whether this Slack message is relevant to software engineering work.\n\n` +
              `RELEVANT: technical discussions, bugs, features, architecture, APIs, code reviews, ` +
              `deployments, decisions, planning, incidents, tool/process discussions.\n` +
              `NOT RELEVANT: pure social chit-chat ("hi", "thanks", "lol"), emoji-only reactions, ` +
              `personal off-topic conversation, simple logistics with no technical detail.\n\n` +
              `Message: ${truncated}\n\n` +
              `Respond: { "relevant": true/false }`,
          },
        ],
      });

      try {
        const parsed = JSON.parse(
          relevanceRaw.choices[0]?.message?.content?.trim() ?? '{}',
        ) as { relevant?: boolean };
        if (parsed.relevant === false) return null;
      } catch {
        // If parse fails, assume relevant — safer to keep than lose data
      }
    }

    // Truncate content to stay within token limits
    const truncatedContent =
      doc.content.length > 6000
        ? doc.content.slice(0, 6000) + '\n...[truncated]'
        : doc.content;

    const response = await this.client.chat.completions.create({
      model: this.chatModel,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content:
            'You are a knowledge distillation engine for a software engineering team. ' +
            'Your job is to produce concise, information-dense text optimised for semantic search.',
        },
        {
          role: 'user',
          content:
            `Produce a clean, information-dense paragraph (max 120 words) from the document below ` +
            `that will be used as the text for a semantic embedding.\n\n` +
            `Rules:\n` +
            `- Include: what this is about, which module/service it belongs to, key changes or ` +
            `decisions made, important technical terms, people involved.\n` +
            `- Strip: raw code diffs, stack traces, URLs, timestamps, log lines, markdown syntax, ` +
            `filler words.\n` +
            `- Write in plain prose. No bullet points. No headers.\n\n` +
            `Document metadata:\n` +
            `- Title: ${doc.title}\n` +
            `- Source: ${doc.source}\n` +
            `- Kind: ${doc.kind ?? 'unknown'}\n` +
            `- Module: ${doc.module ?? 'unknown'}\n` +
            `- Author: ${doc.author ?? 'unknown'}\n\n` +
            `Document content:\n${truncatedContent}\n\n` +
            `Output ONLY the paragraph. No labels, no preamble.`,
        },
      ],
    });

    return response.choices[0]?.message?.content?.trim() ?? null;
  }

  /**
   * If the current message is a vague follow-up (pronouns, "it", "they", "the fix", etc.)
   * and there is prior conversation history, rewrite it into a self-contained search query.
   * Returns the original message unchanged when no rewrite is needed.
   */
  async rewriteQuery(
    message: string,
    history: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<string> {
    if (!history.length) return message;

    // Use the last 6 messages (3 turns) for rewrite context
    const recent = history.slice(-6);
    const historyText = recent
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 400)}`)
      .join('\n');

    const response = await this.client.chat.completions.create({
      model: this.chatModel,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You are a search query rewriter for a software team knowledge base. ' +
            'Given a conversation history and the latest question, rewrite the question into a ' +
            'concise, self-contained search query (max 20 words) that captures the full intent. ' +
            'If the question is already self-contained and requires no context from history, ' +
            'return it UNCHANGED. Output ONLY the (possibly rewritten) query, no explanation.',
        },
        {
          role: 'user',
          content: `Conversation so far:\n${historyText}\n\nLatest question: ${message}\n\nRewritten search query:`,
        },
      ],
    });
    return response.choices[0]?.message?.content?.trim() ?? message;
  }
}
