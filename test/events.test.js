import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createInitialState, reduce, reasonText, usageText, toolResultText } from '../src/events.js'

test('createInitialState returns the documented shape', () => {
  const state = createInitialState()
  assert.deepStrictEqual(state, {
    items: [],
    todos: [],
    busy: false,
    stream: { reasoning: '', text: '', tool: null },
    usage: null,
    turnStart: undefined,
  })
  // fresh graph, not shared across calls
  const other = createInitialState()
  assert.notEqual(other, state)
  assert.notEqual(other.stream, state.stream)
  assert.notEqual(other.items, state.items)
})

test('skips events with seq below firstSeq (seed history)', () => {
  const state = createInitialState()
  const out = reduce(state, { seq: 3, type: 'turn/start', data: {} }, 5)
  assert.equal(out, state)
  assert.equal(out.busy, false)

  // seq === firstSeq is live
  const live = reduce(state, { seq: 5, type: 'turn/start', data: {} }, 5)
  assert.notEqual(live, state)
  assert.equal(live.busy, true)
})

test('full turn: start → chunks → message → tool → end', () => {
  let s = createInitialState()

  s = reduce(s, { seq: 1, type: 'turn/start', data: {} })
  assert.equal(s.busy, true)
  assert.deepStrictEqual(s.stream, { reasoning: '', text: '', tool: null })
  assert.deepStrictEqual(s.todos, [])
  assert.equal(s.usage, null)
  assert.equal(typeof s.turnStart, 'number')

  s = reduce(s, { seq: 2, type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'Hello' } } })
  s = reduce(s, { seq: 3, type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: ' world' } } })
  s = reduce(s, { seq: 4, type: 'assistant/chunk', data: { chunk: { type: 'reasoning-delta', text: 'think' } } })
  assert.equal(s.stream.text, 'Hello world')
  assert.equal(s.stream.reasoning, 'think')

  s = reduce(s, {
    seq: 5,
    type: 'assistant/message',
    data: {
      message: { content: [{ type: 'text', text: 'Hello world' }, { type: 'reasoning', text: 'think' }] },
      usage: { inputTokens: 12, outputTokens: 5 },
    },
  })
  assert.deepStrictEqual(s.items, [
    { kind: 'assistant', text: 'Hello world', reasoning: 'think', usage: { inputTokens: 12, outputTokens: 5 } },
  ])
  assert.deepStrictEqual(s.stream, { reasoning: '', text: '', tool: null })
  assert.deepStrictEqual(s.usage, { inputTokens: 12, outputTokens: 5 })

  s = reduce(s, { seq: 6, type: 'tool/call', data: { callId: 'call-1', name: 'bash', arguments: '{"cmd":"ls"}' } })
  assert.deepStrictEqual(s.items[1], { kind: 'tool', callId: 'call-1', name: 'bash', args: '{"cmd":"ls"}', status: 'running' })

  // tool/result pairs via message.source.callId (no top-level callId)
  s = reduce(s, {
    seq: 7,
    type: 'tool/result',
    data: {
      message: {
        source: { callId: 'call-1' },
        content: [{ type: 'tool-result', content: [{ type: 'text', text: 'file.txt' }] }],
      },
    },
  })
  assert.equal(s.items[1].kind, 'tool')
  assert.equal(s.items[1].status, 'done')
  assert.equal(s.items[1].output, 'file.txt')
  assert.equal(typeof s.items[1].seconds, 'number')
  assert.equal(s.items[1].error, undefined)

  s = reduce(s, {
    seq: 8,
    type: 'turn/end',
    data: { reason: { kind: 'completed' }, usage: { inputTokens: 12, outputTokens: 5 } },
  })
  assert.equal(s.busy, false)
  assert.equal(s.turnStart, undefined)
  assert.deepStrictEqual(s.items, [
    { kind: 'assistant', text: 'Hello world', reasoning: 'think', usage: { inputTokens: 12, outputTokens: 5 } },
    { kind: 'tool', callId: 'call-1', name: 'bash', args: '{"cmd":"ls"}', status: 'done', seconds: s.items[1].seconds, output: 'file.txt', error: undefined },
    { kind: 'divider' },
    { kind: 'status', text: '✓ completed · usage: 12in 5out', error: false },
  ])
})

test('todo/write updates todos; cleared on turn/start, kept on turn/end', () => {
  let s = reduce(createInitialState(), { type: 'turn/start', data: {} })
  s = reduce(s, { type: 'todo/write', data: { todos: [{ content: 'step 1', status: 'in_progress' }] } })
  assert.deepStrictEqual(s.todos, [{ content: 'step 1', status: 'in_progress' }])

  s = reduce(s, { type: 'turn/start', data: {} })
  assert.deepStrictEqual(s.todos, [])

  s = reduce(s, { type: 'todo/write', data: { todos: [{ content: 'done', status: 'completed' }] } })
  s = reduce(s, { type: 'turn/end', data: { reason: { kind: 'aborted' } } })
  assert.deepStrictEqual(s.todos, [{ content: 'done', status: 'completed' }])
  assert.equal(s.items[s.items.length - 1].text, '⏹ aborted')
})

