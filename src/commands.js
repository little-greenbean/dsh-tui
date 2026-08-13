/**
 * Pure parsing + command metadata for dsh-tui.
 *
 * No React/Ink, no side effects, no event loop. The launcher forwards every
 * argument after its own flags verbatim via `ctx.cmdlineArgs.args`; the TUI
 * parses those here, and also uses these helpers for `/slash` commands typed
 * in the composer.
 */

/**
 * @typedef {object} CliArgs
 * @property {string} [resume] Session id to resume, or `'__last__'` for `--continue`.
 * @property {string} [model] Model name requested on the command line.
 * @property {boolean} help `--help` / `-h` was passed.
 * @property {boolean} version `--version` / `-V` was passed.
 * @property {boolean} listSessions `--list-sessions` / `--ls` was passed.
 * @property {string[]} unknown Unrecognized or positional arguments.
 */

const FLAG = /^--[^=]+=.*$/;

/**
 * Parse the CLI flags the launcher forwards to the plugin.
 *
 * @param {string[]} args
 * @returns {CliArgs}
 */
export function parseCliArgs(args) {
  const result = { help: false, version: false, listSessions: false, unknown: [] };

  // Reads the value for a space-separated option form (e.g. `--model foo`).
  // Returns the value and whether the next token was consumed. A next token
  // that is missing or starts with `-` is treated as "no value".
  const readValue = (i) => {
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith('-')) {
      return { value: next, consumed: true };
    }
    return { value: undefined, consumed: false };
  };

  let positional = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    // Everything after `--` is positional.
    if (positional) {
      result.unknown.push(arg);
      continue;
    }
    if (arg === '--') {
      positional = true;
      continue;
    }

    // `--flag=value` forms.
    if (FLAG.test(arg)) {
      const eq = arg.indexOf('=');
      const flag = arg.slice(0, eq);
      const value = arg.slice(eq + 1);
      if (flag === '--resume') result.resume = value;
      else if (flag === '--model') result.model = value;
      else result.unknown.push(arg);
      continue;
    }

    switch (arg) {
      case '--help':
      case '-h':
        result.help = true;
        break;
      case '--version':
      case '-V':
        result.version = true;
        break;
      case '--list-sessions':
      case '--ls':
        result.listSessions = true;
        break;
      case '--continue':
      case '-c':
        result.resume = '__last__';
        break;
      case '--resume': {
        // `--resume` with no following value means "resume the last session".
        const { value, consumed } = readValue(i);
        result.resume = value ?? '__last__';
        if (consumed) i += 1;
        break;
      }
      case '--model':
      case '-m': {
        const { value, consumed } = readValue(i);
        if (consumed) {
          result.model = value;
          i += 1;
        }
        break;
      }
      default:
        result.unknown.push(arg);
    }
  }

  return result;
}

/**
 * Parse a single line typed in the composer as a slash command.
 *
 * @param {string} line
 * @returns {{ name: string, arg: string } | null} `null` when the line is not
 *   a slash command (or is a bare `/`). `name` is the first whitespace-separated
 *   token (lowercased); `arg` is the remainder, trimmed.
 */
export function parseSlash(line) {
  if (typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed.startsWith('/')) return null;

  const body = trimmed.slice(1).trimStart();
  if (body === '') return null;

  const match = body.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  return { name: match[1].toLowerCase(), arg: (match[2] ?? '').trim() };
}

/**
 * Metadata for the slash commands the TUI handles itself (UI-only).
 * @type {{ name: string, argHint?: string, description: string }[]}
 */
export const SLASH_COMMANDS = [
  { name: 'help', argHint: '[command]', description: 'Show help for slash commands and keyboard shortcuts.' },
  { name: 'clear', description: 'Clear the conversation history and start fresh.' },
  { name: 'model', argHint: '<model>', description: 'Switch the active model, e.g. /model deepseek-v4-pro.' },
  { name: 'resume', argHint: '<session-id>', description: 'Resume a previous session by id.' },
  { name: 'status', description: 'Show the current session and agent status.' },
  { name: 'cost', description: 'Show token usage and cost for this session.' },
  { name: 'compact', description: 'Compact the conversation to free context window.' },
  { name: 'exit', description: 'Exit the TUI. Alias: /quit.' },
];

/**
 * Multi-line help listing slash commands and keyboard shortcuts (Claude Code
 * `/help` style). The zh README translates this separately.
 * @type {string}
 */
export const HELP_TEXT = [
  'Slash commands',
  '  /help            Show this help.',
  '  /clear           Clear the conversation history.',
  '  /model <model>   Switch the active model.',
  '  /resume <id>     Resume a previous session.',
  '  /status          Show session and agent status.',
  '  /cost            Show token usage and cost.',
  '  /compact         Compact the conversation.',
  '  /exit            Exit the TUI (alias: /quit).',
  '',
  'Keyboard shortcuts',
  '  Enter            Send the message.',
  '  Shift+Enter      Insert a newline.',
  '  Esc              Cancel the current request.',
  '  Ctrl+C           Interrupt or exit.',
  '  Up / Down        Cycle through input history.',
].join('\n');

/**
 * The `--help` text printed when `parseCliArgs` reports `help: true`.
 * @type {string}
 */
export const CLI_HELP_TEXT = [
  'Usage: dsh --profile tui [options]',
  '',
  'Options:',
  '  --resume <id>          Resume the session with the given id (or --resume=<id>).',
  '  --continue, -c         Resume the most recent session.',
  '  --model <name>         Set the model (or --model=<name>).',
  '  -m <name>              Alias for --model <name>.',
  '  --list-sessions, --ls  List resumable sessions and exit.',
  '  --help, -h             Show this help and exit.',
  '  --version, -V          Print the version and exit.',
  '  --                     Treat all remaining arguments as positional.',
].join('\n');
