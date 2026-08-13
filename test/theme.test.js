import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { makePalette, probeTerminalBg } from '../src/theme.js'

const HEX = /^#[0-9a-f]{6}$/i
const luma = (hex) => {
  const [, r, g, b] = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  return 0.299 * parseInt(r, 16) + 0.587 * parseInt(g, 16) + 0.114 * parseInt(b, 16)
}

describe('makePalette', () => {
  const dark = makePalette('#1e1e1e')
  const light = makePalette('#ffffff')

  test('returns all eight semantic tokens', () => {
    assert.deepEqual(Object.keys(dark).sort(), [
      'accent', 'codeBg', 'dim', 'error', 'success', 'thinking', 'userBg', 'userFg',
    ])
  })

  test('every token is a valid hex color', () => {
    for (const palette of [dark, light]) {
      for (const [key, value] of Object.entries(palette)) {
        assert.match(value, HEX, `${key} should be a hex color`)
      }
    }
  })

  test('tokens are pairwise distinct', () => {
    assert.equal(new Set(Object.values(dark)).size, 8)
    assert.equal(new Set(Object.values(light)).size, 8)
  })

  test('accent is lighter on a dark background than on a light one', () => {
    assert.ok(luma(dark.accent) > luma(light.accent))
  })

  test('userBg and codeBg differ between dark and light backgrounds', () => {
    assert.notEqual(dark.userBg, light.userBg)
    assert.notEqual(dark.codeBg, light.codeBg)
  })

  test('null background falls back to a dark palette', () => {
    const p = makePalette(null)
    assert.deepEqual(p, makePalette('#000000'))
    assert.equal(p.userBg, '#1f1f1f')
    assert.equal(p.codeBg, '#383838')
  })
})

describe('probeTerminalBg', () => {
  const envSave = process.env.DSH_TUI_BG
  const restoreEnv = () => {
    if (envSave === undefined) delete process.env.DSH_TUI_BG
    else process.env.DSH_TUI_BG = envSave
  }

  /** Shadow `isTTY` to false on the real streams; returns a restore fn. */
  const stubNonTty = () => {
    const restores = []
    for (const stream of [process.stdin, process.stdout]) {
      if (!stream || typeof stream !== 'object') continue
      const own = Object.getOwnPropertyDescriptor(stream, 'isTTY')
      try {
        Object.defineProperty(stream, 'isTTY', { value: false, configurable: true })
      } catch {
        continue
      }
      restores.push(() => {
        if (own) Object.defineProperty(stream, 'isTTY', own)
        else delete stream.isTTY
      })
    }
    return () => restores.forEach((r) => r())
  }

  test('honors DSH_TUI_BG with a leading #', async () => {
    process.env.DSH_TUI_BG = '#abcdef'
    try {
      assert.equal(await probeTerminalBg(), '#abcdef')
    } finally {
      restoreEnv()
    }
  })

  test('normalizes DSH_TUI_BG without a leading #', async () => {
    process.env.DSH_TUI_BG = '123456'
    try {
      assert.equal(await probeTerminalBg(), '#123456')
    } finally {
      restoreEnv()
    }
  })

  test('returns null for an invalid DSH_TUI_BG', async () => {
    process.env.DSH_TUI_BG = 'not-a-color'
    try {
      assert.equal(await probeTerminalBg(), null)
    } finally {
      restoreEnv()
    }
  })

  test('returns null when stdin/stdout are not TTYs', async () => {
    delete process.env.DSH_TUI_BG
    const restoreStreams = stubNonTty()
    try {
      assert.equal(await probeTerminalBg(), null)
    } finally {
      restoreStreams()
      restoreEnv()
    }
  })
})
