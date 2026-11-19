// ==================== LOCAL MODE ====================
// Verso runs on localhost with no accounts. Kept as a no-op so older call
// sites stay simple.
async function getAuthHeaders() { return {}; }

// ==================== STATE ====================
const state = {
  projectId: null,
  projectName: 'Untitled',
  screens: [],
  activeScreenIndex: 0,
  settings: {
    device: 'iPhone 16',
    theme: 'Light',
    accentColor: '#007AFF',
    fontFamily: '\u2014',
    iconLibrary: '\u2014',
  },

  isConnected: false,
  isWorking: false,
  prototypeMode: false,
  protoHistory: [],
  protoHistoryIndex: -1,
  entryScreenIndex: 0,
  zoom: 0.75,
  panX: 0,
  panY: 0,
  appTheme: (() => { try { return localStorage.getItem('verso-theme') || 'dark'; } catch { return 'dark'; } })(),
  designPrompt: '',
  selection: null,   // element the user clicked: { screenIndex, nodeId, tag, name }
  agentNotes: [],    // notes the user left on elements for the agent
};

// ==================== THEME ====================
function applyAppTheme() {
  document.documentElement.setAttribute('data-theme', state.appTheme);
  const sunIcon = document.getElementById('icon-sun');
  const moonIcon = document.getElementById('icon-moon');
  if (state.appTheme === 'dark') {
    sunIcon.style.display = '';
    moonIcon.style.display = 'none';
  } else {
    sunIcon.style.display = 'none';
    moonIcon.style.display = '';
  }
}

function toggleTheme() {
  state.appTheme = state.appTheme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('verso-theme', state.appTheme);
  applyAppTheme();
}

// ==================== WEBSOCKET ====================
let ws = null;
let workingTimeout = null;

async function connectWS() {
  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${wsProtocol}//${location.host}/ws`);
  ws.onopen = () => {
    state.isConnected = true;
    renderConnectionStatus();
    // Register with project ID so messages are scoped
    if (state.projectId) ws.send(JSON.stringify({ type: 'register', projectId: state.projectId }));
  };
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'agent_activity') { onAgentActivity(msg); return; }
      if (msg.type === 'project_renamed') { applyProjectName(msg.name); return; }
      if (msg.tool) handleToolCall(msg);
    } catch(e) { console.error('WS parse error:', e); }
  };
  ws.onclose = () => {
    state.isConnected = false;
    renderConnectionStatus();
    setTimeout(connectWS, 1500);
  };
  ws.onerror = () => {};
}

// Tell the server which tab the user is looking at, so agent calls go there.
window.addEventListener('focus', () => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'focus' }));
});

// ==================== TOOL CALL HANDLER ====================
async function handleToolCall(msg) {
  const { id, tool, args } = msg;
  // The "working" shimmer is for changes; reads should not blur the screen.
  const READ_ONLY = ['get_tree', 'get_selection', 'list_screens', 'get_screen_html', 'get_design_settings', 'get_screenshot', 'auto_prototype'];
  const showWorking = !READ_ONLY.includes(tool);
  if (showWorking) {
    state.isWorking = true;
    renderWorkingState();
    clearTimeout(workingTimeout);
  }

  let result;
  try {
    const SCREEN_SCOPED = ['write_html', 'get_tree', 'set_text', 'set_style', 'set_class', 'replace_node_html', 'remove_node', 'get_screenshot'];
    if (SCREEN_SCOPED.includes(tool) && args && args.screen !== undefined && args.screen !== null) {
      const idx = findScreenIndex(args.screen);
      if (idx < 0) throw new Error(`Screen not found: ${args.screen}`);
      handleSwitchScreen({ index: idx });
    }
    if (tool === 'write_html' && state.screens.length === 0) handleCreateScreen({ name: 'Screen 1' });
    if (SCREEN_SCOPED.includes(tool)) await whenFrameReady(getActiveIframe());
    switch (tool) {
      case 'write_html': result = await handleWriteHtml(args); break;
      case 'get_tree': result = await handleGetTree(); break;
      case 'set_text': result = handleSetText(args); break;
      case 'set_style': result = handleSetStyle(args); break;
      case 'remove_node': result = handleRemoveNode(args); break;
      case 'get_screenshot': result = await handleGetScreenshot(); break;
      case 'create_screen': result = handleCreateScreen(args); break;
      case 'list_screens': result = handleListScreens(); break;
      case 'switch_screen': result = handleSwitchScreen(args); break;
      case 'get_design_settings': result = handleGetDesignSettings(); break;
      case 'set_design_settings': result = handleSetDesignSettings(args); break;
      case 'auto_prototype': result = await handleAutoPrototype(); break;
      case 'set_links': result = handleSetLinks(args); break;
      case 'set_class': result = handleSetClass(args); break;
      case 'replace_node_html': result = handleReplaceNode(args); break;
      case 'delete_screen': result = handleDeleteScreenTool(args); break;
      case 'rename_screen': result = handleRenameScreenTool(args); break;
      case 'get_screen_html': result = handleGetScreenHtml(args); break;
      case 'get_selection': result = handleGetSelection(args); break;
      default: result = { error: `Unknown tool: ${tool}` };
    }
  } catch (err) { result = { error: err.message }; }

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ id, result }));
  }

  // Keep the screen the agent is working on in view.
  // New screens: fit everything while that stays readable, else pan to it.
  if (!result || !result.error) {
    if (tool === 'create_screen' && fitZoomValue() >= 0.35) animateView(zoomFit);
    else if (['create_screen', 'switch_screen', 'write_html'].includes(tool) || (args && args.screen !== undefined)) animateView(() => revealScreen(state.activeScreenIndex));
  }

  if (showWorking) {
    workingTimeout = setTimeout(() => {
      state.isWorking = false;
      renderWorkingState();
    }, 800);
  }
}

// ==================== SNAP ALIGNMENT ====================
const SNAP_THRESHOLD = 8;

function getSnapGuides(nx, ny, draggedId) {
  const phoneW = 393 + 12;
  const phoneH = 852 + 12 + 40;

  const cur = {
    l: nx, cx: nx + phoneW / 2, r: nx + phoneW,
    t: ny, cy: ny + phoneH / 2, b: ny + phoneH,
  };

  let bestDx = SNAP_THRESHOLD + 1, bestDy = SNAP_THRESHOLD + 1;
  const result = { x: null, y: null };

  state.screens.forEach(s => {
    if (s.id === draggedId) return;
    const ox = s.x || 0, oy = s.y || 0;
    const o = {
      l: ox, cx: ox + phoneW / 2, r: ox + phoneW,
      t: oy, cy: oy + phoneH / 2, b: oy + phoneH,
    };

    for (const ck of ['l', 'cx', 'r']) {
      for (const ok of ['l', 'cx', 'r']) {
        const d = Math.abs(cur[ck] - o[ok]);
        if (d < bestDx) {
          bestDx = d;
          result.x = { snapTo: o[ok], offset: o[ok] - cur[ck] };
        }
      }
    }
    for (const ck of ['t', 'cy', 'b']) {
      for (const ok of ['t', 'cy', 'b']) {
        const d = Math.abs(cur[ck] - o[ok]);
        if (d < bestDy) {
          bestDy = d;
          result.y = { snapTo: o[ok], offset: o[ok] - cur[ck] };
        }
      }
    }
  });

  if (bestDx > SNAP_THRESHOLD) result.x = null;
  if (bestDy > SNAP_THRESHOLD) result.y = null;
  return result;
}

function showSnapGuides(snap) {
  let el = document.getElementById('snap-guides');
  if (!el) {
    el = document.createElement('div');
    el.id = 'snap-guides';
    document.getElementById('canvas-transform').appendChild(el);
  }
  el.innerHTML = '';
  if (snap.x) {
    const v = document.createElement('div');
    v.className = 'snap-guide snap-guide-v';
    v.style.left = snap.x.snapTo + 'px';
    el.appendChild(v);
  }
  if (snap.y) {
    const h = document.createElement('div');
    h.className = 'snap-guide snap-guide-h';
    h.style.top = snap.y.snapTo + 'px';
    el.appendChild(h);
  }
}

function hideSnapGuides() {
  const el = document.getElementById('snap-guides');
  if (el) el.innerHTML = '';
}

// ==================== SCREEN DOM HELPERS ====================
// Resolves once the renderer inside a screen iframe is ready for messages.
// Agents often call create_screen and write_html back to back, before the
// new iframe has finished loading.
function whenFrameReady(iframe, timeoutMs = 8000) {
  if (!iframe) return Promise.resolve();
  const ready = () => {
    try { return !!(iframe.contentWindow && iframe.contentWindow.PS && iframe.contentDocument.readyState === 'complete'); } catch { return false; }
  };
  if (ready()) return Promise.resolve();
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (ready() || Date.now() - started > timeoutMs) return resolve();
      setTimeout(tick, 50);
    };
    tick();
  });
}

function getActiveIframe() {
  const screen = state.screens[state.activeScreenIndex];
  if (!screen) return null;
  return document.querySelector(`.renderer-frame[data-screen-id="${screen.id}"]`);
}

function createScreenDOM(screen) {
  const wrapper = document.createElement('div');
  wrapper.className = 'screen-wrapper';
  wrapper.dataset.screenId = screen.id;
  wrapper.style.left = (screen.x || 0) + 'px';
  wrapper.style.top = (screen.y || 0) + 'px';

  const screenIdx = state.screens.indexOf(screen);
  const isEntry = screenIdx === state.entryScreenIndex;
  const entryDot = isEntry
    ? '<span class="entry-dot" title="Entry point"></span>'
    : '';

  // Single "more" button sits next to the screen label. Clicking it opens a
  // dropdown menu with all per-screen actions (copy, export, rename, entry
  // point, delete) so we don't pollute the canvas with a row of icons.
  wrapper.innerHTML = `
    <div class="screen-header" data-screen-id="${screen.id}">
      ${entryDot}
      <div class="screen-label" data-screen-id="${screen.id}">${escapeHtml(screen.name)}</div>
      <button class="screen-more-btn" data-screen-id="${screen.id}" aria-label="Screen actions">
        <iconify-icon icon="solar:menu-dots-bold" width="16" height="16"></iconify-icon>
      </button>
    </div>
    <div class="phone-container">
      <div class="phone-frame">
        <iframe class="renderer-frame" data-screen-id="${screen.id}" src="/renderer.html"></iframe>
      </div>
    </div>
  `;

  // Wire the more-button to open the menu (the menu itself is rendered once
  // in #screen-menu-popup and reused per click).
  const moreBtn = wrapper.querySelector('.screen-more-btn');
  if (moreBtn) {
    moreBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openScreenMenu(screen.id, moreBtn);
    });
    moreBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  // NOTE: right-click context menu removed in favour of the always-visible
  // floating action toolbar. All its actions live there now.

  // NOTE: clicking a screen intentionally does NOT change the active screen
  // anymore. The "active screen" concept is only used as a write target for
  // AI actions; it is set programmatically by create_screen / switch_screen
  // and preserved across user clicks so the AI doesn't accidentally overwrite
  // the wrong screen when the user was just inspecting another one.

  // Drag to reposition screen — auto-pans canvas near edges
  let dragStartX, dragStartY, origX, origY;
  let screenDragging = false;
  let dragThresholdMet = false;
  let autoPanRAF = null;
  let lastPointerX = 0, lastPointerY = 0;
  let accPanX = 0, accPanY = 0; // accumulated auto-pan offset (world-space)

  const EDGE_ZONE = 80;
  const PAN_SPEED = 10;

  function updateScreenPos() {
    const s = state.screens.find(s => s.id === screen.id);
    const dx = (lastPointerX - dragStartX) / state.zoom;
    const dy = (lastPointerY - dragStartY) / state.zoom;
    let nx = origX + dx + accPanX;
    let ny = origY + dy + accPanY;

    // Snap alignment
    const snap = getSnapGuides(nx, ny, screen.id);
    if (snap.x) nx += snap.x.offset;
    if (snap.y) ny += snap.y.offset;
    showSnapGuides(snap);

    wrapper.style.left = nx + 'px';
    wrapper.style.top = ny + 'px';
    if (s) { s.x = nx; s.y = ny; }
    scheduleArrowUpdate();
  }

  function autoPanTick() {
    if (!screenDragging || !dragThresholdMet) return;
    const rect = canvasArea.getBoundingClientRect();

    const left = lastPointerX - rect.left;
    const right = rect.right - lastPointerX;
    const top = lastPointerY - rect.top;
    const bottom = rect.bottom - lastPointerY;

    let dpx = 0, dpy = 0;
    if (left < EDGE_ZONE && left >= 0) dpx = PAN_SPEED * (1 - left / EDGE_ZONE);
    else if (right < EDGE_ZONE && right >= 0) dpx = -PAN_SPEED * (1 - right / EDGE_ZONE);
    if (top < EDGE_ZONE && top >= 0) dpy = PAN_SPEED * (1 - top / EDGE_ZONE);
    else if (bottom < EDGE_ZONE && bottom >= 0) dpy = -PAN_SPEED * (1 - bottom / EDGE_ZONE);

    if (dpx !== 0 || dpy !== 0) {
      state.panX += dpx;
      state.panY += dpy;
      accPanX -= dpx / state.zoom;
      accPanY -= dpy / state.zoom;
      applyTransform();
      updateScreenPos();
    }

    autoPanRAF = requestAnimationFrame(autoPanTick);
  }

  wrapper.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.tagName === 'IFRAME') return;
    e.stopPropagation();
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    accPanX = 0;
    accPanY = 0;
    const s = state.screens.find(s => s.id === screen.id);
    origX = s?.x || 0;
    origY = s?.y || 0;
    screenDragging = true;
    dragThresholdMet = false;
    wrapper.setPointerCapture(e.pointerId);
  });

  wrapper.addEventListener('pointermove', (e) => {
    if (!screenDragging) return;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;

    if (!dragThresholdMet) {
      const dx = Math.abs(e.clientX - dragStartX);
      const dy = Math.abs(e.clientY - dragStartY);
      if (dx < 5 && dy < 5) return;
      dragThresholdMet = true;
      wrapper.classList.add('dragging');
      autoPanRAF = requestAnimationFrame(autoPanTick);
    }

    updateScreenPos();
    wrapper._didDrag = true;
  });

  const onScreenDragEnd = () => {
    if (!screenDragging) return;
    screenDragging = false;
    if (autoPanRAF) { cancelAnimationFrame(autoPanRAF); autoPanRAF = null; }
    hideSnapGuides();
    if (dragThresholdMet) {
      wrapper.classList.remove('dragging');
      updateCanvasContentSize();
      applyTransform();
      renderPrototypeArrows();
      saveState();
    }
  };
  wrapper.addEventListener('pointerup', onScreenDragEnd);
  wrapper.addEventListener('pointercancel', onScreenDragEnd);

  return wrapper;
}

function updateActiveScreenHighlight() {
  document.querySelectorAll('.screen-wrapper').forEach(w => w.classList.remove('active'));
  const screen = state.screens[state.activeScreenIndex];
  if (screen) {
    const wrapper = document.querySelector(`.screen-wrapper[data-screen-id="${screen.id}"]`);
    if (wrapper) wrapper.classList.add('active');
  }
  updateScreenLabels();
}

