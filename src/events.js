/**
 * Pure session-event reducer for dsh-tui.
 *
 * Maps the DeepSeek Harness `SessionEvent` stream into flat render state that the
 * UI layer (built separately) consumes directly. No React, no Ink, no side effects:
 * every call returns a new state object and never mutates the one it was handed.
 *
 * Extracted and hardened from the MIT reference at `/tmp/deepseek-harness-tui/src/ui.js`.
 */

/**
 * Hard cap on the transcript length. Kept local on purpose (this module is built
 * in parallel with `utils.js`, which also defines a MAX_ITEMS; the two must not be
 * coupled). The oldest items are dropped once the cap is exceeded.
 */
const MAX_ITEMS = 500

/**
 * Module-private side channel for tool timing: `callId -> Date.now()` start
 * timestamp. Stored OUTSIDE state (never serialized) so `reduce` remains a pure
 * state transform. CallIds from the harness are unique, so cross-turn collision
 * is not a practical concern; entries are removed on the matching `tool/result`.
 */
const toolStarts = new Map()

/** A fresh, blank streaming accumulator. */
function freshStream() {
  return { reasoning: '', text: '', tool: null }
}

/** Append additions to items, dropping the oldest rows past MAX_ITEMS. */
function appendItems(items, additions) {
  return [...items, ...additions].slice(-MAX_ITEMS)
}

/** Join the text of every block of one `type` in a message content array. */
function blocksText(content, type) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block && typeof block === 'object' && block.type === type && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

/** Compact token-usage line; omits missing fields. */
export function usageText(usage) {
  if (!usage || typeof usage !== 'object') return ''
  const parts = []
  if (typeof usage.inputTokens === 'number') parts.push(`${usage.inputTokens}in`)
  if (typeof usage.outputTokens === 'number') parts.push(`${usage.outputTokens}out`)
  if (typeof usage.cacheReadTokens === 'number') parts.push(`${usage.cacheReadTokens}cache`)
  return parts.length > 0 ? `usage: ${parts.join(' ')}` : ''
}

/** Human label for a turn-end reason. */
export function reasonText(reason) {
  if (!reason || typeof reason !== 'object') return 'ended'
  switch (reason.kind) {
    case 'completed': return '✓ completed'
    case 'error': return `✗ error: ${reason.error?.code ?? 'UNKNOWN'} ${reason.error?.message ?? ''}`
    case 'aborted': return '⏹ aborted'
    case 'max-tokens': return '⚠ max-tokens'
    default: return String(reason.kind)
  }
}

/** First text found in a tool-result message (ToolResultBlock inner blocks). */
export function toolResultText(message) {
  if (!message || typeof message !== 'object' || !Array.isArray(message.content)) return ''
  const parts = []
  for (const block of message.content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    } else if (block.type === 'tool-result' && Array.isArray(block.content)) {
      for (const inner of block.content) {
        if (inner && typeof inner === 'object' && inner.type === 'text' && typeof inner.text === 'string') {
          parts.push(inner.text)
        }
      }
    }
  }
  return parts.join('\n')
}

/** The initial reducer state. Always a fresh object graph. */
export function createInitialState() {
  return {
    items: [],
    todos: [],
    busy: false,
    stream: { reasoning: '', text: '', tool: null },
    usage: null,
    turnStart: undefined,
  }
}

/**
 * Reduce one SessionEvent into a new state.
 *
 * @param {object} state    current state (see `createInitialState`)
 * @param {object} event    a SessionEvent; all fields treated as possibly-absent
 * @param {number} [firstSeq] events with `seq < firstSeq` are seed history, ignored
 * @returns {object} new state (input state is never mutated)
 */
