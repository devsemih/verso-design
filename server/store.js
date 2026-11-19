// File-based project store. Each project is one JSON file in
// <dataDir>/projects/<id>.json, and uploaded images live in
// <dataDir>/assets/<id>/. Plain files, so projects are easy to back up,
// version with git, or read directly from an agent.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const DEFAULT_SETTINGS = {
  device: 'iPhone 16',
  theme: 'Light',
  accentColor: '#007AFF',
  fontFamily: '—',
  iconLibrary: '—',
}

const ID_RE = /^[a-z0-9-]{1,80}$/

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

function createStore(dataDir) {
  const projectsDir = path.join(dataDir, 'projects')
  const assetsRoot = path.join(dataDir, 'assets')
  fs.mkdirSync(projectsDir, { recursive: true })
  fs.mkdirSync(assetsRoot, { recursive: true })

  const fileFor = (id) => {
    if (!ID_RE.test(id)) throw new Error('Invalid project id')
    return path.join(projectsDir, `${id}.json`)
  }

  function writeAtomic(file, data) {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
    fs.renameSync(tmp, file)
  }

  function get(id) {
    try {
      return JSON.parse(fs.readFileSync(fileFor(id), 'utf8'))
    } catch (e) {
      if (e.code === 'ENOENT' || e.message === 'Invalid project id') return null
      throw e
    }
  }

  function list() {
    const out = []
    for (const f of fs.readdirSync(projectsDir)) {
      if (!f.endsWith('.json')) continue
      const p = get(f.slice(0, -5))
      if (p) out.push(p)
    }
    return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  }

  function create({ name, device } = {}) {
    const projectName = String(name || 'Untitled Project').slice(0, 120)
    const base = slugify(projectName) || 'project'
    let id
    do {
      id = `${base}-${crypto.randomBytes(2).toString('hex')}`
    } while (fs.existsSync(path.join(projectsDir, `${id}.json`)))
    const now = new Date().toISOString()
    const project = {
      id,
      name: projectName,
      screens: [],
      activeScreenIndex: 0,
      entryScreenIndex: 0,
      settings: { ...DEFAULT_SETTINGS, ...(device ? { device } : {}) },
      designPrompt: '',
      designMemory: null,
      notes: [],
      createdAt: now,
      updatedAt: now,
    }
    writeAtomic(fileFor(id), project)
    return project
  }

  const EDITABLE = ['name', 'screens', 'activeScreenIndex', 'entryScreenIndex', 'settings', 'designPrompt', 'designMemory', 'notes']

  function update(id, patch) {
    const existing = get(id)
    if (!existing) return null
    const next = { ...existing }
    for (const key of EDITABLE) {
      if (patch[key] !== undefined) next[key] = patch[key]
    }
    if (typeof next.name !== 'string' || !next.name.trim()) next.name = existing.name
    next.updatedAt = new Date().toISOString()
    writeAtomic(fileFor(id), next)
    return next
  }

  function remove(id) {
    const file = fileFor(id)
    if (!fs.existsSync(file)) return false
    fs.unlinkSync(file)
    fs.rmSync(path.join(assetsRoot, id), { recursive: true, force: true })
    return true
  }

  function assetsDir(id) {
    if (!ID_RE.test(id)) throw new Error('Invalid project id')
    const dir = path.join(assetsRoot, id)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  return { dataDir, projectsDir, assetsRoot, get, list, create, update, remove, assetsDir, isValidId: (id) => ID_RE.test(id) }
}

module.exports = { createStore, DEFAULT_SETTINGS }
