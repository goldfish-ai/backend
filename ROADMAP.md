# Implementation Roadmap

## Phase 1: Foundation
- [ ] Initialize NestJS project.
- [ ] Setup Prisma Schema with `MemoryChunk` and `SourceType`.
- [ ] Configure Redis and BullMQ.

## Phase 2: Ingestion Engines
- [ ] **GitHub:** Implement PR/Commit fetching.
- [ ] **Slack:** Implement Channel history and thread fetching.
- [ ] **Notion:** Implement Page-to-Markdown conversion.

## Phase 3: The "Memory" (AI)
- [ ] Setup Vector Store connection (Pinecone/Chroma).
- [ ] Implement LangChain embedding pipeline.
- [ ] Create the `/ask` endpoint for RAG queries.

## Phase 4: Interface
- [ ] Build a Slack Bot for direct queries.
- [ ] Web dashboard for memory management.
