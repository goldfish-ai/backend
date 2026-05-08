import { Module } from '@nestjs/common';
import { DocumentsModule } from '../../documents/documents.module';
import { ProjectsModule } from '../../projects/projects.module';
import { GithubController } from './github.controller';
import { GithubService } from './github.service';

@Module({
  imports: [DocumentsModule, ProjectsModule],
  controllers: [GithubController],
  providers: [GithubService],
})
export class GithubModule {}
