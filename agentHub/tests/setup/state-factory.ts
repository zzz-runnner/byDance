import { isoNow, type AgentDefinition, type Workspace } from '../../src/shared/contracts'

/**
 * Creates a file-writing engineer agent for delivery tests.
 * Input: optional agent overrides. Output: complete agent definition.
 */
export function createTestAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  const now = isoNow()
  return {
    id: 'engineer',
    name: 'Engineer',
    role: 'Engineer',
    description: 'Implements workspace changes.',
    whenToUse: 'Use for implementation tasks.',
    systemPrompt: 'Implement narrowly scoped changes.',
    modelProvider: 'mock',
    contextPolicy: {
      includeProjectBrief: true,
      includePinnedMessages: true,
      recentMessageLimit: 10,
      includeSameConversationOnly: false,
      includeArtifacts: true,
      includeFileSummaries: true,
      allowReadFilesOnDemand: false,
    },
    tools: ['readContext'],
    permissions: {
      fileRead: true,
      fileWrite: true,
      shell: false,
      webSearch: false,
      webFetch: false,
      deploy: false,
    },
    permissionMode: 'acceptEdits',
    runtimePolicy: {
      workspaceOnly: true,
      allowNetwork: false,
      allowShell: false,
      maxRunSeconds: 90,
    },
    outputSchema: 'Return implementation summary.',
    isolation: 'shared',
    skills: [],
    source: 'built-in',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/**
 * Creates a workspace record for runtime tests.
 * Input: optional workspace overrides. Output: complete workspace record.
 */
export function createTestWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  const now = isoNow()
  const id = overrides.id ?? 'ws-test'
  return {
    id,
    name: 'Test Workspace',
    goal: 'Validate AgentHub runtime behavior.',
    workspaceType: 'dev',
    rootPath: `data/workspaces/${id}/repo`,
    runtimeType: 'local',
    runtimeStatus: 'ready',
    projectBrief: 'Test workspace brief.',
    pinnedMessageIds: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
