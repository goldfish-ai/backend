import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(private prisma: PrismaService) {}

  async processSlackMessage(
    text: string,
    authorEmail: string | undefined,
    authorName: string,
    sourceUrl: string,
    metadata: any,
  ) {
    try {
      this.logger.log(`Processing Slack message from ${authorName}`);

      let user: User | null = null;

      // Upsert User if email is provided
      if (authorEmail) {
        user = await this.prisma.user.upsert({
          where: { email: authorEmail },
          update: { name: authorName },
          create: { email: authorEmail, name: authorName },
        });
      }

      // Convert text to Markdown (For Slack, basic text is often close enough, but you can expand this)
      const markdownContent = text;

      // Create Memory
      const memory = await this.prisma.memory.create({
        data: {
          content: markdownContent,
          sourceType: 'SLACK',
          sourceUrl,
          authorId: user ? user.id : null,
          metadata,
        },
      });

      this.logger.log(
        `Successfully saved Slack message to DB as Memory ID: ${memory.id}`,
      );
      return memory;
    } catch (error) {
      this.logger.error('Failed to process and save Slack message', error);
      throw error;
    }
  }
}
