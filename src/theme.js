/**
 * Terminal background probing (OSC 11) + Claude-style semantic palette.
 *
 * probeTerminalBg MUST run before Ink mounts: Ink's key parser would read the
 * OSC response bytes as keystrokes and type `]11;rgb:...` into the composer.
 */

import { blend, codeChipBg, hexToRgb, isLightBg, rgbToHex, userMessageBg } from './utils.js'

// ── Background probe (OSC 11) ─────────────────────────────────────────────

const HEX_RE = /^#?[0-9a-f]{6}$/i

/**
 * Resolve the terminal background hex (e.g. `#1e1e1e`), or `null` when unknown.
 * Honors the `DSH_TUI_BG` override; returns `null` on non-TTY or timeout.
 */
export function probeTerminalBg(timeoutMs = 300) {
  const forced = process.env.DSH_TUI_BG
  if (forced) {
    const v = forced.trim()
    return Promise.resolve(HEX_RE.test(v) ? rgbToHex(hexToRgb(v)) : null)
  }
  return new Promise((resolve) => {
    const stdin = process.stdin
    const stdout = process.stdout
    if (!stdin || !stdout || !stdin.isTTY || !stdout.isTTY) {
      resolve(null)
      return
    }
    let settled = false
    let buffer = ''
    const finish = (hex) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stdin.off('data', onData)
      try {
        stdin.setRawMode(false)
      } catch {}
      resolve(hex)
    }
    // Terminator (ST `\x1b\\` or BEL `\x07`) is part of the match so the
    // response's tail bytes never reach Ink's key parser as a stray ESC.
    const OSC11_RE = /\x1b\]11;rgb:([0-9a-f]{2,4})\/([0-9a-f]{2,4})\/([0-9a-f]{2,4})(?:\x1b\\|\x07)/i
    const onData = (chunk) => {
      buffer += chunk.toString()
      const match = buffer.match(OSC11_RE)
      if (match) {
        // OSC 11 carries 16-bit (4-digit) channels; the high byte IS the
        // 8-bit conversion. 2-digit values pass through unchanged.
        const scale = (v) => Math.min(255, parseInt(v.slice(0, 2), 16))
        finish(rgbToHex([scale(match[1]), scale(match[2]), scale(match[3])]))
      } else if (buffer.length > 80) {
        finish(null)
      }
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    try {
      stdin.setRawMode(true)
      stdin.resume()
    } catch {
      finish(null)
      return
    }
    stdin.on('data', onData)
    try {
      stdout.write('\x1b]11;?\x1b\\')
    } catch {
      finish(null)
    }
  })
}

// ── Semantic palette ───────────────────────────────────────────────────────

/** Claude Code accent — warm terracotta orange. */
const ACCENT_BASE = [217, 119, 87]    // #D97757
const SUCCESS_BASE = [90, 168, 91]    // green
const ERROR_BASE = [224, 108, 117]    // red
const THINKING_BASE = [167, 139, 250] // muted violet

/**
 * Adapt a semantic hue to the terminal: lighten toward white on dark
 * backgrounds, darken toward black on light ones, so final text colors are
 * derived from the background, never hardcoded.
 */
const textOn = (base, light) =>
  rgbToHex(blend(light ? [0, 0, 0] : [255, 255, 255], base, light ? 0.22 : 0.24))

/**
 * Derive the full semantic palette from a terminal background hex.
 * A null/invalid `bgHex` falls back to a dark-theme palette.
 *
 * Tokens:
 * - `accent`   — terracotta: prompt, active marker, user-message accent
 * - `success`  — green: ✓ and successful tool results
 * - `error`    — red: ✗ and errors
 * - `dim`      — gray derived from the background: secondary text
 * - `thinking` — muted violet: reasoning trace
 * - `userBg`   — faint tint behind user messages
 * - `codeBg`   — chip behind inline code
 * - `userFg`   — high-contrast user-message text color
 */
export function makePalette(bgHex) {
  const bg = hexToRgb(bgHex)
  const light = isLightBg(bg)
  return {
    accent: textOn(ACCENT_BASE, light),
    success: textOn(SUCCESS_BASE, light),
    error: textOn(ERROR_BASE, light),
    dim: rgbToHex(blend(light ? [0, 0, 0] : [255, 255, 255], bg, light ? 0.35 : 0.45)),
    thinking: textOn(THINKING_BASE, light),
    userBg: userMessageBg(bgHex),
    codeBg: codeChipBg(bgHex),
    userFg: rgbToHex(blend(light ? [0, 0, 0] : [255, 255, 255], bg, light ? 0.9 : 0.92)),
  }
}
