import aiCoreImage from '../asset/brand/ai-core.png'

type OrbMarkProps = {
  size?: 'sm' | 'md' | 'lg'
  pulse?: boolean
}

/**
 * Shows the AI Core orb mark reused from the reference visual direction.
 * Input: size variant and optional pulse flag.
 * Output: an image-backed brand mark.
 */
export function OrbMark({ size = 'md', pulse = false }: OrbMarkProps) {
  return (
    <span className={`orb-mark orb-mark--${size} ${pulse ? 'orb-mark--pulse' : ''}`.trim()} aria-hidden="true">
      <img src={aiCoreImage} alt="" />
    </span>
  )
}