function updateScreenLabels() {
  state.screens.forEach(screen => {
    const wrapper = document.querySelector(`.screen-wrapper[data-screen-id="${screen.id}"]`);
    if (wrapper) {
      const label = wrapper.querySelector('.screen-label');
      if (label) label.textContent = screen.name;
    }
  });
}

// ==================== TOOL IMPLEMENTATIONS ====================
function handleWriteHtml(args) {
  const { html, platform, theme, accentColor, fontFamily, iconLibrary, targetNodeId, changeDescription, designPrompt } = args;

  if (platform) state.settings.device = platform;
  if (theme) state.settings.theme = theme;
  if (accentColor) state.settings.accentColor = accentColor;
  if (fontFamily) state.settings.fontFamily = fontFamily;
  if (iconLibrary) state.settings.iconLibrary = iconLibrary;
  if (designPrompt !== undefined) state.designPrompt = designPrompt;

  const screen = state.screens[state.activeScreenIndex];
  screen.html = html;
  pushHistory(screen, changeDescription || (targetNodeId ? 'Update component' : 'Design update'));

  const iframe = getActiveIframe();
  if (!iframe) return { error: 'No active screen iframe' };

  if (targetNodeId) {
    iframe.contentWindow.postMessage({ type: 'insertComponent', parentId: targetNodeId, html, position: args.mode || 'replace' }, '*');
  } else {
    iframe.contentWindow.postMessage({ type: 'setHTML', html }, '*');
  }

  if (platform === 'Web') {
    iframe.contentWindow.postMessage({ type: 'setViewportWidth', width: 1440 }, '*');
  } else {
    iframe.contentWindow.postMessage({ type: 'setViewportWidth', width: 393 }, '*');
  }

  renderScreenList();
  renderInspector();
  saveState();

  // Refresh arrows after content changes (links may have been added)
  setTimeout(() => renderPrototypeArrows(), 300);

  // Extract design memory from generated HTML
  updateDesignMemory(html);

  return {
    success: true, message: 'OK',
    viewport: platform === 'Web' ? { width: 1440, height: 900 } : { width: 393, height: 852 },
    designSettings: state.settings,
  };
}

// Extracts the canonical <style type="text/tailwindcss">...</style> block plus any
// <link rel="stylesheet" href="fonts.googleapis.com/..."> tags so the exact same tokens
// and fonts can be re-used verbatim on new screens — the main consistency lever.
function extractThemeBlock(html) {
  if (!html) return '';
  const styleMatch = html.match(/<style[^>]*type="text\/tailwindcss"[^>]*>[\s\S]*?<\/style>/i);
  const linkMatches = html.match(/<link[^>]*fonts\.googleapis\.com[^>]*>/gi) || [];
  if (!styleMatch && !linkMatches.length) return '';
  return [...linkMatches, styleMatch ? styleMatch[0] : ''].filter(Boolean).join('\n');
}

