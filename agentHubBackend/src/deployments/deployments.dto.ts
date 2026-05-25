import { IsOptional, IsString } from 'class-validator'

export class DeployVersionDto {
  @IsOptional()
  @IsString()
  versionId?: string
}
