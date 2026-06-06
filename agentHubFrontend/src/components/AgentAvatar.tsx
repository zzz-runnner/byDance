import { createAvatar } from '@dicebear/core'
import { botttsNeutral } from '@dicebear/collection'
import { UserRound } from 'lucide-react'
import { DEFAULT_ORCHESTRATOR_NAME, agentTone } from '../appModel'
import engineerAvatarSrc from '../asset/avatar/engineer-1.webp'
import productManagerAvatarSrc from '../asset/avatar/product-manager.webp'
import projectManagerAvatarSrc from '../asset/avatar/project-manager.webp'
import reviewerAvatarSrc from '../asset/avatar/reviewer-2.webp'

type AgentAvatarProps = {
  agentId: string
  name?: string
  size?: 'sm' | 'md' | 'lg'
}

const agentAvatarCache = new Map<string, string>()
const BUILTIN_AGENT_AVATAR_SRC: Record<string, string> = {
  orchestrator: projectManagerAvatarSrc,
  engineer: engineerAvatarSrc,
  'claude-code-direct': projectManagerAvatarSrc,
  'codex-direct': engineerAvatarSrc,
  'product-manager': productManagerAvatarSrc,
  reviewer: reviewerAvatarSrc,
}

const AGENT_AVATAR_BACKGROUNDS: Record<string, string[]> = {
  engineer: ['dbeafe', 'bfdbfe'],
  'claude-code-direct': ['dbeafe', 'ddd6fe'],
  'codex-direct': ['dbeafe', 'bfdbfe'],
  reviewer: ['dcfce7', 'bbf7d0'],
  'product-manager': ['fef3c7', 'fed7aa'],
}

/**
 * Selects stable avatar background colors for each child agent role.
 * Input: agent id.
 * Output: DiceBear-compatible hex colors without hash prefixes.
 */
function agentAvatarBackground(agentId: string): string[] {
  return AGENT_AVATAR_BACKGROUNDS[agentId] ?? ['fce7f3', 'ddd6fe']
}

/**
 * Returns one stable avatar image for built-in agents or a generated fallback.
 * Input: agent id used as the avatar seed.
 * Output: an image source string that can be used in one avatar element.
 */
function childAgentAvatarSrc(agentId: string): string {
  const builtinAvatar = BUILTIN_AGENT_AVATAR_SRC[agentId]

  if (builtinAvatar) {
    return builtinAvatar
  }

  const cached = agentAvatarCache.get(agentId)

  if (cached) {
    return cached
  }

  const avatar = createAvatar(botttsNeutral, {
    seed: `agenthub-${agentId}`,
    size: 96,
    radius: 50,
    scale: 86,
    backgroundColor: agentAvatarBackground(agentId),
    backgroundType: ['gradientLinear'],
    backgroundRotation: [135],
  }).toDataUri()

  agentAvatarCache.set(agentId, avatar)

  return avatar
}

/**
 * Renders an avatar for the user or one agent.
 * Input: agent id, optional display name, and size variant.
 * Output: an avatar element with a deterministic visual tone.
 */
export function AgentAvatar({ agentId, name, size = 'md' }: AgentAvatarProps) {
  if (agentId === 'user') {
    return (
      <span className={`agent-avatar agent-avatar--${size} agent-avatar--user`} title="User">
        <UserRound size={size === 'sm' ? 15 : 18} />
      </span>
    )
  }

  return (
    <span
      className={`agent-avatar agent-avatar--${size} agent-avatar--${agentTone(agentId)} agent-avatar--generated`}
      title={agentId === 'orchestrator' ? name ?? DEFAULT_ORCHESTRATOR_NAME : name ?? agentId}
    >
      <img className="agent-avatar__image" src={childAgentAvatarSrc(agentId)} alt="" />
    </span>
  )
}
