import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { ApiResponseInterceptor } from './common/api-response.interceptor';
import { requestContext } from './common/request-context.middleware';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });
  app.setGlobalPrefix('api/v1');
  app.use(requestContext);
  app.enableCors({ origin: (process.env.CORS_ORIGIN ?? 'http://127.0.0.1:5173,http://127.0.0.1:5174').split(','), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ApiResponseInterceptor());

  const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('Crypta API')
    .setDescription('API quản lý vòng đời khóa mã hóa và chứng thư số. Không trả về private key.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build());
  SwaggerModule.setup('docs', app, document);

  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}

void bootstrap();
