/**
 * dsh-tui Ink UI — plain React (React.createElement only, no JSX, no build).
 *
 * Claude-CLI form: bottom-anchored streaming transcript, tool calls folded into
 * cells, collapsible thinking, and a palette derived from the terminal
 * background. Every feature runs through the harness; this component only
 * renders. State is a pure reduce over `session/event` (see ./events.js).
 *
 * All event access is defensive: shapes carry optional fields and the harness
 * iterates fast, so the UI must never crash on unknown types.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import TextInput from 'ink-text-input'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { makePalette } from './theme.js'
import { createInitialState, reduce } from './events.js'
import { parseSlash, SLASH_COMMANDS, HELP_TEXT } from './commands.js'
import {
  MAX_TOOL_ARGS, OUTPUT_HEAD, OUTPUT_TAIL,
  userMessageBg, codeChipBg,
  strWidth, wrapText, truncate, stripAnsi,
  fmtDuration, fmtElapsedCompact, usageText,
  blocksText, toolResultText, splitOutput, splitCodeBlocks,
} from './utils.js'

/** createElement shorthand. */
const el = React.createElement

/** Default semantic palette; replaced by makePalette(themeBg) when a bg is known. */
const DEFAULT_PALETTE = { accent: '#D97757', success: '#5BB345', error: '#E05555', thinking: '#8a8a8a' }

/** Known model ids for the /model picker; arbitrary ids are also accepted. */
const KNOWN_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro']

/** Braille spinner (ink-spinner has no braille frame set). */
const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function BrailleSpinner() {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % BRAILLE_FRAMES.length), 80)
    return () => clearInterval(timer)
  }, [])
  return el(Text, null, BRAILLE_FRAMES[frame])
}

/** Inline markdown tokens: `code`, **bold**, *italic*. Returns Text children. */
function renderInline(text, keyPrefix, chipBg) {
  const nodes = []
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/g
  let last = 0
  let match
  let key = 0
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) nodes.push(el(Text, { key: `${keyPrefix}-${key++}` }, text.slice(last, match.index)))
    const token = match[0]
    if (match[1] !== undefined) {
      nodes.push(el(Text, { key: `${keyPrefix}-${key++}`, backgroundColor: chipBg }, token.slice(1, -1)))
    } else if (match[2] !== undefined) {
      nodes.push(el(Text, { key: `${keyPrefix}-${key++}`, bold: true }, token.slice(2, -2)))
    } else {
      nodes.push(el(Text, { key: `${keyPrefix}-${key++}`, italic: true }, token.slice(1, -1)))
    }
    last = match.index + token.length
  }
  if (last < text.length) nodes.push(el(Text, { key: `${keyPrefix}-${key++}` }, text.slice(last)))
  return nodes
}

/** Markdown body: headers keep `#` (bold), fences keep fences, inline styled. */
function markdownLines(text, width, indent, chipBg, prefix) {
  const pad = ' '.repeat(indent)
  const avail = Math.max(1, width - indent)
  const out = []
  let blockKey = 0
  let first = true
  const gutter = () => {
    const g = first ? (prefix !== '' ? prefix : pad) : pad
    first = false
    return g
  }
  for (const block of splitCodeBlocks(text)) {
    if (block.type === 'code') {
      for (const line of wrapText(block.content, avail)) {
        out.push(el(Text, { key: `b${blockKey}`, wrap: 'wrap' }, gutter() + line))
        blockKey += 1
      }
    } else {
      for (const rawLine of block.content.split('\n')) {
        const trimmed = rawLine.replace(/^\s+/, '')
        const isHeader = /^#{1,6}\s/.test(trimmed)
        if (trimmed === '') {
          out.push(el(Text, { key: `b${blockKey}`, wrap: 'wrap' }))
          blockKey += 1
          continue
        }
        for (const line of wrapText(trimmed, avail)) {
          if (isHeader) {
            out.push(el(Text, { key: `b${blockKey}`, bold: true, wrap: 'wrap' }, gutter() + line))
          } else {
            out.push(el(Text, { key: `b${blockKey}`, wrap: 'wrap' }, gutter(), ...renderInline(line, `i${blockKey}`, chipBg)))
          }
          blockKey += 1
        }
      }
    }
  }
  if (out.length === 0) out.push(el(Text, { key: 'empty' }))
  return out
}

/** Body lines for a plain (non-markdown) message with a prefix. */
function plainLines(text, width, prefix, indent) {
  return wrapText(text, Math.max(1, width - indent))
    .map((line, i) => el(Text, { key: `l${i}`, wrap: 'wrap' }, `${i === 0 ? prefix : ' '.repeat(indent)}${line}`))
}

