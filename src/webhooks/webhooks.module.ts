import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DocumentsModule } from '../documents/documents.module';
import { GithubWebhookService } from './github-webhook.service';
import { SlackWebhookService } from './slack-webhook.service';
import { NotionPollService } from './notion-poll.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [ScheduleModule.forRoot(), DocumentsModule],
  controllers: [WebhooksController],
  providers: [GithubWebhookService, SlackWebhookService, NotionPollService],
})
export class WebhooksModule {}
