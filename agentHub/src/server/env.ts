import { z } from 'zod'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ENV_FILES = ['.env', '.env.local']

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  WEB_PORT: z.coerce.number().int().positive().default(5173),
  AGENTHUB_STORAGE: z.enum(['memory', 'postgres']).default('memory'),
  DATABASE_URL: z.string().optional(),
  CLAUDE_CODE_BIN: z.string().min(1).default('claude'),
  CODEX_BIN: z.string().min(1).default('codex'),
  AGENTHUB_CODEX_BRIDGE_URL: z.string().url().default('http://127.0.0.1:8788/v1'),
  AGENTHUB_CODEX_MODEL_PROVIDER: z.string().min(1).default('agenthub-deepseek'),
  AGENTHUB_CODEX_MODEL: z.string().min(1).default('deepseek-v4-pro'),
  AGENTHUB_CODEX_HOME: z.string().min(1).default('.codex-agenthub'),
  AGENTHUB_CODEX_BRIDGE_API_KEY: z.string().min(1).default('agenthub-local'),
  AGENTHUB_REAL_AGENTS: z
    .enum(['true', 'false'])
    .default('true')
    .transform(value => value === 'true'),
  AGENTHUB_RUNTIME_ROOT: z.string().min(1).default('data/workspaces'),
  AGENTHUB_ORCHESTRATOR_PROVIDER: z.enum(['deepseek', 'mock']).default('deepseek'),
  AGENTHUB_ORCHESTRATOR_MODEL: z.string().optional(),
  AGENTHUB_ORCHESTRATOR_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  AGENTHUB_ORCHESTRATOR_MAX_TOKENS: z.coerce.number().int().positive().default(2_000),
  AGENTHUB_ROUTER_MODEL: z.string().min(1).default('deepseek-v4-flash'),
  AGENTHUB_ROUTER_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
  AGENTHUB_ROUTER_MAX_TOKENS: z.coerce.number().int().positive().default(500),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com'),
})

export type ServerEnv = z.infer<typeof EnvSchema>

/**
 * Parses one dotenv-style file into key-value pairs.
 * Input: absolute or relative env file path. Output: parsed environment entries.
 */
function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    return {}
  }

  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .reduce<Record<string, string>>((entries, line) => {
      const separator = line.indexOf('=')
      if (separator === -1) {
        return entries
      }
      const key = line.slice(0, separator).trim()
      const rawValue = line.slice(separator + 1).trim()
      entries[key] = rawValue.replace(/^['"]|['"]$/g, '')
      return entries
    }, {})
}

/**
 * Loads local env files while letting explicit process env values win.
 * Input: process environment object. Output: merged environment entries.
 */
function loadLocalEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const fileEnv = ENV_FILES
    .map(fileName => parseEnvFile(path.resolve(process.cwd(), fileName)))
    .reduce<Record<string, string>>((merged, entries) => ({ ...merged, ...entries }), {})

  return { ...fileEnv, ...source }
}

/**
 * Maps short local model aliases onto explicit AgentHub env names.
 * Input: merged environment entries. Output: environment entries with aliases populated.
 */
function normalizeEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const normalized = { ...source }
  if (!normalized.AGENTHUB_ORCHESTRATOR_MODEL && normalized.MODEL) {
    normalized.AGENTHUB_ORCHESTRATOR_MODEL = normalized.MODEL
  }
  if (!normalized.DEEPSEEK_API_KEY && normalized.APIKEY) {
    normalized.DEEPSEEK_API_KEY = normalized.APIKEY
  }
  return normalized
}

/**
 * Parses environment variables into the server runtime contract.
 * Input: a Node environment object. Output: validated server configuration.
 */
export function readEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const merged = source === process.env ? loadLocalEnv(source) : source
  return EnvSchema.parse(normalizeEnv(merged))
}
