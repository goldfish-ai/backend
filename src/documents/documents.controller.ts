import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { SeedDocumentDto } from './dto/seed-document.dto';
import { SeedBulkDto } from './dto/seed-bulk.dto';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  create(@Body() dto: CreateDocumentDto) {
    return this.documents.create(dto);
  }

  /** Quick seed: POST /documents/seed — just send { text } */
  @Post('seed')
  seed(@Body() dto: SeedDocumentDto) {
    return this.documents.seed(dto);
  }

  /** Bulk seed: POST /documents/seed/bulk — send { documents: [...] } */
  @Post('seed/bulk')
  seedBulk(@Body() dto: SeedBulkDto) {
    return this.documents.seedBulk(dto);
  }

  @Get()
  findAll() {
    return this.documents.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.documents.findOne(id);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.documents.remove(id);
    return { success: true };
  }
}
