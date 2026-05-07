import { Module } from '@nestjs/common';
import { GithubModule } from './github/github.module';
import { NotionModule } from './notion/notion.module';
import { SlackModule } from './slack/slack.module';

@Module({
  imports: [GithubModule, NotionModule, SlackModule],
})
export class IntegrationsModule {}
