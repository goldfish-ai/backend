import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebClient } from '@slack/web-api';
import { DocumentsService } from '../../documents/documents.service';
import { SlackIngestDto } from './dto/slack-ingest.dto';

@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);
  private readonly userCache = new Map<string, string>();

  constructor(
    private readonly config: ConfigService,
    private readonly documents: DocumentsService,
  ) {}

  private getClient(token?: string): WebClient {
    const t = token || this.config.get<string>('SLACK_TOKEN');
    if (!t) throw new BadRequestException('SLACK_TOKEN is required');
    return new WebClient(t);
  }

  /** Resolve Slack user ID to real display name with caching */
  private async resolveUser(client: WebClient, userId?: string): Promise<string | null> {
    if (!userId) return null;
    if (this.userCache.has(userId)) return this.userCache.get(userId)!;
    try {
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

  async ingest(dto: SlackIngestDto, projectId = 1): Promise<{ stored: number[] }> {
    const client = this.getClient(dto.token);
    const limit = dto.limit ?? 200;

    let channelName = dto.channelId;
    try {
      const info = await client.conversations.info({ channel: dto.channelId });
      channelName = (info.channel as any)?.name ?? dto.channelId;
    } catch {
      // non-fatal; use the ID
    }

    const result = await client.conversations.history({
      channel: dto.channelId,
      limit,
    });

    const messages = ((result.messages ?? []) as any[]).filter(
      (m) => m.text && m.type === 'message' && !m.subtype,
    );

    const threadParents = messages.filter((m) => m.reply_count > 0);
    const standalone = messages.filter((m) => !m.reply_count && !m.thread_ts);

    const stored: number[] = [];

    for (const parent of threadParents) {
      const replies = await client.conversations.replies({
        channel: dto.channelId,
        ts: parent.ts as string,
        limit: 100,
      });

      const allMsgs = (replies.messages ?? [parent]) as any[];
      const contentLines = await Promise.all(
        allMsgs.map(async (m) => {
          const name = (await this.resolveUser(client, m.user)) ?? 'unknown';
          return `${name}: ${m.text}`;
        }),
      );

      const parentAuthor = await this.resolveUser(client, parent.user);
      const snippet = parent.text?.slice(0, 80) ?? 'Thread';

      const doc = await this.documents.create({
        title: `[Slack #${channelName}] ${snippet}`,
        content: contentLines.join('\n'),
        source: 'slack',
        author: parentAuthor ?? undefined,
        dataCreatedAt: new Date(parseFloat(parent.ts) * 1000).toISOString(),
        metadata: {
          channel_id: dto.channelId,
          channel: channelName,
          thread_ts: parent.ts,
          reply_count: parent.reply_count,
          type: 'thread',
        },
      }, projectId);
      stored.push(doc.id);
    }

    for (const msg of standalone) {
      const authorName = await this.resolveUser(client, msg.user);

      const doc = await this.documents.create({
        title: `[Slack #${channelName}] ${msg.text?.slice(0, 80) ?? 'Message'}`,
        content: msg.text ?? '',
        source: 'slack',
        author: authorName ?? undefined,
        dataCreatedAt: new Date(parseFloat(msg.ts) * 1000).toISOString(),
        metadata: {
          channel_id: dto.channelId,
          channel: channelName,
          ts: msg.ts,
          slack_user_id: msg.user,
          type: 'message',
        },
      }, projectId);
      stored.push(doc.id);
    }

    return { stored };
  }
}