function updateDesignMemory(html) {
  if (!html || html.length < 100) return;
  const mem = state.designMemory || {};

  // Extract and persist the canonical theme block for reuse on subsequent screens.
  const theme = extractThemeBlock(html);
  if (theme) mem.themeBlock = theme;

  // Extract colors from CSS custom properties or inline styles
  const colorMatches = html.match(/#[0-9A-Fa-f]{3,8}/g) || [];
  const colors = [...new Set(colorMatches)].slice(0, 12);
  if (colors.length) mem.colors = colors;

  // Extract font families
  const fontMatch = html.match(/family=([^&"']+)/g);
  if (fontMatch) {
    mem.fonts = [...new Set(fontMatch.map(f => decodeURIComponent(f.replace('family=', '').replace(/\+/g, ' ').split(':')[0])))].slice(0, 3);
  }

  // Extract icon library usage
  if (html.includes('iconify-icon')) {
    const iconSets = html.match(/icon="(\w+):/g);
    if (iconSets) mem.iconSets = [...new Set(iconSets.map(s => s.replace('icon="', '').replace(':', '')))].slice(0, 3);
  }

  // Extract layout patterns (bottom nav, headers, cards, etc.)
  const patterns = [];
  if (html.includes('fixed') && html.includes('bottom')) patterns.push('bottom-tab-bar');
  if (html.match(/pt-1[0-2]/)) patterns.push('status-bar-padding');
  if (html.includes('rounded-') && html.includes('shadow')) patterns.push('card-based-layout');
  if (html.includes('grid')) patterns.push('grid-layout');
  if (html.includes('gradient')) patterns.push('gradients');
  if (patterns.length) mem.patterns = [...new Set([...(mem.patterns || []), ...patterns])].slice(0, 8);

  // Extract component snippets (compact: just class patterns for key sections)
  const navMatch = html.match(/class="[^"]*(?:tab-bar|bottom-nav|nav)[^"]*"/g);
  if (navMatch) mem.navStyle = navMatch[0].slice(0, 100);

  state.designMemory = mem;

  // Auto-detect design settings from generated HTML
  let settingsChanged = false;

  // Detect font
  if (mem.fonts && mem.fonts.length > 0 && (state.settings.fontFamily === '—' || !state.settings.fontFamily)) {
    state.settings.fontFamily = mem.fonts[0];
    settingsChanged = true;
  }

  // Detect icon library
  if (mem.iconSets && mem.iconSets.length > 0 && (state.settings.iconLibrary === '—' || !state.settings.iconLibrary)) {
    state.settings.iconLibrary = mem.iconSets[0].charAt(0).toUpperCase() + mem.iconSets[0].slice(1);
    settingsChanged = true;
  }

  // Detect accent color from --primary CSS variable
  const primaryMatch = html.match(/--primary:\s*(#[0-9A-Fa-f]{3,8})/);
  if (primaryMatch && state.settings.accentColor !== primaryMatch[1]) {
    state.settings.accentColor = primaryMatch[1];
    settingsChanged = true;
  }

  // Detect theme from --background
  const bgMatch = html.match(/--background:\s*(#[0-9A-Fa-f]{3,8})/);
  if (bgMatch) {
    const isDark = parseInt(bgMatch[1].replace('#', '').slice(0, 2), 16) < 40;
    const newTheme = isDark ? 'Dark' : 'Light';
    if (state.settings.theme !== newTheme) {
      state.settings.theme = newTheme;
      settingsChanged = true;
    }
  }

  if (settingsChanged) renderInspector();
  saveState();
}

function handleGetTree() {
  const iframe = getActiveIframe();
  if (!iframe || !iframe.contentWindow) return [];
  return new Promise((resolve) => {
    const onMsg = (event) => {
      if (event.data && event.data.type === 'treeResult') {
        window.removeEventListener('message', onMsg);
        try { resolve(JSON.parse(event.data.tree)); } catch(e) { resolve([]); }
      }
    };
    window.addEventListener('message', onMsg);
    iframe.contentWindow.postMessage({ type: 'getTree' }, '*');
    setTimeout(() => { window.removeEventListener('message', onMsg); resolve([]); }, 3000);
  });
}

function syncScreenHTML(screen, iframe) {
  if (!iframe || !iframe.contentDocument) return;
  const canvas = iframe.contentDocument.getElementById('canvas');
  if (!canvas) return;

  // Clone canvas and strip data-ps-id attrs (they're re-assigned on setHTML)
  const clone = canvas.cloneNode(true);
  clone.querySelectorAll('[data-ps-id]').forEach(el => el.removeAttribute('data-ps-id'));
  const bodyHTML = clone.innerHTML;

  // Extract meta parts (links, styles, theme) from original screen.html
  const orig = screen.html || '';
  const parts = [];
  (orig.match(/<link[^>]*>/gi) || []).forEach(l => parts.push(l));
  (orig.match(/<style[^>]*type="text\/tailwindcss"[^>]*>[\s\S]*?<\/style>/gi) || []).forEach(s => parts.push(s));
  (orig.match(/<style(?![^>]*type="text\/tailwindcss")[^>]*>[\s\S]*?<\/style>/gi) || []).forEach(s => parts.push(s));
  parts.push(bodyHTML);
  screen.html = parts.join('\n');
}

function handleSetText(args) {
  const iframe = getActiveIframe();
  if (!iframe || !iframe.contentWindow) return { error: 'No active iframe' };
  const screen = state.screens[state.activeScreenIndex];
  iframe.contentWindow.PS.setText(args.nodeId, args.text);
  syncScreenHTML(screen, iframe);
  pushHistory(screen, args.changeDescription || 'Edit text');
  renderScreenList();
  saveState();
  return { success: true };
}

function handleSetStyle(args) {
  const iframe = getActiveIframe();
  if (!iframe || !iframe.contentWindow) return { error: 'No active iframe' };
  const screen = state.screens[state.activeScreenIndex];
  iframe.contentWindow.PS.setStyle(args.nodeId, args.css);
  syncScreenHTML(screen, iframe);
  pushHistory(screen, args.changeDescription || 'Edit style');
  renderScreenList();
  saveState();
  return { success: true };
}

function handleRemoveNode(args) {
  const iframe = getActiveIframe();
  if (!iframe || !iframe.contentWindow) return { error: 'No active iframe' };
  const screen = state.screens[state.activeScreenIndex];
  iframe.contentWindow.PS.removeNode(args.nodeId);
  syncScreenHTML(screen, iframe);
  pushHistory(screen, args.changeDescription || 'Remove element');
  renderScreenList();
  saveState();
  return { success: true };
}

function handleSetClass(args) {
  const iframe = getActiveIframe();
  if (!iframe || !iframe.contentWindow) return { error: 'No active iframe' };
  const screen = state.screens[state.activeScreenIndex];
  const res = iframe.contentWindow.PS.setClass(args.nodeId, args.className);
  if (typeof res === 'string' && res.startsWith('Error')) return { error: res };
  syncScreenHTML(screen, iframe);
  pushHistory(screen, args.changeDescription || 'Update classes');
  renderScreenList();
  saveState();
  return { success: true };
}

function handleReplaceNode(args) {
  const iframe = getActiveIframe();
  if (!iframe || !iframe.contentWindow) return { error: 'No active iframe' };
  const screen = state.screens[state.activeScreenIndex];
  const res = iframe.contentWindow.PS.replaceNode(args.nodeId, args.html);
  if (typeof res === 'string' && res.startsWith('Error')) return { error: res };
  syncScreenHTML(screen, iframe);
  pushHistory(screen, args.changeDescription || 'Replace component');
  renderScreenList();
  saveState();
  return { success: true };
}

// Wait for web fonts and images inside a screen, so a screenshot taken right
// after write_html does not catch a half-loaded page.
async function waitForScreenAssets(iframeDoc, timeoutMs = 4000) {
  const timeout = new Promise(r => setTimeout(r, timeoutMs));
  const fonts = iframeDoc.fonts ? iframeDoc.fonts.ready : Promise.resolve();
  const images = Array.from(iframeDoc.images).map(img =>
    img.complete ? null : new Promise(r => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); })
  ).filter(Boolean);
  await Promise.race([Promise.all([fonts, ...images]), timeout]);
}

// True when every sampled pixel has the same color, i.e. nothing rendered.
function looksBlank(canvas) {
  const w = 24, h = 48;
  const small = document.createElement('canvas');
  small.width = w; small.height = h;
  const ctx = small.getContext('2d');
  ctx.drawImage(canvas, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  for (let i = 4; i < d.length; i += 4) {
    if (Math.abs(d[i] - d[0]) > 6 || Math.abs(d[i + 1] - d[1]) > 6 || Math.abs(d[i + 2] - d[2]) > 6) return false;
  }
  return true;
}

async function handleGetScreenshot() {
  const iframe = getActiveIframe();
  if (!iframe || !iframe.contentDocument) return { error: 'No active screen' };
  const iframeDoc = iframe.contentDocument;
  const contentEl = iframeDoc.querySelector('#canvas');
  if (!contentEl) return { error: 'No content to capture' };
  const screen = state.screens[state.activeScreenIndex];
  const hasContent = !!(screen && screen.html && screen.html.length > 80);
  const web = state.settings.device === 'Web';
  const width = web ? 1440 : 393;
  const height = web ? 900 : 852;

  await waitForScreenAssets(iframeDoc);

  let captured = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      captured = await captureScreenCanvas(iframe, { width, height, scale: web ? 1 : 2 });
    } catch (e) {
      return { error: 'Screenshot capture failed: ' + e.message };
    }
    if (!hasContent || !looksBlank(captured)) break;
    await new Promise(r => setTimeout(r, 700));
  }
  const base64 = captured.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
  return { _screenshot: true, data: base64 };
}

function handleCreateScreen(args) {
  const name = args.name || `Screen ${state.screens.length + 1}`;
  // Place new screen to the right of the rightmost screen
  const phoneW = 393 + 12;
  const gap = 60;
  let maxRight = 0;
  state.screens.forEach(s => {
    const right = (s.x || 0) + phoneW;
    if (right > maxRight) maxRight = right;
  });
  const screen = { id: String(Date.now()), name, html: '', x: state.screens.length > 0 ? maxRight + gap : 0, y: 0 };
  state.screens.push(screen);
  state.activeScreenIndex = state.screens.length - 1;

  // Add new phone frame to canvas
  const container = document.getElementById('screens-container');
  const wrapper = createScreenDOM(screen);
  container.appendChild(wrapper);

  updateActiveScreenHighlight();
  updateCanvasContentSize();
  renderScreenList();
  applyTransform();
  saveState();
  if (typeof refreshPhoneWorking === 'function') refreshPhoneWorking();
  return { success: true, screenIndex: state.screens.length - 1, viewport: { width: 393, height: 852 } };
}

function handleListScreens() {
  return state.screens.map((s, i) => ({ index: i, name: s.name, active: i === state.activeScreenIndex }));
}

function handleSwitchScreen(args) {
  let targetIndex = -1;
  if (args.screen !== undefined) targetIndex = findScreenIndex(args.screen);
  else if (args.index !== undefined) targetIndex = args.index;
  else if (args.name) targetIndex = state.screens.findIndex(s => s.name.toLowerCase() === args.name.toLowerCase());

  if (targetIndex < 0 || targetIndex >= state.screens.length) return { error: 'Screen not found' };

  state.activeScreenIndex = targetIndex;
  updateActiveScreenHighlight();
  renderScreenList();
  if (typeof refreshPhoneWorking === 'function') refreshPhoneWorking();

  return { success: true, screen: state.screens[targetIndex].name };
}

function handleGetDesignSettings() {
  return {
    ...state.settings,
    viewport: state.settings.device === 'Web' ? { width: 1440, height: 900 } : { width: 393, height: 852 },
    designPrompt: state.designPrompt || '',
  };
}

function handleSetDesignSettings(args) {
  const { device, theme, accentColor, fontFamily, iconLibrary, designPrompt } = args;
  if (designPrompt !== undefined) state.designPrompt = designPrompt;
  if (device) state.settings.device = device;
  if (theme) state.settings.theme = theme;
  if (accentColor) state.settings.accentColor = accentColor;
  if (fontFamily) state.settings.fontFamily = fontFamily;
  if (iconLibrary) state.settings.iconLibrary = iconLibrary;
  renderInspector();
  saveState();
  return { success: true, settings: state.settings };
}

// ==================== AUTO PROTOTYPE ====================
async function handleAutoPrototype() {
  // Slim down tree: keep structure but only id+name, drop childless non-interesting leaves
  function slimTree(nodes, depth) {
    if (depth > 8) return []; // cap depth
    const result = [];
    for (const node of nodes) {
      const kids = node.children ? slimTree(node.children, depth + 1) : [];
      const hasKids = kids.length > 0;
      const isLeafIcon = node.tag === 'svg' || node.tag === 'iconify-icon';

      // Skip deep childless divs/spans with generic names — they're layout noise
      if (!hasKids && !isLeafIcon && depth > 3) {
        const name = (node.name || '').toLowerCase();
        if (!name || /^(div|span|section|container|wrapper|flex|grid)$/i.test(name)) continue;
      }

      const slim = { id: node.id };
      if (node.name) slim.name = node.name;
      if (node.tag === 'a' || node.tag === 'button' || node.tag === 'img' || node.tag === 'nav') slim.tag = node.tag;
      if (node.link) slim.link = node.link;
      if (hasKids) slim.children = kids;
      result.push(slim);
    }
    return result;
  }

  const screens = [];
  for (let i = 0; i < state.screens.length; i++) {
    const screen = state.screens[i];
    const iframe = document.querySelector(`.renderer-frame[data-screen-id="${screen.id}"]`);
    let tree = [];
    if (iframe && iframe.contentWindow && iframe.contentWindow.PS) {
      try {
        tree = JSON.parse(iframe.contentWindow.PS.getTree());
      } catch(e) {}
    }
    screens.push({ index: i, name: screen.name, tree: slimTree(tree, 0) });
  }

  return {
    screens,
    instructions: 'Analyze all screens and their elements. Link interactive elements (buttons, tabs, images, cards, avatars, CTAs, back arrows) to target screens using set_links. Match by semantic meaning — e.g. a profile avatar links to Profile, a cart icon links to Cart.',
  };
}

function handleSetLinks(args) {
  const { links } = args;
  if (!links || !Array.isArray(links)) return { error: 'links array required' };

  let applied = 0;
  for (const link of links) {
    const { screenIndex, nodeId, targetScreen } = link;
    if (screenIndex == null || !nodeId || !targetScreen) continue;

    // Verify target screen exists
    const targetExists = state.screens.some(s => s.name.toLowerCase() === targetScreen.toLowerCase());
    if (!targetExists) continue;

    const screen = state.screens[screenIndex];
    if (!screen) continue;

    const iframe = document.querySelector(`.renderer-frame[data-screen-id="${screen.id}"]`);
    if (!iframe || !iframe.contentWindow) continue;

    iframe.contentWindow.postMessage({ type: 'setLink', nodeId, target: targetScreen }, '*');
    applied++;
  }

  // Sync all screen HTML after links are applied
  setTimeout(() => {
    state.screens.forEach((screen, i) => {
      const iframe = document.querySelector(`.renderer-frame[data-screen-id="${screen.id}"]`);
      if (iframe) syncScreenHTML(screen, iframe);
    });
    saveState();
    renderPrototypeArrows();
  }, 100);

  return { success: true, applied, total: links.length };
}

// ==================== ELEMENT INSPECTOR POPUP ====================
function closeElementPopup() {
  const existing = document.querySelector('.element-popup-overlay');
  if (existing) existing.remove();
}

function showElementPopup(msg, sourceEvent) {
  // Deprecated — element data now renders in the right panel via
  // populateRightInspector(). Keep this as a no-op for back-compat.
  return;
}

// Legacy block below is kept (unreached) so we can revive it if needed later.
function _legacyShowElementPopup(msg, sourceEvent) {
  closeElementPopup();

  const { id, name, tag, styleInfo, iframeX, iframeY } = msg;
  if (!styleInfo) {
    // Click-to-ref disabled — nothing to show without style info.
    return;
  }

  const s = styleInfo;

  // Create overlay to catch outside clicks
  const overlay = document.createElement('div');
  overlay.className = 'element-popup-overlay';
  overlay.addEventListener('click', closeElementPopup);

  // Create popup
  const popup = document.createElement('div');
  popup.className = 'element-popup';
  popup.addEventListener('click', e => e.stopPropagation());

  // Helper to format color for display
  function formatColor(c) {
    if (!c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent') return null;
    return c;
  }

  // Helper for box model value class
  function vmClass(v) {
    return v === 0 ? 'box-model-value is-zero' : 'box-model-value';
  }

  const bgColor = formatColor(s.backgroundColor);
  const textColor = formatColor(s.color);

  // Build popup HTML
  let html = `
    <div class="element-popup-header">
      <div class="element-popup-title">
        <span class="tag-badge">${tag}</span>
        <span class="name" title="${name}">${name}</span>
      </div>
    </div>

    <div class="element-popup-section">
      <div class="section-label">Dimensions</div>
      <div class="element-popup-dims">
        <span>${s.width}px</span>
        <span class="dim-sep">&times;</span>
        <span>${s.height}px</span>
      </div>
    </div>

    <div class="element-popup-section" id="popup-spacing-section">
      <div class="section-label">Spacing</div>
      <div class="box-model-tabs">
        <button class="box-model-tab active" onclick="switchBoxModelTab(this, 'padding')">Padding</button>
        <button class="box-model-tab" onclick="switchBoxModelTab(this, 'margin')">Margin</button>
      </div>
      <div class="box-model" id="box-model-padding">
        <div class="box-model-row">
          <span class="${vmClass(s.padding.top)}">${s.padding.top}</span>
        </div>
        <div class="box-model-row">
          <span class="${vmClass(s.padding.left)}">${s.padding.left}</span>
          <div class="box-model-center">P</div>
          <span class="${vmClass(s.padding.right)}">${s.padding.right}</span>
        </div>
        <div class="box-model-row">
          <span class="${vmClass(s.padding.bottom)}">${s.padding.bottom}</span>
        </div>
      </div>
      <div class="box-model" id="box-model-margin" style="display:none">
        <div class="box-model-row">
          <span class="${vmClass(s.margin.top)}">${s.margin.top}</span>
        </div>
        <div class="box-model-row">
          <span class="${vmClass(s.margin.left)}">${s.margin.left}</span>
          <div class="box-model-center">M</div>
          <span class="${vmClass(s.margin.right)}">${s.margin.right}</span>
        </div>
        <div class="box-model-row">
          <span class="${vmClass(s.margin.bottom)}">${s.margin.bottom}</span>
        </div>
      </div>
    </div>

    <div class="element-popup-section">
      <div class="section-label">Style</div>
      <div class="style-props">
        ${s.fontSize ? `<div class="style-prop"><span class="prop-label">Font Size</span><span class="prop-value">${s.fontSize}</span></div>` : ''}
        ${s.fontWeight ? `<div class="style-prop"><span class="prop-label">Weight</span><span class="prop-value">${s.fontWeight}</span></div>` : ''}
        ${textColor ? `<div class="style-prop"><span class="prop-label">Color</span><span class="prop-value"><span class="color-swatch" style="background:${textColor}"></span>${textColor}</span></div>` : ''}
        ${bgColor ? `<div class="style-prop"><span class="prop-label">Background</span><span class="prop-value"><span class="color-swatch" style="background:${bgColor}"></span>${bgColor}</span></div>` : ''}
        ${s.borderRadius && s.borderRadius !== '0px' ? `<div class="style-prop"><span class="prop-label">Radius</span><span class="prop-value">${s.borderRadius}</span></div>` : ''}
        ${s.gap && s.gap !== 'normal' ? `<div class="style-prop"><span class="prop-label">Gap</span><span class="prop-value">${s.gap}</span></div>` : ''}
        ${s.display ? `<div class="style-prop"><span class="prop-label">Display</span><span class="prop-value">${s.display}</span></div>` : ''}
        ${s.position && s.position !== 'static' ? `<div class="style-prop"><span class="prop-label">Position</span><span class="prop-value">${s.position}</span></div>` : ''}
      </div>
    </div>
  `;

  // Add classes section if there are classes
  if (s.classes && s.classes.trim()) {
    const classes = s.classes.trim().split(/\s+/).slice(0, 12);
    html += `
      <div class="element-popup-section">
        <div class="section-label">Classes</div>
        <div style="font-family:'SF Mono','Fira Code',monospace;font-size:11px;color:var(--text-1);line-height:1.6;word-break:break-word">${classes.map(c => `<span style="background:var(--bg-2);padding:1px 5px;border-radius:3px;margin:1px;display:inline-block">${c}</span>`).join(' ')}${s.classes.trim().split(/\s+/).length > 12 ? ' <span style="color:var(--text-2)">+' + (s.classes.trim().split(/\s+/).length - 12) + '</span>' : ''}</div>
      </div>
    `;
  }

  popup.innerHTML = html;

  overlay.appendChild(popup);
  document.body.appendChild(overlay);

  // Position popup at the right-click location, translated from iframe coords to page coords
  let left = 100, top = 100;

  // Find the source iframe and translate coordinates
  const activeScreen = state.screens[state.activeScreenIndex];
  const iframe = activeScreen ? document.querySelector(`.renderer-frame[data-screen-id="${activeScreen.id}"]`) : null;

  if (iframe && iframeX != null && iframeY != null) {
    const iframeRect = iframe.getBoundingClientRect();
    // Scale iframe-internal coords to screen coords (accounts for canvas zoom)
    const scaleX = iframeRect.width / iframe.offsetWidth;
    const scaleY = iframeRect.height / iframe.offsetHeight;
    left = iframeRect.left + iframeX * scaleX;
    top = iframeRect.top + iframeY * scaleY;
  }

  // Keep within viewport
  const pw = popup.offsetWidth;
  const ph = popup.offsetHeight;
  if (left + pw > window.innerWidth - 12) left = window.innerWidth - pw - 12;
  if (left < 12) left = 12;
  if (top + ph > window.innerHeight - 12) top = window.innerHeight - ph - 12;
  if (top < 12) top = 12;

  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
}

function switchBoxModelTab(btn, mode) {
  const section = btn.closest('.element-popup-section');
  section.querySelectorAll('.box-model-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  section.querySelector('#box-model-padding').style.display = mode === 'padding' ? '' : 'none';
  section.querySelector('#box-model-margin').style.display = mode === 'margin' ? '' : 'none';
}

// Close popup on Escape / exit prototype mode / arrow nav
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (state.prototypeMode) exitPrototypeMode();
    else closeElementPopup();
  }
  if (state.prototypeMode) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = state.activeScreenIndex - 1;
      if (prev >= 0) prototypeNavigate(prev);
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = state.activeScreenIndex + 1;
      if (next < state.screens.length) prototypeNavigate(next);
    }
  }
});

// ==================== PROTOTYPE MODE ====================
function prototypeFitScreen() {
  const canvas = document.getElementById('canvas-area');
  const phoneW = 393 + 12;
  const phoneH = 852 + 12 + 40;
  const scaleX = canvas.clientWidth / (phoneW + 60);
  const scaleY = canvas.clientHeight / (phoneH + 60);
  state.zoom = Math.min(scaleX, scaleY, 1);
  focusOnScreen(state.activeScreenIndex);
}

function enterPrototypeMode() {
  if (state.screens.length === 0) { showToast('No screens to prototype'); return; }
  state.prototypeMode = true;
  state._savedZoom = state.zoom;
  state._savedPanX = state.panX;
  state._savedPanY = state.panY;
  state._savedScreenIndex = state.activeScreenIndex;

  // Start from entry point
  const entryIdx = state.entryScreenIndex < state.screens.length ? state.entryScreenIndex : 0;
  state.activeScreenIndex = entryIdx;
  updateActiveScreenHighlight();
  renderScreenList();

  // Init history
  state.protoHistory = [entryIdx];
  state.protoHistoryIndex = 0;

  document.body.classList.add('prototype-mode');

  // Tell all iframes to enter prototype mode
  document.querySelectorAll('.renderer-frame').forEach(f => {
    f.contentWindow.postMessage({ type: 'setPrototypeMode', enabled: true }, '*');
  });

  prototypeFitScreen();
  window.addEventListener('resize', _protoResizeHandler);
}

function _protoResizeHandler() {
  if (state.prototypeMode) prototypeFitScreen();
}

function exitPrototypeMode() {
  state.prototypeMode = false;
  document.body.classList.remove('prototype-mode');

  // Tell all iframes to exit prototype mode
  document.querySelectorAll('.renderer-frame').forEach(f => {
    f.contentWindow.postMessage({ type: 'setPrototypeMode', enabled: false }, '*');
  });

  window.removeEventListener('resize', _protoResizeHandler);

  // Remove transition classes
  document.querySelectorAll('.screen-wrapper').forEach(w => {
    w.classList.remove('proto-fade');
  });

  // Restore screen + zoom/pan
  if (state._savedScreenIndex != null) {
    state.activeScreenIndex = state._savedScreenIndex;
    updateActiveScreenHighlight();
    renderScreenList();
  }
  if (state._savedZoom != null) {
    state.zoom = state._savedZoom;
    state.panX = state._savedPanX;
    state.panY = state._savedPanY;
    applyTransform();
  }
}

function prototypeNavigate(targetIndex, skipHistory) {
  if (targetIndex === state.activeScreenIndex) return;
  if (targetIndex < 0 || targetIndex >= state.screens.length) return;

  // Switch active screen
  state.activeScreenIndex = targetIndex;
  updateActiveScreenHighlight();
  renderScreenList();

  // Track history
  if (!skipHistory) {
    state.protoHistory = state.protoHistory.slice(0, state.protoHistoryIndex + 1);
    state.protoHistory.push(targetIndex);
    state.protoHistoryIndex = state.protoHistory.length - 1;
  }

  // Fade in new screen
  const newScreen = state.screens[targetIndex];
  const newWrapper = document.querySelector(`.screen-wrapper[data-screen-id="${newScreen.id}"]`);
  if (newWrapper) {
    newWrapper.classList.add('proto-fade');
    prototypeFitScreen();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        newWrapper.classList.remove('proto-fade');
      });
    });
  } else {
    prototypeFitScreen();
  }
}

function protoGoBack() {
  if (state.protoHistoryIndex <= 0) return;
  state.protoHistoryIndex--;
  prototypeNavigate(state.protoHistory[state.protoHistoryIndex], true);
}

function protoGoForward() {
  if (state.protoHistoryIndex >= state.protoHistory.length - 1) return;
  state.protoHistoryIndex++;
  prototypeNavigate(state.protoHistory[state.protoHistoryIndex], true);
}

// ==================== CONNECTION ARROWS ====================
// Throttled arrow update for smooth dragging
let _arrowRAF = null;
function scheduleArrowUpdate() {
  if (_arrowRAF) return;
  _arrowRAF = requestAnimationFrame(() => {
    _arrowRAF = null;
    renderPrototypeArrows();
  });
}

