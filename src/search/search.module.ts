import { Module } from '@nestjs/common';
import { OpenAIModule } from '../openai/openai.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [OpenAIModule],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
