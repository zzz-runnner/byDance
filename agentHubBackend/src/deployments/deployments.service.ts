import { randomUUID } from 'node:crypto'
import fs from 'fs-extra'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { isoNow } from '../common/time'
import { ProjectsService } from '../projects/projects.service'
import { DeploymentMetadata } from '../projects/project.types'
import { LocalStorageService } from '../storage/local-storage.service'
import { VersionsService } from '../versions/versions.service'
import { DeployVersionDto } from './deployments.dto'

@Injectable()
export class DeploymentsService {
  constructor(
    private readonly projects: ProjectsService,
    private readonly storage: LocalStorageService,
    private readonly versions: VersionsService,
  ) {}

  async deployVersion(projectId: string, input: DeployVersionDto): Promise<DeploymentMetadata> {
    const version = await this.versions.resolveVersion(projectId, input.versionId)
    if (!version.buildPath || version.buildStatus !== 'success') {
      throw new BadRequestException(`Version has not been built successfully: ${version.versionId}`)
    }
    if (!(await fs.pathExists(version.buildPath))) {
      throw new NotFoundException(`Build artifact not found: ${version.buildPath}`)
    }

    const deployPath = this.storage.deployLatestDir(projectId)
    await this.storage.ensureCleanDir(deployPath)
    await fs.copy(version.buildPath, deployPath)

    const deployment: DeploymentMetadata = {
      deploymentId: `deploy-${randomUUID()}`,
      versionId: version.versionId,
      deployPath,
      deployUrl: this.storage.getDeployUrl(projectId),
      createdAt: isoNow(),
    }

    await this.projects.updateProject(projectId, project => {
      project.deployments.push(deployment)
    })

    return deployment
  }
}