function renderPrototypeArrows() {
  const svg = document.getElementById('prototype-arrows');
  if (!svg) return;
  svg.innerHTML = '';

  const phoneW = 393 + 12;
  const phoneH = 852 + 12 + 40;
  const labelH = 40;

  // Collect all links from all screens (parse from saved HTML, not iframe DOM)
  const links = [];
  state.screens.forEach((screen, srcIdx) => {
    const html = screen.html || '';
    const regex = /data-ps-link="([^"]+)"/gi;
    let match;
    const targets = new Set();
    while ((match = regex.exec(html)) !== null) {
      targets.add(match[1]);
    }
    targets.forEach(targetName => {
      const tgtIdx = state.screens.findIndex(s => s.name.toLowerCase() === targetName.toLowerCase());
      if (tgtIdx >= 0 && tgtIdx !== srcIdx) {
        if (!links.some(l => l.src === srcIdx && l.tgt === tgtIdx)) {
          links.push({ src: srcIdx, tgt: tgtIdx });
        }
      }
    });
  });

  if (links.length === 0) return;

  // --- Fan-out: spread connection points so they don't cluster ---
  const bySource = {};
  const byTarget = {};
  links.forEach((link, i) => {
    (bySource[link.src] ||= []).push(i);
    (byTarget[link.tgt] ||= []).push(i);
  });
  // Sort each group so left-most targets fan to the left
  Object.values(bySource).forEach(arr =>
    arr.sort((a, b) => (state.screens[links[a].tgt].x || 0) - (state.screens[links[b].tgt].x || 0))
  );
  Object.values(byTarget).forEach(arr =>
    arr.sort((a, b) => (state.screens[links[a].src].x || 0) - (state.screens[links[b].src].x || 0))
  );

  const srcFan = {};
  const tgtFan = {};
  Object.values(bySource).forEach(arr =>
    arr.forEach((li, i) => { srcFan[li] = { i, n: arr.length }; })
  );
  Object.values(byTarget).forEach(arr =>
    arr.forEach((li, i) => { tgtFan[li] = { i, n: arr.length }; })
  );

  function fanX(cx, idx, total) {
    if (total <= 1) return cx;
    const spread = Math.min(phoneW * 0.45, total * 40);
    return cx - spread / 2 + spread * idx / (total - 1);
  }

  // Size SVG to cover all screens
  const { width, height, minX, minY } = getCanvasContentSize();
  const pad = 150;
  const extraBottom = 130;
  const offX = minX - pad;
  const offY = minY - pad;
  const svgW = width + pad * 2;
  const svgH = height + pad * 2 + extraBottom;
  svg.style.width = svgW + 'px';
  svg.style.height = svgH + 'px';
  svg.style.left = offX + 'px';
  svg.style.top = offY + 'px';
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);

  // Draw connections
  links.forEach(({ src, tgt }, li) => {
    const ss = state.screens[src], ts = state.screens[tgt];
    const sx = (ss.x || 0) - offX, sy = (ss.y || 0) + labelH - offY;
    const tx = (ts.x || 0) - offX, ty = (ts.y || 0) + labelH - offY;

    const srcCX = sx + phoneW / 2;
    const tgtCX = tx + phoneW / 2;
    const srcBot = sy + (phoneH - labelH) + 10;
    const tgtBot = ty + (phoneH - labelH) + 10;

    // Fan-out positions
    const x1 = fanX(srcCX, srcFan[li].i, srcFan[li].n);
    const y1 = srcBot;
    const x2 = fanX(tgtCX, tgtFan[li].i, tgtFan[li].n);
    const y2 = tgtBot;

    // Smooth curve — sag scales with distance
    const dist = Math.abs(x2 - x1);
    const sag = 50 + Math.min(90, dist * 0.12);
    const d = `M${x1},${y1} C${x1},${y1 + sag} ${x2},${y2 + sag} ${x2},${y2}`;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);

    // Small dot at source
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', x1);
    dot.setAttribute('cy', y1);
    dot.setAttribute('r', 2.5);
    dot.classList.add('arrow-dot');
    svg.appendChild(dot);

    // Arrowhead at target — small chevron
    const aw = 3.5, ah = 5;
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    arrow.setAttribute('points', `${x2-aw},${y2+ah} ${x2},${y2} ${x2+aw},${y2+ah}`);
    arrow.classList.add('arrow-head');
    svg.appendChild(arrow);
  });
}

// ==================== IFRAME MESSAGES ====================
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'screenLink':
      const idx = state.screens.findIndex(s => s.name.toLowerCase() === msg.target.toLowerCase());
      if (idx >= 0) {
        if (state.prototypeMode) {
          prototypeNavigate(idx);
        } else {
          handleSwitchScreen({ index: idx });
        }
      }
      break;
    case 'nodeTapped':
      // Legacy — replaced by nodeInspect on left-click. No-op.
      break;
    case 'nodeInspect': {
      if (state.prototypeMode) break;
      populateRightInspector(msg);
      if (msg.refresh) break; // inspector refresh after an edit, not a user click
      // Also surface the inline edit popup next to the clicked element.
      // Figure out which screen the click came from so target-lock can
      // bind to the right one (fixes the old "edits wrong page" bug).
      let sourceIdx = state.activeScreenIndex;
      for (let i = 0; i < state.screens.length; i++) {
        const screen = state.screens[i];
        const iframe = document.querySelector(`.screen-wrapper[data-screen-id="${screen.id}"] .renderer-frame`);
        if (iframe && iframe.contentWindow === event.source) { sourceIdx = i; break; }
      }
      setSelection({ screenIndex: sourceIdx, nodeId: msg.id, tag: msg.tag, name: msg.name });
      showEditPopup(msg, sourceIdx);
      break;
    }
    case 'nodeDeselect':
      if (state.prototypeMode) break;
      clearRightInspector();
      closeEditPopup();
      setSelection(null);
      break;
  }
});

// ==================== SCREEN MANAGEMENT ====================
function addScreen() { handleCreateScreen({}); }

function switchToScreen(index) {
  handleSwitchScreen({ index });
  focusOnScreen(index);
}

function deleteScreen(index, event) {
  if (event) event.stopPropagation();
  if (state.screens.length <= 1) { showToast('You cannot delete the last screen'); return; }
  const screen = state.screens[index];
  if (!confirm(`Delete "${screen.name}"?`)) return;

  const wrapper = document.querySelector(`.screen-wrapper[data-screen-id="${screen.id}"]`);
  if (wrapper) wrapper.remove();

  state.screens.splice(index, 1);
  if (state.activeScreenIndex >= state.screens.length) state.activeScreenIndex = state.screens.length - 1;

  updateActiveScreenHighlight();
  updateCanvasContentSize();
  renderScreenList();
  applyTransform();
  saveState();
}

function renameScreen(index) {
  const nameEl = document.querySelector(`#screen-item-${index} .screen-name`);
  if (!nameEl) return;
  nameEl.contentEditable = true;
  nameEl.focus();
  const range = document.createRange();
  range.selectNodeContents(nameEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const finish = () => {
    nameEl.contentEditable = false;
    const newName = nameEl.textContent.trim();
    if (newName) state.screens[index].name = newName;
    renderScreenList();
    updateScreenLabels();
    saveState();
  };
  nameEl.addEventListener('blur', finish, { once: true });
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
    if (e.key === 'Escape') { nameEl.textContent = state.screens[index].name; nameEl.blur(); }
  });
}

// Shared action dispatcher — called by the inline floating action toolbar
// above each screen.
function performScreenAction(action, screenIndex, actionBtn) {
  const screen = state.screens[screenIndex];
  if (!screen) return;

  switch (action) {
    case 'export-png': {
      // Temporarily switch active screen for export, then switch back so the
      // user's current AI write target isn't disturbed.
      const prevIdx = state.activeScreenIndex;
      state.activeScreenIndex = screenIndex;
      exportPNG().then(() => { state.activeScreenIndex = prevIdx; });
      break;
    }
    case 'copy-html': {
      if (!screen.html) { showToast('No design to copy'); break; }
      navigator.clipboard.writeText(buildScreenHTML(screen)).then(() => showToast('HTML copied'));
      break;
    }
    case 'reload': {
      const iframe = document.querySelector(`.renderer-frame[data-screen-id="${screen.id}"]`);
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'setHTML', html: screen.html }, '*');
      }
      break;
    }
    case 'rename':    renameScreenOnCanvas(screenIndex); break;
    case 'delete':    deleteScreen(screenIndex); break;
    case 'entry-point': {
      state.entryScreenIndex = screenIndex;
      showToast(`"${screen.name}" set as entry point`);
      renderScreenList();
      updateEntryBadges();
      saveState();
      break;
    }
  }
}

// Briefly replace a screen-action button's icon with a checkmark + success
// color so the user gets immediate visual confirmation that their click was
// registered. Reverts after ~1s. Optimistic feedback — doesn't track async
// completion, because actions either complete instantly (copy html, set
// entry, duplicate) or fire-and-forget (export png); the
// toast from each action handler is the authoritative success/fail signal.
const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
function flashActionSuccess(btn) {
  if (!btn || !btn.isConnected) return;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = CHECK_SVG;
  btn.classList.add('success');
  setTimeout(() => {
    if (!btn.isConnected) return;
    btn.innerHTML = originalHtml;
    btn.classList.remove('success');
  }, 1000);
}

// Suppress the browser's default context menu on the canvas area — right-
// click used to open our own context menu here, now it simply does nothing
// (all actions live in the floating toolbar above each screen).
document.getElementById('canvas-area').addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

function duplicateScreen(index) {
  const src = state.screens[index];
  const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const newScreen = {
    id,
    name: src.name + ' Copy',
    html: src.html,
    x: (src.x || 0) + 393 + 12 + 60,
    y: src.y || 0,
    history: [],
  };
  state.screens.splice(index + 1, 0, newScreen);
  state.activeScreenIndex = index + 1;
  initScreensOnCanvas();
  renderScreenList();
  saveState();
  showToast(`"${src.name}" duplicated`);
}

function renameScreenOnCanvas(index) {
  const screen = state.screens[index];
  const wrapper = document.querySelector(`.screen-wrapper[data-screen-id="${screen.id}"]`);
  if (!wrapper) return;
  const label = wrapper.querySelector('.screen-label');
  if (!label) return;

  label.contentEditable = true;
  label.style.pointerEvents = 'auto';
  label.style.cursor = 'text';
  label.style.background = 'var(--bg-2)';
  label.style.borderRadius = '4px';
  label.style.padding = '2px 8px';
  label.style.outline = '1px solid var(--accent)';
  label.focus();

  const range = document.createRange();
  range.selectNodeContents(label);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const finish = () => {
    label.contentEditable = false;
    label.style.background = '';
    label.style.borderRadius = '';
    label.style.padding = '';
    label.style.outline = '';
    label.style.cursor = '';
    const newName = label.textContent.trim();
    if (newName && newName !== screen.name) {
      screen.name = newName;
      renderScreenList();
      saveState();
    } else {
      label.textContent = screen.name;
    }
  };
  label.addEventListener('blur', finish, { once: true });
  label.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); label.blur(); }
    if (e.key === 'Escape') { label.textContent = screen.name; label.blur(); }
  });
}

// ==================== ZOOM & PAN ====================
function zoomBy(delta) {
  state.zoom = Math.max(0.2, Math.min(2, state.zoom + delta));
  applyTransform();
}

function zoomTo(level) {
  state.zoom = level;
  applyTransform();
}

function getCanvasContentSize() {
  const phoneW = 393 + 12;
  const phoneH = 852 + 12 + 40;
  if (state.screens.length === 0) return { width: phoneW, height: phoneH, minX: 0, minY: 0 };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  state.screens.forEach(s => {
    const x = s.x || 0, y = s.y || 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + phoneW);
    maxY = Math.max(maxY, y + phoneH);
  });
  return { width: maxX - minX, height: maxY - minY, minX, minY };
}

function updateCanvasContentSize() {
  // Recalculate container size for transform centering
  const container = document.getElementById('screens-container');
  const { width, height, minX, minY } = getCanvasContentSize();
  container.style.width = (width - minX) + 'px';
  container.style.height = (height - minY) + 'px';
}

function getPromptBarOffset() {
  const bar = document.getElementById('ai-prompt-bar');
  if (!bar || bar.offsetParent === null) return 0;
  return bar.offsetHeight + 20; // height + bottom gap
}

function fitZoomValue() {
  const canvas = document.getElementById('canvas-area');
  const { width, height } = getCanvasContentSize();
  const promptH = getPromptBarOffset();
  const padX = Math.min(80, canvas.clientWidth * 0.08), padY = Math.min(80, canvas.clientHeight * 0.08);
  const scaleX = (canvas.clientWidth - padX * 2) / width;
  const scaleY = (canvas.clientHeight - promptH - padY * 2) / height;
  return Math.max(0.1, Math.min(scaleX, scaleY, 1.5));
}

// Run a pan/zoom change with a short ease, used when the agent moves the view.
function animateView(change) {
  const el = document.getElementById('canvas-transform');
  el.style.transition = 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)';
  change();
  clearTimeout(animateView._t);
  animateView._t = setTimeout(() => { el.style.transition = ''; }, 500);
}

function zoomFit() {
  const promptH = getPromptBarOffset();
  state.zoom = fitZoomValue();
  state.panX = 0;
  state.panY = -promptH / 2;
  applyTransform();
}

