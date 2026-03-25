import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  // Habilitar CORS para webhooks
  app.enableCors();

  const port = process.env.PORT || 3001;
  await app.listen(port);

  logger.log(`Fair Assist Prospecção rodando na porta ${port}`);
  logger.log(`Webhook Evolution API: http://localhost:${port}/webhook/evolution`);
  logger.log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
}

bootstrap();
