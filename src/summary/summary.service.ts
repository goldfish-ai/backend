import { BadRequestException, Injectable } from '@nestjs/common';
import { OpenAIService } from '../openai/openai.service';
import { DocumentsService } from '../documents/documents.service';
import { SummaryDto } from './dto/summary.dto';

@Injectable()
export class SummaryService {
  constructor(
    private readonly openai: OpenAIService,
    private readonly documents: DocumentsService,
  ) {}

  async summarize(dto: SummaryDto, projectId: number) {
    if (!dto.documentId && !dto.text) {
      throw new BadRequestException('Provide documentId or text');
    }

    if (dto.documentId) {
      const doc = await this.documents.findOne(dto.documentId, projectId);
      const summary = await this.openai.summarize(doc.content, {
        maxWords: dto.maxWords,
      });
      const updated = await this.documents.updateSummary(doc.id, summary, projectId);
      return {
        documentId: doc.id,
        title: doc.title,
        summary,
        cached: false,
        updated_at: updated.updated_at,
      };
    }

    const summary = await this.openai.summarize(dto.text!, {
      maxWords: dto.maxWords,
    });
    return { summary };
  }
}
