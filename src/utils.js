/**
 * Pure utility functions for dsh-tui — no React/Ink dependencies.
 *
 * Width helpers are CJK- and emoji-aware (Chinese users): CJK/fullwidth
 * characters count 2 columns, combining marks 0, and an emoji cluster
 * (ZWJ joins, skin tones, VS16, keycaps, flags) counts as a single 2-column
 * glyph so wrapping never slices an emoji in half.
 */

// ── Caps ──────────────────────────────────────────────────────────────────

/** Max transcript rows kept in the live viewport. */
export const MAX_ITEMS = 500
/** Max chars shown for a folded tool call's arguments. */
export const MAX_TOOL_ARGS = 160
/** Max chars kept when previewing a tool result. */
export const MAX_RESULT_PREVIEW = 300
/** First output lines kept per tool result. */
export const OUTPUT_HEAD = 10
/** Last output lines kept per tool result. */
export const OUTPUT_TAIL = 6

// ── Color utilities ───────────────────────────────────────────────────────

/** True when an [r,g,b] triplet reads as light (luma > 128). */
export const isLightBg = (rgb) => 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] > 128

/** Linear mix of `fg` over `bg`; `alpha` 1 → fg, 0 → bg. Returns [r,g,b]. */
export const blend = (fg, bg, alpha) => [
  Math.round(fg[0] * alpha + bg[0] * (1 - alpha)),
  Math.round(fg[1] * alpha + bg[1] * (1 - alpha)),
  Math.round(fg[2] * alpha + bg[2] * (1 - alpha)),
]

/** Format an [r,g,b] triplet as `#rrggbb`. */
export const rgbToHex = ([r, g, b]) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`

/** Parse `#rrggbb` (leading `#` optional); returns [0,0,0] for anything else. */
export const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '')
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0]
}

/** Faint block behind user messages, blended from the background. */
export const userMessageBg = (bgHex) => {
  const rgb = hexToRgb(bgHex)
  const light = isLightBg(rgb)
  return rgbToHex(blend(light ? [0, 0, 0] : [255, 255, 255], rgb, light ? 0.04 : 0.12))
}

/** Slightly stronger chip behind inline code, blended from the background. */
export const codeChipBg = (bgHex) => {
  const rgb = hexToRgb(bgHex)
  const light = isLightBg(rgb)
  return rgbToHex(blend(light ? [0, 0, 0] : [255, 255, 255], rgb, light ? 0.08 : 0.22))
}

// ── Width helpers (CJK + emoji aware) ─────────────────────────────────────

// Zero-width: combining marks, variation selectors (incl. VS16/FE0F), ZWJ,
// and emoji skin-tone modifiers.
const ZERO_RE = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯︀-️‍\u{1f3fb}-\u{1f3ff}]/u
// Wide (2 columns): CJK (+ Ext B–H), fullwidth forms, Hangul, emoji pictographs.
// Regional indicators are excluded here: each is 1 col, so a flag pair = 2.
const WIDE_RE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1f300}-\u{1faff}\u{20000}-\u{2fa1f}\u{30000}-\u{323af}]/u

/** Display width of a single code point: 0 (combining), 2 (wide), else 1. */
export function wcwidth(ch) {
  if (ZERO_RE.test(ch)) return 0
  return WIDE_RE.test(ch) ? 2 : 1
}

