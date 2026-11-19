// MCP tool definitions and their implementations.
//
// Project, guide and image tools run on the server. Design tools are
// forwarded to the editor tab that shows the project (see bridge.js); if no
// tab is open, Verso opens one in the browser and waits for it.

const { z } = require('zod')
const { DESIGN_GUIDE } = require('./guide')
const { searchImages, addImage } = require('./images')

const screenRef = z.union([z.string(), z.number()]).describe('Screen name or zero-based index')
const optScreen = screenRef.optional().describe('Screen name or zero-based index. Defaults to the active screen.')
const changeDescription = z.string().describe('Specific, commit-style summary of the change, e.g. "Add search bar and category chips". Shown in version history and the activity feed.')
const optProject = z.string().optional().describe('Project id. Defaults to the project currently open in the browser.')

const TOOLS = [
  // ---------- projects ----------
  {
    name: 'list_projects',
    title: 'List projects',
    description: 'List Verso projects (id, name, screen count, last update) and which one is open in the browser.',
    input: {},
    readOnly: true,
    server: true,
  },
  {
    name: 'create_project',
    title: 'Create project',
    description: 'Create a new project and open it in the browser. It becomes the current project for all design tools.',
    input: {
      name: z.string().describe('Project name, e.g. "Pocket – budgeting app"'),
      device: z.enum(['iPhone 16', 'Web']).optional().describe('Target device. Defaults to iPhone 16.'),
    },
    server: true,
  },
  {
    name: 'open_project',
    title: 'Open project',
    description: 'Make a project current and open it in the browser if it is not open yet.',
    input: { projectId: z.string().describe('Project id from list_projects') },
    server: true,
  },
  {
    name: 'get_design_guide',
    title: 'Design guide',
    description: 'Read the Verso design guide: canvas rules, theme block, icons, images and quality rules. Call once per session before your first write_html.',
    input: {},
    readOnly: true,
    server: true,
  },

  // ---------- images ----------
  {
    name: 'search_images',
    title: 'Search photos',
    description: 'Search real stock photos to use in designs. Uses Unsplash when UNSPLASH_ACCESS_KEY is set, otherwise Openverse (openly licensed). Embed the returned url in <img src>.',
    input: {
      query: z.string().describe('What the photo shows, in English, e.g. "pasta carbonara top view"'),
      orientation: z.enum(['portrait', 'landscape', 'squarish']).optional(),
      count: z.number().int().min(1).max(20).optional().describe('Number of results, default 6'),
    },
    readOnly: true,
    server: true,
  },
  {
    name: 'add_image',
    title: 'Add image',
    description: 'Add your own image to the project (a local file path, an http(s) URL or a data URI). Use it for images you generated or files the user gave you. Returns a /files/... URL to use in <img src>.',
    input: {
      source: z.string().describe('Absolute file path, http(s) URL, or data:image/...;base64,... URI'),
      name: z.string().optional().describe('Short file name hint, e.g. "hero-illustration"'),
      projectId: optProject,
    },
    server: true,
  },

  // ---------- screens ----------
  { name: 'list_screens', title: 'List screens', description: 'List the screens of the current project with their index and which one is active.', input: { projectId: optProject }, readOnly: true },
  {
    name: 'create_screen',
    title: 'Create screen',
    description: 'Add a blank screen to the canvas. It becomes the active screen, so the next write_html lands on it.',
    input: { name: z.string().describe('Screen name, e.g. "Home", "Checkout"'), projectId: optProject },
  },
  { name: 'switch_screen', title: 'Switch screen', description: 'Make another screen active.', input: { screen: screenRef, projectId: optProject } },
  { name: 'rename_screen', title: 'Rename screen', description: 'Rename a screen.', input: { screen: screenRef, name: z.string(), projectId: optProject } },
  { name: 'delete_screen', title: 'Delete screen', description: 'Delete a screen from the project.', input: { screen: screenRef, projectId: optProject }, destructive: true },
  {
    name: 'get_screen_html',
    title: 'Get screen HTML',
    description: 'Return the full saved HTML of a screen. Read it before rewriting an existing screen with write_html.',
    input: { screen: optScreen, projectId: optProject },
    readOnly: true,
  },

  // ---------- design ----------
  {
    name: 'write_html',
    title: 'Write screen HTML',
    description: 'Replace the HTML of a screen (Tailwind CSS v4 + Iconify, body fragment only). Start with the Google Fonts <link> and <style type="text/tailwindcss"> theme block from get_design_guide. With targetNodeId, inserts into that element instead of replacing the screen.',
    input: {
      html: z.string().describe('Screen HTML: theme block (<link> + <style type="text/tailwindcss">) followed by the markup. No <html>/<head>/<body>.'),
      changeDescription,
      screen: optScreen,
      platform: z.enum(['iPhone 16', 'Web']).optional().describe('iPhone 16 for mobile (393 wide), Web for desktop (1440 wide)'),
      theme: z.enum(['Light', 'Dark']).optional(),
      accentColor: z.string().optional().describe('Primary color as hex; should match --primary'),
      fontFamily: z.string().optional(),
      iconLibrary: z.string().optional().describe('e.g. Solar, Lucide, Phosphor'),
      designPrompt: z.string().optional().describe('Updated project brief (concept, palette, typography, screens). Extend the existing one; do not shrink it.'),
      targetNodeId: z.string().optional().describe('data-ps-id of an element to write into instead of replacing the screen'),
      mode: z.enum(['replace', 'append', 'prepend']).optional().describe('How to insert when targetNodeId is set (default replace)'),
      projectId: optProject,
    },
  },
  {
    name: 'get_tree',
    title: 'Get layer tree',
    description: 'Return the layer tree of a screen (id, tag, name, children). Use the data-ps-id values with the surgical tools.',
    input: { screen: optScreen, projectId: optProject },
    readOnly: true,
  },
  {
    name: 'set_text',
    title: 'Set text',
    description: 'Change the text of one element by data-ps-id. Nothing else on the screen changes.',
    input: { nodeId: z.string(), text: z.string(), changeDescription: changeDescription.optional(), screen: optScreen, projectId: optProject },
  },
  {
    name: 'set_class',
    title: 'Set classes',
    description: 'Replace the full Tailwind class list of one element by data-ps-id. The preferred way to restyle a single element.',
    input: { nodeId: z.string(), className: z.string().describe('Complete new class string'), changeDescription: changeDescription.optional(), screen: optScreen, projectId: optProject },
  },
  {
    name: 'set_style',
    title: 'Set inline style',
    description: 'Apply inline CSS to one element by data-ps-id, for tweaks that are awkward with Tailwind classes.',
    input: { nodeId: z.string(), css: z.string().describe('CSS declarations, e.g. "color: #FF6B35; letter-spacing: -0.02em"'), changeDescription: changeDescription.optional(), screen: optScreen, projectId: optProject },
  },
  {
    name: 'replace_node_html',
    title: 'Replace element',
    description: 'Swap one element (and its children) for new markup with a single root element. Use it to restructure one component without rewriting the screen.',
    input: { nodeId: z.string(), html: z.string(), changeDescription: changeDescription.optional(), screen: optScreen, projectId: optProject },
  },
  {
    name: 'remove_node',
    title: 'Remove element',
    description: 'Remove one element by data-ps-id.',
    input: { nodeId: z.string(), changeDescription: changeDescription.optional(), screen: optScreen, projectId: optProject },
    destructive: true,
  },
  {
    name: 'get_screenshot',
    title: 'Screenshot',
    description: 'Capture a PNG of a screen as it renders in the browser. Use it to check your work.',
    input: { screen: optScreen, projectId: optProject },
    readOnly: true,
  },
  {
    name: 'get_design_settings',
    title: 'Get design settings',
    description: 'Return the project design settings (device, theme, accent color, font, icon set, viewport) and the designPrompt brief.',
    input: { projectId: optProject },
    readOnly: true,
  },
  {
    name: 'set_design_settings',
    title: 'Set design settings',
    description: 'Update project design settings and/or the designPrompt brief. Only pass what changes.',
    input: {
      device: z.enum(['iPhone 16', 'Web']).optional(),
      theme: z.enum(['Light', 'Dark']).optional(),
      accentColor: z.string().optional(),
      fontFamily: z.string().optional(),
      iconLibrary: z.string().optional(),
      designPrompt: z.string().optional(),
      projectId: optProject,
    },
  },
  {
    name: 'get_selection',
    title: 'Get selection and notes',
    description: 'Return the element the user selected on the canvas and the notes they left on elements for you (with screen, data-ps-id and outerHTML). Call it when the user says "this", "selected" or mentions their notes.',
    input: { clearNotes: z.boolean().optional().describe('Clear the notes after reading them (do this once you have applied them)'), projectId: optProject },
  },
  {
    name: 'auto_prototype',
    title: 'Prototype map',
    description: 'Return every screen with a slim element tree so you can decide which buttons, tabs and cards should link to which screens. Follow up with set_links.',
    input: { projectId: optProject },
    readOnly: true,
  },
  {
    name: 'set_links',
    title: 'Set prototype links',
    description: 'Make elements navigate to other screens in prototype (play) mode.',
    input: {
      links: z.array(z.object({
        screenIndex: z.number().int().describe('Index of the screen that contains the element'),
        nodeId: z.string().describe('data-ps-id of the element'),
        targetScreen: z.string().describe('Exact name of the destination screen'),
      })),
      projectId: optProject,
    },
  },
]

