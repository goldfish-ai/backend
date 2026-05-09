import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ProjectMemberGuard } from '../../projects/guards/project-member.guard';
import { NotionIngestDto } from './dto/notion-ingest.dto';
import { NotionService } from './notion.service';

@Controller('projects/:projectId/integrations/notion')
@UseGuards(JwtAuthGuard, ProjectMemberGuard)
export class NotionController {
  constructor(private readonly notion: NotionService) {}

  @Post('ingest')
  ingest(@Req() req: any, @Body() dto: NotionIngestDto) {
    return this.notion.ingest(dto, req.project.id);
  }
}
