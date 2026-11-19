// Verso local server: serves the editor, stores projects on disk, relays
// design tools to the editor over WebSocket and exposes MCP over HTTP.
// Binds to 127.0.0.1 and only accepts requests addressed to localhost, so
// other websites and machines cannot reach it.

const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')
const { createStore } = require('./store')
const { createBridge } = require('./bridge')
const { createToolRunner } = require('./tools')
const { handleMcpHttp } = require('./mcp')
const { EXT_BY_TYPE } = require('./images')
const { version } = require('../package.json')

const PUBLIC_DIR = path.join(__dirname, '..', 'public')
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
}
const MAX_BODY = 40 * 1024 * 1024

function defaultDataDir() {
  return process.env.VERSO_HOME || path.join(os.homedir(), '.verso')
}

function openInBrowser(url) {
  if (process.env.VERSO_NO_OPEN === '1') return
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  } catch { /* no browser available */ }
}

// How users should register the MCP server, given how Verso was launched.
function mcpCommand() {
  const bin = path.join(__dirname, '..', 'bin', 'verso.js')
  if (/[\\/](_npx|node_modules)[\\/]/.test(bin)) return ['npx', '-y', 'verso-design', 'mcp']
  return ['node', bin, 'mcp']
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(data))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) { reject(new Error('Body too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve(undefined)
      try { resolve(JSON.parse(raw)) } catch (e) { reject(new Error('Invalid JSON')) }
    })
    req.on('error', reject)
  })
}

function serveFile(res, file, extraHeaders = {}) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    })
    res.end(data)
  })
}

function manifestFor(project, baseUrl) {
  const s = project.settings || {}
  const web = s.device === 'Web'
  return {
    verso: '1.0',
    project: project.name,
    updated_at: project.updatedAt,
    design_system: {
      device: s.device || 'iPhone 16',
      viewport_width: web ? 1440 : 393,
      theme: s.theme || 'Light',
      accent_color: s.accentColor || null,
      font_family: s.fontFamily || null,
      icon_library: s.iconLibrary || null,
    },
    design_prompt: project.designPrompt || '',
    screens: (project.screens || []).map((sc, i) => ({ index: i, name: sc.name || `Screen ${i + 1}`, html: sc.html || '' })),
    assets_base_url: `${baseUrl}/files/${project.id}/`,
    ai_context: 'Design exported from Verso. Each screen is HTML + Tailwind CSS v4 rendered in a fixed viewport (393px wide for iPhone, 1440px for web). Treat it as a visual blueprint, not production code: reproduce layout, spacing, colors and hierarchy with the target framework\'s native components. design_system holds the global tokens. Image paths starting with /files/ are served from assets_base_url.',
  }
}

