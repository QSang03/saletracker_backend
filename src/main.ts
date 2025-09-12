import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DatetimeInterceptor } from './common/interceptors/datetime.interceptor';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  // Limit Nest internal logger to warnings and errors to avoid noisy route mapping logs
  const app = await NestFactory.create(AppModule, {
    logger: ['warn', 'error'],
  });

  // Increase body size limit for file uploads
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

  app.enableCors({
    origin: true, // Cho phép tất cả origin (mọi port)
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false, // Cho phép các thuộc tính không được định nghĩa để debug
      enableDebugMessages: true,
    }),
  );

  app.useGlobalInterceptors(new DatetimeInterceptor());

  // Lắng nghe trên tất cả IP để dùng LAN
  const port = process.env.PORT || 3001;
  await app.listen(port);
  // Use Nest logger for consistent logging
  const { Logger } = require('@nestjs/common');
  const logger = new Logger('Bootstrap');
  logger.log(`🚀 Backend API đang chạy trên port ${port}`);
}
bootstrap();
