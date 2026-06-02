import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator'

export class CreateVersionDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_.-]+$/)
  versionId?: string

  @IsOptional()
  @IsString()
  @MaxLength(300)
  message?: string

  @IsOptional()
  @IsBoolean()
  requireAgentGate?: boolean
}

export class DiffQueryDto {
  @IsString()
  @IsNotEmpty()
  v1!: string

  @IsString()
  @IsNotEmpty()
  v2!: string
}

export class RestoreVersionDto {
  @IsOptional()
  @IsBoolean()
  createSnapshotBeforeRestore?: boolean

  @IsOptional()
  @IsString()
  @MaxLength(300)
  message?: string
}
