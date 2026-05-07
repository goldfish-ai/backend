import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OpenAIModule } from '../openai/openai.module';
import { SearchModule } from '../search/search.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [AuthModule, OpenAIModule, SearchModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
