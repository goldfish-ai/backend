# System Architecture

## 1. Module Structure
- `IngestionModule`: Orchestrates data fetching across all platforms.
- `SlackModule`: Handles Slack Web API and Events.
- `GithubModule`: Manages Octokit integrations for PRs and Commits.
- `NotionModule`: Recursive page crawling and block conversion.
- `VectorModule`: Manages embeddings and vector database logic.
- `KnowledgeModule`: The RAG pipeline (Retrieval + LLM).

## 2. Ingestion Strategy
- **Text Processing:** All data is converted to Markdown before chunking.
- **Queuing:** Use BullMQ to handle rate limits (especially for Notion/GitHub).
- **Metadata:** Every chunk retains a `sourceUrl` and `authorId`.

## 3. Data Flow
1. **Fetch:** Fetch raw data from API.
2. **Transform:** Convert to Markdown.
3. **Chunk:** Split using LangChain RecursiveCharacterTextSplitter.
4. **Embed:** Convert to vectors via OpenAI/HuggingFace.
5. **Store:** Upsert into Vector DB.
