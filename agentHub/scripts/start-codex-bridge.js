import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'

const ENV_FILES = ['.env', '.env.local']

/**
 * Wraps Windows command shims so Node can spawn .cmd files reliably.
 * Input: command and arguments. Output: spawn-safe command and arguments.
 */
function resolveSpawnCommand(command, args) {
  const lowerCommand = command.toLowerCase()
  const isWindowsScript = process.platform === 'win32' && (lowerCommand.endsWith('.cmd') || lowerCommand.endsWith('.bat'))
  if (isWindowsScript) {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', command, ...args],
    }
  }
  return { command, args }
}

/**
 * Parses a dotenv-style file into key-value pairs.
 * Input: file path. Output: parsed entries.
 */
function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {}
  }

  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .reduce((entries, line) => {
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
 * Loads local env files while preserving explicit process env values.
 * Input: current process env. Output: merged env entries.
 */
function loadEnv(source) {
  const fileEnv = ENV_FILES
    .map(fileName => parseEnvFile(path.resolve(process.cwd(), fileName)))
    .reduce((merged, entries) => ({ ...merged, ...entries }), {})

  return { ...fileEnv, ...source }
}

const env = loadEnv(process.env)
const deepSeekKey = env.DEEPSEEK_API_KEY || env.APIKEY || env.DS_API_KEY

if (!deepSeekKey) {
  console.error('Missing DeepSeek API key. Set DEEPSEEK_API_KEY, APIKEY, or DS_API_KEY in .env.local.')
  process.exit(1)
}

const childEnv = {
  ...process.env,
  ...env,
  DS_API_KEY: deepSeekKey,
  DEEPSEEK_API_KEY: deepSeekKey,
}

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const args = ['--yes', 'mimo2codex@0.4.10', '--no-admin', '--no-load-env', '--model', 'ds']

console.log('Starting AgentHub Codex bridge with mimo2codex DeepSeek mode.')
console.log('DeepSeek API key loaded from local environment.')

const resolved = resolveSpawnCommand(command, args)
const child = spawn(resolved.command, resolved.args, {
  cwd: process.cwd(),
  env: childEnv,
  stdio: 'inherit',
  windowsHide: true,
})

child.on('error', error => {
  console.error(`Failed to start AgentHub Codex bridge: ${error.message}`)
  process.exit(1)
})

child.on('exit', code => {
  process.exit(code ?? 1)
})
