import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AgentHubModule } from './agent-hub/agent-hub.module'
import { AgentsModule } from './agents/agents.module'
import { BuildsModule } from './builds/builds.module'
import { DeploymentsModule } from './deployments/deployments.module'
import { validateEnv } from './config/env.schema'
import { AppController } from './app.controller'
import { ProjectsModule } from './projects/projects.module'
import { StorageModule } from './storage/storage.module'
import { VersionsModule } from './versions/versions.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnv,
    }),
    StorageModule,
    AgentHubModule,
    AgentsModule,
    ProjectsModule,
    VersionsModule,
    BuildsModule,
    DeploymentsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
