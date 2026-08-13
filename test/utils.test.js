import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_ITEMS, MAX_TOOL_ARGS, MAX_RESULT_PREVIEW, OUTPUT_HEAD, OUTPUT_TAIL,
  isLightBg, blend, rgbToHex, hexToRgb, userMessageBg, codeChipBg,
  wcwidth, strWidth, wrapText, prefixedLines, truncate,
  stripAnsi, fmtDuration, fmtElapsedCompact, usageText, reasonText,
  blocksText, toolResultText, splitOutput, splitCodeBlocks,
} from '../src/utils.js'

describe('constants', () => {
  test('caps match the documented values', () => {
    assert.equal(MAX_ITEMS, 500)
    assert.equal(MAX_TOOL_ARGS, 160)
    assert.equal(MAX_RESULT_PREVIEW, 300)
    assert.equal(OUTPUT_HEAD, 10)
    assert.equal(OUTPUT_TAIL, 6)
  })
})

describe('color utilities', () => {
  test('isLightBg uses luma', () => {
    assert.equal(isLightBg([0, 0, 0]), false)
    assert.equal(isLightBg([255, 255, 255]), true)
    assert.equal(isLightBg([128, 128, 128]), false)
    assert.equal(isLightBg([129, 129, 129]), true)
  })

  test('blend mixes fg over bg', () => {
    assert.deepEqual(blend([255, 255, 255], [0, 0, 0], 0.5), [128, 128, 128])
    assert.deepEqual(blend([0, 0, 0], [255, 255, 255], 0), [255, 255, 255])
    assert.deepEqual(blend([255, 0, 0], [0, 0, 0], 1), [255, 0, 0])
  })

  test('rgbToHex formats and pads', () => {
    assert.equal(rgbToHex([255, 0, 0]), '#ff0000')
    assert.equal(rgbToHex([0, 15, 255]), '#000fff')
  })

  test('hexToRgb parses 6-digit hex and falls back to black', () => {
    assert.deepEqual(hexToRgb('#ff0000'), [255, 0, 0])
    assert.deepEqual(hexToRgb('FF0000'), [255, 0, 0])
    assert.deepEqual(hexToRgb('ff0000'), [255, 0, 0])
    assert.deepEqual(hexToRgb('#abc'), [0, 0, 0])
    assert.deepEqual(hexToRgb(null), [0, 0, 0])
    assert.deepEqual(hexToRgb('invalid'), [0, 0, 0])
  })

  test('userMessageBg blends from the background', () => {
    assert.equal(userMessageBg('#000000'), '#1f1f1f')
    assert.equal(userMessageBg('#ffffff'), '#f5f5f5')
    assert.equal(userMessageBg(null), '#1f1f1f')
    assert.equal(userMessageBg('invalid'), '#1f1f1f')
  })

  test('codeChipBg blends from the background', () => {
    assert.equal(codeChipBg('#000000'), '#383838')
    assert.equal(codeChipBg('#ffffff'), '#ebebeb')
    assert.equal(codeChipBg(null), '#383838')
  })
})

describe('wcwidth', () => {
  test('ASCII is width 1', () => assert.equal(wcwidth('a'), 1))
  test('CJK ideographs are width 2', () => assert.equal(wcwidth('你'), 2))
  test('fullwidth forms are width 2', () => {
    assert.equal(wcwidth('Ａ'), 2)
    assert.equal(wcwidth('！'), 2)
  })
  test('CJK Extension B is width 2', () => assert.equal(wcwidth('𠀀'), 2))
  test('combining marks are width 0', () => assert.equal(wcwidth('́'), 0))
  test('variation selectors and ZWJ are width 0', () => {
    assert.equal(wcwidth('️'), 0)
    assert.equal(wcwidth('‍'), 0)
  })
  test('skin-tone modifiers are width 0', () => assert.equal(wcwidth('🏽'), 0))
  test('emoji pictographs are width 2', () => assert.equal(wcwidth('😀'), 2))
})

describe('strWidth', () => {
  test('plain ASCII', () => assert.equal(strWidth('hello'), 5))
  test('CJK text is 2 columns per char', () => {
    assert.equal(strWidth('你好'), 4)
    assert.equal(strWidth('你好a'), 5)
  })
  test('combining marks add zero', () => assert.equal(strWidth('é'), 1))
  test('single emoji is 2 columns', () => assert.equal(strWidth('😀'), 2))
  test('skin-tone emoji is 2 columns', () => assert.equal(strWidth('👍🏽'), 2))
  test('VS16 heart is 2 columns', () => assert.equal(strWidth('❤️'), 2))
  test('ZWJ family emoji is 2 columns', () => assert.equal(strWidth('👨‍👩‍👧‍👦'), 2))
  test('flag emoji is 2 columns', () => assert.equal(strWidth('🇨🇳'), 2))
  test('keycap emoji is 2 columns', () => assert.equal(strWidth('1️⃣'), 2))
  test('fullwidth and CJK mix', () => assert.equal(strWidth('Ａ你'), 4))
  test('empty string is 0', () => assert.equal(strWidth(''), 0))
})

