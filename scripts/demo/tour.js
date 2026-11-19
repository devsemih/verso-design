// Scripted demo tour for the README. Starts Verso with a throwaway data
// folder, opens the editor in headless Chrome, and plays both sides: the
// agent (real MCP tool calls) and the user (a visible cursor that selects an
// element and leaves a note). Writes screencast frames plus a screenshot.
//
//   node scripts/demo/tour.js <outDir>
//
// Needs Google Chrome (or CHROME_PATH) and the puppeteer-core dev dependency.

const fs = require('fs')
const os = require('os')
const path = require('path')
const puppeteer = require('puppeteer-core')
const { startServer } = require('../../server')
const { HOME, INSIGHTS, CARD, WARM_CARD_CLASS, DESIGN_PROMPT } = require('./screens')

const OUT = path.resolve(process.argv[2] || 'build/demo')
const WIDTH = 1440
const HEIGHT = 900
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const CURSOR_SVG = `<svg width="26" height="26" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M5 2.5v17.2l4.6-4.4 2.9 6.6 2.7-1.2-2.9-6.5h6.3z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true })
  process.env.VERSO_NO_OPEN = '1'

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verso-demo-'))
  const server = await startServer({ port: 0, dataDir, log: () => {} })
  const project = server.store.create({ name: 'Pocket' })
  const agent = async (tool, args = {}) => {
    const res = await server.tools.run(tool, args)
    if (res.isError) throw new Error(`${tool}: ${res.content[0].text}`)
    return res
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [`--window-size=${WIDTH},${HEIGHT}`, '--hide-scrollbars', '--force-color-profile=srgb'],
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 },
  })
  const page = await browser.newPage()
  await page.goto(`${server.url}/p/${project.id}`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  // Show the published npx command, not this checkout's path and port.
  await page.waitForFunction(() => typeof _agentSetup !== 'undefined' && _agentSetup)
  await page.evaluate(() => { _agentSetup.mcpCommand = ['npx', '-y', 'verso-design', 'mcp']; selectAgentClient('claude') })
  await sleep(600)

  // Visible cursor (headless screenshots have none).
  await page.evaluate((svg) => {
    const c = document.createElement('div')
    c.id = 'demo-cursor'
    c.innerHTML = svg
    Object.assign(c.style, {
      position: 'fixed', left: '0', top: '0', zIndex: 2147483647, pointerEvents: 'none',
      transform: 'translate(1180px, 760px)', transition: 'transform 0.9s cubic-bezier(0.45, 0, 0.2, 1)',
      filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.35))',
    })
    document.body.appendChild(c)
  }, CURSOR_SVG)
  const moveCursor = async (x, y, ms = 900) => {
    await page.evaluate((x, y, ms) => {
      const c = document.getElementById('demo-cursor')
      c.style.transitionDuration = `${ms}ms`
      c.style.transform = `translate(${x - 5}px, ${y - 3}px)`
    }, x, y, ms)
    await sleep(ms + 80)
  }

  // --- screencast ---
  const cdp = await page.createCDPSession()
  const frames = []
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const file = `f${String(frames.length).padStart(5, '0')}.jpg`
    fs.writeFileSync(path.join(OUT, 'frames', file), Buffer.from(data, 'base64'))
    frames.push({ file, t: metadata.timestamp })
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: WIDTH * 2, maxHeight: HEIGHT * 2, everyNthFrame: 1 })
  const started = Date.now() / 1000
  await sleep(1200)

  // --- the agent designs three screens ---
  await agent('open_project', { projectId: project.id })
  await sleep(500)
  await agent('get_design_guide')
  const screens = [['Home', HOME, 'Design home with balance card, quick actions and spending chart'],
    ['Insights', INSIGHTS, 'Add insights screen with category donut and budgets'],
    ['Card', CARD, 'Add card screen with card controls and monthly limit']]
  for (const [i, [name, html, change]] of screens.entries()) {
    await agent('create_screen', { name })
    await sleep(700)
    await agent('write_html', {
      html, changeDescription: change, platform: 'iPhone 16', theme: 'Light', accentColor: '#6D5BFF',
      fontFamily: 'Plus Jakarta Sans', iconLibrary: 'Solar', ...(i === 0 ? { designPrompt: DESIGN_PROMPT } : {}),
    })
    await sleep(1700)
  }
  await agent('get_screenshot', { screen: 'Home' })
  await sleep(1400)

  // --- the user selects the balance card and leaves a note ---
  const target = await page.evaluate(() => {
    const frame = document.querySelector('.renderer-frame')
    const fr = frame.getBoundingClientRect()
    const scale = fr.width / 393
    const card = [...frame.contentDocument.querySelectorAll('section')].find(s => s.textContent.includes('Total balance'))
    const r = card.getBoundingClientRect()
    return { x: fr.left + (r.left + 9) * scale, y: fr.top + (r.top + r.height * 0.55) * scale }
  })
  await moveCursor(target.x, target.y, 1100)
  await sleep(250)
  await page.mouse.click(target.x, target.y)
  await sleep(700)
  await page.keyboard.type('Make this card warmer, more sunset than violet', { delay: 42 })
  await sleep(500)
  await page.keyboard.press('Enter')
  await sleep(500)
  await moveCursor(1180, 760, 900)
  await sleep(900)

  // --- the agent reads the note and applies it ---
  const sel = JSON.parse((await agent('get_selection')).content[0].text)
  const note = sel.notes[0]
  await sleep(700)
  await agent('set_class', { screen: note.screenName, nodeId: note.nodeId, className: WARM_CARD_CLASS, changeDescription: 'Warm up the balance card gradient' })
  await sleep(600)
  await agent('get_selection', { clearNotes: true })
  await sleep(2600)

  await cdp.send('Page.stopScreencast')
  const ended = Date.now() / 1000

  // ffconcat with real frame timings.
  const lines = ['ffconcat version 1.0']
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : ended - started + frames[0].t
    lines.push(`file 'frames/${f.file}'`, `duration ${Math.max(0.02, next - f.t).toFixed(3)}`)
  })
  if (frames.length) lines.push(`file 'frames/${frames[frames.length - 1].file}'`)
  fs.writeFileSync(path.join(OUT, 'frames.ffconcat'), lines.join('\n') + '\n')

  // Still screenshot: clear the selection and hide the cursor first.
  await page.evaluate(() => {
    document.getElementById('demo-cursor').remove()
    if (typeof clearRightInspector === 'function') clearRightInspector()
    document.querySelectorAll('.renderer-frame').forEach(f => f.contentWindow.postMessage({ type: 'clearHighlight' }, '*'))
  })
  await sleep(400)
  await page.screenshot({ path: path.join(OUT, 'screenshot.png') })

  await browser.close()
  await server.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
  console.log(`${frames.length} frames, ${(ended - started).toFixed(1)}s → ${OUT}`)
  process.exit(0)
}

main().catch((err) => { console.error(err); process.exit(1) })
