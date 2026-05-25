/**
 * Renders non-interactive color wash layers behind the workbench UI.
 * Input: none.
 * Output: decorative blurred layers that create a slow ambient flow.
 */
export function BackgroundCanvas() {
  return (
    <div className="background-canvas" aria-hidden="true">
      <span className="ambient-layer ambient-layer--cyan" />
      <span className="ambient-layer ambient-layer--magenta" />
      <span className="ambient-layer ambient-layer--violet" />
      <span className="ambient-layer ambient-layer--gold" />
      <span className="ambient-layer ambient-layer--sweep" />
    </div>
  )
}