describe('wrapText', () => {
  test('short string returns a single line', () => {
    assert.deepEqual(wrapText('hello', 10), ['hello'])
  })
  test('splits long string at width boundary', () => {
    const result = wrapText('hello world', 5)
    assert.equal(result[0], 'hello')
    assert.equal(result.join(''), 'hello world')
  })
  test('newlines split into separate lines', () => {
    assert.deepEqual(wrapText('a\nb', 10), ['a', 'b'])
  })
  test('CJK wraps at 2-column boundaries', () => {
    assert.deepEqual(wrapText('你好世界', 4), ['你好', '世界'])
    assert.deepEqual(wrapText('你好世界', 6), ['你好世', '界'])
  })
  test('emoji clusters are not split mid-glyph', () => {
    assert.deepEqual(wrapText('😀😀😀', 4), ['😀😀', '😀'])
    const lines = wrapText('a👨‍👩‍👧‍👦bc', 4)
    assert.deepEqual(lines, ['a👨‍👩‍👧‍👦b', 'c'])
    assert.ok(lines[0].includes('👨‍👩‍👧‍👦'))
  })
  test('empty string returns one empty line', () => {
    assert.deepEqual(wrapText('', 10), [''])
  })
})

describe('prefixedLines', () => {
  test('prefixes first line and indents the rest', () => {
    assert.deepEqual(prefixedLines('abc\ndef', 80, '> ', 2), ['> abc', '  def'])
  })
  test('single line only gets the prefix', () => {
    assert.deepEqual(prefixedLines('hello', 80, '• '), ['• hello'])
  })
})

describe('truncate', () => {
  test('no truncation when within max', () => assert.equal(truncate('hello', 10), 'hello'))
  test('truncates with ellipsis', () => assert.equal(truncate('hello', 3), 'he…'))
  test('CJK truncation respects display width', () => assert.equal(truncate('你好', 3), '你…'))
  test('emoji truncation does not split a cluster', () => assert.equal(truncate('😀😀', 3), '😀…'))
  test('non-string input returns empty', () => {
    assert.equal(truncate(null, 5), '')
    assert.equal(truncate(123, 5), '')
  })
})

describe('stripAnsi', () => {
  test('removes CSI color codes', () => {
    assert.equal(stripAnsi('\x1b[31mred\x1b[0m'), 'red')
  })
  test('removes OSC sequences with ST terminator', () => {
    assert.equal(stripAnsi('\x1b]11;rgb:1/2/3\x1b\\'), '')
  })
  test('removes OSC sequences with BEL terminator', () => {
    assert.equal(stripAnsi('\x1b]0;title\x07'), '')
  })
  test('removes screen-control CSI', () => {
    assert.equal(stripAnsi('\x1b[2J\x1b[H'), '')
  })
  test('plain text passes through unchanged', () => {
    assert.equal(stripAnsi('hello'), 'hello')
  })
  test('mixed escapes and text', () => {
    assert.equal(stripAnsi('\x1b[1mbold\x1b[0m text'), 'bold text')
  })
})

describe('time formatting', () => {
  test('fmtDuration uses tenths under 10s', () => {
    assert.equal(fmtDuration(500), '0.5s')
    assert.equal(fmtDuration(1500), '1.5s')
  })
  test('fmtDuration rounds whole seconds at 10s+', () => {
    assert.equal(fmtDuration(10000), '10s')
    assert.equal(fmtDuration(15000), '15s')
  })
  test('fmtElapsedCompact', () => {
    assert.equal(fmtElapsedCompact(0), '0s')
    assert.equal(fmtElapsedCompact(59000), '59s')
    assert.equal(fmtElapsedCompact(62000), '1m 02s')
    assert.equal(fmtElapsedCompact(3723000), '1h 02m 03s')
  })
})

describe('usageText', () => {
  test('empty/missing usage', () => {
    assert.equal(usageText(null), '')
    assert.equal(usageText({}), '')
  })
  test('input and output tokens', () => {
    assert.equal(usageText({ inputTokens: 10, outputTokens: 20 }), 'usage: 10in 20out')
  })
  test('includes cache read tokens', () => {
    assert.equal(usageText({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 5 }), 'usage: 10in 20out 5cache')
  })
  test('cache only', () => {
    assert.equal(usageText({ cacheReadTokens: 3 }), 'usage: 3cache')
  })
})

