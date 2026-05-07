import { Body, Controller, Post } from '@nestjs/common';
import { SummaryDto } from './dto/summary.dto';
import { SummaryService } from './summary.service';

@Controller('summary')
export class SummaryController {
  constructor(private readonly summaryService: SummaryService) {}

  @Post()
  summarize(@Body() dto: SummaryDto) {
    return this.summaryService.summarize(dto);
  }
}
