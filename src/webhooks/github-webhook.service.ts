import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import axios from 'axios';
import { DocumentsService } from '../documents/documents.service';

@Injectable()
export class GithubWebhookService {
  private readonly logger = new Logger(GithubWebhookService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly documents: DocumentsService,
  ) {}

  private authHeaders(token?: string) {
    const t = token ?? this.config.get<string>('GITHUB_TOKEN');
    return {
      Accept: 'application/vnd.github.v3.diff',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    };
  }

  async getPullRequestDiff(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<string> {
    try {
      const { data } = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`,
        { headers: this.authHeaders() },
      );
      return data as string;
    } catch (err) {
      this.logger.warn(
        `Could not fetch diff for ${owner}/${repo}#${pullNumber}: ${(err as any)?.message}`,
      );
      return '';
    }
  }

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
        dataCreatedAt: commit.timestamp ?? null,
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
    const [owner, repoName] = repo.split('/');

    const diff = await this.getPullRequestDiff(owner, repoName, pr.number);

    const contentParts = [
      `PR #${pr.number}: ${pr.title}`,
      `Action: ${action}`,
      `State: ${pr.state}`,
      `Author: ${pr.user.login}`,
      `Branch: ${pr.head.ref} → ${pr.base.ref}`,
      `Merged: ${pr.merged ?? false}`,
      pr.body || '(no description)',
      `URL: ${pr.html_url}`,
    ];

    if (diff) {
      contentParts.push('', '## Code Diff', '```diff', diff, '```');
    }

    const doc = await this.documents.create({
      title: `[PR #${pr.number}] ${pr.title}`,
      content: contentParts.join('\n'),
      source: 'github',
      author: pr.user?.login ?? null,
      dataCreatedAt: pr.created_at ?? null,
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

  async handleIssueComment(payload: any): Promise<number | null> {
    if (payload.action !== 'created') return null;

    const comment = payload.comment;
    const issue = payload.issue;
    const repo = payload.repository?.full_name ?? 'unknown';
    const isPr = !!issue.pull_request;

    const doc = await this.documents.create({
      title: `[Comment on ${isPr ? 'PR' : 'Issue'} #${issue.number}] ${issue.title}`,
      content: [
        `# Comment on ${isPr ? 'PR' : 'Issue'} #${issue.number}: ${issue.title}`,
        `**Author:** ${comment.user.login}`,
        '',
        comment.body,
        '',
        `URL: ${comment.html_url}`,
      ].join('\n'),
      source: 'github',
      author: comment.user?.login ?? null,
      dataCreatedAt: comment.created_at ?? null,
      metadata: {
        issue_number: issue.number,
        comment_id: comment.id,
        repo,
        type: 'issue_comment',
        is_pr: isPr,
        auto: true,
      },
    });

    this.logger.log(
      `Auto-embedded issue_comment by ${comment.user.login} on #${issue.number} from ${repo}`,
    );
    return doc.id;
  }
}
