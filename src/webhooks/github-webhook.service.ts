import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { DocumentsService } from '../documents/documents.service';

@Injectable()
export class GithubWebhookService {
  private readonly logger = new Logger(GithubWebhookService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly documents: DocumentsService,
  ) {}

  verify(rawBody: Buffer, signature: string): boolean {
    const secret = this.config.get<string>('GITHUB_WEBHOOK_SECRET');
    if (!secret) return true; // skip verification if not configured
    const expected = `sha256=${crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')}`;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  async handlePush(payload: any): Promise<number[]> {
    const commits: any[] = payload.commits ?? [];
    const repo = payload.repository?.full_name ?? 'unknown';
    const stored: number[] = [];

    for (const commit of commits) {
      const doc = await this.documents.create({
        title: `[Commit] ${commit.message.split('\n')[0].slice(0, 120)}`,
        content: [
          commit.message,
          `Author: ${commit.author.name} <${commit.author.email}>`,
          `Timestamp: ${commit.timestamp}`,
          `SHA: ${commit.id}`,
          `URL: ${commit.url}`,
          commit.added?.length ? `Added: ${commit.added.join(', ')}` : '',
          commit.modified?.length ? `Modified: ${commit.modified.join(', ')}` : '',
          commit.removed?.length ? `Removed: ${commit.removed.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        source: 'github',
        author: commit.author?.name ?? null,
        metadata: { sha: commit.id, repo, type: 'commit', auto: true },
      });
      stored.push(doc.id);
      this.logger.log(`Auto-embedded commit ${commit.id.slice(0, 8)} from ${repo}`);
    }

    return stored;
  }

  async handlePullRequest(payload: any): Promise<number | null> {
    const action: string = payload.action;
    if (!['opened', 'edited', 'closed'].includes(action)) return null;

    const pr = payload.pull_request;
    const repo = payload.repository?.full_name ?? 'unknown';

    const doc = await this.documents.create({
      title: `[PR #${pr.number}] ${pr.title}`,
      content: [
        `PR #${pr.number}: ${pr.title}`,
        `Action: ${action}`,
        `State: ${pr.state}`,
        `Author: ${pr.user.login}`,
        `Branch: ${pr.head.ref} → ${pr.base.ref}`,
        `Merged: ${pr.merged ?? false}`,
        pr.body || '(no description)',
        `URL: ${pr.html_url}`,
      ].join('\n'),
      source: 'github',
      author: pr.user?.login ?? null,
      metadata: {
        pr_number: pr.number,
        repo,
        type: 'pull_request',
        action,
        auto: true,
      },
    });

    this.logger.log(`Auto-embedded PR #${pr.number} (${action}) from ${repo}`);
    return doc.id;
  }
}
