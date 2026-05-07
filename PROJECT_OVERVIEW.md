# Project Goldfish.ai (स्मृति)

## Vision

Goldfish.ai is a collaborative "Collective Memory" tool for engineering teams. It connects the dots between conversation (Slack), documentation (Notion), and implementation (GitHub). It answers the "Why" behind code changes by processing tribal knowledge.

## Core Features

- **Slack Ingestion:** Reads comments, threads, and meeting notes.
- **GitHub Ingestion:** Processes PR comments, commit messages, and code diffs.
- **Notion Ingestion:** Scans workspaces for Design Docs and RFCs.
- **Semantic Memory:** Stores knowledge as embeddings in a Vector Database.
- **Natural Language Query:** A RAG interface to answer developer questions.

## Tech Stack

- **Framework:** NestJS (TypeScript)
- **Database:** Prisma (PostgreSQL) for metadata.
- **Vector Store:** Pinecone or Milvus.
- **AI Orchestration:** LangChain.js.
- **LLM:** OpenAI GPT-4o / Claude 3.5 Sonnet.
- **Task Queue:** BullMQ with Redis.