function applyTransform() {
  const el = document.getElementById('canvas-transform');
  const { width, height, minX, minY } = getCanvasContentSize();
  const offsetX = -(minX + width / 2);
  const offsetY = -(minY + height / 2);
  el.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom}) translate(${offsetX}px, ${offsetY}px)`;
  const lbl = document.getElementById('zoom-label');
  if (lbl) lbl.textContent = Math.round(state.zoom * 100) + '%';
}

// Header zoom dropdown — open/close, jump-to-zoom helper
function toggleZoomDropdown(event) {
  if (event) event.stopPropagation();
  const dd = document.getElementById('zoom-dropdown');
  if (!dd) return;
  const open = dd.style.display !== 'none';
  dd.style.display = open ? 'none' : '';
  if (!open) {
    setTimeout(() => {
      const closer = (e) => {
        if (dd.contains(e.target) || e.target.closest('#zoom-trigger')) return;
        dd.style.display = 'none';
        document.removeEventListener('click', closer);
      };
      document.addEventListener('click', closer);
    }, 0);
  }
}

function setZoom(z) {
  state.zoom = Math.max(0.1, Math.min(4, z));
  applyTransform();
  const dd = document.getElementById('zoom-dropdown');
  if (dd) dd.style.display = 'none';
}

// Right panel — tab switching (kept for compat; no tabs in current markup).
function switchRightTab(name) {
  document.querySelectorAll('.rp-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
}

// ==================== TOOL MODE ====================
// 'cursor' (default — element selection ON), 'hand' (pan only — clicks disabled)
let _toolMode = 'cursor';

function setToolMode(mode) {
  if (mode !== 'cursor' && mode !== 'hand') return;
  _toolMode = mode;
  document.querySelectorAll('.cd-tool').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  const app = document.getElementById('app');
  if (app) {
    app.classList.toggle('hand-mode', mode === 'hand');
    app.classList.toggle('cursor-mode', mode === 'cursor');
  }
  // Clear any current selection when switching to hand mode
  if (mode === 'hand') clearRightInspector();
}

// Selected element id (so we can re-highlight or open menus later)
let _rpSelectedId = null;
let _rpBoxModelTab = 'padding'; // 'padding' | 'margin'

function clearRightInspector() {
  _rpSelectedId = null;
  const insp = document.getElementById('rp-inspector');
  const def = document.getElementById('rp-default');
  if (insp) { insp.style.display = 'none'; insp.innerHTML = ''; }
  if (def) def.style.display = '';
}

// Build the right-panel inspector for a clicked element — Figma-style sections.
// Read-only for now; field values are sourced from getComputedStyle in renderer.js.
function populateRightInspector(msg) {
  const { id, name, tag, styleInfo } = msg;
  if (!styleInfo) { clearRightInspector(); return; }
  _rpSelectedId = id;

  const def = document.getElementById('rp-default');
  const insp = document.getElementById('rp-inspector');
  if (!insp) return;

  const s = styleInfo;
  const hex = (c) => {
    if (!c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent') return null;
    return c;
  };
  const fg = hex(s.color);
  const bg = hex(s.backgroundColor);

  const fmtPx = (v) => (v == null || v === '' ? '—' : (typeof v === 'number' ? v + 'px' : v));
  const radius = (s.borderRadius && s.borderRadius !== '0px') ? s.borderRadius : '0';
  const compactRadius = (() => {
    const parts = radius.split(' ');
    if (parts.every(p => p === parts[0])) return parts[0].replace('px', '');
    return parts[0].replace('px', '');
  })();
  const fontFamily = (s.fontFamily || '').split(',')[0].replace(/['"]/g, '').trim() || 'System';
  const fontWeightLabel = (() => {
    const w = parseInt(s.fontWeight) || 400;
    if (w <= 300) return 'Light';
    if (w <= 400) return 'Regular';
    if (w <= 500) return 'Medium';
    if (w <= 600) return 'Semibold';
    if (w <= 700) return 'Bold';
    return 'Black';
  })();
  const fontSizePx = parseInt(s.fontSize) || 0;
  const lineHeightPct = (() => {
    if (!s.lineHeight || s.lineHeight === 'normal') return '120%';
    const lh = parseFloat(s.lineHeight);
    if (!fontSizePx || isNaN(lh)) return s.lineHeight;
    return Math.round((lh / fontSizePx) * 100) + '%';
  })();
  const letterSpacing = (() => {
    if (!s.letterSpacing || s.letterSpacing === 'normal') return '0';
    const ls = parseFloat(s.letterSpacing);
    if (!fontSizePx || isNaN(ls)) return s.letterSpacing;
    return ((ls / fontSizePx) * 100).toFixed(1) + '%';
  })();
  const opacityPct = Math.round((parseFloat(s.opacity) || 1) * 100) + '%';

  const elX = s.iframeRect ? Math.round(s.iframeRect.left) : 0;
  const elY = s.iframeRect ? Math.round(s.iframeRect.top) : 0;

  const hAlign = (() => {
    const ta = (s.textAlign || '').toLowerCase();
    if (ta === 'center') return 'hcenter';
    if (ta === 'right' || ta === 'end') return 'right';
    return 'left';
  })();
  const vAlign = (() => {
    const as = (s.alignSelf || '').toLowerCase();
    if (as === 'center') return 'vcenter';
    if (as === 'flex-end' || as === 'end') return 'bottom';
    return 'top';
  })();

  insp.innerHTML = `
    <!-- Element identity strip -->
    <section class="rp-section rp-element-header">
      <span class="rp-tag-badge">${escapeHtml((tag || '').toUpperCase())}</span>
      <span class="rp-element-name" title="${escapeHtml(name || '')}">${escapeHtml(name || tag)}</span>
    </section>

    <!-- Alignment icon row — horizontal from textAlign, vertical from alignSelf -->
    <div class="rp-align-row">
      ${alignIcon('left', hAlign === 'left')}${alignIcon('hcenter', hAlign === 'hcenter')}${alignIcon('right', hAlign === 'right')}
      <span class="rp-align-sep"></span>
      ${alignIcon('top', vAlign === 'top')}${alignIcon('vcenter', vAlign === 'vcenter')}${alignIcon('bottom', vAlign === 'bottom')}
    </div>

    <!-- Frame -->
    <section class="rp-section">
      <div class="rp-section-head">
        <span class="rp-section-title-strong">Frame</span>
      </div>
      <div class="rp-input-grid">
        <div class="rp-input"><input value="${elX}" readonly><span class="rp-input-suffix">X</span></div>
        <div class="rp-input"><input value="${elY}" readonly><span class="rp-input-suffix">Y</span></div>
        <div class="rp-input"><input value="${s.width}" readonly><span class="rp-input-suffix">W</span></div>
        <div class="rp-input"><input value="${s.height}" readonly><span class="rp-input-suffix">H</span></div>
        <div class="rp-input"><input value="0" readonly><span class="rp-input-suffix"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18l6-6V3"/><circle cx="3" cy="18" r="1"/></svg></span></div>
        <div class="rp-input"><input value="${compactRadius}" readonly><span class="rp-input-suffix"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21V11a8 8 0 0 1 8-8h10"/></svg></span></div>
      </div>
    </section>

    <!-- Constraints (decorative) -->
    <section class="rp-section">
      <div class="rp-section-head">
        <span class="rp-section-title-strong">Constrains</span>
      </div>
      <div class="rp-constraints">
        <div class="rp-constraints-cross">
          <span class="rp-cc-line rp-cc-top"></span>
          <span class="rp-cc-line rp-cc-bottom"></span>
          <span class="rp-cc-line rp-cc-left"></span>
          <span class="rp-cc-line rp-cc-right"></span>
          <span class="rp-cc-center"></span>
        </div>
        <div class="rp-constraints-side">
          <div class="rp-select-pill"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/></svg><span>Center</span><svg class="rp-pill-chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
          <div class="rp-select-pill"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="3" x2="12" y2="21"/></svg><span>Top</span><svg class="rp-pill-chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
        </div>
      </div>
    </section>

    <!-- Blending -->
    <section class="rp-section">
      <div class="rp-section-head">
        <span class="rp-section-title-strong">Blending</span>
      </div>
      <div class="rp-select-pill rp-select-full"><span>${escapeHtml(opacityPct === '100%' ? 'Normal' : 'Normal · ' + opacityPct)}</span><svg class="rp-pill-chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
    </section>

    <!-- Typography -->
    <section class="rp-section">
      <div class="rp-section-head">
        <span class="rp-section-title-strong">Typography</span>
      </div>
      <div class="rp-select-pill rp-select-full"><span>${escapeHtml(fontFamily)}</span><svg class="rp-pill-chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
      <div class="rp-input-grid">
        <div class="rp-input rp-input-with-icon"><span class="rp-input-prefix">${fontWeightLabel}</span><svg class="rp-input-suffix-chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
        <div class="rp-input"><input value="${fontSizePx || ''}" readonly><span class="rp-input-suffix"><span class="rp-input-letter">A</span></span></div>
        <div class="rp-input"><input value="${lineHeightPct}" readonly><span class="rp-input-suffix"><span class="rp-input-letter rp-letter-underline">A</span></span></div>
        <div class="rp-input"><input value="${letterSpacing}" readonly><span class="rp-input-suffix"><span class="rp-input-letter rp-letter-bars">|A|</span></span></div>
      </div>
    </section>

    <!-- Fill -->
    ${(bg || fg) ? `<section class="rp-section">
      <div class="rp-section-head">
        <span class="rp-section-title-strong">Fill</span>
      </div>
      ${bg ? renderFillRow(bg, opacityPct) : ''}
      ${fg && !bg ? renderFillRow(fg, opacityPct) : ''}
    </section>` : ''}

  `;

  if (def) def.style.display = 'none';
  insp.style.display = '';
}

// Render a single Fill row — color swatch + clean hex + opacity + eye icon.
// The hex is the canvas-normalized form so oklab/oklch values render as #RRGGBB.
function renderFillRow(color, opacityPct) {
  const hex = rgbToHex(color) || '—';
  return `<div class="rp-fill-row">
    <span class="rp-swatch-lg" style="background-color:${hex !== '—' ? hex : color}"></span>
    <span class="rp-fill-hex">${escapeHtml(hex.replace('#', ''))}</span>
    <span class="rp-fill-opacity">${escapeHtml(opacityPct)}</span>
    <button class="rp-fill-eye" tabindex="-1" disabled aria-label="Visibility">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
    </button>
  </div>`;
}

// Small alignment icon helper
function alignIcon(kind, isActive = false) {
  const icons = {
    left:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="4" x2="4" y2="20"/><rect x="7" y="8" width="10" height="8" rx="1"/></svg>',
    hcenter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="12" y1="4" x2="12" y2="20"/><rect x="6" y="8" width="12" height="8" rx="1"/></svg>',
    right:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="20" y1="4" x2="20" y2="20"/><rect x="7" y="8" width="10" height="8" rx="1"/></svg>',
    top:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="4" x2="20" y2="4"/><rect x="8" y="7" width="8" height="10" rx="1"/></svg>',
    vcenter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"/><rect x="8" y="6" width="8" height="12" rx="1"/></svg>',
    bottom:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="20" x2="20" y2="20"/><rect x="8" y="7" width="8" height="10" rx="1"/></svg>',
  };
  return `<button class="rp-align-btn${isActive ? ' active' : ''}" tabindex="-1" disabled>${icons[kind] || ''}</button>`;
}

// ==================== INLINE EDIT POPUP ====================
let _epTarget = null; // { id, name, tag, screenIndex }

function showEditPopup(msg, sourceIdx) {
  const popup = document.getElementById('edit-popup');
  const nameEl = document.getElementById('ep-element-name');
  const input = document.getElementById('ep-input');
  if (!popup || !nameEl || !input) return;

  _epTarget = {
    id: msg.id,
    name: msg.name || msg.tag || 'Element',
    tag: msg.tag,
    screenIndex: sourceIdx,
  };
  nameEl.textContent = _epTarget.name;
  input.value = '';
  updateEpSendState();

  // Draw selection outline + tag label around the element.
  const screen = state.screens[sourceIdx];
  const iframe = screen ? document.querySelector(`.screen-wrapper[data-screen-id="${screen.id}"] .renderer-frame`) : null;
  const elRect = msg.styleInfo && msg.styleInfo.iframeRect;
  if (iframe && elRect) {
    const ifRect = iframe.getBoundingClientRect();
    const scale = ifRect.width / 393;
    const left = ifRect.left + elRect.left * scale;
    const top = ifRect.top + elRect.top * scale;
    const w = elRect.width * scale;
    const h = elRect.height * scale;
    drawSelectionOutline(left, top, w, h, msg.tag);

    // Position popup below the element, clamped to viewport
    const popupW = 320;
    let popupLeft = left;
    let popupTop = top + h + 10;
    const margin = 12;
    if (popupLeft + popupW > window.innerWidth - margin) {
      popupLeft = window.innerWidth - popupW - margin;
    }
    if (popupLeft < margin) popupLeft = margin;
    const popupH = 180;
    if (popupTop + popupH > window.innerHeight - margin) {
      popupTop = Math.max(margin, top - popupH - 10);
    }
    popup.style.left = popupLeft + 'px';
    popup.style.top = popupTop + 'px';
  }
  popup.style.display = '';
  setTimeout(() => input.focus(), 10);
}

function closeEditPopup() {
  _epTarget = null;
  const popup = document.getElementById('edit-popup');
  if (popup) popup.style.display = 'none';
  clearSelectionOutline();
}

function handleEditPopupKey(e) {
  const input = e.target;
  if (e.key === 'Escape') { closeEditPopup(); return; }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    editPopupSubmit();
    return;
  }
  setTimeout(() => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    updateEpSendState();
  }, 0);
}

function updateEpSendState() {
  const input = document.getElementById('ep-input');
  const send = document.getElementById('ep-send');
  if (!input || !send) return;
  send.classList.toggle('ready', !!input.value.trim());
}

// Submit — bind target-lock to ONLY this element + screen, then fire the
// existing generate flow (so drift detection, auto-switch, lock prompt all
// reuse the proven path).
function editPopupSubmit() {
  const input = document.getElementById('ep-input');
  if (!input || !_epTarget) return;
  const text = input.value.trim();
  if (!text) return;

  addAgentNote(_epTarget, text);
  closeEditPopup();
}

function drawSelectionOutline(left, top, width, height, tag) {
  clearSelectionOutline();
  const overlay = document.createElement('div');
  overlay.className = 'edit-selection';
  overlay.id = 'edit-selection';
  overlay.style.left = left + 'px';
  overlay.style.top = top + 'px';
  overlay.style.width = width + 'px';
  overlay.style.height = height + 'px';
  const label = document.createElement('span');
  label.className = 'edit-selection-label';
  label.textContent = '<' + (tag || 'element') + '>';
  overlay.appendChild(label);
  document.body.appendChild(overlay);
}

function clearSelectionOutline() {
  const ex = document.getElementById('edit-selection');
  if (ex) ex.remove();
}

// Any CSS color (rgb/rgba/oklab/oklch/hsl/named) → #RRGGBB
// Uses canvas 2d fillStyle as the universal normalizer.
let _colorCanvas;
function rgbToHex(color) {
  if (!color) return null;
  // Fast path for rgb/rgba which most computed styles already give
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    const toHex = (n) => parseInt(n).toString(16).padStart(2, '0').toUpperCase();
    return '#' + toHex(m[1]) + toHex(m[2]) + toHex(m[3]);
  }
  // Fallback — paint to canvas, read back the normalized form
  try {
    if (!_colorCanvas) _colorCanvas = document.createElement('canvas').getContext('2d');
    _colorCanvas.fillStyle = '#000';
    _colorCanvas.fillStyle = color;
    const out = _colorCanvas.fillStyle; // either #rrggbb or rgba(...)
    if (out.startsWith('#')) return out.toUpperCase();
    const m2 = out.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m2) {
      const toHex = (n) => parseInt(n).toString(16).padStart(2, '0').toUpperCase();
      return '#' + toHex(m2[1]) + toHex(m2[2]) + toHex(m2[3]);
    }
  } catch {}
  return null;
}

function renderBoxModel(box, label) {
  if (!box) return '<div class="rp-style-val">—</div>';
  const cls = (v) => `rp-bm-val${v === 0 ? ' is-zero' : ''}`;
  return `
    <div class="rp-bm-row"><span class="${cls(box.top)}">${box.top}</span></div>
    <div class="rp-bm-row">
      <span class="${cls(box.left)}">${box.left}</span>
      <div class="rp-bm-center">${label}</div>
      <span class="${cls(box.right)}">${box.right}</span>
    </div>
    <div class="rp-bm-row"><span class="${cls(box.bottom)}">${box.bottom}</span></div>
  `;
}

function setRpBoxModelTab(tab) {
  _rpBoxModelTab = tab;
  // Re-render the inspector by faking the message — pull last styleInfo from
  // the current selection's data we already rendered. Simplest: do nothing
  // for now beyond switching the tab visually + re-rendering the box model.
  // For correctness re-fire the click on the selected element via the iframe.
  const insp = document.getElementById('rp-inspector');
  if (!insp || !_rpSelectedId) return;
  // Just toggle the active class + the box model values via DOM swap
  insp.querySelectorAll('.rp-spacing-tab').forEach(b => {
    b.classList.toggle('active', b.textContent.toLowerCase() === tab);
  });
  // Re-fetching computed style requires the iframe roundtrip; for now we
  // request a refresh by re-asking the iframe via a synthetic click.
  // Simpler: ask the renderer for fresh styleInfo of the selected id.
  refreshSelectedInspector();
}

// Ask the renderer for fresh styleInfo of the currently-selected element so
// the inspector reflects DOM changes (post-edit) and tab swaps.
function refreshSelectedInspector() {
  if (!_rpSelectedId) return;
  const screen = state.screens[state.activeScreenIndex];
  if (!screen) return;
  const iframe = document.querySelector(`.screen-wrapper[data-screen-id="${screen.id}"] .renderer-frame`);
  if (!iframe || !iframe.contentWindow) return;
  iframe.contentWindow.postMessage({ type: 'requestInspect', nodeId: _rpSelectedId }, '*');
}

// Pan to a screen only if it is (partly) outside the visible canvas.
function revealScreen(index) {
  const screen = state.screens[index];
  if (!screen || state.prototypeMode) return;
  const wrapper = document.querySelector(`.screen-wrapper[data-screen-id="${screen.id}"]`);
  const area = document.getElementById('canvas-area');
  if (!wrapper || !area) return;
  const r = wrapper.getBoundingClientRect();
  const a = area.getBoundingClientRect();
  const visible = r.left >= a.left && r.right <= a.right && r.top >= a.top - 40 && r.bottom <= a.bottom + 40;
  if (!visible) focusOnScreen(index);
}

function focusOnScreen(index) {
  const screen = state.screens[index];
  if (!screen) return;
  const phoneW = 393 + 12;
  const phoneH = 852 + 12 + 40;
  const { width, height, minX, minY } = getCanvasContentSize();
  const promptH = state.prototypeMode ? 0 : getPromptBarOffset();
  // Screen center in content-space (relative to content center)
  const screenCX = (screen.x || 0) + phoneW / 2 - (minX + width / 2);
  const screenCY = (screen.y || 0) + phoneH / 2 - (minY + height / 2);
  // Pan so that screen center maps to visible area center (above prompt bar)
  state.panX = -screenCX * state.zoom;
  state.panY = -screenCY * state.zoom - promptH / 2;
  applyTransform();
}

// --- Drag to pan ---
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let panStartX = 0, panStartY = 0;
let spaceHeld = false;

const canvasArea = document.getElementById('canvas-area');

canvasArea.addEventListener('pointerdown', (e) => {
  if (state.prototypeMode) return;
  // Middle mouse button or left click on canvas background
  if (e.button === 1 || (e.button === 0 && (spaceHeld || e.target === canvasArea || e.target.id === 'canvas-grid'))) {
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    panStartX = state.panX;
    panStartY = state.panY;
    canvasArea.classList.add('grabbing');
    canvasArea.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
});

canvasArea.addEventListener('pointermove', (e) => {
  if (!isDragging) return;
  state.panX = panStartX + (e.clientX - dragStartX);
  state.panY = panStartY + (e.clientY - dragStartY);
  applyTransform();
});

canvasArea.addEventListener('pointerup', (e) => {
  if (isDragging) {
    isDragging = false;
    canvasArea.classList.remove('grabbing');
  }
});

// Space key for pan mode
document.addEventListener('keydown', (e) => {
  if (state.prototypeMode) return;
  if (e.code === 'Space' && !e.repeat && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA' && !document.activeElement.isContentEditable) {
    e.preventDefault();
    spaceHeld = true;
    canvasArea.classList.add('space-held');
  }
  // Cmd/Ctrl + zoom
  if ((e.metaKey || e.ctrlKey) && e.key === '=') { e.preventDefault(); zoomBy(0.1); }
  if ((e.metaKey || e.ctrlKey) && e.key === '-') { e.preventDefault(); zoomBy(-0.1); }
  if ((e.metaKey || e.ctrlKey) && e.key === '0') { e.preventDefault(); zoomFit(); }
});

document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    spaceHeld = false;
    canvasArea.classList.remove('space-held');
  }
});

// Scroll wheel zoom (zoom towards cursor)
canvasArea.addEventListener('wheel', (e) => {
  if (state.prototypeMode) { e.preventDefault(); return; }
  e.preventDefault();

  if (e.ctrlKey || e.metaKey) {
    // Pinch-to-zoom or Cmd+scroll
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    const oldZoom = state.zoom;
    state.zoom = Math.max(0.2, Math.min(2, state.zoom + delta));

    // Zoom towards cursor position
    const rect = canvasArea.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    const factor = state.zoom / oldZoom;
    state.panX = cx - factor * (cx - state.panX);
    state.panY = cy - factor * (cy - state.panY);
  } else {
    // Regular scroll → pan
    state.panX -= e.deltaX;
    state.panY -= e.deltaY;
  }
  applyTransform();
}, { passive: false });

// ==================== RENDERING ====================
function updateEmptyCanvas() {
  const el = document.getElementById('canvas-empty');
  if (el) el.style.display = state.screens.length === 0 ? '' : 'none';
}

function renderScreenList() {
  updateEmptyCanvas();
  const list = document.getElementById('screen-list');
  if (!list) return;

  list.innerHTML = state.screens.map((screen, i) => {
    const isActive = i === state.activeScreenIndex;
    const history = screen.history || [];
    const expanded = screen._historyOpen && history.length > 0;

    let historyHTML = '';
    if (expanded) {
      const activeIdx = screen._activeHistoryIndex ?? (history.length - 1);
      const limitLabel = '';
      historyHTML = `<div class="history-list">${history.slice().reverse().map((h, hi) => {
        const idx = history.length - 1 - hi;
        const isCurrent = idx === activeIdx;
        const hId = h.id || (idx + 1);
        return `<div class="history-item ${isCurrent ? 'current' : ''}" onclick="restoreVersion(${i}, ${idx}, event)" title="${escapeHtml(h.label || '')}">
          <span class="history-id">#${hId}</span>
          <span class="history-time">${h.time}</span>
          <span class="history-label">${escapeHtml(h.label || 'Change')}</span>
          <button class="history-delete" onclick="deleteHistory(${i}, ${idx}, event)" title="Sil">&times;</button>
        </div>`;
      }).join('')}${limitLabel}</div>`;
    }

    return `
      <div class="screen-item ${isActive ? 'active' : ''}"
           id="screen-item-${i}"
           onclick="switchToScreen(${i})"
           ondblclick="renameScreen(${i})">
        <svg class="screen-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
        </svg>
        <span class="screen-name">${escapeHtml(screen.name)}</span>
        ${i === state.entryScreenIndex ? '<span class="entry-indicator">entry</span>' : ''}
        ${history.length > 0 ? `<button class="history-toggle" onclick="toggleHistory(${i}, event)" title="Version history">${history.length}</button>` : ''}
        <button class="screen-delete" onclick="deleteScreen(${i}, event)" title="Delete">&times;</button>
      </div>
      ${historyHTML}
    `;
  }).join('');

}

function updateEntryBadges() {
  // Remove any existing dot from each screen header
  document.querySelectorAll('.screen-header .entry-dot').forEach(el => el.remove());
  // Add the dot to the current entry screen's header (left of the label)
  state.screens.forEach((screen, i) => {
    if (i !== state.entryScreenIndex) return;
    const header = document.querySelector(`.screen-wrapper[data-screen-id="${screen.id}"] .screen-header`);
    if (!header) return;
    const dot = document.createElement('span');
    dot.className = 'entry-dot';
    dot.title = 'Entry point';
    header.insertBefore(dot, header.firstChild);
  });
}

function toggleHistory(screenIndex, event) {
  event.stopPropagation();
  const screen = state.screens[screenIndex];
  screen._historyOpen = !screen._historyOpen;
  renderScreenList();
}

function restoreVersion(screenIndex, historyIndex, event) {
  event.stopPropagation();
  const screen = state.screens[screenIndex];
  if (!screen.history || !screen.history[historyIndex]) return;

  // Already at this version
  if (screen._activeHistoryIndex === historyIndex) return;

  const entry = screen.history[historyIndex];
  const currentIdx = screen._activeHistoryIndex ?? (screen.history.length - 1);
  const direction = historyIndex < currentIdx ? 'geri' : 'ileri';

  if (!confirm(`"${entry.label || 'Change'}" (${entry.time}) versiyonuna ${direction} d\u00f6n\u00fcls\u00fcn m\u00fc?`)) return;

  screen._activeHistoryIndex = historyIndex;
  screen.html = entry.html;

  // Update iframe
  const iframe = document.querySelector(`.renderer-frame[data-screen-id="${screen.id}"]`);
  if (iframe && iframe.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'setHTML', html: entry.html }, '*');
  }

  renderScreenList();
  saveState();
}

function nextHistoryId(screen) {
  if (!screen.history || screen.history.length === 0) return 1;
  const maxId = screen.history.reduce((max, h) => Math.max(max, h.id || 0), 0);
  return maxId + 1;
}

function pushHistory(screen, label) {
  if (!screen.history) screen.history = [];
  const now = Date.now();
  const time = new Date(now).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Merge rapid changes: if last entry has same label and is within 5 seconds, update in place
  const last = screen.history[screen.history.length - 1];
  if (last && last.label === label && last._epoch && (now - last._epoch) < 5000) {
    last.html = screen.html;
    last.time = time;
    last._epoch = now;
    screen._activeHistoryIndex = screen.history.length - 1;
    return;
  }

  const id = nextHistoryId(screen);
  const maxHistory = 50;
  screen.history.push({ id, html: screen.html, time, label, _epoch: now });
  if (screen.history.length > maxHistory) screen.history.shift();
  screen._activeHistoryIndex = screen.history.length - 1;
}

function deleteHistory(screenIndex, historyIndex, event) {
  event.stopPropagation();
  const screen = state.screens[screenIndex];
  if (!screen.history || screen.history.length <= 1) {
    showToast('Son versiyon silinemez');
    return;
  }

  const entry = screen.history[historyIndex];
  if (!confirm(`#${entry.id || historyIndex + 1} "${entry.label || 'Change'}" silinsin mi?`)) return;

  const activeIdx = screen._activeHistoryIndex ?? (screen.history.length - 1);

  // If deleting the currently active version, switch to nearest
  if (historyIndex === activeIdx) {
    const newIdx = historyIndex > 0 ? historyIndex - 1 : 0;
    screen.html = screen.history[newIdx === historyIndex ? historyIndex + 1 : newIdx].html;
    const iframe = document.querySelector(`.renderer-frame[data-screen-id="${screen.id}"]`);
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'setHTML', html: screen.html }, '*');
    }
  }

  screen.history.splice(historyIndex, 1);

  // Adjust _activeHistoryIndex
  if (historyIndex < activeIdx) {
    screen._activeHistoryIndex = activeIdx - 1;
  } else if (historyIndex === activeIdx) {
    screen._activeHistoryIndex = Math.min(historyIndex, screen.history.length - 1);
  }

  renderScreenList();
  saveState();
}