test('error tool-result marks the tool as error', () => {
  let s = reduce(createInitialState(), { type: 'tool/call', data: { callId: 'err-1', name: 'bash', arguments: '' } })
  s = reduce(s, {
    type: 'tool/result',
    data: {
      callId: 'err-1',
      message: { content: [{ type: 'tool-result', isError: true, content: [{ type: 'text', text: 'failed' }] }] },
    },
  })
  assert.equal(s.items[0].status, 'error')
  assert.equal(s.items[0].output, 'failed')
  assert.deepStrictEqual(s.items[0].error, { name: 'tool error', code: undefined })

  // top-level data.error supplies name/code
  let s2 = reduce(createInitialState(), { type: 'tool/call', data: { callId: 'err-2', name: 'bash', arguments: '' } })
  s2 = reduce(s2, {
    type: 'tool/result',
    data: {
      callId: 'err-2',
      error: { name: 'EvalError', code: 'EVAL' },
      message: { content: [{ type: 'tool-result', isError: true, content: [{ type: 'text', text: 'nope' }] }] },
    },
  })
  assert.equal(s2.items[0].status, 'error')
  assert.deepStrictEqual(s2.items[0].error, { name: 'EvalError', code: 'EVAL' })
})

test('reasoning and tool-call deltas accumulate into stream', () => {
  let s = reduce(createInitialState(), { type: 'turn/start', data: {} })
  s = reduce(s, { type: 'assistant/chunk', data: { chunk: { type: 'reasoning-delta', text: 'a' } } })
  s = reduce(s, { type: 'assistant/chunk', data: { chunk: { type: 'reasoning-delta', text: 'b' } } })
  assert.equal(s.stream.reasoning, 'ab')

  s = reduce(s, { type: 'assistant/chunk', data: { chunk: { type: 'tool-call-delta', name: 'bash', argumentsDelta: '{"c' } } })
  s = reduce(s, { type: 'assistant/chunk', data: { chunk: { type: 'tool-call-delta', argumentsDelta: 'md":1}' } } })
  assert.deepStrictEqual(s.stream.tool, { name: 'bash', args: '{"cmd":1}' })

  // a real tool/call clears the live stream.tool
  s = reduce(s, { type: 'tool/call', data: { callId: 'c', name: 'bash', arguments: '{}' } })
  assert.equal(s.stream.tool, null)
})

test('caps items at 500', () => {
  let s = createInitialState()
  for (let i = 0; i < 505; i++) {
    s = reduce(s, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `msg ${i}` }] } } })
  }
  assert.equal(s.items.length, 500)
  assert.equal(s.items[0].text, 'msg 5')
  assert.equal(s.items[499].text, 'msg 504')

  // turn/end is also capped: 2 more rows added, oldest 2 dropped
  s = reduce(s, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  assert.equal(s.items.length, 500)
  assert.equal(s.items[498].kind, 'divider')
  assert.equal(s.items[499].kind, 'status')
})

test('reduce never mutates the input state', () => {
  let s = createInitialState()
  s = reduce(s, { type: 'turn/start', data: {} })
  s = reduce(s, { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'hi' } } })
  s = reduce(s, { type: 'todo/write', data: { todos: [{ content: 'x', status: 'pending' }] } })
  s = reduce(s, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'hi' }] } } })
  s = reduce(s, { type: 'tool/call', data: { callId: 'cX', name: 'bash', arguments: '{}' } })

  const before = structuredClone(s)
  const event = {
    type: 'tool/result',
    data: { callId: 'cX', message: { content: [{ type: 'tool-result', content: [{ type: 'text', text: 'ok' }] }] } },
  }
  const out = reduce(s, event)

  assert.notEqual(out, s)
  assert.notEqual(out.items, s.items)
  assert.deepStrictEqual(s, before) // input untouched
})

test('unknown event types and malformed events are ignored safely', () => {
  const state = createInitialState()
  assert.equal(reduce(state, null), state)
  assert.equal(reduce(state, undefined), state)
  assert.equal(reduce(state, 42), state)
  assert.equal(reduce(state, { type: 'something/unknown', data: { x: 1 } }), state)
  assert.equal(reduce(state, { type: 'assistant/chunk', data: {} }), state)
})

test('helper functions: reasonText / usageText / toolResultText', () => {
  assert.equal(reasonText({ kind: 'completed' }), '✓ completed')
  assert.equal(reasonText({ kind: 'aborted' }), '⏹ aborted')
  assert.equal(reasonText({ kind: 'max-tokens' }), '⚠ max-tokens')
  assert.equal(reasonText({ kind: 'error', error: { code: 'E1', message: 'boom' } }), '✗ error: E1 boom')
  assert.equal(reasonText({ kind: 'something-else' }), 'something-else')
  assert.equal(reasonText(undefined), 'ended')

  assert.equal(usageText({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 3 }), 'usage: 10in 20out 3cache')
  assert.equal(usageText({ outputTokens: 20 }), 'usage: 20out')
  assert.equal(usageText({}), '')
  assert.equal(usageText(undefined), '')
  assert.equal(usageText(null), '')

  assert.equal(
    toolResultText({ content: [{ type: 'tool-result', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }] }),
    'a\nb',
  )
  assert.equal(toolResultText({ content: [{ type: 'text', text: 'direct' }] }), 'direct')
  assert.equal(toolResultText(undefined), '')
  assert.equal(toolResultText({}), '')
})
