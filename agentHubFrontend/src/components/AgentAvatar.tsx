import { Bot, UserRound } from 'lucide-react'
import { agentTone } from '../appModel'
import { OrbMark } from './OrbMark'

type AgentAvatarProps = {
  agentId: string
  name?: string
  size?: 'sm' | 'md'
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
    <span className={`agent-avatar agent-avatar--${size} agent-avatar--${agentTone(agentId)}`} title={name ?? agentId}>
      <Bot size={size === 'sm' ? 15 : 18} />
    </span>
  )
}
