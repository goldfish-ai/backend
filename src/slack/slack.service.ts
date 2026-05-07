import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebClient } from '@slack/web-api';

@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);
  private readonly client: WebClient;

  constructor(private configService: ConfigService) {
    const token = this.configService.get<string>('SLACK_BOT_TOKEN');
    if (!token) {
      this.logger.warn(
        'SLACK_BOT_TOKEN is not defined in environment variables. Slack WebClient will not be fully functional.',
      );
    }
    this.client = new WebClient(token);
  }

  async fetchChannelHistory(channelId: string, limit: number = 100) {
    try {
      const result = await this.client.conversations.history({
        channel: channelId,
        limit,
      });
      return result.messages || [];
    } catch (error) {
      this.logger.error(
        `Failed to fetch history for channel ${channelId}`,
        error,
      );
      throw error;
    }
  }

  async fetchThreadReplies(channelId: string, threadTs: string) {
    try {
      const result = await this.client.conversations.replies({
        channel: channelId,
        ts: threadTs,
      });
      return result.messages || [];
    } catch (error) {
      this.logger.error(
        `Failed to fetch replies for thread ${threadTs} in channel ${channelId}`,
        error,
      );
      throw error;
    }
  }

  async getUserInfo(userId: string) {
    try {
      const result = await this.client.users.info({
        user: userId,
      });
      return result.user;
    } catch (error) {
      this.logger.error(`Failed to fetch info for user ${userId}`, error);
      throw error;
    }
  }
}
