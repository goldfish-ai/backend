import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";

@Injectable()
export class OpenAIService {
  private readonly logger = new Logger(OpenAIService.name);
  private readonly client: OpenAI;
  private readonly embeddingModel = "text-embedding-3-small";
  private readonly chatModel = "gpt-4o-mini";

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
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
          role: "system",
          content:
            "You are a precise technical writer. Summarize the user-provided document into a clear, concise summary preserving key facts, decisions, and reasoning. Use plain prose, no markdown headers.",
        },
        {
          role: "user",
          content: `Summarize the following in roughly ${maxWords} words:\n\n${text}`,
        },
      ],
    });
    return response.choices[0]?.message?.content?.trim() ?? "";
  }

  async chatWithContext(
    userMessage: string,
    contextBlock: string,
    history: { role: "user" | "assistant"; content: string }[] = [],
    mode: "qa" | "decision" | "onboarding" | "history" = "qa",
  ): Promise<string> {
    const systemPrompt = contextBlock
      ? this.buildContextSystemPrompt(mode, contextBlock)
      : `You are Project Memory, an AI assistant for software teams. 
No relevant documents were found. Answer based on general knowledge and be transparent about it.`;

    const response = await this.client.chat.completions.create({
      model: this.chatModel,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: userMessage },
      ],
    });
    return response.choices[0]?.message?.content?.trim() ?? "";
  }

  private buildContextSystemPrompt(
    mode: "qa" | "decision" | "onboarding" | "history",
    contextBlock: string,
  ): string {
    const base =
      "You are Project Memory, an AI assistant with access to your team's institutional knowledge. " +
      "Answer using ONLY the context below. Cite sources by their number like [Source N]. " +
      "If the context is insufficient, say so honestly.";

    const modeInstruction = {
      qa: "",
      decision:
        "\n\nThis is a DECISION ARCHAEOLOGY query. Structure your answer to surface:\n" +
        "  • What was decided and when (date from sources).\n" +
        "  • Who decided / who participated.\n" +
        "  • What alternatives were considered and rejected, with reasons.\n" +
        "  • Concerns or dissent raised during the debate — quote dissenting voices verbatim when present.\n" +
        "  • Trade-offs that were accepted.\n" +
        "If thread replies or PR review comments are in the context, weave them into the narrative.",
      onboarding:
        "\n\nThis is an ONBOARDING query from a new engineer. " +
        "Explain how the system works concretely:\n" +
        "  • Cite file paths, function names, or module names from source metadata when available.\n" +
        "  • Describe the data flow step by step.\n" +
        "  • Point to the canonical place to start reading.\n" +
        "Be specific, not abstract.",
      history:
        '\n\nThis is a HISTORY / "has anyone seen this before?" query. ' +
        "Summarize prior occurrences in chronological order:\n" +
        "  • Group by date (oldest → newest).\n" +
        "  • Note who reported / who resolved each instance.\n" +
        "  • Call out unresolved or recurring issues explicitly.",
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
    // Fast-path: fewer than 2 words is always noise regardless of source
    const wordCount = doc.content.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < 2) return null;

    // Universal LLM relevance check — source-aware prompt
    const truncatedForRelevance =
      doc.content.length > 1200
        ? doc.content.slice(0, 1200) + "..."
        : doc.content;

    const relevanceRaw = await this.client.chat.completions.create({
      model: this.chatModel,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a relevance classifier for a software engineering team knowledge base. " +
            "Respond ONLY with valid JSON.",
        },
        {
          role: "user",
          content:
            `Classify whether this document contains meaningful, non-trivial information worth storing.\n\n` +
            `Source: ${doc.source}  Kind: ${doc.kind ?? "unknown"}\n\n` +
            `RELEVANT examples by source:\n` +
            `- slack: technical discussions, bugs, features, architecture, decisions, incidents, code reviews\n` +
            `- github: commits with real changes, PRs with descriptions, issues with substance\n` +
            `- notion: pages with actual content, decisions, specs, documentation\n` +
            `- meeting: segments with technical discussion, decisions, action items\n` +
            `- manual/seed: any content with real substance\n\n` +
            `NOT RELEVANT:\n` +
            `- slack: chit-chat, greetings, emoji-only, "thanks", "ok", "lol", off-topic personal messages\n` +
            `- github: trivial commits ("fix typo", "bump version", "whitespace fix"), bot/auto-generated PRs with no description, empty issues\n` +
            `- notion: empty pages, untitled stubs, template placeholders with no real content\n` +
            `- meeting: filler segments ("ok", "yeah", "let's get started", "brb"), non-substantive short segments\n` +
            `- any source: placeholder or test content with no real information\n\n` +
            `Title: ${doc.title}\n` +
            `Content: ${truncatedForRelevance}\n\n` +
            `Respond ONLY with: { "relevant": true } or { "relevant": false }`,
        },
      ],
    });

    try {
      const parsed = JSON.parse(
        relevanceRaw.choices[0]?.message?.content?.trim() ?? "{}",
      ) as { relevant?: boolean };
      if (parsed.relevant === false) return null;
    } catch {
      // If parse fails, assume relevant — safer to keep than lose data
    }

    const cleanedContent = doc.content
      // Remove URLs
      .replace(/https?:\/\/\S+/g, "")

      // Remove markdown code blocks
      .replace(/```[\s\S]*?```/g, " ")

      // Remove inline code
      .replace(/`[^`]*`/g, " ")

      // Remove stack traces / log-like lines
      .replace(/^(\s*at\s.+|\[.*?\]\s.*|INFO\s.*|WARN\s.*|ERROR\s.*)$/gm, " ")

      // Remove greetings / conversational noise
      .replace(
        /\b(hi|hello|hey|thanks|thank you|good morning|good evening|ok|okay|cool|sure|got it)\b/gi,
        " ",
      )

      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 15000);

    const response = await this.client.chat.completions.create({
      model: this.chatModel,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are a knowledge distillation engine for a software engineering team. " +
            "Convert conversations, technical documents, pull request discussions, tickets, " +
            "architecture notes, and debugging sessions into compact semantic-search-optimized summaries. " +
            "Ignore conversational noise, greetings, acknowledgements, filler text, repetition, and unrelated chatter.",
        },
        {
          role: "user",
          content:
            `Generate a concise semantic embedding summary from the document below.\n\n` +
            `OBJECTIVE:\n` +
            `Create a dense technical summary preserving implementation decisions, ` +
            `architecture changes, debugging outcomes, business logic updates, and engineering context.\n\n` +
            `RULES:\n` +
            `- Maximum 120 words.\n` +
            `- Ignore greetings, pleasantries, acknowledgements, jokes, and small talk.\n` +
            `- Summarize long discussions into compact technical prose.\n` +
            `- If the discussion includes codebase changes, explicitly include:\n` +
            `  - affected modules, services, APIs, components, hooks, schemas, permissions, or database changes\n` +
            `  - UI/UX behavior updates\n` +
            `  - validation or business logic changes\n` +
            `  - bug fixes and behavior corrections\n` +
            `  - architectural or implementation decisions\n` +
            `  - libraries, frameworks, utilities, patterns, or technologies involved\n` +
            `- Prioritize retrieval-friendly technical keywords.\n` +
            `- Include people involved only if technically relevant.\n` +
            `- Remove markdown, raw diffs, stack traces, logs, timestamps, URLs, and repetitive text.\n` +
            `- Write as a single dense paragraph.\n` +
            `- No bullet points.\n` +
            `- No headings.\n` +
            `- No explanations.\n\n` +
            `PRIORITIZE:\n` +
            `- feature additions\n` +
            `- permission changes\n` +
            `- schema updates\n` +
            `- API contract changes\n` +
            `- UI behavior changes\n` +
            `- performance optimizations\n` +
            `- bug fixes\n` +
            `- migration or deployment-impacting changes\n\n` +
            `DOCUMENT METADATA:\n` +
            `Title: ${doc.title}\n` +
            `Source: ${doc.source}\n` +
            `Kind: ${doc.kind ?? "unknown"}\n` +
            `Module: ${doc.module ?? "unknown"}\n` +
            `Author: ${doc.author ?? "unknown"}\n\n` +
            `DOCUMENT CONTENT:\n${cleanedContent}\n\n` +
            `OUTPUT:\n` +
            `Only the final semantic summary paragraph.`,
        },
      ],
    });
    console.dir(response, { depth: null });
    return response.choices[0]?.message?.content?.trim() ?? null;
  }

  /**
   * If the current message is a vague follow-up (pronouns, "it", "they", "the fix", etc.)
   * and there is prior conversation history, rewrite it into a self-contained search query.
   * Returns the original message unchanged when no rewrite is needed.
   */
  async rewriteQuery(
    message: string,
    history: { role: "user" | "assistant"; content: string }[],
  ): Promise<string> {
    if (!history.length) return message;

    // Only rewrite short/vague messages — heuristic: <60 chars or contains anaphoric words
    const isVague =
      message.length < 60 ||
      /\b(it|they|them|this|that|the fix|the issue|the problem|the team|the decision|the change|the pr|the bug|the incident|the solution|those|these)\b/i.test(
        message,
      );
    if (!isVague) return message;

    const recent = history.slice(-4); // last 2 turns
    const historyText = recent
      .map(
        (m) =>
          `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 300)}`,
      )
      .join("\n");

    const response = await this.client.chat.completions.create({
      model: this.chatModel,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are a search query rewriter. Given a short follow-up question and recent conversation history, " +
            "rewrite the question into a concise, self-contained search query (max 20 words) that captures the full intent. " +
            "Output ONLY the rewritten query, no explanation.",
        },
        {
          role: "user",
          content: `Conversation so far:\n${historyText}\n\nFollow-up question: ${message}\n\nRewritten search query:`,
        },
      ],
    });
    return response.choices[0]?.message?.content?.trim() ?? message;
  }
}
