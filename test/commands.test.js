import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCliArgs,
  parseSlash,
  SLASH_COMMANDS,
  HELP_TEXT,
  CLI_HELP_TEXT,
} from '../src/commands.js';

test('parseCliArgs: empty args', () => {
  assert.deepEqual(parseCliArgs([]), {
    help: false,
    version: false,
    listSessions: false,
    unknown: [],
  });
});

test('parseCliArgs: --help / -h', () => {
  assert.equal(parseCliArgs(['--help']).help, true);
  assert.equal(parseCliArgs(['-h']).help, true);
});

test('parseCliArgs: --version / -V', () => {
  assert.equal(parseCliArgs(['--version']).version, true);
  assert.equal(parseCliArgs(['-V']).version, true);
});

test('parseCliArgs: --list-sessions / --ls', () => {
  assert.equal(parseCliArgs(['--list-sessions']).listSessions, true);
  assert.equal(parseCliArgs(['--ls']).listSessions, true);
});

test('parseCliArgs: --resume <id>', () => {
  assert.equal(parseCliArgs(['--resume', 'abc123']).resume, 'abc123');
});

test('parseCliArgs: --resume=<id>', () => {
  assert.equal(parseCliArgs(['--resume=abc123']).resume, 'abc123');
});

test('parseCliArgs: --continue / -c maps to __last__', () => {
  assert.equal(parseCliArgs(['--continue']).resume, '__last__');
  assert.equal(parseCliArgs(['-c']).resume, '__last__');
});

test('parseCliArgs: --model <name> / -m <name> / --model=<name>', () => {
  assert.equal(parseCliArgs(['--model', 'deepseek-v4-pro']).model, 'deepseek-v4-pro');
  assert.equal(parseCliArgs(['-m', 'deepseek-v4-pro']).model, 'deepseek-v4-pro');
  assert.equal(parseCliArgs(['--model=deepseek-v4-pro']).model, 'deepseek-v4-pro');
});

test('parseCliArgs: `--` makes everything after positional', () => {
  assert.deepEqual(parseCliArgs(['--', 'a', '--b', '-c']).unknown, ['a', '--b', '-c']);
});

test('parseCliArgs: `--resume` with missing value becomes __last__', () => {
  assert.equal(parseCliArgs(['--resume']).resume, '__last__');
  // Followed by a flag: does not consume the flag and still resumes last.
  assert.equal(parseCliArgs(['--resume', '--help']).resume, '__last__');
  assert.equal(parseCliArgs(['--resume', '--help']).help, true);
});

test('parseCliArgs: unknown args are collected', () => {
  assert.deepEqual(parseCliArgs(['foo', '--bogus', '-x']).unknown, [
    'foo',
    '--bogus',
    '-x',
  ]);
});

test('parseSlash: bare `/` and non-slash text return null', () => {
  assert.equal(parseSlash('/'), null);
  assert.equal(parseSlash('  '), null);
  assert.equal(parseSlash(''), null);
  assert.equal(parseSlash('hello world'), null);
  assert.equal(parseSlash('not a command'), null);
});

test('parseSlash: bare /model', () => {
  assert.deepEqual(parseSlash('/model'), { name: 'model', arg: '' });
});

test('parseSlash: /model with an argument', () => {
  assert.deepEqual(parseSlash('/model deepseek-v4-pro'), {
    name: 'model',
    arg: 'deepseek-v4-pro',
  });
});

test('parseSlash: /model with multiple words', () => {
  assert.deepEqual(parseSlash('/model x y'), { name: 'model', arg: 'x y' });
});

test('parseSlash: leading whitespace is tolerated', () => {
  assert.deepEqual(parseSlash('   /help   extra  '), { name: 'help', arg: 'extra' });
});

test('parseSlash: name is lowercased', () => {
  assert.deepEqual(parseSlash('/MODEL foo'), { name: 'model', arg: 'foo' });
});

test('SLASH_COMMANDS: names are unique and non-empty', () => {
  const names = SLASH_COMMANDS.map((c) => c.name);
  assert.equal(new Set(names).size, names.length, 'names must be unique');
  for (const name of names) {
    assert.equal(typeof name, 'string');
    assert.ok(name.length > 0, 'name must be non-empty');
  }
});

test('SLASH_COMMANDS: includes the required command set', () => {
  const names = new Set(SLASH_COMMANDS.map((c) => c.name));
  for (const required of ['help', 'clear', 'model', 'resume', 'status', 'cost', 'compact', 'exit']) {
    assert.ok(names.has(required), `missing command: ${required}`);
  }
});

test('SLASH_COMMANDS: every entry has a short description', () => {
  for (const cmd of SLASH_COMMANDS) {
    assert.equal(typeof cmd.description, 'string');
    assert.ok(cmd.description.length > 0, `description missing for /${cmd.name}`);
  }
});

test('HELP_TEXT and CLI_HELP_TEXT are non-empty and document the flags', () => {
  assert.equal(typeof HELP_TEXT, 'string');
  assert.ok(HELP_TEXT.length > 0);
  assert.equal(typeof CLI_HELP_TEXT, 'string');
  assert.ok(CLI_HELP_TEXT.length > 0);
  assert.ok(CLI_HELP_TEXT.includes('--resume'));
  assert.ok(CLI_HELP_TEXT.includes('--model'));
  assert.ok(CLI_HELP_TEXT.includes('--list-sessions'));
});
