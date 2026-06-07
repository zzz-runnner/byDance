import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'

const AGENT_PROVIDERS = ['claude', 'codex'] as const
const PERMISSION_MODES = ['readonly', 'ask', 'acceptEdits', 'dangerous'] as const
const ISOLATION_MODES = ['shared', 'worktree'] as const

export class CreateAgentDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  id?: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string

  @IsOptional()
  @IsString()
  @MaxLength(240)
  role?: string

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  whenToUse?: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(20_000)
  systemPrompt!: string

  @IsOptional()
  @IsIn(AGENT_PROVIDERS)
  modelProvider?: 'claude' | 'codex'

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string

  @IsOptional()
  @IsObject()
  contextPolicy?: Record<string, unknown>

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tools?: string[]

  @IsOptional()
  @IsObject()
  permissions?: Record<string, unknown>

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  disallowedTools?: string[]

  @IsOptional()
  @IsIn(PERMISSION_MODES)
  permissionMode?: 'readonly' | 'ask' | 'acceptEdits' | 'dangerous'

  @IsOptional()
  @IsObject()
  runtimePolicy?: Record<string, unknown>

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  outputSchema?: string

  @IsOptional()
  @IsIn(ISOLATION_MODES)
  isolation?: 'shared' | 'worktree'

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[]

  @IsOptional()
  @IsObject()
  routingProfile?: Record<string, unknown>
}

export class UpdateAgentDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string

  @IsOptional()
  @IsString()
  @MaxLength(240)
  role?: string

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  whenToUse?: string

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  systemPrompt?: string

  @IsOptional()
  @IsIn(AGENT_PROVIDERS)
  modelProvider?: 'claude' | 'codex'

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string

  @IsOptional()
  @IsObject()
  contextPolicy?: Record<string, unknown>

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tools?: string[]

  @IsOptional()
  @IsObject()
  permissions?: Record<string, unknown>

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  disallowedTools?: string[]

  @IsOptional()
  @IsIn(PERMISSION_MODES)
  permissionMode?: 'readonly' | 'ask' | 'acceptEdits' | 'dangerous'

  @IsOptional()
  @IsObject()
  runtimePolicy?: Record<string, unknown>

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  outputSchema?: string

  @IsOptional()
  @IsIn(ISOLATION_MODES)
  isolation?: 'shared' | 'worktree'

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[]

  @IsOptional()
  @IsObject()
  routingProfile?: Record<string, unknown>
}
