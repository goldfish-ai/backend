import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ProjectMemberGuard } from '../../projects/guards/project-member.guard';
import { SlackIngestDto } from './dto/slack-ingest.dto';
import { SlackService } from './slack.service';

@Controller('projects/:projectId/integrations/slack')
@UseGuards(JwtAuthGuard, ProjectMemberGuard)
export class SlackController {
  constructor(private readonly slack: SlackService) {}

  @Post('ingest')
  ingest(@Req() req: any, @Body() dto: SlackIngestDto) {
    return this.slack.ingest(dto, req.project.id);
  }
}
