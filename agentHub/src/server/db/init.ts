import { createSeedState } from '../store/seed'
import { readEnv } from '../env'
import { createPostgresStateStore } from '../store/postgres'

/**
 * Initializes PostgreSQL storage with the AgentHub JSONB state row.
 * Input: DATABASE_URL from the environment. Output: ready database schema.
 */
async function main(): Promise<void> {
  const env = readEnv()
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for npm run db:init')
  }

  await createPostgresStateStore(env.DATABASE_URL, createSeedState())
  console.log('PostgreSQL schema is ready.')
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