// One rendered emoji glyph: ZWJ joins, skin tones, VS16, keycaps, flag pairs.
const CELL_RE = /(\p{Extended_Pictographic}(?:️|\u{1F3FB}-\u{1F3FF})?(?:‍\p{Extended_Pictographic}(?:️|\u{1F3FB}-\u{1F3FF})?)*|(?:\u{1F1E6}-\u{1F1FF}){2}|[0-9#*]️?⃣)|[\s\S]/gu

/** Yield `[segment, width]`; an emoji cluster is one 2-column segment. */
function* segments(text) {
  for (const m of String(text).matchAll(CELL_RE)) {
    yield m[1] !== undefined ? [m[0], 2] : [m[0], wcwidth(m[0])]
  }
}

/** Display width of a string in columns (CJK = 2, emoji clusters = 2). */
export function strWidth(text) {
  let w = 0
  for (const [, segW] of segments(text)) w += segW
  return w
}

// ── Text wrapping ─────────────────────────────────────────────────────────

/**
 * Wrap `text` to `width` columns; returns an array of lines. Newlines split
 * first; emoji clusters are never split mid-glyph.
 */
export function wrapText(text, width) {
  if (width < 4) return [String(text)]
  const parts = String(text).split('\n')
  if (parts[parts.length - 1] === '') parts.pop()
  const lines = []
  for (const part of parts) {
    if (part === '') {
      lines.push('')
      continue
    }
    let cur = ''
    let curW = 0
    for (const [seg, segW] of segments(part)) {
      if (curW + segW > width && cur !== '') {
        lines.push(cur)
        cur = ''
        curW = 0
      }
      cur += seg
      curW += segW
    }
    if (cur !== '') lines.push(cur)
  }
  return lines.length === 0 ? [''] : lines
}

/**
 * Wrap and prefix: first line gets `prefix`, subsequent lines get `indent`
 * spaces — the aligned-message look.
 */
export function prefixedLines(text, width, prefix, indent = 2) {
  const pad = ' '.repeat(indent)
  const avail = Math.max(1, width - indent)
  const lines = wrapText(text, avail)
  if (lines.length === 0) return [prefix]
  return [prefix + lines[0], ...lines.slice(1).map((line) => pad + line)]
}

/** Clip a string to `max` columns with an ellipsis (never splits CJK/emoji). */
export function truncate(text, max) {
  if (typeof text !== 'string') return ''
  if (strWidth(text) <= max) return text
  let out = ''
  let w = 0
  for (const [seg, segW] of segments(text)) {
    if (w + segW > max - 1) break
    out += seg
    w += segW
  }
  return `${out}…`
}

// ── ANSI stripping ────────────────────────────────────────────────────────

/** Strip CSI/OSC escape sequences so raw tool bytes cannot repaint the TUI. */
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
export function stripAnsi(text) {
  return String(text).replace(ANSI_RE, '')
}

// ── Time formatting ───────────────────────────────────────────────────────

/** Format milliseconds as seconds (`0.5s`, `10s`). */
export function fmtDuration(ms) {
  const sec = Math.max(0, ms) / 1000
  return sec < 10 ? `${sec.toFixed(1)}s` : `${Math.round(sec)}s`
}

/** Compact elapsed: `0s`, `59s`, `1m 02s`, `1h 02m 03s`. */
export function fmtElapsedCompact(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

// ── Token usage ───────────────────────────────────────────────────────────

/** Compact token-usage line (`usage: 12in 34out 5cache`); omits missing fields. */
export function usageText(usage) {
  if (!usage || typeof usage !== 'object') return ''
  const parts = []
  if (typeof usage.inputTokens === 'number') parts.push(`${usage.inputTokens}in`)
  if (typeof usage.outputTokens === 'number') parts.push(`${usage.outputTokens}out`)
  if (typeof usage.cacheReadTokens === 'number') parts.push(`${usage.cacheReadTokens}cache`)
  return parts.length > 0 ? `usage: ${parts.join(' ')}` : ''
}

// ── Turn reason ───────────────────────────────────────────────────────────

/** Human label for a turn-end reason (`✓ completed`, `✗ error: …`, …). */
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

// ── Content extraction ────────────────────────────────────────────────────

/** Join the text of every block of one `type` in a message content array. */
export function blocksText(content, type) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block && typeof block === 'object' && block.type === type && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

/** First text found in a tool-result message (nested inner blocks included). */
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

// ── Output truncation ─────────────────────────────────────────────────────

/** Cap tool output to head + tail lines (`{ lines, omitted }`), or null. */
export function splitOutput(text) {
  if (typeof text !== 'string' || text === '') return null
  const clean = stripAnsi(text).replace(/\r\n?/g, '\n')
  const capped = truncate(clean, MAX_RESULT_PREVIEW)
  const lines = capped.split('\n')
  if (lines.length <= OUTPUT_HEAD + OUTPUT_TAIL) return { lines, omitted: 0 }
  return {
    lines: [...lines.slice(0, OUTPUT_HEAD), ...lines.slice(-OUTPUT_TAIL)],
    omitted: lines.length - OUTPUT_HEAD - OUTPUT_TAIL,
  }
}

// ── Markdown block splitting ──────────────────────────────────────────────

/** Split text into fenced code blocks and plain segments. */
export function splitCodeBlocks(text) {
  const src = text == null ? '' : String(text)
  if (src === '') return [{ type: 'text', content: '' }]
  const blocks = []
  const fence = /```[\s\S]*?```/g
  let last = 0
  let match
  while ((match = fence.exec(src)) !== null) {
    if (match.index > last) {
      const content = src.slice(last, match.index).replace(/^\n+|\n+$/g, '')
      if (content !== '') blocks.push({ type: 'text', content })
    }
    blocks.push({ type: 'code', content: match[0] })
    last = match.index + match[0].length
  }
  // Remaining text after the last fence (or the whole string if no fence).
  if (last < src.length) {
    const remaining = src.slice(last)
    // An unclosed fence is treated as a code block.
    if (remaining.startsWith('```')) {
      blocks.push({ type: 'code', content: remaining })
    } else {
      const content = remaining.replace(/^\n+|\n+$/g, '')
      if (content !== '') blocks.push({ type: 'text', content })
    }
  }
  return blocks
}
