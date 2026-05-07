import { Module } from '@nestjs/common';
import { GithubModule } from './github/github.module';
import { NotionModule } from './notion/notion.module';
import { SlackModule } from './slack/slack.module';
import { MeetingsModule } from './meetings/meetings.module';

@Module({
  imports: [GithubModule, NotionModule, SlackModule, MeetingsModule],
})
export class IntegrationsModule {}
