import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DocumentsModule } from '../documents/documents.module';
import { ProjectsModule } from '../projects/projects.module';
import { GithubWebhookService } from './github-webhook.service';
import { GithubEventsController, GithubEventsProjectController } from './github-events.controller';
import { SlackWebhookService } from './slack-webhook.service';
import { SlackEventsController, SlackEventsProjectController } from './slack-events.controller';
import { NotionPollService } from './notion-poll.service';
import { WebhooksController, WebhooksProjectController } from './webhooks.controller';

@Module({
  imports: [ScheduleModule.forRoot(), DocumentsModule, ProjectsModule],
  controllers: [
    WebhooksController,
    WebhooksProjectController,
    SlackEventsController,
    SlackEventsProjectController,
    GithubEventsController,
    GithubEventsProjectController,
  ],
  providers: [GithubWebhookService, SlackWebhookService, NotionPollService],
})
export class WebhooksModule {}
