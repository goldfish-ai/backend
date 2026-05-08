import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { WebClient } from '@slack/web-api';
import { DocumentsService } from '../documents/documents.service';

@Injectable()
export class SlackWebhookService {
  private readonly logger = new Logger(SlackWebhookService.name);
  private readonly userCache = new Map<string, string>(); // userId → real name

  constructor(
    private readonly config: ConfigService,
    private readonly documents: DocumentsService,
  ) {}

  verify(rawBody: Buffer, timestamp: string, signature: string): boolean {
    const secret = this.config.get<string>('SLACK_SIGNING_SECRET');
    if (!secret) return true;

    if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;

    const baseString = `v0:${timestamp}:${rawBody.toString()}`;
    const expected = `v0=${crypto
      .createHmac('sha256', secret)
      .update(baseString)
      .digest('hex')}`;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  /** Resolve a Slack user ID to their real display name, with in-memory cache */
  private async resolveUserName(userId: string): Promise<string> {
    if (this.userCache.has(userId)) return this.userCache.get(userId)!;

    const token = this.config.get<string>('SLACK_TOKEN');
    if (!token) return userId;

    try {
      const client = new WebClient(token);
      const result = await client.users.info({ user: userId });
      const user = result.user as any;
      const name =
        user?.profile?.display_name ||
        user?.profile?.real_name ||
        user?.real_name ||
        user?.name ||
        userId;
      this.userCache.set(userId, name);
      return name;
    } catch {
      return userId;
    }
  }

  async handleEvent(payload: any, projectId = 1): Promise<number | null> {
    const event = payload.event;
    if (!event) return null;

    // Only handle plain user messages
    if (event.type !== 'message') return null;
    if (event.subtype) return null; // edits, joins, bot_message, etc.
    if (event.bot_id) return null;

    const channel: string = event.channel ?? 'unknown';
    const text: string = (event.text ?? '').trim();
    if (!text) return null;

    const userId: string = event.user ?? 'unknown';
    const dataCreatedAt = new Date(parseFloat(event.ts) * 1000).toISOString();
    const isThreadReply = !!(event.thread_ts && event.thread_ts !== event.ts);

    // Resolve real name via Slack API
    const authorName = await this.resolveUserName(userId);

    const doc = await this.documents.create({
      title: `[Slack] ${authorName}: ${text.slice(0, 80)}`,
      content: text,
      source: 'slack',
      author: authorName,
      dataCreatedAt,
      metadata: {
        channel_id: channel,
        ts: event.ts,
        thread_ts: event.thread_ts ?? null,
        is_thread_reply: isThreadReply,
        slack_user_id: userId,
        type: 'message',
        auto: true,
      },
    }, projectId);

    this.logger.log(`Auto-embedded Slack message from ${authorName} in #${channel}`);
    return doc.id;
  }
}

