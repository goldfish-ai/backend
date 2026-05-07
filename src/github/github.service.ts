import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);
  private octokit: Octokit;

  constructor(private configService: ConfigService) {
    const token = this.configService.get<string>('GITHUB_TOKEN');
    this.octokit = new Octokit({ auth: token });
  }

  async getPullRequestDiff(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<string> {
    try {
      const response = await this.octokit.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
        mediaType: {
          format: 'diff',
        },
      });
      return response.data as unknown as string;
    } catch (error) {
      this.logger.error(
        `Failed to fetch PR diff for ${owner}/${repo}#${pullNumber}`,
        error,
      );
      return '';
    }
  }
}