const LABELS = {
  open_project: 'Opening project',
  create_project: (a) => `Creating project "${a.name}"`,
  list_screens: 'Listing screens',
  create_screen: (a) => `Creating screen "${a.name || 'New screen'}"`,
  switch_screen: (a) => `Switching to ${a.screen}`,
  rename_screen: (a) => `Renaming screen to "${a.name}"`,
  delete_screen: (a) => `Deleting screen ${a.screen}`,
  get_screen_html: 'Reading screen HTML',
  write_html: 'Designing screen',
  get_tree: 'Reading layers',
  set_text: 'Editing text',
  set_class: 'Restyling element',
  set_style: 'Styling element',
  replace_node_html: 'Replacing element',
  remove_node: 'Removing element',
  get_screenshot: 'Taking a screenshot',
  get_design_settings: 'Reading design settings',
  set_design_settings: 'Updating design settings',
  get_selection: 'Reading your selection',
  auto_prototype: 'Mapping prototype links',
  set_links: (a) => `Linking ${(a.links || []).length} element(s)`,
  add_image: 'Adding an image',
  search_images: (a) => `Searching photos: ${a.query}`,
}

function summarize(name, args) {
  if (args && args.changeDescription) return args.changeDescription
  const l = LABELS[name]
  return typeof l === 'function' ? l(args || {}) : (l || name)
}

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] })
const fail = (message) => ({ content: [{ type: 'text', text: `Error: ${String(message).replace(/^Error:\s*/, '')}` }], isError: true })

