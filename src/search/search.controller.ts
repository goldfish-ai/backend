import { Body, Controller, Post } from '@nestjs/common';
import { SearchDto } from './dto/search.dto';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Post()
  async search(@Body() dto: SearchDto) {
    const results = await this.searchService.search(
      dto.query,
      dto.limit ?? 5,
      dto.threshold ?? 0.2,
    );
    return { query: dto.query, count: results.length, results };
  }
}
