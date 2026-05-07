import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { IngestionModule } from './ingestion/ingestion.module';
import { SlackModule } from './slack/slack.module';
import { GithubModule } from './github/github.module';
import { NotionModule } from './notion/notion.module';
import { VectorModule } from './vector/vector.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [IngestionModule, SlackModule, GithubModule, NotionModule, VectorModule, KnowledgeModule, PrismaModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
