import 'reflect-metadata';
import { ConsoleLogger, ShutdownSignal, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { ApiResponseInterceptor } from './common/api-response.interceptor';
import { createCryptaOpenApi } from './common/openapi';
import { requestContext } from './common/request-context.middleware';
import { AppModule } from './app.module';
import { OperationsMetricsService } from './operations/operations-metrics.service';
import { cryptoProviderConfig } from './jobs/crypto-provider-config';
import { HttpFailureAuditService } from './audit/http-failure-audit.service';
import { ReadinessService, shutdownUnavailable } from './health/readiness.service';
import { prepareDeploymentEnvironment } from './common/deployment-config';
import type { NextFunction, Request, Response } from 'express';

async function bootstrap() {
  prepareDeploymentEnvironment();
  cryptoProviderConfig();
  const app = await NestFactory.create(AppModule, { cors: false, logger: new ConsoleLogger({ json: true }) });
  app.setGlobalPrefix('api/v1');
  app.use(requestContext(app.get(OperationsMetricsService)));
  app.enableCors({ origin: (process.env.CORS_ORIGIN ?? 'http://127.0.0.1:5173,http://127.0.0.1:5174').split(','), credentials: true });
  const readiness = app.get(ReadinessService);
  app.use((request: Request, _response: Response, next: NextFunction) => {
    if (readiness.stopping && request.path !== '/api/v1/health/live') return next(shutdownUnavailable());
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter(app.get(HttpFailureAuditService)));
  app.useGlobalInterceptors(new ApiResponseInterceptor());

  SwaggerModule.setup('docs', app, createCryptaOpenApi(app));

  app.enableShutdownHooks([ShutdownSignal.SIGINT, ShutdownSignal.SIGTERM], { useProcessExit: true });
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}

void bootstrap();
