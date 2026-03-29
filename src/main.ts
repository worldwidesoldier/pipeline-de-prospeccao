import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { validateEnv } from './config/env.config';
import { join } from 'path';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Fail fast if required env vars are missing
  validateEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  // Serve static dashboard files
  app.useStaticAssets(join(__dirname, 'public'));

  app.enableCors();

  const port = process.env.PORT || 3001;
  await app.listen(port);

  logger.log(`Fair Assist Prospecção rodando na porta ${port}`);
  logger.log(`Dashboard: http://localhost:${port}`);
  logger.log(`Webhook Evolution API: http://localhost:${port}/webhook/evolution`);
  logger.log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
}

bootstrap();
