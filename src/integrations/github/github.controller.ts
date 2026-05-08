import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ProjectMemberGuard } from '../../projects/guards/project-member.guard';
import { GithubIngestDto } from './dto/github-ingest.dto';
import { GithubService } from './github.service';

@Controller('projects/:projectId/integrations/github')
@UseGuards(JwtAuthGuard, ProjectMemberGuard)
export class GithubController {
  constructor(private readonly github: GithubService) {}

  @Post('ingest')
  ingest(@Req() req: any, @Body() dto: GithubIngestDto) {
    return this.github.ingest(dto, req.project.id);
  }
}
