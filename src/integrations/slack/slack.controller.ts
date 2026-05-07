import { Body, Controller, Post } from '@nestjs/common';
import { SlackIngestDto } from './dto/slack-ingest.dto';
import { SlackService } from './slack.service';

@Controller('integrations/slack')
export class SlackController {
  constructor(private readonly slack: SlackService) {}

  @Post('ingest')
  ingest(@Body() dto: SlackIngestDto) {
    return this.slack.ingest(dto);
  }
}
