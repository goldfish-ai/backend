import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DocumentsModule } from '../documents/documents.module';
import { GithubWebhookService } from './github-webhook.service';
import { GithubEventsController } from './github-events.controller';
import { SlackWebhookService } from './slack-webhook.service';
import { SlackEventsController } from './slack-events.controller';
import { NotionPollService } from './notion-poll.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [ScheduleModule.forRoot(), DocumentsModule],
  controllers: [WebhooksController, SlackEventsController, GithubEventsController],
  providers: [GithubWebhookService, SlackWebhookService, NotionPollService],
})
export class WebhooksModule {}
