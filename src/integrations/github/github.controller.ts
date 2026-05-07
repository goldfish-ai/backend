import { Body, Controller, Post } from '@nestjs/common';
import { GithubIngestDto } from './dto/github-ingest.dto';
import { GithubService } from './github.service';

@Controller('integrations/github')
export class GithubController {
  constructor(private readonly github: GithubService) {}

  @Post('ingest')
  ingest(@Body() dto: GithubIngestDto) {
    return this.github.ingest(dto);
  }
}
