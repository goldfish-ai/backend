import { IsInt, IsPositive } from 'class-validator';

export class AddMemberDto {
  @IsInt()
  @IsPositive()
  userId: number;
}