function initScreensOnCanvas() {
  const container = document.getElementById('screens-container');
  const phoneW = 393 + 12;
  const gap = 60;

  // Assign default positions for screens without x/y (backwards compat)
  state.screens.forEach((screen, i) => {
    if (screen.x === undefined) screen.x = i * (phoneW + gap);
    if (screen.y === undefined) screen.y = 0;
  });

  state.screens.forEach(screen => {
    const wrapper = createScreenDOM(screen);
    container.appendChild(wrapper);

    // Restore saved HTML after iframe loads
    if (screen.html) {
      const iframe = wrapper.querySelector('.renderer-frame');
      iframe.addEventListener('load', () => {
        iframe.contentWindow.postMessage({ type: 'setHTML', html: screen.html }, '*');
        // Render arrows after iframes are ready (with delay for DOM settle)
        setTimeout(() => renderPrototypeArrows(), 600);
      }, { once: true });
    }
  });
  updateCanvasContentSize();
  updateActiveScreenHighlight();
}


function renderInspector() {
  const s = state.settings;
  // Hidden inspector elements (for JS state)
  const sd = document.getElementById('s-device'); if (sd) sd.textContent = s.device;
  const st = document.getElementById('s-theme'); if (st) st.textContent = s.theme;
  const ss = document.getElementById('s-accent-swatch'); if (ss) ss.style.background = s.accentColor;
  const sh = document.getElementById('s-accent-hex'); if (sh) sh.textContent = s.accentColor;
  const sf = document.getElementById('s-font'); if (sf) sf.textContent = s.fontFamily;
  const si = document.getElementById('s-icons'); if (si) si.textContent = s.iconLibrary;

  // Update prompt bar tags
  const tagDevice = document.getElementById('tag-device'); if (tagDevice) tagDevice.textContent = s.device;
  const tagTheme = document.getElementById('tag-theme'); if (tagTheme) tagTheme.textContent = s.theme;
  const tagAccent = document.getElementById('tag-accent'); if (tagAccent) tagAccent.textContent = s.accentColor;
  const tagAccentDot = document.getElementById('tag-accent-dot'); if (tagAccentDot) tagAccentDot.style.background = s.accentColor;
  const tagFont = document.getElementById('tag-font'); if (tagFont) tagFont.textContent = s.fontFamily;
  const tagFontWrap = document.getElementById('tag-font-wrap');
  if (tagFontWrap) tagFontWrap.style.display = (s.fontFamily && s.fontFamily !== '—') ? '' : 'none';
  const tagIcons = document.getElementById('tag-icons'); if (tagIcons) tagIcons.textContent = s.iconLibrary;
  const tagIconsWrap = document.getElementById('tag-icons-wrap');
  if (tagIconsWrap) tagIconsWrap.style.display = (s.iconLibrary && s.iconLibrary !== '—') ? '' : 'none';

  // Design palette popup (in the chat dock header)
  const pDevice = document.getElementById('palette-device'); if (pDevice) pDevice.textContent = s.device;
  const pTheme = document.getElementById('palette-theme'); if (pTheme) pTheme.textContent = s.theme;
  const pAccentHex = document.getElementById('palette-accent-hex'); if (pAccentHex) pAccentHex.textContent = s.accentColor;
  const pAccentDot = document.getElementById('palette-accent-dot'); if (pAccentDot) pAccentDot.style.background = s.accentColor;
  const pFont = document.getElementById('palette-font'); if (pFont) pFont.textContent = s.fontFamily;
  const pFontRow = document.getElementById('palette-font-row');
  if (pFontRow) pFontRow.style.display = (s.fontFamily && s.fontFamily !== '—') ? '' : 'none';
  const pIcons = document.getElementById('palette-icons'); if (pIcons) pIcons.textContent = s.iconLibrary;
  const pIconsRow = document.getElementById('palette-icons-row');
  if (pIconsRow) pIconsRow.style.display = (s.iconLibrary && s.iconLibrary !== '—') ? '' : 'none';
}

