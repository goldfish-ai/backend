import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DocumentsService } from '../../documents/documents.service';
import { GithubIngestDto } from './dto/github-ingest.dto';

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly documents: DocumentsService,
  ) {}

  private headers(token?: string) {
    const t = token || this.config.get<string>('GITHUB_TOKEN');
    return {
      Accept: 'application/vnd.github.v3+json',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    };
  }

  async ingest(dto: GithubIngestDto): Promise<{ stored: number[]; skipped: number }> {
    const type = dto.type ?? 'all';
    const limit = dto.limit ?? 30;
    const stored: number[] = [];
    let skipped = 0;

    if (type === 'commits' || type === 'all') {
      const ids = await this.ingestCommits(dto.owner, dto.repo, limit, dto.token);
      stored.push(...ids);
    }
    if (type === 'pulls' || type === 'all') {
      const ids = await this.ingestPulls(dto.owner, dto.repo, limit, dto.state ?? 'all', dto.token);
      stored.push(...ids);
    }
    if (type === 'issues' || type === 'all') {
      const ids = await this.ingestIssues(dto.owner, dto.repo, limit, dto.state ?? 'all', dto.token);
      stored.push(...ids);
    }

    return { stored, skipped };
  }

  private async ingestCommits(
    owner: string,
    repo: string,
    limit: number,
    token?: string,
  ): Promise<number[]> {
    const { data } = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/commits`,
      { headers: this.headers(token), params: { per_page: limit } },
    );
    const stored: number[] = [];
    for (const c of data) {
      const doc = await this.documents.create({
        title: `[Commit] ${c.commit.message.split('\n')[0].slice(0, 120)}`,
        content: [
          c.commit.message,
          `Author: ${c.commit.author.name} <${c.commit.author.email}>`,
          `SHA: ${c.sha}`,
          `URL: ${c.html_url}`,
        ].join('\n'),
        source: 'github',
        author: c.commit.author.name || c.author?.login || null,
        dataCreatedAt: c.commit.author.date ?? null,
        metadata: { sha: c.sha, repo: `${owner}/${repo}`, type: 'commit' },
      });
      stored.push(doc.id);
    }
    return stored;
  }

  private async ingestPulls(
    owner: string,
    repo: string,
    limit: number,
    state: string,
    token?: string,
  ): Promise<number[]> {
    const { data } = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/pulls`,
      { headers: this.headers(token), params: { per_page: limit, state } },
    );
    const stored: number[] = [];
    for (const pr of data) {
      const doc = await this.documents.create({
        title: `[PR #${pr.number}] ${pr.title}`,
        content: [
          `PR #${pr.number}: ${pr.title}`,
          `State: ${pr.state}`,
          `Author: ${pr.user.login}`,
          `Branch: ${pr.head.ref} → ${pr.base.ref}`,
          pr.body || '(no description)',
          `URL: ${pr.html_url}`,
        ].join('\n'),
        source: 'github',
        author: pr.user?.login ?? null,
        dataCreatedAt: pr.created_at ?? null,
        metadata: { pr_number: pr.number, repo: `${owner}/${repo}`, type: 'pull_request', state: pr.state },
      });
      stored.push(doc.id);
    }
    return stored;
  }

  private async ingestIssues(
    owner: string,
    repo: string,
    limit: number,
    state: string,
    token?: string,
  ): Promise<number[]> {
    const { data } = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/issues`,
      { headers: this.headers(token), params: { per_page: limit, state } },
    );
    // GitHub issues endpoint returns PRs too — filter them out
    const issues = data.filter((i: any) => !i.pull_request);
    const stored: number[] = [];
    for (const issue of issues) {
      const doc = await this.documents.create({
        title: `[Issue #${issue.number}] ${issue.title}`,
        content: [
          `Issue #${issue.number}: ${issue.title}`,
          `State: ${issue.state}`,
          `Author: ${issue.user.login}`,
          `Labels: ${issue.labels.map((l: any) => l.name).join(', ') || 'none'}`,
          issue.body || '(no description)',
          `URL: ${issue.html_url}`,
        ].join('\n'),
        source: 'github',
        author: issue.user?.login ?? null,
        metadata: { issue_number: issue.number, repo: `${owner}/${repo}`, type: 'issue', state: issue.state },
      });
      stored.push(doc.id);
    }
    return stored;
  }
}
