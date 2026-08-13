/**
 * dsh-tui — Claude-CLI-style interactive terminal chat for the DeepSeek
 * Harness. A Cordis bundle plugin (`tui-runner`), composed over dsh-base +
 * dsh-headless; the patch disables the headless one-shot rows and inserts this
 * runner. Drives the core Agent exactly like the headless runner, but streams
 * session events into an Ink chat UI instead of printing a single answer.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import React from 'react'
import { render } from 'ink'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { probeTerminalBg } from './theme.js'
import { parseCliArgs, CLI_HELP_TEXT } from './commands.js'
import { createInitialState, reduce } from './events.js'
import { App } from './ui.js'

/** This package's version, read from its own manifest (source and packed layouts). */
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

/** Stable Cordis plugin name (bundle row id: tui-runner). */
export const name = 'tui-runner'

/** Core services required before the interactive session can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions', 'sessionPersistence', 'commands']

/**
 * Bridge between the Cordis event bus (non-React) and the Ink tree. The App
 * installs its event consumer by calling `onEvent` with a function once
 * mounted; every matching `session/event` is then forwarded to it. Events are
 * dropped until the App mounts.
 */
let uiHandler = undefined
function forward(eventOrHandler) {
  if (typeof eventOrHandler === 'function' || eventOrHandler == null) {
    uiHandler = typeof eventOrHandler === 'function' ? eventOrHandler : undefined
    return
  }
  if (typeof uiHandler === 'function') uiHandler(eventOrHandler)
}

/** The approval answerer the App installs; resolves pending permission requests. */
let approvalHandler = undefined
function onApproval(handler) {
  approvalHandler = typeof handler === 'function' ? handler : undefined
}

/**
 * Mount the interactive chat driver.
 * @param ctx - plugin context carrying core services and the launcher-provided exit.
 */
export function apply(ctx) {
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('tui-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  void run(ctx, exit).catch((error) => {
    console.error(`dsh-tui: ${error instanceof Error ? error.message : String(error)}`)
    exit(1)
  })
}

/**
 * Resolve a `--resume` spec (`'__last__'` or an id prefix) to a persisted
 * session id, or undefined when nothing matches.
 * @param spec - the resume spec from CLI args.
 * @param persistence - the session-persistence service.
 * @returns the most-recent or matching session id, or undefined.
 */
async function resolveResumeId(spec, persistence) {
  const headers = await persistence.list()
  if (headers.length === 0) return undefined
  const byNewest = [...headers].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  if (spec === '__last__') return byNewest[0].id
  const wanted = String(spec)
  const found = byNewest.find((h) => String(h.id) === wanted || String(h.id).startsWith(wanted))
  return found?.id
}

/** Print persisted sessions for `--list-sessions`. */
async function listSessions(persistence) {
  const headers = await persistence.list()
  if (headers.length === 0) {
    process.stdout.write('no sessions\n')
    return
  }
  const rows = [...headers]
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .map((h) => {
      const created = h.createdAt !== undefined ? new Date(h.createdAt).toISOString() : '?'
      const cwd = h.cwd ?? ''
      return `${String(h.id)}\t${created}\t${cwd}`
    })
  process.stdout.write(rows.join('\n') + '\n')
}

