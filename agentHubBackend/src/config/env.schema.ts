import { z } from 'zod'

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8790),
  CORS_ORIGIN: z.string().min(1).default('http://127.0.0.1:5173'),
  AGENTHUB_BASE_URL: z.string().url().default('http://127.0.0.1:8787'),
  AGENTHUB_RUNTIME_ROOT: z.string().min(1).default('../agentHub/data/workspaces'),
  APP_STORAGE_ROOT: z.string().min(1).default('storage'),
  APP_METADATA_STORE: z.enum(['local', 'postgres']).default('local'),
  DATABASE_URL: z.string().optional(),
  DOCKER_NODE_IMAGE: z.string().min(1).default('node:20-alpine'),
  BUILD_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  BUILD_CPU_LIMIT: z.string().min(1).default('1'),
  BUILD_MEMORY_LIMIT: z.string().min(1).default('2g'),
})

export type AppEnv = z.infer<typeof EnvSchema>

export function validateEnv(input: Record<string, unknown>): AppEnv {
  const parsed = EnvSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(`Invalid backend environment: ${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}
