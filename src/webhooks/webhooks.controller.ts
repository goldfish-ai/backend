import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectMemberGuard } from '../projects/guards/project-member.guard';
import { GithubWebhookService } from './github-webhook.service';
import { SlackWebhookService } from './slack-webhook.service';
import { NotionPollService } from './notion-poll.service';

/** Project-scoped webhooks: POST /api/projects/:projectId/webhooks/... */
@Controller('projects/:projectId/webhooks')
@UseGuards(JwtAuthGuard, ProjectMemberGuard)
export class WebhooksProjectController {
  private readonly logger = new Logger(WebhooksProjectController.name);

  constructor(
    private readonly github: GithubWebhookService,
    private readonly slack: SlackWebhookService,
    private readonly notionPoll: NotionPollService,
  ) {}

  @Post('github')
  @HttpCode(200)
  async githubWebhook(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-github-event') event: string,
    @Headers('x-hub-signature-256') sig: string,
    @Body() body: any,
  ) {
    const rawBody = req.rawBody;
    if (rawBody && sig && !this.github.verify(rawBody, sig)) {
      return { ok: false, error: 'Invalid signature' };
    }

    setImmediate(() => {
      this.processGithubEvent(event, body, projectId).catch((err) =>
        this.logger.error(`Error processing GitHub event '${event}'`, err),
      );
    });

    return { ok: true, event };
  }

  private async processGithubEvent(event: string, body: any, projectId: number): Promise<void> {
    if (event === 'push') {
      await this.github.handlePush(body, projectId);
    } else if (event === 'pull_request') {
      await this.github.handlePullRequest(body, projectId);
    } else if (event === 'issue_comment') {
      await this.github.handleIssueComment(body, projectId);
    }
  }

  @Post('slack')
  @HttpCode(200)
  async slackWebhook(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-slack-request-timestamp') ts: string,
    @Headers('x-slack-signature') sig: string,
    @Body() body: any,
  ) {
    const rawBody = req.rawBody;
    if (rawBody && sig && !this.slack.verify(rawBody, ts, sig)) {
      return { error: 'Invalid signature' };
    }

    if (body.type === 'url_verification') {
      return { challenge: body.challenge };
    }

    const id = await this.slack.handleEvent(body, projectId);
    return { ok: true, stored: id ? [id] : [] };
  }

  @Post('notion/poll')
  @HttpCode(200)
  triggerNotionPoll(@Param('projectId', ParseIntPipe) projectId: number) {
    return this.notionPoll.triggerPoll(projectId);
  }
}

/** Legacy shims: POST /api/webhooks/... → routes to project 1 */
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly github: GithubWebhookService,
    private readonly slack: SlackWebhookService,
    private readonly notionPoll: NotionPollService,
  ) {}

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

    if (body.type === 'url_verification') {
      return { challenge: body.challenge };
    }

    const id = await this.slack.handleEvent(body);
    return { ok: true, stored: id ? [id] : [] };
  }

  @Post('notion/poll')
  @HttpCode(200)
  triggerNotionPoll() {
    return this.notionPoll.triggerPoll();
  }
}
