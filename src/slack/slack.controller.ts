import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { MockQueueService } from './mock-queue.service';

@Controller('slack/events')
export class SlackController {
  private readonly logger = new Logger(SlackController.name);

  constructor(private readonly queueService: MockQueueService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleSlackEvent(@Body() body: any) {
    console.log({ body });
    // 1. Handle URL Verification Challenge
    if (body.type === 'url_verification') {
      this.logger.log('Received url_verification challenge from Slack');
      return { challenge: body.challenge };
    }

    // 2. Handle actual events
    if (body.event) {
      this.logger.log(`Received Slack event: ${body.event.type}`);

      // Optionally filter out bot messages or process specific types
      if (body.event.bot_id) {
        return; // Ignore bot events to prevent loops
      }

      // Add to background processing queue to reply quickly to Slack (within 3 seconds)
      await this.queueService.addJob('process_slack_event', body.event);
    }

    return { status: 'ok' };
  }
}
