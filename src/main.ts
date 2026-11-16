import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { getFrontendOrigins } from './modules/auth/auth.config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { RedisIoAdapter } from './redis/redis-io.adapter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Cross-origin-resource-policy must allow the web app (another origin) to show uploaded images.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  app.use(cookieParser());

  // Credentialed CORS cannot use a wildcard. When FRONTEND_ORIGINS is unset
  // (local dev) the request origin is reflected instead.
  const frontendOrigins = getFrontendOrigins();
  app.enableCors({
    origin: frontendOrigins.length > 0 ? frontendOrigins : true,
    credentials: true,
  });

  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Master Backend Api')
    .setDescription('Master Backend Api')
    .setVersion('1.0.0.1')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const redisIoAdapter = new RedisIoAdapter(app);
  try {
    await redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);
  } catch (error) {
    logger.warn(
      `Redis Socket.IO adapter disabled: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const port = Number(process.env.PORT ?? 4500);
  await app.listen(port, '0.0.0.0');
  logger.log(`Server running on port ${port}`);
  logger.log(`API:     http://localhost:${port}/api/v1`);
  logger.log(`Swagger: http://localhost:${port}/api/docs`);
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error(
    `Application failed to start: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
});
