import { Injectable, Logger } from '@nestjs/common';
import { IngestionService } from '../ingestion/ingestion.service';
import { SlackService } from './slack.service';

@Injectable()
export class MockQueueService {
  private readonly logger = new Logger(MockQueueService.name);

  constructor(
    private readonly ingestionService: IngestionService,
    private readonly slackService: SlackService,
  ) {}

  async addJob(name: string, data: any) {
    this.logger.log(`[MockQueue] Added job '${name}' to queue.`);

    // Simulate async processing
    setTimeout(() => {
      this.processJob(name, data);
    }, 100);
  }

  private async processJob(name: string, data: any) {
    this.logger.log(`[MockQueue] Processing job '${name}'...`);
    try {
      if (
        name === 'process_slack_event' &&
        data.type === 'message' &&
        data.text
      ) {
        // Fetch user info from Slack
        let authorEmail: string | undefined = undefined;
        let authorName = 'Unknown User';

        console.log({ data });
        if (data.user) {
          try {
            const userInfo = await this.slackService.getUserInfo(data.user);
            console.log({ userInfo });
            if (userInfo) {
              authorEmail = userInfo?.id;
              authorName = userInfo.real_name || userInfo.name || authorName;
            }
          } catch (err) {
            this.logger.warn(`Could not fetch user info for ${data.user}`);
          }
        }

        // Construct sourceUrl (approximation if workspace domain isn't known)
        const sourceUrl = `https://slack.com/archives/${data.channel}/p${data.ts.replace('.', '')}`;

        // Send to Ingestion Service
        await this.ingestionService.processSlackMessage(
          data.text,
          authorEmail,
          authorName,
          sourceUrl,
          data,
        );
      }
      this.logger.log(`[MockQueue] Job '${name}' completed successfully.`);
    } catch (error) {
      this.logger.error(`[MockQueue] Error processing job '${name}':`, error);
    }
  }
}
