import { Module } from '@nestjs/common';
import { OpenAIModule } from '../openai/openai.module';
import { ProjectsModule } from '../projects/projects.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [OpenAIModule, ProjectsModule],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
