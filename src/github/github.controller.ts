import {
  Controller,
  Post,
  Headers,
  Body,
  Req,
  Res,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { IngestionService } from '../ingestion/ingestion.service';
import { GithubService } from './github.service';

@Controller('github/events')
export class GithubController {
  private readonly logger = new Logger(GithubController.name);

  constructor(
    private configService: ConfigService,
    private ingestionService: IngestionService,
    private githubService: GithubService,
  ) {}

  @Post()
  async handleWebhook(
    @Headers('x-hub-signature-256') signature: string,
    @Headers('x-github-event') event: string,
    @Res() res: Response,
    @Body() body: any,
  ) {
    // Acknowledge immediately to prevent GitHub timeouts
    res.status(HttpStatus.OK).send('Received');

    // In a production setup, you would verify the signature using crypto
    // against the raw body buffer and GITHUB_WEBHOOK_SECRET here.

    // Asynchronously process the event
    this.processEvent(event, body).catch((err) => {
      this.logger.error('Error processing github event', err);
    });
  }

  private async processEvent(event: string, payload: any) {
    this.logger.log(`Processing GitHub event: ${event}`);

    let content = '';
    let authorName = 'Unknown GitHub User';
    let authorEmail: string | undefined = undefined;
    let sourceUrl = '';
    console.dir({ event, payload }, { depth: null });
    // Handle Pull Request Events
    if (
      event === 'pull_request' &&
      (payload.action === 'opened' || payload.action === 'closed')
    ) {
      const pr = payload.pull_request;
      authorName = pr.user.login;
      sourceUrl = pr.html_url;

      // Fetch the code diff
      const diff = await this.githubService.getPullRequestDiff(
        payload.repository.owner.login,
        payload.repository.name,
        pr.number,
      );

      content = `
# Pull Request: ${pr.title}
**Action:** ${payload.action}
**Author:** ${authorName}

## Description
${pr.body || 'No description provided.'}

## Code Diff
\`\`\`diff
${diff}
\`\`\`
      `;

      await this.ingestionService.processGithubEvent(
        content,
        authorEmail,
        authorName,
        sourceUrl,
        payload,
      );
    }
    // Handle PR/Issue Comments
    else if (event === 'issue_comment' && payload.action === 'created') {
      const comment = payload.comment;
      const issue = payload.issue;
      authorName = comment.user.login;
      sourceUrl = comment.html_url;

      content = `
# Comment on Issue/PR: ${issue.title}
**Author:** ${authorName}

${comment.body}
      `;
      console.log({ content, comment, issue });
      await this.ingestionService.processGithubEvent(
        content,
        authorEmail,
        authorName,
        sourceUrl,
        payload,
      );
    }
  }
}