export function reduce(state, event, firstSeq) {
  if (!state || typeof state !== 'object') state = createInitialState()
  if (!event || typeof event !== 'object') return state
  if (typeof event.seq === 'number' && typeof firstSeq === 'number' && event.seq < firstSeq) return state

  const data = event.data && typeof event.data === 'object' ? event.data : {}

  switch (event.type) {
    case 'turn/start':
      return {
        ...state,
        busy: true,
        stream: freshStream(),
        todos: [],
        usage: null,
        turnStart: Date.now(),
      }

    case 'turn/end': {
      const reason = data.reason && typeof data.reason === 'object' ? data.reason : {}
      const usage = data.usage && typeof data.usage === 'object' ? data.usage : state.usage
      const label = reasonText(reason)
      const usageLine = usageText(usage)
      const text = usageLine === '' ? label : `${label} · ${usageLine}`
      const isError = reason.kind === 'error'
      // Divider only when there is prior transcript; todos stay visible.
      const additions = [...(state.items.length === 0 ? [] : [{ kind: 'divider' }]), { kind: 'status', text, error: isError }]
      return {
        ...state,
        busy: false,
        turnStart: undefined,
        usage,
        items: appendItems(state.items, additions),
      }
    }

    case 'assistant/chunk': {
      const chunk = data.chunk && typeof data.chunk === 'object' ? data.chunk : {}
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        return { ...state, stream: { ...state.stream, text: state.stream.text + chunk.text } }
      }
      if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
        return { ...state, stream: { ...state.stream, reasoning: state.stream.reasoning + chunk.text } }
      }
      if (chunk.type === 'tool-call-delta' && typeof chunk.argumentsDelta === 'string') {
        const prev = state.stream && typeof state.stream === 'object' ? state.stream.tool : undefined
        return {
          ...state,
          stream: {
            ...state.stream,
            tool: {
              name: typeof chunk.name === 'string' ? chunk.name : (prev?.name ?? ''),
              args: (prev?.args ?? '') + chunk.argumentsDelta,
            },
          },
        }
      }
      if (chunk.type === 'usage' && chunk.usage && typeof chunk.usage === 'object') {
        return { ...state, usage: chunk.usage }
      }
      return state
    }

    case 'assistant/message': {
      const message = data.message && typeof data.message === 'object' ? data.message : {}
      const content = Array.isArray(message.content) ? message.content : []
      const itemUsage = data.usage && typeof data.usage === 'object' ? data.usage : undefined
      const item = { kind: 'assistant', text: blocksText(content, 'text'), reasoning: blocksText(content, 'reasoning') }
      if (itemUsage) item.usage = itemUsage
      return {
        ...state,
        stream: freshStream(),
        usage: itemUsage ?? state.usage,
        items: appendItems(state.items, [item]),
      }
    }

    case 'tool/call': {
      const callId = typeof data.callId === 'string' ? data.callId : `t${Date.now()}`
      toolStarts.set(callId, Date.now())
      const item = {
        kind: 'tool',
        callId,
        name: typeof data.name === 'string' ? data.name : 'tool',
        args: typeof data.arguments === 'string' ? data.arguments : '',
        status: 'running',
      }
      return {
        ...state,
        stream: state.stream?.tool ? { ...state.stream, tool: null } : state.stream,
        items: appendItems(state.items, [item]),
      }
    }

    case 'tool/result': {
      const message = data.message && typeof data.message === 'object' ? data.message : undefined
      const callId =
        typeof data.callId === 'string'
          ? data.callId
          : message && message.source && typeof message.source.callId === 'string'
            ? message.source.callId
            : undefined
      if (callId === undefined) return state

      const content = message && Array.isArray(message.content) ? message.content : []
      const resultBlock = content.find((block) => block && typeof block === 'object' && block.type === 'tool-result')
      const errorInfo = data.error && typeof data.error === 'object' ? data.error : undefined
      const isError = errorInfo !== undefined ? true : resultBlock ? resultBlock.isError === true : false

      const start = toolStarts.get(callId)
      toolStarts.delete(callId)
      const seconds = start !== undefined ? (Date.now() - start) / 1000 : undefined
      const output = toolResultText(message)

      return {
        ...state,
        items: state.items.map((item) =>
          item.kind === 'tool' && item.callId === callId
            ? {
                ...item,
                status: isError ? 'error' : 'done',
                seconds,
                output,
                error: isError ? { name: errorInfo?.name ?? 'tool error', code: errorInfo?.code } : undefined,
              }
            : item,
        ),
      }
    }

    case 'todo/write':
      if (Array.isArray(data.todos)) return { ...state, todos: data.todos }
      return state

    default:
      return state
  }
}
