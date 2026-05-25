import 'reflect-metadata'
import express from 'express'
import path from 'node:path'
import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  const config = app.get(ConfigService)
  const storageRoot = path.resolve(process.cwd(), config.get<string>('APP_STORAGE_ROOT', 'storage'))

  app.enableCors({
    origin: config.get<string>('CORS_ORIGIN', 'http://127.0.0.1:5173'),
    credentials: true,
  })
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }))

  app.use('/build-preview', express.static(path.join(storageRoot, 'artifacts', 'build'), {
    index: ['index.html'],
  }))
  app.use('/deploy', express.static(path.join(storageRoot, 'deploy'), {
    index: ['index.html'],
  }))

  const port = config.get<number>('PORT', 8790)
  await app.listen(port, '0.0.0.0')
}

void bootstrap()
