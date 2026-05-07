import { Injectable, Logger } from '@nestjs/common';
import { DocumentsService } from '../../documents/documents.service';
import { IngestMeetingDto } from './dto/ingest-meeting.dto';

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(private readonly documents: DocumentsService) {}

  async ingest(dto: IngestMeetingDto): Promise<{ stored: number[] }> {
    const stored: number[] = [];

    for (const entry of dto.transcript) {
      const text = entry.text.join(' ').trim();
      if (!text) continue;

      const doc = await this.documents.create({
        title: `[Meeting] ${dto.title} — ${entry.speaker}`,
        content: text,
        source: 'meeting',
        author: entry.speaker,
        dataCreatedAt: entry.timestamp,
        metadata: {
          meeting_title: dto.title,
          meeting_date: dto.date ?? null,
          duration: dto.duration ?? null,
          type: 'meeting_transcript',
        },
      });

      stored.push(doc.id);
      this.logger.log(
        `Stored meeting transcript entry from ${entry.speaker} (doc #${doc.id})`,
      );
    }

    return { stored };
  }
}
