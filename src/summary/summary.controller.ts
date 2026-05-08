import { Body, Controller, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectMemberGuard } from '../projects/guards/project-member.guard';
import { SummaryDto } from './dto/summary.dto';
import { SummaryService } from './summary.service';

@Controller('projects/:projectId/summary')
@UseGuards(JwtAuthGuard, ProjectMemberGuard)
export class SummaryController {
  constructor(private readonly summaryService: SummaryService) {}

  @Post()
  summarize(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: SummaryDto,
  ) {
    return this.summaryService.summarize(dto, projectId);
  }
}
