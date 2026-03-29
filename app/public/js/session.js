// klyr — Session Workspace

(function () {
  // ---- Session ID from URL ----
  const sessionId = window.location.pathname.replace(/^\//, '').replace(/\/$/, '');
  document.getElementById('sessionIdLabel').textContent = sessionId;
  document.title = `klyr — ${sessionId}`;

  // ---- Terminal Setup ----
  const term = new window.Terminal({
    fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
    fontSize: 13,
    lineHeight: 1.4,
    cursorBlink: true,
    cursorStyle: 'bar',
    theme: {
      background: '#000000',
      foreground: '#e0e0e0',
      cursor: '#ffffff',
      cursorAccent: '#000000',
      selectionBackground: 'rgba(255,255,255,0.15)',
      black: '#000000',
      red: '#ff6b6b',
      green: '#69db7c',
      yellow: '#ffd43b',
      blue: '#74c0fc',
      magenta: '#da77f2',
      cyan: '#66d9e8',
      white: '#e0e0e0',
      brightBlack: '#555555',
      brightRed: '#ff8787',
      brightGreen: '#8ce99a',
      brightYellow: '#ffe066',
      brightBlue: '#a5d8ff',
      brightMagenta: '#e599f7',
      brightCyan: '#99e9f2',
      brightWhite: '#ffffff',
    },
  });

  const fitAddon = new window.FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  try {
    const webLinksAddon = new window.WebLinksAddon.WebLinksAddon();
    term.loadAddon(webLinksAddon);
  } catch {}

  const termEl = document.getElementById('terminal');
  term.open(termEl);
  fitAddon.fit();

  // ---- WebSocket ----
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/?session=${sessionId}`;
  let ws;
  let reconnectTimer;

  function connect() {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      term.write('\r\n\x1b[2m  Connected to klyr session\x1b[0m\r\n\r\n');
      // Send initial size
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'output') {
        term.write(msg.data);
      } else if (msg.type === 'exit') {
        term.write('\r\n\x1b[2m  Session ended (exit code: ' + (msg.code ?? '?') + ')\x1b[0m\r\n');
      } else if (msg.type === 'error') {
        term.write('\r\n\x1b[31m  Error: ' + msg.data + '\x1b[0m\r\n');
      } else if (msg.type === 'fs') {
        refreshFiles();
      }
    };

    ws.onclose = () => {
      term.write('\r\n\x1b[2m  Disconnected. Reconnecting...\x1b[0m\r\n');
      reconnectTimer = setTimeout(connect, 2000);
    };

    ws.onerror = () => {};
  }

  connect();

  // Terminal input -> WebSocket
  term.onData((data) => {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'input', data }));
    }
  });

  // Terminal resize
  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  });
  resizeObserver.observe(termEl);

  // ---- Tab Switching ----
  const tabs = document.querySelectorAll('.topbar-tab');
  const panels = {
    terminal: document.getElementById('terminalPanel'),
    code: document.getElementById('codePanel'),
    preview: document.getElementById('previewPanel'),
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.panel;
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      Object.values(panels).forEach((p) => p.classList.remove('active'));
      panels[target].classList.add('active');
      if (target === 'terminal') {
        setTimeout(() => fitAddon.fit(), 50);
      }
    });
  });

  // ---- Sidebar Toggle ----
  const sidebar = document.getElementById('sidebar');
  const sidebarResize = document.getElementById('sidebarResize');
  const toggleFilesBtn = document.getElementById('toggleFilesBtn');

  toggleFilesBtn.addEventListener('click', () => {
    sidebar.classList.toggle('hidden');
    sidebarResize.style.display = sidebar.classList.contains('hidden') ? 'none' : '';
    toggleFilesBtn.classList.toggle('active');
    setTimeout(() => fitAddon.fit(), 50);
  });

  // ---- Sidebar Resize ----
  let resizing = false;

  sidebarResize.addEventListener('mousedown', (e) => {
    resizing = true;
    sidebarResize.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    const newWidth = Math.max(180, Math.min(400, e.clientX));
    sidebar.style.width = newWidth + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (resizing) {
      resizing = false;
      sidebarResize.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      fitAddon.fit();
    }
  });

  // ---- File Explorer ----
  const fileTree = document.getElementById('fileTree');

  async function refreshFiles() {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/files`);
      if (!res.ok) return;
      const files = await res.json();
      renderTree(files);
    } catch {}
  }

  function renderTree(items, depth = 0) {
    if (depth === 0) fileTree.innerHTML = '';
    if (depth === 0 && items.length === 0) {
      fileTree.innerHTML = '<div class="file-tree-empty">No files yet</div>';
      return;
    }

    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'tree-item';
      el.style.paddingLeft = (14 + depth * 16) + 'px';

      const icon = document.createElement('span');
      icon.className = 'tree-icon';

      if (item.type === 'dir') {
        icon.textContent = '\u25B6'; // right triangle
        el.dataset.expanded = 'false';
      } else {
        icon.textContent = getFileIcon(item.name);
      }

      const name = document.createElement('span');
      name.className = 'tree-name';
      name.textContent = item.name;

      el.appendChild(icon);
      el.appendChild(name);
      fileTree.appendChild(el);

      if (item.type === 'dir' && item.children) {
        const childContainer = document.createElement('div');
        childContainer.className = 'tree-children';
        childContainer.style.display = 'none';
        fileTree.appendChild(childContainer);

        el.addEventListener('click', () => {
          const expanded = el.dataset.expanded === 'true';
          el.dataset.expanded = expanded ? 'false' : 'true';
          icon.textContent = expanded ? '\u25B6' : '\u25BC'; // right vs down triangle
          childContainer.style.display = expanded ? 'none' : '';
        });

        // Render children into the container
        const savedParent = fileTree;
        // Temporarily use childContainer as target
        const tempFragment = document.createDocumentFragment();
        for (const child of item.children) {
          renderSingleItem(tempFragment, child, depth + 1);
        }
        childContainer.appendChild(tempFragment);
      } else if (item.type === 'file') {
        el.addEventListener('click', () => loadFile(item.path, item.name));
      }
    }
  }

  function renderSingleItem(parent, item, depth) {
    const el = document.createElement('div');
    el.className = 'tree-item';
    el.style.paddingLeft = (14 + depth * 16) + 'px';

    const icon = document.createElement('span');
    icon.className = 'tree-icon';

    if (item.type === 'dir') {
      icon.textContent = '\u25B6';
      el.dataset.expanded = 'false';
    } else {
      icon.textContent = getFileIcon(item.name);
    }

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = item.name;

    el.appendChild(icon);
    el.appendChild(name);
    parent.appendChild(el);

    if (item.type === 'dir' && item.children) {
      const childContainer = document.createElement('div');
      childContainer.className = 'tree-children';
      childContainer.style.display = 'none';
      parent.appendChild(childContainer);

      el.addEventListener('click', () => {
        const expanded = el.dataset.expanded === 'true';
        el.dataset.expanded = expanded ? 'false' : 'true';
        icon.textContent = expanded ? '\u25B6' : '\u25BC';
        childContainer.style.display = expanded ? 'none' : '';
      });

      const frag = document.createDocumentFragment();
      for (const child of item.children) {
        renderSingleItem(frag, child, depth + 1);
      }
      childContainer.appendChild(frag);
    } else if (item.type === 'file') {
      el.addEventListener('click', () => loadFile(item.path, item.name));
    }
  }

  function getFileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const icons = {
      ts: 'TS', tsx: 'TX', js: 'JS', jsx: 'JX',
      css: '#', html: '<>', json: '{}', md: 'M',
      svg: '~', png: '\u25A3', jpg: '\u25A3', gif: '\u25A3',
      lock: '\u26BF', yaml: 'Y', yml: 'Y', toml: 'T',
    };
    return icons[ext] || '\u2022';
  }

  async function loadFile(filePath, fileName) {
    // Switch to code tab
    tabs.forEach((t) => t.classList.remove('active'));
    document.querySelector('[data-panel="code"]').classList.add('active');
    Object.values(panels).forEach((p) => p.classList.remove('active'));
    panels.code.classList.add('active');

    document.getElementById('codeHeader').textContent = filePath;

    try {
      const res = await fetch(`/api/sessions/${sessionId}/file?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      document.getElementById('codeContent').querySelector('code').textContent = data.content;
    } catch {
      document.getElementById('codeContent').querySelector('code').textContent = '// Failed to load file';
    }
  }

  // ---- Preview ----
  const previewFrame = document.getElementById('previewFrame');
  const previewPlaceholder = document.getElementById('previewPlaceholder');
  const refreshPreviewBtn = document.getElementById('refreshPreviewBtn');
  const openPreviewBtn = document.getElementById('openPreviewBtn');

  let previewUrl = `/preview/${sessionId}/index.html`;

  function refreshPreview() {
    previewFrame.src = previewUrl + '?t=' + Date.now();
    previewPlaceholder.classList.add('hidden');
  }

  refreshPreviewBtn.addEventListener('click', refreshPreview);
  openPreviewBtn.addEventListener('click', () => window.open(previewUrl, '_blank'));

  // Auto-refresh preview when files change
  let previewRefreshTimer;
  const origOnMessage = ws ? ws.onmessage : null;

  // We hook into the file system events to auto-refresh preview
  // This is done through the WebSocket 'fs' messages which trigger refreshFiles() above
  // Additionally refresh preview on html/css/js changes
  setInterval(() => {
    // Periodically check if index.html exists and refresh preview
    fetch(`/preview/${sessionId}/index.html`, { method: 'HEAD' })
      .then((res) => {
        if (res.ok && previewPlaceholder && !previewPlaceholder.classList.contains('hidden')) {
          refreshPreview();
        }
      })
      .catch(() => {});
  }, 3000);

  // ---- Toggle Preview Split ----
  const togglePreviewBtn = document.getElementById('togglePreviewBtn');
  let previewSplit = false;

  togglePreviewBtn.addEventListener('click', () => {
    previewSplit = !previewSplit;
    togglePreviewBtn.classList.toggle('active');

    const mainContent = document.querySelector('.main-content');

    if (previewSplit) {
      // Show both terminal and preview side by side
      mainContent.style.flexDirection = 'row';
      panels.terminal.classList.add('active');
      panels.preview.classList.add('active');
      panels.code.classList.remove('active');

      panels.terminal.style.flex = '1';
      panels.preview.style.flex = '1';
      panels.preview.style.borderLeft = '1px solid hsl(0 0% 20% / 0.4)';

      tabs.forEach((t) => t.classList.remove('active'));
      document.querySelector('[data-panel="terminal"]').classList.add('active');

      refreshPreview();
      setTimeout(() => fitAddon.fit(), 50);
    } else {
      mainContent.style.flexDirection = '';
      panels.preview.style.flex = '';
      panels.preview.style.borderLeft = '';
      panels.terminal.style.flex = '';

      // Restore single panel view
      panels.preview.classList.remove('active');
      panels.terminal.classList.add('active');
      tabs.forEach((t) => t.classList.remove('active'));
      document.querySelector('[data-panel="terminal"]').classList.add('active');
      setTimeout(() => fitAddon.fit(), 50);
    }
  });

  // ---- Initial refresh ----
  document.getElementById('refreshFilesBtn').addEventListener('click', refreshFiles);
  refreshFiles();

  // Refresh files every 5 seconds
  setInterval(refreshFiles, 5000);
})();
