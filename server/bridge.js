// Bridge between agents and the editor tabs open in the browser.
//
// Design tools run inside the editor (the canvas DOM lives there), so the
// server forwards each call over WebSocket to one editor tab and waits for
// its reply. When several tabs show the same project, the most recently
// focused one handles the call so changes are applied exactly once.

const crypto = require('crypto')
const { WebSocketServer, WebSocket } = require('ws')

function createBridge() {
  const editors = new Set() // ws with ws.projectId, ws.lastActive
  const pending = new Map() // id -> { resolve, reject, timer }
  const waiters = new Set() // { projectId, resolve }

  function editorsFor(projectId) {
    return [...editors].filter(ws => ws.projectId === projectId && ws.readyState === WebSocket.OPEN)
  }

  function pickEditor(projectId) {
    const list = editorsFor(projectId)
    list.sort((a, b) => b.lastActive - a.lastActive)
    return list[0] || null
  }

  function hasEditor(projectId) {
    return editorsFor(projectId).length > 0
  }

  // Project shown in the most recently active editor tab (any project).
  function activeProjectId() {
    let best = null
    for (const ws of editors) {
      if (ws.projectId && ws.readyState === WebSocket.OPEN && (!best || ws.lastActive > best.lastActive)) best = ws
    }
    return best ? best.projectId : null
  }

  function waitForEditor(projectId, timeoutMs) {
    if (hasEditor(projectId)) return Promise.resolve(true)
    return new Promise((resolve) => {
      const waiter = { projectId, resolve }
      waiters.add(waiter)
      setTimeout(() => {
        if (waiters.delete(waiter)) resolve(false)
      }, timeoutMs)
    })
  }

  function call(projectId, tool, args, timeoutMs = 45000) {
    const ws = pickEditor(projectId)
    if (!ws) return Promise.reject(new Error('No editor open for this project'))
    const id = crypto.randomBytes(8).toString('hex')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`The editor did not answer "${tool}" in time`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer, ws })
      ws.send(JSON.stringify({ id, tool, args: args || {} }))
    })
  }

  function broadcast(projectId, payload) {
    const msg = JSON.stringify(payload)
    for (const ws of editorsFor(projectId)) ws.send(msg)
  }

  function attach(httpServer, { isAllowedUpgrade }) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 })

    httpServer.on('upgrade', (req, socket, head) => {
      const pathname = (req.url || '').split('?')[0]
      if (pathname !== '/ws' || !isAllowedUpgrade(req)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
    })

    wss.on('connection', (ws) => {
      ws.projectId = null
      ws.lastActive = Date.now()
      editors.add(ws)

      ws.on('message', (data) => {
        let msg
        try { msg = JSON.parse(data.toString()) } catch { return }

        if (msg.type === 'register' && typeof msg.projectId === 'string') {
          ws.projectId = msg.projectId
          ws.lastActive = Date.now()
          for (const w of [...waiters]) {
            if (w.projectId === ws.projectId) { waiters.delete(w); w.resolve(true) }
          }
          return
        }
        if (msg.type === 'focus') { ws.lastActive = Date.now(); return }

        if (msg.id && pending.has(msg.id)) {
          const p = pending.get(msg.id)
          pending.delete(msg.id)
          clearTimeout(p.timer)
          p.resolve(msg.result)
        }
      })

      ws.on('close', () => {
        editors.delete(ws)
        for (const [id, p] of pending) {
          if (p.ws === ws) {
            pending.delete(id)
            clearTimeout(p.timer)
            p.reject(new Error('The editor tab was closed'))
          }
        }
      })
    })
    return wss
  }

  return { attach, call, broadcast, hasEditor, waitForEditor, activeProjectId }
}

module.exports = { createBridge }
