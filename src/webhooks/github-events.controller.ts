import {
  Body,
  Controller,
  Headers,
  HttpStatus,
  Logger,
  Post,
  RawBodyRequest,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { GithubWebhookService } from './github-webhook.service';

@Controller('github/events')
export class GithubEventsController {
  private readonly logger = new Logger(GithubEventsController.name);

  constructor(private readonly github: GithubWebhookService) {}

  @Post()
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') sig: string,
    @Headers('x-github-event') event: string,
    @Body() body: any,
    @Res() res: Response,
  ) {
    // Verify signature when present
    const rawBody = req.rawBody;
    if (rawBody && sig && !this.github.verify(rawBody, sig)) {
      res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Invalid signature' });
      return;
    }

    // Acknowledge immediately — GitHub expects a response within 10 seconds
    // and diff fetching adds extra latency
    res.status(HttpStatus.OK).send('Received');

    this.processEvent(event, body).catch((err) =>
      this.logger.error(`Error processing GitHub event '${event}'`, err),
    );
  }

  private async processEvent(event: string, payload: any): Promise<void> {
    this.logger.log(`Processing GitHub event: ${event}`);

    if (
      event === 'pull_request' &&
      (payload.action === 'opened' || payload.action === 'closed')
    ) {
      await this.github.handlePullRequest(payload);
    } else if (event === 'issue_comment' && payload.action === 'created') {
      await this.github.handleIssueComment(payload);
    } else if (event === 'push') {
      await this.github.handlePush(payload);
    } else {
      this.logger.log(`Unhandled GitHub event type: ${event} (action: ${payload.action ?? 'n/a'})`);
    }
  }
}
