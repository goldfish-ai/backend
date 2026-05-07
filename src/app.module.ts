import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { OpenAIModule } from './openai/openai.module';
import { DocumentsModule } from './documents/documents.module';
import { SearchModule } from './search/search.module';
import { SummaryModule } from './summary/summary.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    OpenAIModule,
    DocumentsModule,
    SearchModule,
    SummaryModule,
    IntegrationsModule,
    AuthModule,
    ChatModule,
    WebhooksModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
