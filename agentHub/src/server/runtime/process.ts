import { spawn, type ChildProcess } from 'node:child_process'

export type ProcessResult = {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export type ProcessOptions = {
  cwd?: string
  env?: NodeJS.ProcessEnv
  stdin?: string
  timeoutMs?: number
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

/**
 * Wraps Windows command scripts so Node can spawn .cmd and .bat files reliably.
 * Input: executable command and arguments. Output: spawn command and arguments.
 */
function resolveSpawnCommand(command: string, args: string[]): { command: string; args: string[] } {
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
 * Terminates a child process and its descendants when the runtime timeout fires.
 * Input: spawned child process. Output: best-effort termination request.
 */
function killProcessTree(child: ChildProcess): void {
  if (!child.pid) {
    child.kill()
    return
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    killer.on('error', () => {
      child.kill()
    })
    return
  }

  child.kill('SIGTERM')
}

/**
 * Runs a child process and captures stdout, stderr, exit code, and timeout state.
 * Input: command, argument list, and process options. Output: collected process result.
 */
export function runProcess(command: string, args: string[], options: ProcessOptions = {}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const resolved = resolveSpawnCommand(command, args)
    const child = spawn(resolved.command, resolved.args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: [options.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          killProcessTree(child)
        }, options.timeoutMs)
      : undefined

    child.stdout?.on('data', chunk => {
      const text = chunk.toString()
      stdout += text
      options.onStdout?.(text)
    })

    child.stderr?.on('data', chunk => {
      const text = chunk.toString()
      stderr += text
      options.onStderr?.(text)
    })

    if (options.stdin && child.stdin) {
      child.stdin.end(options.stdin)
    }

    child.on('error', error => {
      if (timer) {
        clearTimeout(timer)
      }
      reject(error)
    })

    child.on('close', code => {
      if (timer) {
        clearTimeout(timer)
      }
      resolve({ code, stdout, stderr, timedOut })
    })
  })
}