// ==================== SCREEN ACTIONS MENU ====================
const SCREEN_MENU_ITEMS = [
  { action: 'copy-html',   label: 'Copy HTML',         iconify: 'solar:code-linear' },
  { action: 'export-png',  label: 'Export PNG',        iconify: 'solar:download-minimalistic-linear' },
  { action: 'rename',      label: 'Rename',            iconify: 'solar:pen-linear' },
  { action: 'entry-point', label: 'Set as Entry Point',iconify: 'solar:flag-linear' },
  { action: 'delete',      label: 'Delete',            iconify: 'solar:trash-bin-trash-linear', danger: true },
];

let _openScreenMenuFor = null;
let _screenMenuCloser = null;

function openScreenMenu(screenId, anchor) {
  const popup = document.getElementById('screen-menu-popup');
  if (!popup) return;

  // Toggle off if same anchor is already open.
  if (_openScreenMenuFor === screenId) { closeScreenMenu(); return; }

  popup.innerHTML = SCREEN_MENU_ITEMS.map(item =>
    `<button class="screen-menu-item${item.danger ? ' danger' : ''}" data-action="${item.action}" data-screen-id="${screenId}">
      <iconify-icon icon="${item.iconify}" width="16" height="16"></iconify-icon>
      <span>${item.label}</span>
    </button>`
  ).join('');

  // Position the popup just below + slightly right of the anchor button.
  const rect = anchor.getBoundingClientRect();
  popup.style.display = '';
  popup.style.top = (rect.bottom + 6) + 'px';
  // Align the popup's right edge to the anchor's right edge so it stays in view.
  const popupWidth = 200;
  popup.style.left = Math.max(8, rect.right - popupWidth) + 'px';

  _openScreenMenuFor = screenId;

  // Wire item clicks
  popup.querySelectorAll('.screen-menu-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const action = btn.dataset.action;
      const idx = state.screens.findIndex(s => s.id === btn.dataset.screenId);
      closeScreenMenu();
      if (idx < 0 || !action) return;
      performScreenAction(action, idx, btn);
    });
  });

  // Close on outside click / Esc
  _screenMenuCloser = (e) => {
    if (popup.contains(e.target)) return;
    if (e.type === 'click' && e.target.closest('.screen-more-btn')) return; // anchor handles toggle
    closeScreenMenu();
  };
  setTimeout(() => {
    document.addEventListener('click', _screenMenuCloser);
    document.addEventListener('keydown', escScreenMenu);
  }, 0);
}

function closeScreenMenu() {
  const popup = document.getElementById('screen-menu-popup');
  if (popup) popup.style.display = 'none';
  _openScreenMenuFor = null;
  if (_screenMenuCloser) {
    document.removeEventListener('click', _screenMenuCloser);
    _screenMenuCloser = null;
  }
  document.removeEventListener('keydown', escScreenMenu);
}

function escScreenMenu(e) { if (e.key === 'Escape') closeScreenMenu(); }

// ==================== DESIGN PALETTE POPUP ====================
function toggleDesignPalette(event) {
  if (event) event.stopPropagation();
  const popup = document.getElementById('design-palette-popup');
  if (!popup) return;
  const open = popup.style.display !== 'none';
  popup.style.display = open ? 'none' : '';
  if (!open) {
    // Close on outside click
    setTimeout(() => {
      const closer = (e) => {
        if (popup.contains(e.target) || e.target.closest('.ai-dock-palette')) return;
        popup.style.display = 'none';
        document.removeEventListener('click', closer);
      };
      document.addEventListener('click', closer);
    }, 0);
  }
}

function saveDesignPrompt() {
  saveState();
}

function copyDesignPrompt() {
  const text = state.designPrompt || '';
  if (!text) { showToast('No prompt to copy'); return; }
  navigator.clipboard.writeText(text).then(() => showToast('Design prompt copied'));
}

// ==================== AGENT PANEL ====================
// The left panel explains how to connect an AI agent (Claude Code, Codex,
// Cursor, …) over MCP and shows a live feed of what the agent is doing.
const agentLog = []; // newest first: { id, tool, summary, status, error, time }
let agentLastSeen = 0;

function renderConnectionStatus() {
  const dot = document.getElementById('agent-status-dot');
  const label = document.getElementById('agent-status-label');
  if (!dot || !label) return;
  const active = state.isConnected && Date.now() - agentLastSeen < 60000;
  dot.className = 'agent-status-dot ' + (!state.isConnected ? 'offline' : active ? 'active' : 'idle');
  label.textContent = !state.isConnected ? 'Verso server is offline' : active ? 'Agent is working' : 'Waiting for your agent';
}
setInterval(renderConnectionStatus, 5000);

function onAgentActivity(msg) {
  agentLastSeen = Date.now();
  let entry = agentLog.find(e => e.id === msg.id);
  if (!entry) {
    entry = { id: msg.id, tool: msg.tool, summary: msg.summary || msg.tool, time: Date.now() };
    agentLog.unshift(entry);
    if (agentLog.length > 80) agentLog.pop();
  }
  entry.status = msg.status;
  if (msg.error) entry.error = msg.error;
  renderAgentLog();
  renderConnectionStatus();
}