/** One transcript row. */
function ChatRow({ item, width, thinkingOpen, themeBg, palette }) {
  const chipBg = codeChipBg(themeBg)
  switch (item.kind) {
    case 'user':
      return el(
        Box,
        { flexDirection: 'column', backgroundColor: userMessageBg(themeBg), flexShrink: 0 },
        ...plainLines(item.text, width, '❯ ', 2).map((line, i) =>
          el(Box, { key: `u${i}`, paddingLeft: 1, paddingRight: 1 }, line)),
      )
    case 'assistant': {
      const lines = []
      if (item.reasoning !== '' && thinkingOpen) {
        lines.push(
          el(Box, { key: 'thinking', flexDirection: 'column' },
            el(Text, { dimColor: true, bold: true, color: palette.thinking }, '  ✻ thinking'),
            ...wrapText(item.reasoning, Math.max(1, width - 6)).map((line, i) =>
              el(Text, { key: `t${i}`, dimColor: true, italic: true, wrap: 'wrap' }, `    ${line}`))),
        )
      }
      if (item.text !== '') {
        lines.push(el(Box, { key: 'body', flexDirection: 'column' }, ...markdownLines(item.text, width, 2, chipBg, '')))
      }
      if (item.usage) {
        lines.push(el(Text, { key: 'usage', dimColor: true, wrap: 'wrap' }, `  ${usageText(item.usage)}`))
      }
      if (lines.length === 0) return null
      return el(Box, { flexDirection: 'column', marginTop: 1, flexShrink: 0 }, ...lines)
    }
    case 'tool': {
      const done = item.status === 'done'
      const failed = item.status === 'error'
      const mark = failed
        ? el(Text, { key: 'm', color: palette.error, bold: true }, '✗')
        : done
          ? el(Text, { key: 'm', color: palette.success, bold: true }, '✓')
          : el(BrailleSpinner, { key: 'm' })
      const label = done || failed ? '' : 'Running '
      const seconds = typeof item.seconds === 'number' ? ` • ${fmtDuration(item.seconds * 1000)}` : ''
      const cmd = `${item.name} ${truncate(item.args, MAX_TOOL_ARGS)}`.trim()
      const outputLines = splitOutput(item.output)
      const rows = [
        el(Text, { key: 'head', wrap: 'wrap' },
          el(Text, {}, '  ⏺ '), mark,
          el(Text, { bold: !done && !failed, color: done || failed ? undefined : palette.accent }, ` ${label}${cmd}`),
          el(Text, { dimColor: true }, seconds)),
      ]
      if (outputLines !== null) {
        let outIndex = 0
        for (const line of outputLines.lines) {
          for (const wrapped of wrapText(stripAnsi(line), Math.max(1, width - 6))) {
            rows.push(el(Text, { key: `o${outIndex++}`, dimColor: true, wrap: 'wrap' }, `    ${wrapped}`))
          }
        }
        if (outputLines.omitted > 0) {
          rows.push(el(Text, { key: 'ell', dimColor: true, wrap: 'wrap' }, `    … +${outputLines.omitted} lines`))
        }
      }
      if (failed && item.error) {
        rows.push(el(Text, { key: 'err', color: palette.error, wrap: 'wrap' }, `    error: ${item.error.name ?? item.error.code ?? 'unknown'}`))
      }
      return el(Box, { flexDirection: 'column', marginTop: 1, flexShrink: 0 }, ...rows)
    }
    case 'divider':
      return el(Text, { dimColor: true }, '  ' + '─'.repeat(Math.min(48, width - 4)))
    default:
      return el(Text, { dimColor: !item.error, color: item.error ? palette.error : undefined, wrap: 'wrap' }, item.text)
  }
}

/** Live streaming block while a turn is in flight. */
function StreamBlock({ stream, width, thinkingOpen, themeBg, palette }) {
  const chipBg = codeChipBg(themeBg)
  const children = []
  if (stream.reasoning !== '' && thinkingOpen) {
    children.push(
      el(Box, { key: 'reasoning', flexDirection: 'column', marginTop: 1 },
        el(Text, { dimColor: true, bold: true, color: palette.thinking }, '  ✻ thinking'),
        ...wrapText(stream.reasoning, Math.max(1, width - 6)).map((line, i) =>
          el(Text, { key: `t${i}`, dimColor: true, italic: true, wrap: 'wrap' }, `    ${line}`))),
    )
  }
  if (stream.text !== '') {
    children.push(el(Box, { key: 'text', flexDirection: 'column', marginTop: 1 }, ...markdownLines(stream.text, width, 2, chipBg, '')))
  }
  if (stream.tool !== null) {
    const name = stream.tool.name !== '' ? stream.tool.name : 'tool'
    children.push(
      el(Text, { key: 'tool', wrap: 'wrap' },
        el(Text, {}, '  ⏺ '),
        el(BrailleSpinner, { key: 'sp' }),
        el(Text, { bold: true, color: palette.accent }, ` Running ${name}`),
        el(Text, { dimColor: true }, ` ${truncate(stream.tool.args, MAX_TOOL_ARGS)}`)),
    )
  }
  return children.length === 0 ? null : el(Box, { flexDirection: 'column' }, ...children)
}

