import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { SlackWebhookService } from './slack-webhook.service';

/** Project-scoped route: POST /api/projects/:projectId/webhooks/slack */
@Controller('projects/:projectId/webhooks/slack')
export class SlackEventsProjectController {
  private readonly logger = new Logger(SlackEventsProjectController.name);

  constructor(private readonly slack: SlackWebhookService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleSlackEvent(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-slack-request-timestamp') ts: string,
    @Headers('x-slack-signature') sig: string,
    @Body() body: any,
  ) {
    const rawBody = req.rawBody;
    if (rawBody && sig && !await this.slack.verify(rawBody, ts, sig, projectId)) {
      return { error: 'Invalid signature' };
    }

    if (body.type === 'url_verification') {
      this.logger.log('Received url_verification challenge from Slack');
      return { challenge: body.challenge };
    }

    if (body.event) {
      if (body.event.bot_id) {
        return { status: 'ok' };
      }

      setImmediate(async () => {
        try {
          await this.slack.handleEvent(body, projectId);
        } catch (err) {
          this.logger.error('Error processing Slack event', err);
        }
      });
    }

    return { status: 'ok' };
  }
}

/** Legacy shim: POST /api/slack/events → routes to project 1 */
@Controller('slack/events')
export class SlackEventsController {
  private readonly logger = new Logger(SlackEventsController.name);

  constructor(private readonly slack: SlackWebhookService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleSlackEvent(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-slack-request-timestamp') ts: string,
    @Headers('x-slack-signature') sig: string,
    @Body() body: any,
  ) {
    const rawBody = req.rawBody;
    if (rawBody && sig && !await this.slack.verify(rawBody, ts, sig, 1)) {
      return { error: 'Invalid signature' };
    }

    if (body.type === 'url_verification') {
      this.logger.log('Received url_verification challenge from Slack');
      return { challenge: body.challenge };
    }

    if (body.event) {
      if (body.event.bot_id) {
        return { status: 'ok' };
      }

      setImmediate(async () => {
        try {
          await this.slack.handleEvent(body);
        } catch (err) {
          this.logger.error('Error processing Slack event', err);
        }
      });
    }

    return { status: 'ok' };
  }
}
