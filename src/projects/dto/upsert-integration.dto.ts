import { IsIn, IsObject } from 'class-validator';

export class UpsertIntegrationDto {
  @IsObject()
  config: Record<string, any>;
}

export const SUPPORTED_PROVIDERS = ['github', 'slack', 'notion'] as const;
export type IntegrationProvider = (typeof SUPPORTED_PROVIDERS)[number];
