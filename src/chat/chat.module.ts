import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OpenAIModule } from '../openai/openai.module';
import { SearchModule } from '../search/search.module';
import { ProjectsModule } from '../projects/projects.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { TimelineService } from './timeline.service';
import { ExpertsService } from './experts.service';

@Module({
  imports: [AuthModule, OpenAIModule, SearchModule, ProjectsModule],
  controllers: [ChatController],
  providers: [ChatService, TimelineService, ExpertsService],
})
export class ChatModule {}