function createToolRunner({ store, bridge, openUrl, baseUrl }) {
  let currentProjectId = null

  const projectUrl = (id) => `${baseUrl()}/p/${id}`

  function resolveProjectId(args) {
    const id = (args && args.projectId) || bridge.activeProjectId() || currentProjectId
    if (!id) return null
    return store.get(id) ? id : null
  }

  async function ensureEditor(projectId) {
    if (bridge.hasEditor(projectId)) return true
    openUrl(projectUrl(projectId))
    return bridge.waitForEditor(projectId, 25000)
  }

  async function runServerTool(name, args) {
    switch (name) {
      case 'list_projects': {
        const active = bridge.activeProjectId()
        const projects = store.list().map(p => ({
          id: p.id,
          name: p.name,
          screens: (p.screens || []).map(s => s.name),
          device: p.settings && p.settings.device,
          updatedAt: p.updatedAt,
          openInBrowser: bridge.hasEditor(p.id),
          current: p.id === (active || currentProjectId),
        }))
        return text(projects.length ? { projects } : { projects: [], hint: 'No projects yet. Call create_project.' })
      }
      case 'create_project': {
        const p = store.create({ name: args.name, device: args.device })
        currentProjectId = p.id
        const opened = await ensureEditor(p.id)
        return text({ projectId: p.id, name: p.name, url: projectUrl(p.id), openInBrowser: opened, next: 'Call get_design_guide (once per session), then create_screen and write_html.' })
      }
      case 'open_project': {
        const p = store.get(args.projectId)
        if (!p) return fail(`Project not found: ${args.projectId}`)
        currentProjectId = p.id
        const opened = await ensureEditor(p.id)
        if (!opened) return fail(`Opened ${projectUrl(p.id)} but the editor did not connect. Ask the user to open that URL.`)
        return text({ projectId: p.id, name: p.name, url: projectUrl(p.id), screens: (p.screens || []).map((s, i) => ({ index: i, name: s.name })), designPrompt: p.designPrompt || '' })
      }
      case 'get_design_guide':
        return text(DESIGN_GUIDE)
      case 'search_images':
        return text(await searchImages(args))
      case 'add_image': {
        const projectId = resolveProjectId(args)
        if (!projectId) return fail('No project is open. Call create_project or open_project first.')
        const res = await addImage(store, projectId, args)
        return text({ ...res, usage: `<img src="${res.url}" class="w-full h-48 object-cover rounded-2xl" alt="">` })
      }
    }
    return fail(`Unknown tool: ${name}`)
  }

  async function runEditorTool(name, args) {
    const projectId = resolveProjectId(args)
    if (!projectId) return fail('No project is open. Call list_projects and open_project, or create_project.')
    currentProjectId = projectId
    if (!(await ensureEditor(projectId))) {
      return fail(`The editor is not open. Ask the user to open ${projectUrl(projectId)} in their browser, then try again.`)
    }
    const editorArgs = { ...args }
    delete editorArgs.projectId
    const result = await bridge.call(projectId, name, editorArgs)

    if (result && result.error) return fail(result.error)
    if (result && result._screenshot && result.data) {
      return { content: [{ type: 'image', data: result.data, mimeType: 'image/png' }] }
    }
    return text(result === undefined ? { success: true } : result)
  }

  async function run(name, args = {}) {
    const def = TOOLS.find(t => t.name === name)
    if (!def) return fail(`Unknown tool: ${name}`)

    const projectId = resolveProjectId(args)
    const activityId = Math.random().toString(36).slice(2)
    const notify = (status, error) => {
      if (projectId && name !== 'list_projects' && name !== 'get_design_guide') {
        bridge.broadcast(projectId, { type: 'agent_activity', id: activityId, tool: name, summary: summarize(name, args), status, error })
      }
    }
    notify('running')
    try {
      const result = def.server ? await runServerTool(name, args) : await runEditorTool(name, args)
      notify(result.isError ? 'error' : 'done', result.isError ? result.content[0].text : undefined)
      return result
    } catch (err) {
      notify('error', err.message)
      return fail(err.message)
    }
  }

  return { run, setCurrentProject: (id) => { currentProjectId = id } }
}

module.exports = { TOOLS, createToolRunner }
