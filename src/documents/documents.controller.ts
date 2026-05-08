import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectMemberGuard } from '../projects/guards/project-member.guard';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { SeedDocumentDto } from './dto/seed-document.dto';
import { SeedBulkDto } from './dto/seed-bulk.dto';

@Controller('projects/:projectId/documents')
@UseGuards(JwtAuthGuard, ProjectMemberGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateDocumentDto) {
    return this.documents.create(dto, req.project.id);
  }

  /** Quick seed: POST /projects/:projectId/documents/seed */
  @Post('seed')
  seed(@Req() req: any, @Body() dto: SeedDocumentDto) {
    return this.documents.seed(dto, req.project.id);
  }

  /** Bulk seed: POST /projects/:projectId/documents/seed/bulk */
  @Post('seed/bulk')
  seedBulk(@Req() req: any, @Body() dto: SeedBulkDto) {
    return this.documents.seedBulk(dto, req.project.id);
  }

  @Get()
  findAll(@Req() req: any) {
    return this.documents.findAll(req.project.id);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.documents.findOne(id, req.project.id);
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    await this.documents.remove(id, req.project.id);
    return { success: true };
  }
}
