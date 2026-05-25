import path from 'node:path'

/**
 * Resolves a CLI binary name for direct Node spawning on Windows and Unix.
 * Input: configured binary name or path. Output: executable command string.
 */
export function resolveCliCommand(command: string): string {
  const hasDirectory = command.includes('/') || command.includes('\\')
  const hasExtension = path.extname(command).length > 0
  const commandName = path.basename(command).toLowerCase()
  if (process.platform === 'win32' && commandName === 'git') {
    return command
  }
  if (process.platform === 'win32' && !hasDirectory && !hasExtension) {
    return `${command}.cmd`
  }
  return command
}

/**
 * Builds a compact child-agent prompt from the context package and task.
 * Input: task, context, and expected output hint. Output: prompt string.
 */
export function buildAgentPrompt(task: string, contextPackage: string, expectedOutput: string): string {
  return [
    'You are running inside AgentHub local runtime.',
    `Task: ${task}`,
    `Expected output: ${expectedOutput}`,
    'Use the context package below. Keep the response concise and structured.',
    '--- Context Package ---',
    contextPackage,
  ].join('\n\n')
}

/**
 * Combines an agent system prompt with the task prompt for stdin-based CLI execution.
 * Input: agent system prompt and task prompt. Output: complete prompt text.
 */
export function buildStdinPrompt(systemPrompt: string, taskPrompt: string): string {
  return ['--- Agent System Prompt ---', systemPrompt, '--- Agent Task Prompt ---', taskPrompt].join('\n\n')
}
