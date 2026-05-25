import type { WorkflowEvent } from '@shared/contracts'

/**
 * Prints assistant final-message events as token-like terminal output.
 * Input: workflow event and streamed message id set. Output: true when handled.
 */
export function printAssistantStreamEvent(event: WorkflowEvent, streamedMessageIds: Set<string>): boolean {
  switch (event.type) {
    case 'assistant_message_started':
      console.log('')
      console.log(`[${event.senderName ?? event.senderId}]`)
      return true
    case 'assistant_delta':
      process.stdout.write(event.delta)
      return true
    case 'assistant_message_finished':
      streamedMessageIds.add(event.messageId)
      console.log('')
      return true
    case 'assistant_message_error':
      streamedMessageIds.add(event.messageId)
      console.log(`\n[assistant] 输出异常：${event.error}`)
      return true
    default:
      return false
  }
}

/**
 * Prints child-agent process output as a live terminal stream.
 * Input: workflow event. Output: true when handled.
 */
export function printAgentOutputStreamEvent(event: WorkflowEvent): boolean {
  switch (event.type) {
    case 'agent_output_started':
      console.log('')
      console.log(`[${event.agentName} ${event.stream}]`)
      return true
    case 'agent_stdout_delta':
      process.stdout.write(event.delta)
      return true
    case 'agent_stderr_delta':
      process.stderr.write(event.delta)
      return true
    case 'agent_output_finished': {
      const writer = event.stream === 'stderr' ? process.stderr : process.stdout
      writer.write(`\n[${event.agentName} ${event.stream}] 输出结束：${event.byteLength} bytes, ${event.chunkCount} chunks\n`)
      return true
    }
    default:
      return false
  }
}
