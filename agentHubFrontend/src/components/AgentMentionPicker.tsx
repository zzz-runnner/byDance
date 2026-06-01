import { AgentAvatar } from './AgentAvatar'

export type AgentMentionOption = {
  id: string
  name: string
}

type AgentMentionPickerProps = {
  options: AgentMentionOption[]
  activeIndex: number
  onSelect: (option: AgentMentionOption) => void
}

/**
 * Renders the upward agent picker used by group-chat @ mentions.
 * Input: filtered agent options, active row index, and a selection callback.
 * Output: a compact popup list anchored above the composer.
 */
export function AgentMentionPicker({ options, activeIndex, onSelect }: AgentMentionPickerProps) {
  return (
    <div className="mention-picker" role="listbox" aria-label="Available agents">
      {options.map((option, index) => (
        <button
          key={option.id}
          className={`mention-picker__option ${index === activeIndex ? 'is-active' : ''}`}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          onMouseDown={event => {
            event.preventDefault()
          }}
          onClick={() => onSelect(option)}
        >
          <AgentAvatar agentId={option.id} name={option.name} size="sm" />
          <span className="mention-picker__copy">
            <strong>{option.name}</strong>
            <small>@{option.id}</small>
          </span>
        </button>
      ))}
    </div>
  )
}
