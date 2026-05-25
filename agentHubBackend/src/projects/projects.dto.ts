import { IsBoolean, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator'

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  goal!: string

  @IsOptional()
  @IsIn(['dev', 'research', 'writing', 'chat'])
  workspaceType?: 'dev' | 'research' | 'writing' | 'chat'

  @IsOptional()
  @IsString()
  workspaceId?: string

  @IsOptional()
  @IsString()
  conversationId?: string
}

export class StreamProjectMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20_000)
  content!: string

  @IsOptional()
  @IsString()
  conversationId?: string
}

export class WriteWorkspaceFileDto {
  @IsString()
  @IsNotEmpty()
  filePath!: string

  @IsString()
  content!: string
}

export class UpdateProjectWorkflowDto {
  @IsOptional()
  @IsObject()
  workflow?: Record<string, unknown>

  @IsOptional()
  @IsBoolean()
  accepted?: boolean
}
