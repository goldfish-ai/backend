import { Module } from '@nestjs/common';
import { SlackController } from './slack.controller';
import { SlackService } from './slack.service';
import { MockQueueService } from './mock-queue.service';

@Module({
  controllers: [SlackController],
  providers: [SlackService, MockQueueService],
  exports: [SlackService],
})
export class SlackModule {}
