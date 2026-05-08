import { IsNotEmpty, IsString } from 'class-validator';

export class SetGithubTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}
