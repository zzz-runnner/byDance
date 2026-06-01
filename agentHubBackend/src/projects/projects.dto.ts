import { Transform, Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

export class ReplyReferenceDto {
  @IsString()
  @IsNotEmpty()
  messageId!: string

  @IsString()
  @IsNotEmpty()
  senderId!: string

  @IsOptional()
  @IsString()
  senderName?: string

  @IsString()
  @IsNotEmpty()
  excerpt!: string
}

export class CodeSelectionReferenceDto {
  @IsString()
  @IsNotEmpty()
  filePath!: string

  @IsString()
  @IsNotEmpty()
  selectedText!: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  startLine!: number

  @Type(() => Number)
  @IsInt()
  @Min(1)
  startColumn!: number

  @Type(() => Number)
  @IsInt()
  @Min(1)
  endLine!: number

  @Type(() => Number)
  @IsInt()
  @Min(1)
  endColumn!: number

  @IsOptional()
  @IsString()
  language?: string

  @IsOptional()
  @IsString()
  beforeContext?: string

  @IsOptional()
  @IsString()
  afterContext?: string
}

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
  @IsIn(['group', 'direct'])
  conversationType?: 'group' | 'direct'

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  agentIds?: string[]

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

  @IsOptional()
  @IsString()
  agentId?: string

  @IsOptional()
  @ValidateNested()
  @Type(() => ReplyReferenceDto)
  replyTo?: ReplyReferenceDto

  @IsOptional()
  @ValidateNested()
  @Type(() => CodeSelectionReferenceDto)
  codeSelection?: CodeSelectionReferenceDto
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

export class FileContentQueryDto {
  @IsString()
  @IsNotEmpty()
  path!: string
}

export class ProjectStateQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  messageLimit?: number
}

export class WorkbenchQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit = 20

  @IsOptional()
  @IsString()
  cursor?: string

  @IsOptional()
  @IsString()
  q?: string
}

export class PreviewBuildQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  force?: boolean
}
