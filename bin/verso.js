#!/usr/bin/env node
// verso            start the canvas server and open it in the browser
// verso mcp        run as an MCP server over stdio (for Claude Code, Codex, …)

const path = require('path')
const { startServer, probe, openInBrowser, defaultDataDir } = require('../server')
const { version } = require('../package.json')

const HELP = `Verso ${version} – a local design canvas for AI agents

Usage:
  verso [options]        Start Verso and open it in your browser
  verso mcp [options]    Run the MCP server over stdio (add this to your agent)

Options:
  --port <n>     Port to use (default 4444, or $VERSO_PORT)
  --data <dir>   Where projects are stored (default ~/.verso, or $VERSO_HOME)
  --no-open      Do not open the browser
  -v, --version  Print the version
  -h, --help     Show this help

Connect an agent:
  claude mcp add verso -- npx -y verso-design mcp
  codex mcp add verso -- npx -y verso-design mcp

Photos: set UNSPLASH_ACCESS_KEY to search Unsplash (otherwise Openverse is used).
`

function parseArgs(argv) {
  const opts = { command: 'start', port: Number(process.env.VERSO_PORT) || 4444, open: true, dataDir: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === 'mcp' || a === 'start') opts.command = a
    else if (a === '--port' || a === '-p') opts.port = Number(argv[++i])
    else if (a.startsWith('--port=')) opts.port = Number(a.slice(7))
    else if (a === '--data') opts.dataDir = argv[++i]
    else if (a.startsWith('--data=')) opts.dataDir = a.slice(7)
    else if (a === '--no-open') opts.open = false
    else if (a === '-v' || a === '--version') opts.command = 'version'
    else if (a === '-h' || a === '--help') opts.command = 'help'
    else { console.error(`Unknown argument: ${a}\n`); opts.command = 'help'; opts.badArg = true }
  }
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) {
    console.error('Invalid --port')
    process.exit(1)
  }
  if (opts.dataDir) opts.dataDir = path.resolve(opts.dataDir)
  return opts
}

async function runStart(opts) {
  const running = await probe(opts.port)
  if (running) {
    const url = `http://localhost:${opts.port}`
    console.log(`Verso is already running at ${url}`)
    if (opts.open) openInBrowser(url)
    return
  }
  let server
  try {
    server = await startServer({ port: opts.port, dataDir: opts.dataDir || defaultDataDir() })
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${opts.port} is used by another app. Try: verso --port ${opts.port + 1}`)
      process.exit(1)
    }
    throw err
  }
  console.log(`
  Verso ${version}
  Canvas    ${server.url}
  MCP       ${server.url}/mcp
  Projects  ${server.store.dataDir}

  Connect your agent (once):
    claude mcp add verso -- npx -y verso-design mcp

  Press Ctrl+C to stop.
`)
  if (opts.open) openInBrowser(server.url)
  const stop = async () => { await server.close(); process.exit(0) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

// stdio MCP. If Verso is already running (say, started with `verso`), tool
// calls are forwarded to it. Otherwise this process starts the server itself
// and the browser opens the first time a design tool needs the canvas.
async function runMcp(opts) {
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
  const { buildMcpServer } = require('../server/mcp')
  const log = (...a) => process.stderr.write(`[verso] ${a.join(' ')}\n`)

  let local = null // in-process server, when we own it

  async function ensureBackend() {
    if (local) return
    if (await probe(opts.port)) return
    try {
      local = await startServer({ port: opts.port, dataDir: opts.dataDir || defaultDataDir(), log })
      log(`canvas running at ${local.url}`)
    } catch (err) {
      if (err.code === 'EADDRINUSE' && (await probe(opts.port))) return // another verso won the race
      throw err
    }
  }

  async function forward(tool, args) {
    const res = await fetch(`http://127.0.0.1:${opts.port}/api/mcp/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, args }),
    })
    if (!res.ok) throw new Error(`Verso server answered ${res.status}`)
    return res.json()
  }

  async function execute(tool, args) {
    try {
      await ensureBackend()
      if (local) return await local.tools.run(tool, args)
      try {
        return await forward(tool, args)
      } catch (err) {
        // The server we were forwarding to went away: take over.
        if (err.cause && err.cause.code === 'ECONNREFUSED') {
          await ensureBackend()
          if (local) return await local.tools.run(tool, args)
        }
        throw err
      }
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }
    }
  }

  await ensureBackend().catch((err) => log(`could not start the canvas yet: ${err.message}`))
  const server = buildMcpServer(execute)
  await server.connect(new StdioServerTransport())
  log('MCP server ready on stdio')

  const stop = async () => {
    if (local) await local.close().catch(() => {})
    process.exit(0)
  }
  process.stdin.on('close', stop)
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.command === 'version') return console.log(version)
  if (opts.command === 'help') { console.log(HELP); process.exit(opts.badArg ? 1 : 0) }
  if (opts.command === 'mcp') return runMcp(opts)
  return runStart(opts)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