/** Create the agent (fresh or resumed) and run the chat until the user quits. */
async function run(ctx, exit) {
  // Probe the terminal background BEFORE Ink mounts: Ink's key parser would
  // otherwise read the OSC 11 response as keystrokes and type garbage.
  const themeBg = await probeTerminalBg()

  // Loader siblings mount concurrently; await the complete composition before
  // creating an Agent so its scoped tools are not half-composed.
  await ctx.get('loader')?.await()

  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  const persistence = ctx.get('sessionPersistence')
  const commands = ctx.get('commands')
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return

  // App-owned flags: everything after the launcher's own flags.
  const cmdline = ctx.get('cmdlineArgs')
  const cli = parseCliArgs(cmdline?.get?.() ?? [])

  if (cli.help) { process.stdout.write(CLI_HELP_TEXT + '\n'); process.exit(0) }
  if (cli.version) { process.stdout.write(`dsh-tui ${VERSION}\n`); process.exit(0) }
  if (cli.listSessions) {
    if (persistence === undefined) {
      process.stderr.write('dsh-tui: session persistence is not available in this profile\n')
      process.exit(1)
    }
    await listSessions(persistence)
    process.exit(0)
  }

  // The mutable model selection: `/model` reassigns `current` so the NEXT turn
  // uses it (prompt assembly snapshots `current` into `assembled`).
  const selection = { current: defaultModel.currentSelection(), assembled: undefined }

  // `--model <name>` overrides the default for this run.
  if (cli.model != null) {
    selection.current = { ...selection.current, model: cli.model }
  }

  let agent
  if (cli.resume !== undefined) {
    if (persistence === undefined) {
      process.stderr.write('dsh-tui: session persistence is not available in this profile\n')
      exit(1)
      return
    }
    const sessionId = await resolveResumeId(cli.resume, persistence)
    if (sessionId === undefined) {
      process.stderr.write(
        cli.resume === '__last__'
          ? 'dsh-tui: no session to resume\n'
          : `dsh-tui: no session matching "${cli.resume}"\n`,
      )
      process.exit(1)
    }
    const handle = await agents.resume({
      resumeSessionId: sessionId,
      setup: (agentCtx) => { installModelSelection(agentCtx, selection) },
    })
    agent = handle.agent
  } else {
    const handle = await agents.create({
      sessionId: SessionId(`session-${randomUUID()}`),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: selection.current.provider, model: selection.current.model },
      setup: (agentCtx) => { installModelSelection(agentCtx, selection) },
    })
    agent = handle.agent
  }

  await agent.whenIdle()
  // Events below this seq are construction seed history, not chat.
  const firstSeq = agent.session.seq

  // On resume, replay the loaded history into the initial UI state so the
  // prior conversation is visible as scrollback.
  let initialState
  if (cli.resume !== undefined) {
    initialState = agent.session.events.reduce(
      (state, event) => reduce(state, event, 0),
      createInitialState(),
    )
  }

  // Intercept approval requests (tool/permission prompts) and answer via the
  // UI. Fail closed to `unavailable` when the UI cannot answer.
  ctx.on('approval/request', async (req, next) => {
    if (req?.agent !== agent || typeof approvalHandler !== 'function') return next()
    try {
      return await approvalHandler(req)
    } catch {
      return 'unavailable'
    }
  })

  // Live append feed: forward this session's events to the UI and persist the
  // log at each turn boundary (fire-and-forget; flush is caller-owned).
  ctx.on('session/event', (session, event) => {
    if (session.id !== agent.session.id) return
    if (event.seq >= firstSeq && event.type === 'turn/end') {
      void sessions.flush(agent.session).catch((error) => {
        console.error(`dsh-tui: session flush failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    forward(event)
  })

  let app
  let exited = false
  const onExit = () => {
    if (exited) return
    exited = true
    if (app) {
      try {
        app.unmount()
      } catch {
        // The App already unmounted itself via useApp().exit().
      }
    }
    // The launcher's graceful path only sets process.exitCode and relies on
    // the event loop draining; file watchers can keep it alive after the UI
    // unmounts, so watchdog the process to release the terminal promptly.
    exit(0)
    setTimeout(() => {
      try {
        process.exit(0)
      } catch {
        // The process already exited via the graceful path.
      }
    }, 2000)
  }

  const onModelSwitch = (newModel) => {
    if (typeof newModel !== 'string' || newModel === '') return false
    selection.current = { ...selection.current, model: newModel }
    return true
  }

  // Slash commands the UI does not own are delegated to the harness's native
  // command registry (e.g. /compact, /goal, /plan, /permission, /feedback).
  const onCommand = (line) => {
    if (commands === undefined) return Promise.resolve(undefined)
    return commands.execute(agent, line, new AbortController().signal)
  }

  // exitOnCtrlC: false — the App owns Ctrl-C so it can exit the harness cleanly.
  app = render(
    React.createElement(App, {
      agent,
      firstSeq,
      initialState,
      model: selection.current.model,
      themeBg,
      onEvent: forward,
      onApproval,
      onInterrupt: () => agent.cancel({ kind: 'user' }),
      onModelSwitch,
      onCommand,
      onExit,
    }),
    { exitOnCtrlC: false },
  )
}
