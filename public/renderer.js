// Verso - Canvas Renderer API
(function() {
  let nodeIdCounter = 0;

  function generateId() {
    return 'ps-' + (++nodeIdCounter);
  }

  function assignIds(element) {
    if (element.nodeType !== 1) return;
    if (!element.getAttribute('data-ps-id')) {
      element.setAttribute('data-ps-id', generateId());
    }
    for (const child of element.children) {
      assignIds(child);
    }
  }

  // --- Semantic Naming ---
  const CLASS_NAMES = {
    'screen': 'Screen', 'nav-bar': 'Navigation Bar', 'tab-bar': 'Tab Bar',
    'large-title': 'Large Title', 'search-bar': 'Search Bar',
    'list-section': 'List Section', 'list-group': 'List Group', 'list-item': 'List Item',
    'card': 'Card', 'button': 'Button', 'badge': 'Badge', 'avatar': 'Avatar',
    'toggle': 'Toggle', 'chip': 'Chip', 'toast': 'Toast', 'sheet': 'Sheet', 'alert': 'Alert',
    'progress-bar': 'Progress Bar', 'spinner': 'Spinner', 'slider': 'Slider',
    'header': 'Header', 'footer': 'Footer', 'hero': 'Hero', 'banner': 'Banner',
    'modal': 'Modal', 'overlay': 'Overlay', 'form': 'Form',
    'carousel': 'Carousel', 'gallery': 'Gallery',
  };

  const TAG_NAMES = {
    'h1': 'Heading 1', 'h2': 'Heading 2', 'h3': 'Heading 3',
    'h4': 'Heading 4', 'h5': 'Heading 5', 'h6': 'Heading 6',
    'p': 'Paragraph', 'span': 'Text', 'a': 'Link',
    'img': 'Image', 'video': 'Video', 'button': 'Button',
    'input': 'Input', 'textarea': 'Text Area', 'select': 'Select',
    'nav': 'Navigation', 'header': 'Header', 'footer': 'Footer',
    'main': 'Main', 'section': 'Section', 'article': 'Article',
    'ul': 'List', 'ol': 'Ordered List', 'li': 'List Item',
    'svg': 'Icon', 'hr': 'Divider',
    'iconify-icon': 'Icon',
  };

  function inferDivName(element) {
    const style = window.getComputedStyle(element);
    const children = element.children;
    const childCount = children.length;

    if (childCount === 1 && children[0].tagName === 'IMG') return 'Image Container';
    if (childCount > 1 && Array.from(children).every(c => c.tagName === 'IMG')) return 'Image Gallery';

    const display = style.display;
    const flexDir = style.flexDirection;
    const isGrid = display === 'grid' || display === 'inline-grid';
    const isFlex = display === 'flex' || display === 'inline-flex';
    const isColumn = flexDir === 'column' || flexDir === 'column-reverse';

    const bg = style.backgroundColor;
    const bgImg = style.backgroundImage;
    const radius = parseFloat(style.borderRadius) || 0;
    const shadow = style.boxShadow !== 'none';
    const hasBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    const w = parseFloat(style.width) || 0;
    const h = parseFloat(style.height) || 0;

    if (bgImg && bgImg !== 'none') return childCount === 0 ? 'Image' : 'Banner';
    if (radius > 0 && w > 0 && h > 0 && Math.abs(w - h) < 2 && radius >= w / 2 - 1) return 'Circle';
    if (style.overflowX === 'auto' || style.overflowX === 'scroll') return 'Scroll View';
    if (style.position === 'fixed' && parseFloat(style.bottom) === 0) return 'Bottom Bar';
    if (style.position === 'sticky') return 'Sticky Header';
    if (isGrid) return 'Grid';

    if (childCount === 0) {
      if (h > 0 && h <= 2) return 'Separator';
      if (hasBg && radius > 0) return 'Rounded Rectangle';
      if (hasBg) return 'Rectangle';
      return 'Spacer';
    }

    if (shadow && radius > 0) return 'Card';
    if (hasBg && radius > 0) return 'Rounded Container';
    if (hasBg) return 'Container';
    if (isFlex) return isColumn ? 'VStack' : 'HStack';
    return 'Frame';
  }

  function inferName(element) {
    const tag = element.tagName.toLowerCase();

    const explicit = element.getAttribute('data-ps-name') || element.getAttribute('data-name');
    if (explicit) return explicit;

    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    const classes = Array.from(element.classList || []);
    for (const cls of classes) {
      if (CLASS_NAMES[cls]) return CLASS_NAMES[cls];
    }

    // Iconify icons
    if (tag === 'iconify-icon') {
      const icon = element.getAttribute('icon');
      if (icon) {
        const name = icon.split(':').pop();
        return 'Icon: ' + name;
      }
      return 'Icon';
    }

    // Text elements: use truncated content
    if (['span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'label', 'strong', 'em', 'b', 'small'].includes(tag)) {
      const text = element.textContent?.trim();
      if (text && text.length <= 30 && element.children.length === 0) return '"' + text + '"';
      if (text && text.length > 30 && element.children.length === 0) return '"' + text.substring(0, 27) + '..."';
    }

    // Divs: try class name or infer
    if (tag === 'div') {
      // Try meaningful Tailwind classes
      const meaningful = classes.find(cls =>
        !cls.startsWith('flex') && !cls.startsWith('items-') && !cls.startsWith('justify-') &&
        !cls.startsWith('gap-') && !cls.startsWith('px-') && !cls.startsWith('py-') &&
        !cls.startsWith('p-') && !cls.startsWith('m-') && !cls.startsWith('w-') &&
        !cls.startsWith('h-') && !cls.startsWith('bg-') && !cls.startsWith('text-') &&
        !cls.startsWith('border') && !cls.startsWith('rounded') && !cls.startsWith('shadow') &&
        !cls.startsWith('overflow') && !cls.startsWith('relative') && !cls.startsWith('absolute') &&
        !cls.startsWith('fixed') && !cls.startsWith('z-') && !cls.startsWith('max-') &&
        !cls.startsWith('min-') && !cls.startsWith('font-') && !cls.startsWith('tracking-') &&
        !cls.startsWith('leading-') && !cls.startsWith('size-') && !cls.startsWith('shrink') &&
        !cls.startsWith('grow') && !cls.startsWith('grid') && !cls.startsWith('col-') &&
        !cls.startsWith('row-') && !cls.startsWith('snap') && !cls.startsWith('cursor') &&
        !cls.startsWith('transition') && !cls.startsWith('hover:') && !cls.startsWith('focus') &&
        !cls.startsWith('top-') && !cls.startsWith('bottom-') && !cls.startsWith('left-') &&
        !cls.startsWith('right-') && !cls.startsWith('inset') && !cls.startsWith('translate') &&
        !cls.startsWith('pb-') && !cls.startsWith('pt-') && !cls.startsWith('pl-') &&
        !cls.startsWith('pr-') && !cls.startsWith('mt-') && !cls.startsWith('mb-') &&
        !cls.startsWith('ml-') && !cls.startsWith('mr-') && !cls.startsWith('whitespace') &&
        !cls.startsWith('truncate') && !cls.startsWith('opacity') && !cls.startsWith('backdrop') &&
        cls.length > 2 && cls.length < 30
      );
      if (meaningful) {
        return meaningful.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      }
      return inferDivName(element);
    }

    return TAG_NAMES[tag] || tag;
  }

  // --- Layer Tree ---
  function buildTree(element) {
    if (element.nodeType !== 1) return null;
    const tag = element.tagName.toLowerCase();
    if (['script', 'style', 'link', 'meta', 'noscript'].includes(tag)) return null;

    // Collapse SVG internals
    if (tag === 'svg') {
      const id = element.getAttribute('data-ps-id') || '';
      return { id, tag: 'svg', name: 'Icon', children: [] };
    }

    const id = element.getAttribute('data-ps-id') || '';
    const name = inferName(element);
    const children = [];
    for (const child of element.children) {
      const node = buildTree(child);
      if (node) children.push(node);
    }
    return { id, tag, name, children };
  }

  function notifyLayerUpdate() {
    const canvas = document.getElementById('canvas');
    const tree = [];
    for (const child of canvas.children) {
      const node = buildTree(child);
      if (node) tree.push(node);
    }
    // Post to parent window (web app)
    try {
      window.parent.postMessage({ type: 'layerUpdate', tree: JSON.stringify(tree) }, '*');
    } catch(e) {}
    // Also try webkit (for macOS app compatibility)
    try {
      window.webkit.messageHandlers.layerUpdate.postMessage(JSON.stringify(tree));
    } catch(e) {}
  }

  function findNode(nodeId) {
    return document.querySelector(`[data-ps-id="${nodeId}"]`);
  }

  // --- Iconify Icon Sizing Fix ---
  // iconify-icon web component renders its SVG at 1em.
  // Tailwind size-* classes set width/height but NOT font-size,
  // so the SVG stays tiny. We fix this by setting font-size to match.
  function fixIconifySizing(root) {
    const icons = (root || document).querySelectorAll('iconify-icon');
    icons.forEach(icon => {
      const computed = window.getComputedStyle(icon);
      const w = computed.width;
      if (w && w !== 'auto' && w !== '0px') {
        icon.style.fontSize = w;
      }
    });
  }

  // --- Public API ---
  window.PS = {
    setHTML(html) {
      const canvas = document.getElementById('canvas');

      // Extract <style type="text/tailwindcss"> blocks
      const twMatches = html.match(/<style[^>]*type="text\/tailwindcss"[^>]*>([\s\S]*?)<\/style>/gi) || [];
      let themeCSS = '';
      for (const m of twMatches) {
        themeCSS += m.replace(/<style[^>]*>/, '').replace(/<\/style>/, '');
        html = html.replace(m, '');
      }

      // Extract <link> tags (fonts etc.) → inject into <head>
      document.querySelectorAll('.verso-injected-link').forEach(el => el.remove());
      const linkMatches = html.match(/<link[^>]*>/gi) || [];
      for (const m of linkMatches) {
        const temp = document.createElement('div');
        temp.innerHTML = m;
        const link = temp.firstChild;
        if (link && link.tagName === 'LINK') {
          link.classList.add('verso-injected-link');
          document.head.appendChild(link);
          html = html.replace(m, '');
        }
      }

      // Extract regular <style> blocks → inject into <head>
      document.querySelectorAll('.verso-injected-style').forEach(el => el.remove());
      const styleMatches = html.match(/<style(?![^>]*type="text\/tailwindcss")[^>]*>([\s\S]*?)<\/style>/gi) || [];
      for (const m of styleMatches) {
        const style = document.createElement('style');
        style.classList.add('verso-injected-style');
        style.textContent = m.replace(/<style[^>]*>/, '').replace(/<\/style>/, '');
        document.head.appendChild(style);
        html = html.replace(m, '');
      }

      // Set body content FIRST so Tailwind can find all classes when it processes the theme
      canvas.style.opacity = '0';
      canvas.innerHTML = html.trim();
      assignIds(canvas);
      // Fade-in reveal
      requestAnimationFrame(() => {
        canvas.style.transition = 'opacity 0.35s ease';
        canvas.style.opacity = '1';
      });

      // CRITICAL: Remove old theme and create a fresh <style type="text/tailwindcss">.
      // Tailwind v4 browser CDN transforms the original element after processing it.
      // Modifying textContent of the transformed element does NOT trigger recompilation.
      // Creating a new element triggers MutationObserver → full Tailwind recompile.
      const oldTheme = document.getElementById('verso-theme');
      if (oldTheme) oldTheme.remove();

      if (themeCSS) {
        const newTheme = document.createElement('style');
        newTheme.setAttribute('type', 'text/tailwindcss');
        newTheme.id = 'verso-theme';
        newTheme.textContent = themeCSS;
        document.head.appendChild(newTheme);
      }

      notifyLayerUpdate();

      // Fix iconify-icon sizing after Tailwind processes classes
      // Use multiple delays to catch both fast and slow Tailwind recompilation
      fixIconifySizing(canvas);
      setTimeout(() => fixIconifySizing(canvas), 100);
      setTimeout(() => fixIconifySizing(canvas), 500);

      return 'OK';
    },

    getTree() {
      const canvas = document.getElementById('canvas');
      const tree = [];
      for (const child of canvas.children) {
        const node = buildTree(child);
        if (node) tree.push(node);
      }
      return JSON.stringify(tree);
    },

    setText(nodeId, text) {
      const el = findNode(nodeId);
      if (!el) return 'Error: Node not found: ' + nodeId;
      el.textContent = text;
      return 'OK';
    },

    setStyle(nodeId, css) {
      const el = findNode(nodeId);
      if (!el) return 'Error: Node not found: ' + nodeId;
      el.style.cssText += css;
      return 'OK';
    },

    setClass(nodeId, className) {
      const el = findNode(nodeId);
      if (!el) return 'Error: Node not found: ' + nodeId;
      el.className = className;
      fixIconifySizing(el.parentElement || el);
      setTimeout(() => fixIconifySizing(el.parentElement || el), 100);
      return 'OK';
    },

    replaceNode(nodeId, html) {
      const el = findNode(nodeId);
      if (!el) return 'Error: Node not found: ' + nodeId;
      const parent = el.parentElement;
      if (!parent) return 'Error: Cannot replace a root element';
      const placeholder = document.createElement('div');
      placeholder.innerHTML = html.trim();
      const newEl = placeholder.firstElementChild;
      if (!newEl) return 'Error: Replacement HTML has no root element';
      parent.replaceChild(newEl, el);
      assignIds(parent);
      notifyLayerUpdate();
      fixIconifySizing(parent);
      setTimeout(() => fixIconifySizing(parent), 100);
      setTimeout(() => fixIconifySizing(parent), 500);
      return 'OK';
    },

    insertComponent(parentId, html, position) {
      const el = findNode(parentId);
      if (!el) return 'Error: Node not found: ' + parentId;
      if (position === 'replace') {
        el.innerHTML = html;
      } else {
        el.insertAdjacentHTML(position || 'beforeend', html);
      }
      assignIds(el.parentElement || el);
      notifyLayerUpdate();
      fixIconifySizing(el.parentElement || el);
      setTimeout(() => fixIconifySizing(el.parentElement || el), 100);
      setTimeout(() => fixIconifySizing(el.parentElement || el), 500);
      return 'OK';
    },

    removeNode(nodeId) {
      const el = findNode(nodeId);
      if (!el) return 'Error: Node not found: ' + nodeId;
      el.remove();
      notifyLayerUpdate();
      return 'OK';
    },

    setViewportWidth(width) {
      return 'OK';
    },

    highlightNode(nodeId) {
      this.clearHighlight();
      const el = findNode(nodeId);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const overlay = document.createElement('div');
      overlay.id = 'ps-highlight-overlay';
      overlay.style.cssText = `
        position: fixed; top: ${rect.top}px; left: ${rect.left}px;
        width: ${rect.width}px; height: ${rect.height}px;
        background: rgba(59, 130, 246, 0.15);
        border: 2px solid rgba(59, 130, 246, 0.6);
        border-radius: 4px;
        pointer-events: none; z-index: 99999;
        transition: all 0.15s ease;
      `;
      document.body.appendChild(overlay);
    },

    clearHighlight() {
      const existing = document.getElementById('ps-highlight-overlay');
      if (existing) existing.remove();
    },

    setLink(nodeId, targetScreenName) {
      const el = findNode(nodeId);
      if (!el) return 'Error: Node not found: ' + nodeId;
      el.setAttribute('data-ps-link', targetScreenName);
      return 'OK';
    },

    removeLinks() {
      document.querySelectorAll('[data-ps-link]').forEach(el => el.removeAttribute('data-ps-link'));
      return 'OK';
    },

    getScreenshot() {
      return 'screenshot-via-parent';
    }
  };

  // Listen for messages from parent window
  window.addEventListener('message', function(e) {
    const msg = e.data;
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'setHTML':
        window.PS.setHTML(msg.html);
        break;
      case 'getTree':
        const tree = window.PS.getTree();
        window.parent.postMessage({ type: 'treeResult', tree }, '*');
        break;
      case 'getNodeHTML': {
        // Used by edit-precision: fetch the outer HTML of one or more ps-ids so the AI
        // gets the exact element bytes, not just name+tag.
        const ids = Array.isArray(msg.nodeIds) ? msg.nodeIds : [msg.nodeId];
        const results = ids.map(id => {
          const el = document.querySelector(`[data-ps-id="${id}"]`);
          return { id, html: el ? el.outerHTML : null };
        });
        window.parent.postMessage({ type: 'nodeHTMLResult', requestId: msg.requestId || null, nodes: results }, '*');
        break;
      }
      case 'requestInspect': {
        // Send fresh styleInfo for the requested ps-id (used by editor's right
        // panel when it needs to refresh post-edit or post-tab-switch).
        const el = document.querySelector(`[data-ps-id="${msg.nodeId}"]`);
        if (!el) break;
        const nodeId = el.getAttribute('data-ps-id');
        const name = (typeof inferName === 'function') ? inferName(el) : (el.id || el.tagName.toLowerCase());
        const tag = el.tagName.toLowerCase();
        const computed = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const styleInfo = {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          padding: {
            top: Math.round(parseFloat(computed.paddingTop) || 0),
            right: Math.round(parseFloat(computed.paddingRight) || 0),
            bottom: Math.round(parseFloat(computed.paddingBottom) || 0),
            left: Math.round(parseFloat(computed.paddingLeft) || 0),
          },
          margin: {
            top: Math.round(parseFloat(computed.marginTop) || 0),
            right: Math.round(parseFloat(computed.marginRight) || 0),
            bottom: Math.round(parseFloat(computed.marginBottom) || 0),
            left: Math.round(parseFloat(computed.marginLeft) || 0),
          },
          fontFamily: computed.fontFamily,
          fontSize: computed.fontSize,
          fontWeight: computed.fontWeight,
          lineHeight: computed.lineHeight,
          letterSpacing: computed.letterSpacing,
          color: computed.color,
          backgroundColor: computed.backgroundColor,
          borderRadius: computed.borderRadius,
          opacity: computed.opacity,
          display: computed.display,
          position: computed.position,
          gap: computed.gap,
          textAlign: computed.textAlign,
          alignSelf: computed.alignSelf,
          classes: el.className || '',
        };
        window.parent.postMessage({ type: 'nodeInspect', id: nodeId, name, tag, styleInfo, refresh: true }, '*');
        break;
      }
      case 'setText':
        window.PS.setText(msg.nodeId, msg.text);
        break;
      case 'setStyle':
        window.PS.setStyle(msg.nodeId, msg.css);
        break;
      case 'setClass':
        window.PS.setClass(msg.nodeId, msg.className);
        break;
      case 'replaceNode':
        window.PS.replaceNode(msg.nodeId, msg.html);
        break;
      case 'removeNode':
        window.PS.removeNode(msg.nodeId);
        break;
      case 'highlightNode':
        window.PS.highlightNode(msg.nodeId);
        break;
      case 'clearHighlight':
        window.PS.clearHighlight();
        break;
      case 'insertComponent':
        window.PS.insertComponent(msg.parentId, msg.html, msg.position);
        break;
      case 'setLink':
        window.PS.setLink(msg.nodeId, msg.target);
        break;
      case 'removeLinks':
        window.PS.removeLinks();
        break;
      case 'setViewportWidth':
        window.PS.setViewportWidth(msg.width);
        break;
      case 'setPrototypeMode':
        if (msg.enabled) {
          document.body.classList.add('prototype-mode');
        } else {
          document.body.classList.remove('prototype-mode');
        }
        break;
    }
  });

  // Left-click: select element and copy node ID
  document.addEventListener('click', function(e) {
    const linkEl = e.target.closest('[data-ps-link]');
    if (linkEl) {
      const target = linkEl.getAttribute('data-ps-link');
      window.parent.postMessage({ type: 'screenLink', target }, '*');
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Skip selection in prototype mode
    if (document.body.classList.contains('prototype-mode')) return;

    const el = e.target.closest('[data-ps-id]');
    if (el) {
      // Left-click on an element → send the full inspector payload so the
      // editor's right panel can render it.
      const nodeId = el.getAttribute('data-ps-id');
      const name = inferName(el);
      const tag = el.tagName.toLowerCase();
      const computed = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();

      const styleInfo = {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        // Element position in the iframe's own viewport coords — used by the
        // editor to anchor the floating edit popup next to the element.
        iframeRect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
        padding: {
          top: Math.round(parseFloat(computed.paddingTop) || 0),
          right: Math.round(parseFloat(computed.paddingRight) || 0),
          bottom: Math.round(parseFloat(computed.paddingBottom) || 0),
          left: Math.round(parseFloat(computed.marginLeft) || 0),
        },
        margin: {
          top: Math.round(parseFloat(computed.marginTop) || 0),
          right: Math.round(parseFloat(computed.marginRight) || 0),
          bottom: Math.round(parseFloat(computed.marginBottom) || 0),
          left: Math.round(parseFloat(computed.marginLeft) || 0),
        },
        fontFamily: computed.fontFamily,
        fontSize: computed.fontSize,
        fontWeight: computed.fontWeight,
        lineHeight: computed.lineHeight,
        letterSpacing: computed.letterSpacing,
        color: computed.color,
        backgroundColor: computed.backgroundColor,
        borderRadius: computed.borderRadius,
        borderColor: computed.borderColor,
        borderWidth: computed.borderWidth,
        opacity: computed.opacity,
        display: computed.display,
        position: computed.position,
        gap: computed.gap,
        textAlign: computed.textAlign,
        alignSelf: computed.alignSelf,
        classes: el.className || '',
      };

      window.parent.postMessage({ type: 'nodeInspect', id: nodeId, name, tag, styleInfo }, '*');
    } else {
      // Clicked on background → deselect
      window.parent.postMessage({ type: 'nodeDeselect' }, '*');
    }
  }, true);

  // Right-click is disabled — left-click already drives the inspector. We
  // just suppress the native browser context menu over canvas elements.
  document.addEventListener('contextmenu', function(e) {
    if (document.body.classList.contains('prototype-mode')) return;
    const el = e.target.closest('[data-ps-id]');
    if (el) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  assignIds(document.getElementById('canvas'));
})();