async function startServer({ port = 4444, host = '127.0.0.1', dataDir = defaultDataDir(), log = console.error } = {}) {
  const store = createStore(dataDir)
  const bridge = createBridge()
  let actualPort = port
  const baseUrl = () => `http://localhost:${actualPort}`
  const tools = createToolRunner({ store, bridge, openUrl: openInBrowser, baseUrl })

  const allowedHost = (req) => {
    const h = String(req.headers.host || '').toLowerCase()
    return [`localhost:${actualPort}`, `127.0.0.1:${actualPort}`, `[::1]:${actualPort}`].includes(h) || (host !== '127.0.0.1' && host !== 'localhost')
  }
  // Browsers send Origin on cross-site requests. Only our own pages may make
  // state-changing calls or open the editor socket; CLI clients send none.
  const allowedOrigin = (req) => {
    const origin = req.headers.origin
    if (!origin) return true
    return [`http://localhost:${actualPort}`, `http://127.0.0.1:${actualPort}`, `http://[::1]:${actualPort}`].includes(origin)
  }

  async function handleApi(req, res, url, method) {
    if (url === '/api/info' && method === 'GET') {
      const cmd = mcpCommand()
      if (actualPort !== 4444) cmd.push('--port', String(actualPort))
      return json(res, 200, { name: 'verso', version, port: actualPort, dataDir: store.dataDir, mcpCommand: cmd })
    }

    // Tool calls forwarded from a `verso mcp` stdio process.
    if (url === '/api/mcp/call' && method === 'POST') {
      const body = await readBody(req)
      if (!body || typeof body.tool !== 'string') return json(res, 400, { error: 'tool is required' })
      return json(res, 200, await tools.run(body.tool, body.args || {}))
    }

    if (url === '/api/projects' && method === 'GET') {
      return json(res, 200, store.list().map(p => ({
        id: p.id,
        name: p.name,
        screenCount: (p.screens || []).length,
        updatedAt: p.updatedAt,
        createdAt: p.createdAt,
        device: p.settings && p.settings.device,
        accentColor: p.settings && p.settings.accentColor,
        previewScreens: (p.screens || []).slice(0, 2).map(s => s.html || '').filter(Boolean),
      })))
    }
    if (url === '/api/projects' && method === 'POST') {
      const body = (await readBody(req)) || {}
      const p = store.create({ name: body.name, device: body.device })
      return json(res, 201, { id: p.id, name: p.name })
    }

    const m = url.match(/^\/api\/projects\/([a-z0-9-]+)(?:\/(manifest|preview))?$/)
    if (m) {
      const [, id, action] = m
      const project = store.get(id)
      if (!project && method !== 'DELETE') return json(res, 404, { error: 'Project not found' })

      if (action === 'manifest' && method === 'GET') return json(res, 200, manifestFor(project, baseUrl()))
      if (action === 'preview' && method === 'GET') {
        return json(res, 200, { name: project.name, publishedScreens: project.screens || [], settings: project.settings || {}, publishedAt: project.updatedAt })
      }
      if (!action && method === 'GET') return json(res, 200, project)
      if (!action && method === 'PUT') {
        const body = (await readBody(req)) || {}
        const updated = store.update(id, body)
        if (body.name && body.name !== project.name) bridge.broadcast(id, { type: 'project_renamed', name: updated.name })
        return json(res, 200, { success: true, updatedAt: updated.updatedAt })
      }
      if (!action && method === 'DELETE') {
        return store.remove(id) ? json(res, 200, { success: true }) : json(res, 404, { error: 'Project not found' })
      }
    }

    if (url === '/api/image-proxy' && method === 'GET') return proxyImage(req, res)

    return json(res, 404, { error: 'Not found' })
  }

  // Used by screenshot/PNG export: html2canvas needs same-origin image data.
  async function proxyImage(req, res) {
    const target = new URL(req.url, baseUrl()).searchParams.get('url') || ''
    let parsed
    try { parsed = new URL(target) } catch { res.writeHead(400); return res.end('Invalid URL') }
    if (!/^https?:$/.test(parsed.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(parsed.hostname)) {
      res.writeHead(403); return res.end('URL not allowed')
    }
    try {
      const upstream = await fetch(parsed, { redirect: 'follow', headers: { 'User-Agent': 'verso-design' } })
      const type = (upstream.headers.get('content-type') || '').toLowerCase()
      if (!upstream.ok || !type.startsWith('image/')) { res.writeHead(502); return res.end('Not an image') }
      const buf = Buffer.from(await upstream.arrayBuffer())
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' })
      res.end(buf)
    } catch {
      res.writeHead(502); res.end('Fetch failed')
    }
  }

  const httpServer = http.createServer(async (req, res) => {
    const method = req.method || 'GET'
    const url = decodeURIComponent((req.url || '/').split('?')[0])

    if (!allowedHost(req)) { res.writeHead(403); return res.end('Forbidden host') }
    if (method !== 'GET' && method !== 'HEAD' && !allowedOrigin(req)) { res.writeHead(403); return res.end('Forbidden origin') }

    try {
      if (url === '/mcp') {
        if (!allowedOrigin(req)) { res.writeHead(403); return res.end('Forbidden origin') }
        const body = method === 'POST' ? await readBody(req) : undefined
        return await handleMcpHttp(req, res, body, tools.run)
      }
      if (url.startsWith('/api/')) return await handleApi(req, res, url, method)

      const files = url.match(/^\/files\/([a-z0-9-]+)\/([A-Za-z0-9._-]+)$/)
      if (files && store.isValidId(files[1]) && Object.values(EXT_BY_TYPE).includes(path.extname(files[2]).toLowerCase())) {
        return serveFile(res, path.join(store.assetsRoot, files[1], files[2]), { 'Cache-Control': 'public, max-age=3600', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" })
      }

      if (url === '/' || url === '/index.html') return serveFile(res, path.join(PUBLIC_DIR, 'index.html'))
      if (/^\/p\/[a-z0-9-]+$/.test(url)) return serveFile(res, path.join(PUBLIC_DIR, 'editor.html'))
      if (/^\/preview\/[a-z0-9-]+$/.test(url)) return serveFile(res, path.join(PUBLIC_DIR, 'preview.html'))

      const file = path.normalize(path.join(PUBLIC_DIR, url))
      if (file.startsWith(PUBLIC_DIR + path.sep) && path.extname(file)) return serveFile(res, file)

      res.writeHead(404); res.end('Not found')
    } catch (err) {
      log(`[verso] ${method} ${url} failed: ${err.message}`)
      if (!res.headersSent) json(res, 500, { error: err.message })
      else res.end()
    }
  })

  bridge.attach(httpServer, { isAllowedUpgrade: (req) => allowedHost(req) && allowedOrigin(req) })

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(port, host, () => {
      httpServer.off('error', reject)
      actualPort = httpServer.address().port
      resolve()
    })
  })

  return {
    url: baseUrl(),
    port: actualPort,
    store,
    tools,
    openInBrowser,
    close: () => new Promise((r) => httpServer.close(r)),
  }
}

// Is a Verso server already answering on this port?
async function probe(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/info`, { signal: AbortSignal.timeout(800) })
    const info = await res.json()
    return info && info.name === 'verso' ? info : null
  } catch {
    return null
  }
}

module.exports = { startServer, probe, openInBrowser, defaultDataDir }