/** Todo list panel (whole-list snapshot from todo/write). */
function TodoPanel({ todos, palette }) {
  if (!Array.isArray(todos) || todos.length === 0) return null
  return el(
    Box,
    { flexDirection: 'column', marginTop: 1, flexShrink: 0 },
    el(Text, { dimColor: true, bold: true }, '  todos'),
    ...todos.map((todo, index) => {
      const done = todo && todo.status === 'completed'
      const inProgress = todo && todo.status === 'in_progress'
      return el(
        Text,
        { key: index, dimColor: !done, color: done ? palette.success : inProgress ? palette.accent : undefined, wrap: 'wrap' },
        `    ${done ? '✓' : inProgress ? '◐' : '☐'} ${todo && typeof todo.content === 'string' ? todo.content : ''}`,
      )
    }),
  )
}

/** Inline permission/approval prompt (rendered while a tool is awaiting a yes/no). */
function ApprovalPrompt({ pending, palette }) {
  if (pending === null) return null
  const req = pending.req
  const reason = typeof req?.reason === 'string' && req.reason !== '' ? ` — ${req.reason}` : ''
  return el(
    Box,
    { flexDirection: 'column', marginTop: 1, paddingLeft: 1, flexShrink: 0 },
    el(Text, { bold: true, color: palette.accent, wrap: 'wrap' }, `  ! allow ${req?.toolName ?? 'tool'}?${reason}`),
    el(Text, { dimColor: true, wrap: 'wrap' }, '    [y] allow once   [n] deny   [esc] cancel'),
  )
}

