// Project list page.

let info = null;
let client = safeGet('verso-agent-client') || 'claude';

function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key, value) { try { localStorage.setItem(key, value); } catch {} }

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- theme ----------
function applyTheme() {
  const theme = safeGet('verso-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-icon').setAttribute('icon', theme === 'dark' ? 'solar:sun-linear' : 'solar:moon-linear');
}
function toggleTheme() {
  safeSet('verso-theme', (safeGet('verso-theme') || 'dark') === 'dark' ? 'light' : 'dark');
  applyTheme();
}

// ---------- connect instructions ----------
function snippet(kind) {
  const cmd = (info && info.mcpCommand) || ['npx', '-y', 'verso-design', 'mcp'];
  const shell = cmd.map(p => (/[\s"']/.test(p) ? JSON.stringify(p) : p)).join(' ');
  if (kind === 'claude') return `claude mcp add verso -- ${shell}`;
  if (kind === 'codex') return `codex mcp add verso -- ${shell}`;
  if (kind === 'http') return `claude mcp add --transport http verso ${location.origin}/mcp`;
  return JSON.stringify({ mcpServers: { verso: { command: cmd[0], args: cmd.slice(1) } } }, null, 2);
}

const HINTS = {
  claude: 'Run once in your terminal, then restart Claude Code and ask it to design something.',
  codex: 'Run once in your terminal, then restart Codex.',
  json: 'Add to your client’s MCP settings (Cursor, Claude Desktop, Windsurf, VS Code…).',
  http: 'For clients that connect over Streamable HTTP. Keep Verso running while you design.',
};

function selectClient(kind) {
  client = kind;
  safeSet('verso-agent-client', kind);
  document.querySelectorAll('.connect-tab').forEach(t => t.classList.toggle('active', t.dataset.client === kind));
  document.getElementById('connect-code').textContent = snippet(kind);
  document.getElementById('connect-hint').textContent = HINTS[kind] || '';
}

function copyConnect(btn) {
  navigator.clipboard.writeText(document.getElementById('connect-code').textContent).then(() => {
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1400);
  });
}

// ---------- projects ----------
function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

function renderProjects(projects) {
  const grid = document.getElementById('projects');
  document.getElementById('empty').style.display = projects.length ? 'none' : '';
  grid.innerHTML = projects.map(p => {
    const web = p.device === 'Web';
    return `
    <a class="card" href="/p/${p.id}">
      <div class="thumb ${web ? 'web' : ''}">
        ${p.previewScreens[0]
          ? `<iframe class="thumb-frame ${web ? 'web' : ''}" src="/renderer.html" tabindex="-1" aria-hidden="true"></iframe>`
          : `<div class="thumb-empty"><iconify-icon icon="solar:pallete-2-linear" width="26" height="26"></iconify-icon></div>`}
      </div>
      <div class="card-meta">
        <div class="card-title">
          <span class="dot" style="background:${escapeHtml(p.accentColor && p.accentColor.startsWith('#') ? p.accentColor : '#8a8a90')}"></span>
          <span class="name">${escapeHtml(p.name)}</span>
        </div>
        <div class="card-sub">${p.screenCount} screen${p.screenCount === 1 ? '' : 's'} · ${timeAgo(p.updatedAt)}</div>
      </div>
      <button class="card-menu" data-id="${p.id}" data-name="${escapeHtml(p.name)}" onclick="deleteProject(event, this)" title="Delete project" aria-label="Delete project">
        <iconify-icon icon="solar:trash-bin-minimalistic-linear" width="16" height="16"></iconify-icon>
      </button>
    </a>`;
  }).join('');

  // Thumbnails reuse the editor's renderer; the screen HTML is posted in
  // once it has loaded, so it never passes through innerHTML here.
  grid.querySelectorAll('.card').forEach((card, i) => {
    const frame = card.querySelector('.thumb-frame');
    if (!frame) return;
    frame.addEventListener('load', () => {
      const web = projects[i].device === 'Web';
      frame.contentWindow.postMessage({ type: 'setHTML', html: projects[i].previewScreens[0] }, location.origin);
      frame.contentWindow.postMessage({ type: 'setViewportWidth', width: web ? 1440 : 393 }, location.origin);
    }, { once: true });
  });
}

let lastSignature = null;
async function loadProjects() {
  const res = await fetch('/api/projects');
  const projects = await res.json();
  const signature = projects.map(p => p.id + p.updatedAt).join('|');
  if (signature === lastSignature) return;
  lastSignature = signature;
  renderProjects(projects);
}

async function newProject() {
  const name = prompt('Project name', 'Untitled Project');
  if (name === null) return;
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() || 'Untitled Project' }),
  });
  const data = await res.json();
  location.href = `/p/${data.id}`;
}

async function deleteProject(event, btn) {
  event.preventDefault();
  event.stopPropagation();
  const { id, name } = btn.dataset;
  if (!confirm(`Delete "${name}"? Its screens and images are removed from disk.`)) return;
  await fetch(`/api/projects/${id}`, { method: 'DELETE' });
  lastSignature = null;
  loadProjects();
}

(async () => {
  applyTheme();
  try {
    info = await (await fetch('/api/info')).json();
    document.getElementById('data-dir').textContent = `Saved in ${info.dataDir}`;
  } catch {}
  selectClient(client);
  loadProjects();
  // Agents create projects too; keep the list fresh.
  setInterval(() => { if (!document.hidden) loadProjects(); }, 5000);
})();
