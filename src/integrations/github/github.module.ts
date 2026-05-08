import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DocumentsModule } from '../../documents/documents.module';
import { ProjectsModule } from '../../projects/projects.module';
import { GithubController } from './github.controller';
import { GithubService } from './github.service';

@Module({
  imports: [DatabaseModule, DocumentsModule, ProjectsModule],
  controllers: [GithubController],
  providers: [GithubService],
})
export class GithubModule {}
