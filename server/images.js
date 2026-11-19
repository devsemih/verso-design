// Images for designs: stock photo search and adding the agent's own images.
//
// search: Unsplash when UNSPLASH_ACCESS_KEY is set (free key from
// unsplash.com/developers), otherwise Openverse, which needs no key and
// returns openly licensed photos.
// add: copies a local file, a URL or a data URI into the project's assets
// folder so the design can reference it as /files/<project>/<file>.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const USER_AGENT = 'verso-design (local design tool)'
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const EXT_BY_TYPE = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
}
const IMAGE_EXTS = new Set(Object.values(EXT_BY_TYPE).concat('.jpeg'))

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers } })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${new URL(url).hostname} answered ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
  }
  return res.json()
}

async function searchUnsplash({ query, orientation, count }, key) {
  const params = new URLSearchParams({ query, per_page: String(count), content_filter: 'high' })
  if (orientation) params.set('orientation', orientation)
  const data = await fetchJson(`https://api.unsplash.com/search/photos?${params}`, {
    Authorization: `Client-ID ${key}`,
    'Accept-Version': 'v1',
  })
  return (data.results || []).map(p => ({
    url: `${p.urls.raw}&w=1080&fit=max&auto=format&q=80`,
    thumbnail: p.urls.small,
    width: p.width,
    height: p.height,
    description: p.alt_description || p.description || '',
    color: p.color,
    author: p.user && p.user.name,
    attribution: p.user ? `Photo by ${p.user.name} on Unsplash` : 'Unsplash',
    pageUrl: p.links && p.links.html,
    source: 'unsplash',
  }))
}

async function searchOpenverse({ query, orientation, count }) {
  const params = new URLSearchParams({ q: query, page_size: String(count), mature: 'false' })
  const aspect = { portrait: 'tall', landscape: 'wide', squarish: 'square' }[orientation]
  if (aspect) params.set('aspect_ratio', aspect)
  const data = await fetchJson(`https://api.openverse.org/v1/images/?${params}`)
  return (data.results || []).map(p => ({
    url: p.url,
    thumbnail: p.thumbnail,
    width: p.width,
    height: p.height,
    description: p.title || '',
    author: p.creator,
    license: `${(p.license || '').toUpperCase()} ${p.license_version || ''}`.trim(),
    attribution: p.attribution,
    pageUrl: p.foreign_landing_url,
    source: 'openverse',
  }))
}

async function searchImages({ query, orientation, count = 6 }) {
  if (!query || !String(query).trim()) throw new Error('query is required')
  const n = Math.max(1, Math.min(20, Number(count) || 6))
  const key = process.env.UNSPLASH_ACCESS_KEY
  const opts = { query: String(query).trim(), orientation, count: n }
  if (key) return { source: 'unsplash', results: await searchUnsplash(opts, key) }
  return {
    source: 'openverse',
    note: 'Set UNSPLASH_ACCESS_KEY for Unsplash results. Openverse photos are openly licensed; keep the attribution when you ship.',
    results: await searchOpenverse(opts),
  }
}

function extFromName(name) {
  const ext = path.extname(String(name || '')).toLowerCase()
  return IMAGE_EXTS.has(ext) ? (ext === '.jpeg' ? '.jpg' : ext) : null
}

async function readSource(source) {
  const src = String(source || '').trim()
  if (!src) throw new Error('source is required')

  if (src.startsWith('data:')) {
    const m = src.match(/^data:([^;,]+)(;base64)?,(.*)$/s)
    if (!m || !EXT_BY_TYPE[m[1]]) throw new Error('Unsupported data URI. Use a png, jpeg, webp, gif, svg or avif image.')
    const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]))
    return { buf, ext: EXT_BY_TYPE[m[1]] }
  }

  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' })
    if (!res.ok) throw new Error(`Download failed with ${res.status}`)
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    const declared = Number(res.headers.get('content-length') || 0)
    if (declared > MAX_IMAGE_BYTES) throw new Error('Image is larger than 15 MB')
    const buf = Buffer.from(await res.arrayBuffer())
    const ext = EXT_BY_TYPE[type] || extFromName(new URL(src).pathname)
    if (!ext) throw new Error(`Not an image (content-type: ${type || 'unknown'})`)
    return { buf, ext }
  }

  // Local file path (absolute, or ~/...).
  const file = path.resolve(src.replace(/^~(?=$|\/)/, require('os').homedir()))
  const ext = extFromName(file)
  if (!ext) throw new Error('Only image files can be added (png, jpg, webp, gif, svg, avif)')
  const stat = fs.statSync(file)
  if (!stat.isFile()) throw new Error('Not a file')
  if (stat.size > MAX_IMAGE_BYTES) throw new Error('Image is larger than 15 MB')
  return { buf: fs.readFileSync(file), ext }
}

async function addImage(store, projectId, { source, name }) {
  const { buf, ext } = await readSource(source)
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('Image is larger than 15 MB')
  const base = String(name || '').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8)
  const fileName = `${base ? base + '-' : ''}${hash}${ext}`
  fs.writeFileSync(path.join(store.assetsDir(projectId), fileName), buf)
  return { url: `/files/${projectId}/${fileName}`, bytes: buf.length }
}

module.exports = { searchImages, addImage, EXT_BY_TYPE }
