import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { SlackWebhookService } from './slack-webhook.service';

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
    // Verify signature when headers are present
    const rawBody = req.rawBody;
    if (rawBody && sig && !this.slack.verify(rawBody, ts, sig)) {
      return { error: 'Invalid signature' };
    }

    // Handle URL verification challenge
    if (body.type === 'url_verification') {
      this.logger.log('Received url_verification challenge from Slack');
      return { challenge: body.challenge };
    }

    // Handle actual events asynchronously to stay within Slack's 3-second window
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
