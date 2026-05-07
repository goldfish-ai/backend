import { Body, Controller, Post } from '@nestjs/common';
import { MeetingsService } from './meetings.service';
import { IngestMeetingDto } from './dto/ingest-meeting.dto';

@Controller('integrations/meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Post('ingest')
  ingest(@Body() dto: IngestMeetingDto) {
    return this.meetings.ingest(dto);
  }
}
