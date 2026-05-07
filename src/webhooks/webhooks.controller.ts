import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { GithubWebhookService } from './github-webhook.service';
import { SlackWebhookService } from './slack-webhook.service';
import { NotionPollService } from './notion-poll.service';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly github: GithubWebhookService,
    private readonly slack: SlackWebhookService,
    private readonly notionPoll: NotionPollService,
  ) {}

  /** GitHub webhook: Settings → Webhooks → add URL /api/webhooks/github */
  @Post('github')
  @HttpCode(200)
  async githubWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-github-event') event: string,
    @Headers('x-hub-signature-256') sig: string,
    @Body() body: any,
  ) {
    const rawBody = req.rawBody;
    if (rawBody && sig && !this.github.verify(rawBody, sig)) {
      return { ok: false, error: 'Invalid signature' };
    }

    // Process asynchronously to stay within GitHub's 10-second timeout
    setImmediate(() => {
      this.processGithubEvent(event, body).catch((err) =>
        this.logger.error(`Error processing GitHub event '${event}'`, err),
      );
    });

    return { ok: true, event };
  }

  private async processGithubEvent(event: string, body: any): Promise<void> {
    if (event === 'push') {
      await this.github.handlePush(body);
    } else if (event === 'pull_request') {
      await this.github.handlePullRequest(body);
    } else if (event === 'issue_comment') {
      await this.github.handleIssueComment(body);
    }
  }

  /** Slack Events API: Configure in App settings → Event Subscriptions */
  @Post('slack')
  @HttpCode(200)
  async slackWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-slack-request-timestamp') ts: string,
    @Headers('x-slack-signature') sig: string,
    @Body() body: any,
  ) {
    const rawBody = req.rawBody;
    if (rawBody && sig && !this.slack.verify(rawBody, ts, sig)) {
      return { error: 'Invalid signature' };
    }

    // Slack URL verification challenge
    if (body.type === 'url_verification') {
      return { challenge: body.challenge };
    }

    const id = await this.slack.handleEvent(body);
    return { ok: true, stored: id ? [id] : [] };
  }

  /** Manual trigger to poll Notion for updates */
  @Post('notion/poll')
  @HttpCode(200)
  triggerNotionPoll() {
    return this.notionPoll.triggerPoll();
  }
}
