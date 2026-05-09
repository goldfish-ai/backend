import { IsNotEmpty, IsString } from 'class-validator';

export class SetSlackSigningSecretDto {
  @IsString()
  @IsNotEmpty()
  signingSecret: string;
}
