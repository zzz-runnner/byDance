import { createAvatar } from '@dicebear/core'
import { botttsNeutral } from '@dicebear/collection'
import { UserRound } from 'lucide-react'
import { agentTone } from '../appModel'
import { OrbMark } from './OrbMark'

type AgentAvatarProps = {
  agentId: string
  name?: string
  size?: 'sm' | 'md'
}

const agentAvatarCache = new Map<string, string>()

const AGENT_AVATAR_BACKGROUNDS: Record<string, string[]> = {
  engineer: ['dbeafe', 'bfdbfe'],
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
 * Builds and caches a deterministic DiceBear robot avatar for a child agent.
 * Input: agent id used as the avatar seed.
 * Output: a data URI string that can be used as an image source.
 */
function childAgentAvatarSrc(agentId: string): string {
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
 * Renders an avatar for the user, Orchestrator, or child agents.
 * Input: agent id, optional display name, and size variant.
 * Output: an avatar element with a deterministic visual tone.
 */
export function AgentAvatar({ agentId, name, size = 'md' }: AgentAvatarProps) {
  if (agentId === 'orchestrator') {
    return (
      <span className={`agent-avatar agent-avatar--${size} agent-avatar--orb`} title={name ?? 'Orchestrator'}>
        <OrbMark size={size === 'sm' ? 'sm' : 'md'} pulse />
      </span>
    )
  }

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
      title={name ?? agentId}
    >
      <img className="agent-avatar__image" src={childAgentAvatarSrc(agentId)} alt="" />
    </span>
  )
}
