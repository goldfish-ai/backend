import { Module } from '@nestjs/common';
import { DocumentsModule } from '../../documents/documents.module';
import { ProjectsModule } from '../../projects/projects.module';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

@Module({
  imports: [DocumentsModule, ProjectsModule],
  controllers: [MeetingsController],
  providers: [MeetingsService],
})
export class MeetingsModule {}
