import { Module } from '@nestjs/common';
import { DocumentsModule } from '../../documents/documents.module';
import { SlackController } from './slack.controller';
import { SlackService } from './slack.service';

@Module({
  imports: [DocumentsModule],
  controllers: [SlackController],
  providers: [SlackService],
})
export class SlackModule {}
