# Slack Integration Implementation Plan

This plan outlines the steps to build the initial Slack integration for Goldfish.ai (Sutr.ai) based on the architecture requirements.

## User Review Required
- **Slack Bolt vs. Web API**: The plan uses `@slack/web-api` coupled with a standard NestJS Controller to handle Event Subscriptions. This is usually cleaner in NestJS than running the full `@slack/bolt` framework. Let me know if you prefer using Bolt instead.
- **BullMQ**: The architecture mentions `BullMQ` for rate limits. I will set up `@nestjs/bullmq` with a generic Redis connection. Do you have a local Redis instance running (e.g., `localhost:6379`), or would you like me to use a mock/in-memory queue for now?

## Open Questions
- Do you already have a Slack App created in your workspace? You will need the `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`.

## Proposed Changes

### 1. Dependencies
Install necessary packages for Slack and Queuing:
- `@slack/web-api` (For fetching channels, threads, user info)
- `@nestjs/bullmq` & `bullmq` (For async task queue)
- `ioredis` (Redis client for BullMQ)
- `@nestjs/config` (For environment variable management)

### 2. Configuration & App Setup
- Set up `ConfigModule` globally in `AppModule` to inject environment variables.
- Set up `BullModule.forRoot()` in `AppModule` to connect to Redis.

#### [MODIFY] src/app.module.ts
Add `ConfigModule` and `BullModule` configurations.

### 3. Slack Module

#### [NEW] src/slack/slack.controller.ts
- Create a `POST /slack/events` endpoint to receive Event Subscriptions from Slack.
- Handle the `url_verification` challenge automatically.
- Listen to events like `message.channels` or `app_mention` and add them to the BullMQ queue for async processing.

#### [NEW] src/slack/slack.service.ts
- Initialize the `WebClient` from `@slack/web-api` using `SLACK_BOT_TOKEN`.
- Implement methods: `fetchChannelHistory(channelId)` and `fetchThreadReplies(channelId, threadTs)`.

#### [NEW] src/slack/slack.processor.ts
- Create a BullMQ Processor (`@Processor('slack-ingestion')`) to consume jobs from the queue.
- This processor will receive the raw message events, fetch necessary thread context via `SlackService`, and eventually hand the data over to the `IngestionModule` or `VectorModule` for text processing.

#### [MODIFY] src/slack/slack.module.ts
- Register the controller, service, processor, and BullMQ queue (`BullModule.registerQueue({ name: 'slack-ingestion' })`).

## Verification Plan
### Automated Tests
- Build the app using `npm run build` to ensure type safety.
- Write a basic unit test for `SlackController` to ensure it properly handles the Slack `url_verification` challenge.

### Manual Verification
- You can run `npm run start:dev` and use `ngrok` to expose the `/slack/events` endpoint. You can then plug this URL into your Slack App Dashboard to verify the webhook connection successfully completes the challenge.
