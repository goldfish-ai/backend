import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectMemberGuard } from '../projects/guards/project-member.guard';
import { SearchDto } from './dto/search.dto';
import { SearchService } from './search.service';

@Controller('projects/:projectId/search')
@UseGuards(JwtAuthGuard, ProjectMemberGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Post()
  async search(@Req() req: any, @Body() dto: SearchDto) {
    const results = await this.searchService.search(dto.query, {
      projectId: req.project.id,
      limit: dto.limit ?? 5,
      threshold: dto.threshold ?? 0.2,
    });
    return { query: dto.query, count: results.length, results };
  }
}
