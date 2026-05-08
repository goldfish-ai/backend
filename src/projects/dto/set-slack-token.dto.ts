import { IsNotEmpty, IsString } from 'class-validator';

export class SetSlackTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}
