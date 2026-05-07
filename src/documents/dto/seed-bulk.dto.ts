import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { SeedDocumentDto } from './seed-document.dto';

export class SeedBulkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SeedDocumentDto)
  documents: SeedDocumentDto[];
}