function formatClock(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderAgentLog() {
  const list = document.getElementById('agent-log');
  if (!list) return;
  const empty = document.getElementById('agent-log-empty');
  if (empty) empty.style.display = agentLog.length ? 'none' : '';
  list.innerHTML = agentLog.map(e => `
    <div class="agent-log-row ${e.status || ''}" title="${escapeHtml(e.error || e.tool)}">
      <span class="agent-log-icon">${e.status === 'running' ? '<span class="agent-spinner"></span>' : e.status === 'error' ? '!' : '✓'}</span>
      <span class="agent-log-text">${escapeHtml(e.summary)}</span>
      <span class="agent-log-time">${formatClock(e.time)}</span>
    </div>`).join('');
}

// --- Setup instructions (MCP commands for each client) ---
let _agentSetup = null;
let _agentSetupClient = localStorage.getItem('verso-agent-client') || 'claude';

async function loadAgentSetup() {
  try {
    const res = await fetch('/api/info');
    _agentSetup = await res.json();
  } catch { _agentSetup = null; }
  renderAgentSetup();
}

function mcpSnippet(client) {
  if (!_agentSetup) return '';
  const cmd = _agentSetup.mcpCommand || ['npx', '-y', 'verso-design', 'mcp'];
  const shellCmd = cmd.map(p => (/[\s"']/.test(p) ? JSON.stringify(p) : p)).join(' ');
  switch (client) {
    case 'claude': return `claude mcp add verso -- ${shellCmd}`;
    case 'codex': return `codex mcp add verso -- ${shellCmd}`;
    case 'http': return `${location.origin}/mcp`;
    default: return JSON.stringify({ mcpServers: { verso: { command: cmd[0], args: cmd.slice(1) } } }, null, 2);
  }
}

function renderAgentSetup() {
  document.querySelectorAll('.agent-client-tab').forEach(t => t.classList.toggle('active', t.dataset.client === _agentSetupClient));
  const pre = document.getElementById('agent-setup-code');
  const hint = document.getElementById('agent-setup-hint');
  if (!pre) return;
  pre.textContent = mcpSnippet(_agentSetupClient);
  const hints = {
    claude: 'Run this once in your terminal, then restart Claude Code.',
    codex: 'Run this once in your terminal, then restart Codex.',
    json: 'Add this to your client’s MCP config (Cursor, Claude Desktop, Windsurf, VS Code…).',
    http: 'For clients that support Streamable HTTP MCP. Verso must be running.',
  };
  if (hint) hint.textContent = hints[_agentSetupClient] || '';
}

function selectAgentClient(client) {
  _agentSetupClient = client;
  try { localStorage.setItem('verso-agent-client', client); } catch {}
  renderAgentSetup();
}

function copyAgentSetup(btn) {
  const text = document.getElementById('agent-setup-code')?.textContent || '';
  navigator.clipboard.writeText(text).then(() => flashCopied(btn));
}

function copyAgentPrompt(btn) {
  const text = `Use the Verso MCP tools to design in my open project "${state.projectName}". Start with get_design_guide.`;
  navigator.clipboard.writeText(text).then(() => flashCopied(btn));
}

function flashCopied(btn) {
  if (!btn) return;
  btn.classList.add('copied');
  setTimeout(() => btn.classList.remove('copied'), 1400);
}

// --- Selection + notes for the agent ---
// Clicking an element selects it. The agent reads the selection (and any
// notes the user left on elements) with the get_selection tool.
function setSelection(sel) {
  state.selection = sel;
}

function addAgentNote(target, text) {
  const screen = state.screens[target.screenIndex];
  state.agentNotes.push({
    id: Date.now().toString(36),
    screenIndex: target.screenIndex,
    screenName: screen ? screen.name : null,
    nodeId: target.id,
    element: target.name || target.tag || 'element',
    text,
    createdAt: new Date().toISOString(),
  });
  renderAgentNotes();
  saveState();
}

function removeAgentNote(id) {
  state.agentNotes = state.agentNotes.filter(n => n.id !== id);
  renderAgentNotes();
  saveState();
}

function renderAgentNotes() {
  const wrap = document.getElementById('agent-notes');
  const list = document.getElementById('agent-notes-list');
  if (!wrap || !list) return;
  wrap.style.display = state.agentNotes.length ? '' : 'none';
  list.innerHTML = state.agentNotes.map(n => `
    <div class="agent-note">
      <div class="agent-note-meta">${escapeHtml(n.screenName || 'Screen')} · ${escapeHtml(n.element)}</div>
      <div class="agent-note-text">${escapeHtml(n.text)}</div>
      <button class="agent-note-remove" onclick="removeAgentNote('${n.id}')" title="Remove note" aria-label="Remove note">&times;</button>
    </div>`).join('');
}

function getElementOuterHTML(screenIndex, nodeId) {
  const screen = state.screens[screenIndex];
  if (!screen) return null;
  const iframe = document.querySelector(`.renderer-frame[data-screen-id="${screen.id}"]`);
  const el = iframe && iframe.contentDocument && iframe.contentDocument.querySelector(`[data-ps-id="${nodeId}"]`);
  if (!el) return null;
  const html = el.outerHTML;
  return html.length > 4000 ? html.slice(0, 4000) + '…' : html;
}

function handleGetSelection(args = {}) {
  let selected = null;
  const sel = state.selection;
  if (sel && state.screens[sel.screenIndex]) {
    selected = {
      screenIndex: sel.screenIndex,
      screenName: state.screens[sel.screenIndex].name,
      nodeId: sel.nodeId,
      tag: sel.tag,
      name: sel.name,
      outerHTML: getElementOuterHTML(sel.screenIndex, sel.nodeId),
    };
  }
  const notes = state.agentNotes.map(n => ({ ...n, outerHTML: getElementOuterHTML(n.screenIndex, n.nodeId) }));
  if (args.clearNotes) {
    state.agentNotes = [];
    renderAgentNotes();
    saveState();
  }
  return {
    selected,
    notes,
    hint: 'Surgical tools act on the active screen. Pass `screen` (index or name) or call switch_screen first when the selection is on another screen.',
  };
}

// --- Extra screen tools for agents ---
function findScreenIndex(ref) {
  if (ref === undefined || ref === null || ref === '') return -1;
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) {
    const i = Number(ref);
    return i >= 0 && i < state.screens.length ? i : -1;
  }
  return state.screens.findIndex(s => s.name.toLowerCase() === String(ref).toLowerCase());
}

function handleDeleteScreenTool(args) {
  const index = findScreenIndex(args.screen);
  if (index < 0) return { error: 'Screen not found' };
  const screen = state.screens[index];
  const wrapper = document.querySelector(`.screen-wrapper[data-screen-id="${screen.id}"]`);
  if (wrapper) wrapper.remove();
  state.screens.splice(index, 1);
  if (state.activeScreenIndex >= state.screens.length) state.activeScreenIndex = Math.max(0, state.screens.length - 1);
  if (state.entryScreenIndex >= state.screens.length) state.entryScreenIndex = 0;
  updateActiveScreenHighlight();
  updateCanvasContentSize();
  renderScreenList();
  applyTransform();
  renderPrototypeArrows();
  saveState();
  return { success: true, deleted: screen.name, screens: handleListScreens() };
}

function handleRenameScreenTool(args) {
  const index = findScreenIndex(args.screen);
  if (index < 0) return { error: 'Screen not found' };
  if (!args.name) return { error: 'name is required' };
  state.screens[index].name = args.name;
  updateScreenLabels();
  renderScreenList();
  saveState();
  return { success: true, screens: handleListScreens() };
}

function handleGetScreenHtml(args = {}) {
  const index = args.screen === undefined ? state.activeScreenIndex : findScreenIndex(args.screen);
  const screen = state.screens[index];
  if (!screen) return { error: 'Screen not found' };
  return { index, name: screen.name, html: screen.html || '' };
}

function applyProjectName(name) {
  if (!name) return;
  state.projectName = name;
  document.title = name + ' — Verso';
  const label = document.getElementById('project-name-label');
  if (label) label.textContent = name;
}


function renderWorkingState() {
  document.querySelectorAll('.phone-container').forEach(c => c.classList.remove('working'));
  if (state.isWorking) {
    const screen = state.screens[state.activeScreenIndex];
    if (screen) {
      const wrapper = document.querySelector(`.screen-wrapper[data-screen-id="${screen.id}"] .phone-container`);
      if (wrapper) wrapper.classList.add('working');
    }
  }
}

// ==================== EXPORT ====================
function buildScreenHTML(screen) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(screen.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"><\/script>
<script src="https://code.iconify.design/iconify-icon/3.0.0/iconify-icon.min.js"><\/script>
</head>
<body>
${screen.html}
</body>
</html>`;
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'screen';
}

/**
 * Prepare an iframe document for capture.
 * Handles: iconify icons (Shadow DOM → inline SVG) and external images (proxy).
 * Returns a cleanup function.
 */
async function prepareForCapture(iframeDoc, contentEl) {
  const win = iframeDoc.defaultView;

  // 1. Inline iconify-icon SVGs (cloned DOM does not include Shadow DOM)
  const iconBackups = [];
  iframeDoc.querySelectorAll('iconify-icon').forEach(icon => {
    const svg = icon.shadowRoot?.querySelector('svg');
    if (!svg) return;
    const clone = svg.cloneNode(true);
    const cs = win.getComputedStyle(icon);
    clone.style.width = cs.width;
    clone.style.height = cs.height;
    clone.style.display = cs.display || 'inline-block';
    clone.style.verticalAlign = 'middle';
    clone.style.color = cs.color;
    clone.style.flexShrink = cs.flexShrink;
    iconBackups.push({ original: icon, clone });
    icon.parentNode.replaceChild(clone, icon);
  });

  // 2. Convert external images to data URLs via server proxy (avoids CORS)
  const imgBackups = [];
  const images = Array.from(contentEl.querySelectorAll('img'));
  await Promise.allSettled(images.map(async img => {
    const src = img.src || img.getAttribute('src') || '';
    if (!src.startsWith('http') || src.startsWith(location.origin)) return;
    try {
      const proxyUrl = '/api/image-proxy?url=' + encodeURIComponent(src);
      const resp = await fetch(proxyUrl);
      if (!resp.ok) return;
      const blob = await resp.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      imgBackups.push({ img, originalSrc: src });
      img.src = dataUrl;
    } catch(e) { /* skip this image */ }
  }));

  // Also handle CSS background-image url() references
  const bgBackups = [];
  const urlRe = /url\(["']?(https?:\/\/[^"')]+)["']?\)/g;
  contentEl.querySelectorAll('*').forEach(el => {
    const bg = win.getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none' || !bg.includes('http')) return;
    const urls = [];
    let m;
    urlRe.lastIndex = 0;
    while ((m = urlRe.exec(bg)) !== null) urls.push(m[1]);
    if (urls.length === 0) return;
    bgBackups.push({ el, original: el.style.backgroundImage });
    // Queue proxy fetch for each URL
    urls.forEach(async u => {
      try {
        const resp = await fetch('/api/image-proxy?url=' + encodeURIComponent(u));
        if (!resp.ok) return;
        const blob = await resp.blob();
        const dataUrl = await new Promise(r => { const rr = new FileReader(); rr.onload = () => r(rr.result); rr.readAsDataURL(blob); });
        const cur = el.style.backgroundImage || bg;
        el.style.backgroundImage = cur.replace(u, dataUrl);
      } catch(e) {}
    });
  });

  // Small delay to let background image proxy fetches complete
  await new Promise(r => setTimeout(r, 100));

  return function cleanup() {
    iconBackups.forEach(({ original, clone }) => {
      if (clone.parentNode) clone.parentNode.replaceChild(original, clone);
    });
    imgBackups.forEach(({ img, originalSrc }) => { img.src = originalSrc; });
    bgBackups.forEach(({ el, original }) => {
      if (original) el.style.backgroundImage = original;
      else el.style.removeProperty('background-image');
    });
  };
}

// Screenshots and PNG export render through SVG foreignObject (html-to-image),
// so the browser's own layout engine paints them and they match the canvas.
// The library is loaded into the screen's iframe on first use.
async function loadCaptureLib(win) {
  if (win.htmlToImage) return win.htmlToImage;
  await new Promise((resolve, reject) => {
    const s = win.document.createElement('script');
    s.src = '/vendor/html-to-image.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the screenshot renderer'));
    win.document.head.appendChild(s);
  });
  return win.htmlToImage;
}

async function captureScreenCanvas(iframe, { width, height, scale }) {
  const doc = iframe.contentDocument;
  const contentEl = doc.querySelector('#canvas');
  if (!contentEl) throw new Error('No content to capture');
  const lib = await loadCaptureLib(iframe.contentWindow);
  const cleanup = await prepareForCapture(doc, contentEl);
  try {
    const firstChild = contentEl.firstElementChild;
    const bg = (firstChild && iframe.contentWindow.getComputedStyle(firstChild).backgroundColor) || '#ffffff';
    return await lib.toCanvas(contentEl, {
      width,
      height,
      pixelRatio: scale,
      backgroundColor: bg === 'rgba(0, 0, 0, 0)' ? '#ffffff' : bg,
      style: { width: width + 'px', height: height + 'px', overflow: 'hidden' },
    });
  } finally {
    cleanup();
  }
}

async function exportPNG() {
  const screen = state.screens[state.activeScreenIndex];
  const iframe = getActiveIframe();
  if (!iframe || !iframe.contentDocument) { alert('No design to export'); return; }
  const web = state.settings.device === 'Web';
  try {
    await waitForScreenAssets(iframe.contentDocument);
    const captured = await captureScreenCanvas(iframe, { width: web ? 1440 : 393, height: web ? 900 : 852, scale: web ? 1 : 2 });
    const link = document.createElement('a');
    link.download = `${slugify(screen.name)}.png`;
    link.href = captured.toDataURL('image/png');
    link.click();
  } catch (e) {
    console.error('PNG export failed:', e);
    alert('PNG export failed: ' + e.message);
  }
}

function exportHTML() {
  const screen = state.screens[state.activeScreenIndex];
  if (!screen.html) { alert('No design to export'); return; }

  navigator.clipboard.writeText(buildScreenHTML(screen)).then(() => {
    const btn = document.getElementById('export-html-btn');
    const orig = btn.innerHTML;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
    btn.style.color = 'var(--green)';
    setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 2000);
  });
}

async function exportAllHTML() {
  const screensWithHTML = state.screens.filter(s => s.html);
  if (screensWithHTML.length === 0) { alert('No designs to export'); return; }

  const btn = document.getElementById('export-zip-btn');
  const orig = btn.innerHTML;
  btn.innerHTML = 'Preparing...';
  btn.disabled = true;

  try {
    const zip = new JSZip();
    screensWithHTML.forEach((screen, i) => {
      const filename = `${String(i + 1).padStart(2, '0')}-${slugify(screen.name)}.html`;
      zip.file(filename, buildScreenHTML(screen));
    });

    // Save project metadata (history, positions, settings, designPrompt)
    const meta = {
      settings: state.settings,
      designPrompt: state.designPrompt || '',
      screens: screensWithHTML.map((screen, i) => ({
        filename: `${String(i + 1).padStart(2, '0')}-${slugify(screen.name)}.html`,
        name: screen.name,
        x: screen.x,
        y: screen.y,
        history: screen.history || [],
      })),
    };
    zip.file('project.json', JSON.stringify(meta, null, 2));

    const blob = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.download = 'verso-screens.zip';
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);

    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Done!';
    btn.style.color = 'var(--green)';
    setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; btn.disabled = false; }, 2000);
  } catch(e) {
    console.error('ZIP export failed:', e);
    btn.innerHTML = orig;
    btn.disabled = false;
    alert('ZIP export failed.');
  }
}

// ==================== EXPORT FOR AI MODAL ====================
const _exportPrompts = {
  expo: (manifestUrl, projectName) =>
`I designed a mobile app called "${projectName}" in Verso. Build it as a production-ready Expo (React Native) app.

Fetch the design manifest here:
${manifestUrl}

Requirements:
- Expo SDK with TypeScript
- expo-router for file-based navigation (one route per screen in the manifest)
- NativeWind v4 for styling — map the HTML layout and spacing to Tailwind-compatible RN styles
- Replicate every screen precisely: layout, colors, typography, spacing, component hierarchy
- Apply design_system.accent_color as the primary brand color globally
- Use design_system.font_family with expo-google-fonts or system font fallback
- Create a /constants/theme.ts with all design tokens
- Each screen in its own file under /app/(tabs)/ or /app/ as appropriate
- Functional components, hooks, no class components`,

  flutter: (manifestUrl, projectName) =>
`I designed a mobile app called "${projectName}" in Verso. Build it as a production-ready Flutter app.

Fetch the design manifest here:
${manifestUrl}

Requirements:
- Flutter with Dart (null-safe, Dart 3+)
- go_router for declarative navigation (one route per screen in the manifest)
- google_fonts package for typography matching design_system.font_family
- Replicate every screen precisely: layout, colors, spacing, widget hierarchy
- Define a ThemeData in theme.dart using design_system.accent_color as primaryColor
- Create one StatelessWidget per screen, each in its own file under lib/screens/
- Use Material 3 (useMaterial3: true)
- lib/constants/app_colors.dart for the color palette`,

  swiftui: (manifestUrl, projectName) =>
`I designed a mobile app called "${projectName}" in Verso. Build it as a production-ready SwiftUI app.

Fetch the design manifest here:
${manifestUrl}

Requirements:
- SwiftUI with Swift 5.9+, targeting iOS 17+
- NavigationStack for navigation between screens
- Replicate every screen precisely: layout, colors, typography, spacing, component hierarchy
- Define a Color extension (Color+App.swift) with design_system.accent_color and the full palette
- Create one SwiftUI View per screen, each in its own file under Sources/Screens/
- Use SF Symbols where icons appear, or match the icon style from design_system.icon_library
- MVVM architecture: one ObservableObject ViewModel per screen where state is needed`,
};

let _exportSelectedFw = 'expo';

async function openExportModal() {
  if (!state.projectId) { showToast('No project to export'); return; }

  const overlay = document.getElementById('export-overlay');
  if (!overlay) return;

  overlay.style.display = 'flex';
  _exportSelectedFw = 'expo';
  overlay.querySelectorAll('.export-fw-card').forEach(c => c.classList.toggle('active', c.dataset.fw === 'expo'));
  _renderExportPrompt();
}

function closeExportModal() {
  const overlay = document.getElementById('export-overlay');
  if (overlay) overlay.style.display = 'none';
}

function selectExportFramework(card) {
  document.querySelectorAll('.export-fw-card').forEach(c => c.classList.remove('active'));
  card.classList.add('active');
  _exportSelectedFw = card.dataset.fw;
  _renderExportPrompt();
}

function _renderExportPrompt() {
  const ta = document.getElementById('export-prompt-text');
  if (!ta) return;
  const manifestUrl = `${window.location.origin}/api/projects/${state.projectId}/manifest`;
  const projectName = state.projectName || document.getElementById('project-name-label')?.textContent || 'My App';
  const fn = _exportPrompts[_exportSelectedFw];
  ta.value = fn ? fn(manifestUrl, projectName) : '';
}

function copyExportPrompt() {
  const ta = document.getElementById('export-prompt-text');
  if (!ta || !ta.value) return;
  navigator.clipboard.writeText(ta.value).then(() => {
    const btn = document.getElementById('export-copy-btn');
    if (!btn) return;
    const orig = btn.innerHTML;
    btn.classList.add('copied');
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
    setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = orig; }, 1800);
  }).catch(() => showToast('Could not copy'));
}

// ==================== PERSISTENCE ====================
let _saveTimer = null;
function saveState() {
  if (!state.projectId) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    const data = {
      name: state.projectName || 'Untitled',
      screens: state.screens.map(s => ({ id: s.id, name: s.name, html: s.html, x: s.x || 0, y: s.y || 0, history: s.history || [] })),
      activeScreenIndex: state.activeScreenIndex,
      settings: state.settings,
      designPrompt: state.designPrompt || '',
      designMemory: state.designMemory || null,
      entryScreenIndex: state.entryScreenIndex || 0,
      notes: state.agentNotes || [],
    };
    const headers = { 'Content-Type': 'application/json', ...(await getAuthHeaders()) };
    fetch('/api/projects/' + state.projectId, {
      method: 'PUT',
      headers,
      body: JSON.stringify(data),
    }).catch(e => console.error('Save failed:', e));
  }, 500);
}

async function loadState() {
  const pathParts = window.location.pathname.split('/');
  const pathId = pathParts[pathParts.length - 1];
  if (!pathId || !/^[a-z0-9-]+$/.test(pathId)) {
    window.location = '/';
    return false;
  }
  state.projectId = pathId;
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/projects/' + pathId, { headers });
    if (!res.ok) { window.location = '/'; return false; }
    const data = await res.json();
    state.projectName = data.name || 'Untitled';
    if (data.screens && data.screens.length > 0) {
      state.screens = data.screens.map(s => ({ ...s, history: s.history || [] }));
      state.activeScreenIndex = Math.min(data.activeScreenIndex || 0, state.screens.length - 1);
    }
    if (data.settings) Object.assign(state.settings, data.settings);
    state.designPrompt = data.designPrompt || '';
    state.designMemory = data.designMemory || null;
    state.entryScreenIndex = data.entryScreenIndex || 0;
    state.agentNotes = Array.isArray(data.notes) ? data.notes : [];
    document.title = data.name + ' \u2014 Verso';
    const label = document.getElementById('project-name-label');
    if (label) label.textContent = data.name;
    return true;
  } catch(e) {
    console.error('Load failed:', e);
    window.location = '/';
    return false;
  }
}

// ==================== UTILS ====================
function toggleSidebar() {
  const el = document.getElementById('sidebar');
  const btn = document.getElementById('toggle-sidebar');
  el.classList.toggle('collapsed');
  const collapsed = el.classList.contains('collapsed');
  btn.querySelector('svg').innerHTML = collapsed
    ? '<polyline points="9 18 15 12 9 6"/>'
    : '<polyline points="15 18 9 12 15 6"/>';
}

function toggleInspector() {
  const el = document.getElementById('inspector');
  el.classList.toggle('collapsed');
}

function goHome() {
  document.body.classList.add('navigating');
  setTimeout(() => { window.location.href = '/'; }, 200);
}

function startRenameProject() {
  const label = document.getElementById('project-name-label');
  if (label.contentEditable === 'true') return;
  label.contentEditable = 'true';
  label.focus();
  // Select all text
  const range = document.createRange();
  range.selectNodeContents(label);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  function finishRename() {
    label.removeAttribute('contenteditable');
    label.removeEventListener('blur', finishRename);
    label.removeEventListener('keydown', onKey);
    const newName = label.textContent.trim();
    if (newName && newName !== state.projectName) {
      state.projectName = newName;
      document.title = newName + ' \u2014 Verso';
      saveState();
      showToast('Project renamed');
    } else {
      label.textContent = state.projectName || 'Untitled';
    }
  }

  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); label.blur(); }
    if (e.key === 'Escape') { label.textContent = state.projectName || 'Untitled'; label.blur(); }
  }

  label.addEventListener('blur', finishRename);
  label.addEventListener('keydown', onKey);
}

function showToast(text) {
  // Toasts disabled
  return;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}



// Tracked so we can re-apply the "working" marker when the active screen
// switches mid-generation (multi-screen flows). Without this, the dots animation
// would stay on the screen the AI just left.
let _phoneWorking = false;

function setPhoneWorking(on) {
  _phoneWorking = !!on;
  document.querySelectorAll('.phone-container.working').forEach(el => el.classList.remove('working'));
  if (!on) return;
  const screen = state.screens[state.activeScreenIndex];
  if (!screen) return;
  const wrapper = document.querySelector(`.screen-wrapper[data-screen-id="${screen.id}"] .phone-container`);
  if (wrapper) wrapper.classList.add('working');
}

// Re-apply the working marker whenever the active screen changes; called from
// handleSwitchScreen / handleCreateScreen so the dots follow the AI's focus.
function refreshPhoneWorking() {
  if (_phoneWorking) setPhoneWorking(true);
}

// ==================== INIT ====================
(async () => {
  applyAppTheme();
  const loaded = await loadState();
  if (!loaded) return;
  initScreensOnCanvas();
  renderScreenList();
  renderInspector();
  zoomFit();
  connectWS();
  renderAgentNotes();
  renderAgentLog();
  renderConnectionStatus();
  loadAgentSetup();
})();