describe('reasonText', () => {
  test('missing reason', () => assert.equal(reasonText(null), 'ended'))
  test('completed', () => assert.equal(reasonText({ kind: 'completed' }), '✓ completed'))
  test('error with code and message', () => {
    assert.equal(reasonText({ kind: 'error', error: { code: 'E1', message: 'boom' } }), '✗ error: E1 boom')
  })
  test('aborted', () => assert.equal(reasonText({ kind: 'aborted' }), '⏹ aborted'))
  test('max-tokens', () => assert.equal(reasonText({ kind: 'max-tokens' }), '⚠ max-tokens'))
  test('unknown kind', () => assert.equal(reasonText({ kind: 'mystery' }), 'mystery'))
})

describe('blocksText', () => {
  test('joins text blocks of the requested type', () => {
    assert.equal(
      blocksText([{ type: 'text', text: 'a' }, { type: 'thinking', text: 'x' }, { type: 'text', text: 'b' }], 'text'),
      'ab',
    )
  })
  test('non-array and missing fields return empty', () => {
    assert.equal(blocksText(null, 'text'), '')
    assert.equal(blocksText('nope', 'text'), '')
    assert.equal(blocksText([{ type: 'text' }], 'text'), '')
  })
})

describe('toolResultText', () => {
  test('missing message returns empty', () => assert.equal(toolResultText(null), ''))
  test('direct text block', () => {
    assert.equal(toolResultText({ content: [{ type: 'text', text: 'hello' }] }), 'hello')
  })
  test('nested tool-result inner text', () => {
    assert.equal(toolResultText({ content: [{ type: 'tool-result', content: [{ type: 'text', text: 'inner' }] }] }), 'inner')
  })
  test('mixed blocks join with newlines', () => {
    assert.equal(
      toolResultText({ content: [{ type: 'text', text: 'a' }, { type: 'tool-result', content: [{ type: 'text', text: 'b' }] }] }),
      'a\nb',
    )
  })
})

describe('splitOutput', () => {
  test('null/empty returns null', () => {
    assert.equal(splitOutput(null), null)
    assert.equal(splitOutput(''), null)
  })
  test('short output returns all lines', () => {
    assert.deepEqual(splitOutput('a\nb\nc'), { lines: ['a', 'b', 'c'], omitted: 0 })
  })
  test('normalizes CRLF', () => {
    assert.deepEqual(splitOutput('a\r\nb'), { lines: ['a', 'b'], omitted: 0 })
  })
  test('strips ANSI before splitting', () => {
    assert.deepEqual(splitOutput('\x1b[31mred\x1b[0m'), { lines: ['red'], omitted: 0 })
  })
  test('long output keeps head + tail and counts omissions', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${String(i + 1).padStart(2, '0')}`)
    const result = splitOutput(lines.join('\n'))
    assert.equal(result.lines.length, OUTPUT_HEAD + OUTPUT_TAIL)
    assert.equal(result.lines[0], 'line01')
    assert.equal(result.lines[9], 'line10')
    assert.equal(result.lines[10], 'line15')
    assert.equal(result.lines[15], 'line20')
    assert.equal(result.omitted, 4)
  })
})

describe('splitCodeBlocks', () => {
  test('plain text returns a single text block', () => {
    assert.deepEqual(splitCodeBlocks('hello world'), [{ type: 'text', content: 'hello world' }])
  })
  test('single fenced block returns one code block', () => {
    const input = '```js\nconsole.log(1)\n```'
    assert.deepEqual(splitCodeBlocks(input), [{ type: 'code', content: input }])
  })
  test('text before and after a fence yields three blocks', () => {
    assert.deepEqual(splitCodeBlocks('before\n```\ncode\n```\nafter'), [
      { type: 'text', content: 'before' },
      { type: 'code', content: '```\ncode\n```' },
      { type: 'text', content: 'after' },
    ])
  })
  test('multiple code blocks separated by text', () => {
    assert.deepEqual(splitCodeBlocks('```\na\n```\nmid\n```\nb\n```'), [
      { type: 'code', content: '```\na\n```' },
      { type: 'text', content: 'mid' },
      { type: 'code', content: '```\nb\n```' },
    ])
  })
  test('empty string returns one empty text block', () => {
    assert.deepEqual(splitCodeBlocks(''), [{ type: 'text', content: '' }])
  })
  test('unclosed fence is treated as a code block', () => {
    const input = '```\nhello'
    assert.deepEqual(splitCodeBlocks(input), [{ type: 'code', content: input }])
  })
})
