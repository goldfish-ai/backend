import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ProjectMemberGuard } from '../../projects/guards/project-member.guard';
import { MeetingsService } from './meetings.service';
import { IngestMeetingDto } from './dto/ingest-meeting.dto';

@Controller('projects/:projectId/integrations/meetings')
@UseGuards(JwtAuthGuard, ProjectMemberGuard)
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Post('ingest')
  ingest(@Req() req: any, @Body() dto: IngestMeetingDto) {
    return this.meetings.ingest(dto, req.project.id);
  }
}
