import { IsNotEmpty, IsString } from 'class-validator';

export class SetGithubWebhookSecretDto {
  @IsString()
  @IsNotEmpty()
  webhookSecret: string;
}
