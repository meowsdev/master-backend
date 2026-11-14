import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { getFrontendOrigins } from './modules/auth/auth.config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { RedisIoAdapter } from './redis/redis-io.adapter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.use(helmet());

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

  await app.listen(process.env.PORT ?? 4500);
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
