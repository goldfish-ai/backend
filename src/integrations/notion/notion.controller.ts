import { Body, Controller, Post } from '@nestjs/common';
import { NotionIngestDto } from './dto/notion-ingest.dto';
import { NotionService } from './notion.service';

@Controller('integrations/notion')
export class NotionController {
  constructor(private readonly notion: NotionService) {}

  @Post('ingest')
  ingest(@Body() dto: NotionIngestDto) {
    return this.notion.ingest(dto);
  }
}