/** App root: owns state, keys, composer, and the bottom-anchored viewport. */
export function App({
  agent, firstSeq = 0, initialState, model = '?', themeBg = null,
  onEvent, onApproval, onInterrupt, onModelSwitch, onCommand, onExit,
}) {
  const [state, setState] = useState(initialState ?? createInitialState())
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(null)
  const [thinkingOpen, setThinkingOpen] = useState(true)
  const [modelLabel, setModelLabel] = useState(model)
  const [, setTick] = useState(0)
  const historyRef = useRef([])
  const historyIdx = useRef(-1)
  const pendingRef = useRef(null)
  const { exit: inkExit } = useApp()
  const { stdout } = useStdout()
  const cols = stdout?.columns ?? 100
  const rows = stdout?.rows ?? 30
  const width = Math.max(20, cols - 2)
  const palette = { ...DEFAULT_PALETTE, ...(themeBg !== null ? makePalette(themeBg) : {}) }

  // Working elapsed timer while busy.
  useEffect(() => {
    if (!state.busy) return
    const t = setInterval(() => setTick((v) => v + 1), 1000)
    return () => clearInterval(t)
  }, [state.busy])

  // Install the approval answerer once the App mounts.
  useEffect(() => {
    if (typeof onApproval !== 'function') return
    onApproval((req) => new Promise((resolve) => {
      const entry = { req, resolve }
      pendingRef.current = entry
      setPending(entry)
    }))
    return () => onApproval(null)
  }, [onApproval])

  // Register this component's event consumer with the non-React bridge once.
  useEffect(() => {
    if (typeof onEvent !== 'function') return
    onEvent((event) => setState((prev) => reduce(prev, event, firstSeq)))
    return () => onEvent(null)
  }, [onEvent, firstSeq])

  const answerApproval = useCallback((outcome) => {
    const entry = pendingRef.current
    if (entry === null) return
    pendingRef.current = null
    setPending(null)
    entry.resolve(outcome)
  }, [])

  const handleExit = useCallback(() => {
    inkExit()
    if (typeof onExit === 'function') onExit()
  }, [inkExit, onExit])

  const pushStatus = useCallback((text, error = false) => {
    setState((prev) => ({ ...prev, items: [...prev.items.slice(-499), { kind: 'status', text, error }] }))
  }, [])

  // Global keys: esc interrupts, ctrl+t toggles thinking, ctrl+c quits,
  // up/down recall history. While a permission prompt is pending, y/n/esc
  // answer it instead.
  useInput((rawInput, key) => {
    if (pendingRef.current !== null) {
      if (rawInput === 'y' || rawInput === 'Y') return answerApproval('allowed-once')
      if (rawInput === 'n' || rawInput === 'N') return answerApproval('rejected')
      if (key.escape) return answerApproval('cancelled')
      return
    }
    if (key.ctrl && rawInput === 'c') handleExit()
    else if (key.escape && state.busy && typeof onInterrupt === 'function') onInterrupt()
    else if (key.ctrl && rawInput === 't') setThinkingOpen((v) => !v)
    else if (key.upArrow) {
      const hist = historyRef.current
      if (hist.length === 0) return
      const next = historyIdx.current < 0 ? hist.length - 1 : Math.max(0, historyIdx.current - 1)
      historyIdx.current = next
      setInput(hist[next])
    } else if (key.downArrow) {
      const hist = historyRef.current
      if (hist.length === 0 || historyIdx.current < 0) return
      const next = historyIdx.current + 1
      if (next >= hist.length) { historyIdx.current = -1; setInput('') } else { historyIdx.current = next; setInput(hist[next]) }
    }
  })

  const handleSubmit = useCallback(
    (value) => {
      const text = typeof value === 'string' ? value.trim() : ''
      if (text === '') return

      // UI-owned slash commands (usable even while a turn is running).
      if (text === '/help') { setInput(''); pushStatus(HELP_TEXT); return }
      if (text === '/clear') { setInput(''); setState(createInitialState()); return }
      if (text === '/exit' || text === '/quit') { setInput(''); handleExit(); return }
      if (text === '/status' || text === '/cost') {
        setInput('')
        const usage = state.usage ? ` · ${usageText(state.usage)}` : ''
        pushStatus(`model: ${modelLabel} · cwd: ${process.cwd()}${usage}`)
        return
      }
      if (text === '/model') {
        setInput('')
        pushStatus(`current model: ${modelLabel}\navailable: ${KNOWN_MODELS.join(', ')} (or any id)`)
        return
      }
      if (text.startsWith('/model ')) {
        const requested = text.slice('/model '.length).trim()
        setInput('')
        if (typeof onModelSwitch === 'function' && onModelSwitch(requested) === true) {
          setModelLabel(requested)
          pushStatus(`✓ switched to ${requested}`)
        } else {
          pushStatus('✗ model switch not available', true)
        }
        return
      }

      // Any other slash command delegates to the harness's native registry.
      const slash = parseSlash(text)
      if (slash !== null) {
        setInput('')
        if (typeof onCommand === 'function') {
          void Promise.resolve(onCommand(text)).catch((error) => {
            pushStatus(`✗ ${error instanceof Error ? error.message : String(error)}`, true)
          })
        } else {
          pushStatus(`unknown command: /${slash.name}`, true)
        }
        return
      }

      if (state.busy) return

      const hist = historyRef.current
      if (hist.length === 0 || hist[hist.length - 1] !== text) hist.push(text)
      historyIdx.current = -1
      setInput('')
      setState((prev) => ({ ...prev, busy: true, items: [...prev.items, { kind: 'user', text }] }))
      try {
        // Fire-and-forget: session events drive the UI, not this promise.
        agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      } catch (error) {
        setState((prev) => ({ ...prev, busy: false }))
        pushStatus(`✗ ${error instanceof Error ? error.message : String(error)}`, true)
      }
    },
    [agent, handleExit, pushStatus, state.busy, state.usage, modelLabel, onModelSwitch, onCommand],
  )

  // Rough per-item height estimates for the bottom-anchored viewport.
  const estimateLines = (item) => {
    const text = typeof item?.text === 'string' ? item.text : typeof item?.output === 'string' ? item.output : ''
    const wrapped = Math.max(1, Math.ceil(strWidth(text) / Math.max(1, width - 6)))
    switch (item.kind) {
      case 'user': return wrapped + 2
      case 'assistant': return Math.ceil(text.split('\n').length * 1.1) + (item.reasoning ? 3 : 0) + 2
      case 'tool': return 2 + (item.output ? Math.min(wrapped, OUTPUT_HEAD + OUTPUT_TAIL + 2) : 0)
      case 'divider': return 1
      default: return Math.max(1, typeof item.text === 'string' ? item.text.split('\n').length : 1)
    }
  }
  const chromeLines = (state.busy ? 1 : 0) + 1 + 1 + (pending !== null ? 2 : 0) + (state.items.length === 0 ? 1 : 0) + (state.todos.length > 0 ? 2 + state.todos.length : 0)
  const available = Math.max(6, rows - chromeLines)
  let visible = state.items
  let total = 0
  for (let i = state.items.length - 1; i >= 0; i--) {
    const h = estimateLines(state.items[i])
    if (total + h > available && i < state.items.length - 1) { visible = state.items.slice(i + 1); break }
    total += h
  }

  // Footer facts.
  const cwd = typeof process !== 'undefined' ? process.cwd() : ''
  const home = typeof process !== 'undefined' ? process.env.HOME : undefined
  const shortCwd = cwd !== '' && home && cwd.startsWith(home) ? (cwd === home ? '~' : `~${cwd.slice(home.length)}`) : cwd
  const usageLine = state.usage !== null ? usageText(state.usage) : ''

  const welcome = state.items.length === 0 && state.stream.text === '' && state.stream.reasoning === '' && state.stream.tool === null
    ? el(
        Box,
        { flexDirection: 'column', alignItems: 'center', marginTop: 1, paddingLeft: 1, paddingRight: 1 },
        el(Text, { bold: true, color: palette.accent }, 'DeepSeek Harness'),
        el(Text, { dimColor: true }, '  ·  terminal AI chat, Claude-CLI style'),
        el(Box, { borderStyle: 'single', borderColor: palette.accent, marginTop: 1, paddingLeft: 2, paddingRight: 2, flexDirection: 'column' },
          el(Box, { flexDirection: 'row' }, el(Text, { dimColor: true }, 'model     '), el(Text, { bold: true }, modelLabel)),
          el(Box, { flexDirection: 'row' }, el(Text, { dimColor: true }, 'directory '), el(Text, {}, shortCwd)),
          el(Box, { flexDirection: 'row' }, el(Text, { dimColor: true }, 'commands  '), el(Text, {}, '/help · /model · /clear · /exit'))),
        el(Text, { dimColor: true, marginTop: 1 }, 'press /help for keys · ctrl + c to quit'),
      )
    : null

  const transcript = el(
    Box,
    { flexDirection: 'column', paddingLeft: 1, paddingRight: 1 },
    el(TodoPanel, { todos: state.todos, palette }),
    welcome,
    ...visible.map((item, index) => el(ChatRow, { key: index, item, width, thinkingOpen, themeBg, palette })),
    el(StreamBlock, { key: 'stream', stream: state.stream, width, thinkingOpen, themeBg, palette }),
  )

  const statusRow = state.busy
    ? el(
        Box,
        { paddingLeft: 1, paddingRight: 1, flexDirection: 'row' },
        el(BrailleSpinner),
        el(Text, { bold: true, color: palette.accent }, ' Working'),
        el(Text, { dimColor: true }, ` ${state.turnStart !== undefined ? fmtElapsedCompact(Date.now() - state.turnStart) : ''}`),
        el(Box, { flexGrow: 1 }),
        el(Text, { dimColor: true }, 'esc interrupt'),
      )
    : null

  const inputRow = el(
    Box,
    { paddingLeft: 1, paddingRight: 1, flexDirection: 'row' },
    el(Text, { bold: true, color: palette.accent }, '> '),
    el(TextInput, { value: input, onChange: setInput, onSubmit: handleSubmit, focus: pending === null, placeholder: 'Ask anything' }),
  )

  const hintLeft = `${modelLabel} · ${shortCwd}${usageLine !== '' ? ` · ${usageLine}` : ''}`
  const hintRightParts = [thinkingOpen ? 'ctrl+t hide' : 'ctrl+t show', '↑↓ history', 'ctrl+c quit']
  const hintRow = el(
    Box,
    { paddingLeft: 1, paddingRight: 1, flexDirection: 'row' },
    el(Text, { dimColor: true }, hintLeft),
    el(Box, { flexGrow: 1 }),
    el(Text, { dimColor: true }, hintRightParts.join('   ')),
  )

  return el(
    Box,
    { flexDirection: 'column', height: '100%' },
    el(Box, { flexGrow: 1, flexDirection: 'column', overflow: 'hidden' }, transcript),
    el(ApprovalPrompt, { pending, palette }),
    statusRow,
    inputRow,
    hintRow,
  )
}

// Re-export pure helpers for tests (imported from ./utils.js).
export { wrapText, truncate, splitOutput, stripAnsi, userMessageBg, codeChipBg, markdownLines, splitCodeBlocks }
