import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  app.enableCors({
    origin: config.get<string>("FRONTEND_URL") ?? "http://localhost:3002",
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.setGlobalPrefix("api");

  const port = config.get<number>("PORT") ?? 3002;
  await app.listen(port);
  console.log(`\n🚀 Backend running on http://localhost:${port}/api\n`);
}

bootstrap();
