const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const chokidar = require('chokidar');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 8000;
const WORKSPACES_DIR = path.join(__dirname, 'workspaces');
const TEMPLATE_DIR = path.join(__dirname, 'templates');

fs.mkdirSync(WORKSPACES_DIR, { recursive: true });

const sessions = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- API ----------

app.post('/api/sessions', (req, res) => {
  const sessionId = uuidv4().slice(0, 8);
  const workspacePath = path.join(WORKSPACES_DIR, sessionId);
  fs.mkdirSync(workspacePath, { recursive: true });

  const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'CLAUDE.md'), 'utf-8');
  fs.writeFileSync(path.join(workspacePath, 'CLAUDE.md'), template);

  sessions.set(sessionId, {
    id: sessionId,
    workspacePath,
    created: new Date().toISOString(),
    ptyProcess: null,
    clients: new Set(),
    watcher: null,
  });

  res.json({ sessionId });
});

app.get('/api/sessions/:id/files', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  function tree(dir, base) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    const items = [];
    for (const e of entries) {
      if (['node_modules', '.git', '.cache', 'dist', '.vite'].includes(e.name)) continue;
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) {
        items.push({ name: e.name, path: rel, type: 'dir', children: tree(path.join(dir, e.name), rel) });
      } else {
        items.push({ name: e.name, path: rel, type: 'file' });
      }
    }
    return items.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1);
  }

  res.json(tree(session.workspacePath, ''));
});

app.get('/api/sessions/:id/file', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });

  const absolute = path.join(session.workspacePath, filePath);
  if (!absolute.startsWith(session.workspacePath)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const content = fs.readFileSync(absolute, 'utf-8');
    res.json({ content });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

app.use('/preview/:sessionId', (req, res, next) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).send('Not found');
  express.static(session.workspacePath)(req, res, next);
});

// ---------- Downloads ----------

// Serve install script
app.get('/install', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'install.sh'));
});

// Generate and serve project tarball
app.get('/download/klyr.tar.gz', (req, res) => {
  const tmpFile = `/tmp/klyr-${Date.now()}.tar.gz`;
  try {
    execSync(
      `tar -czf "${tmpFile}" --exclude=node_modules --exclude=workspaces --exclude=.git --exclude="*.log" --exclude="*.pid" -C "${path.dirname(__dirname)}" app`,
      { timeout: 15000 }
    );
    res.download(tmpFile, 'klyr.tar.gz', () => {
      try { fs.unlinkSync(tmpFile); } catch {}
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create package' });
  }
});

// Serve the CLI script directly
app.get('/download/klyr', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'bin', 'klyr'));
});

// Session page route
app.get('/:sessionId([a-f0-9]{8})', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'session.html'));
});

// ---------- WebSocket ----------

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('session');

  if (!sessionId) {
    ws.send(JSON.stringify({ type: 'error', data: 'Missing session ID' }));
    ws.close();
    return;
  }

  // Auto-create session if it doesn't exist (for manual URL entry)
  if (!sessions.has(sessionId)) {
    const workspacePath = path.join(WORKSPACES_DIR, sessionId);
    fs.mkdirSync(workspacePath, { recursive: true });
    try {
      const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'CLAUDE.md'), 'utf-8');
      fs.writeFileSync(path.join(workspacePath, 'CLAUDE.md'), template);
    } catch {}
    sessions.set(sessionId, {
      id: sessionId,
      workspacePath,
      created: new Date().toISOString(),
      ptyProcess: null,
      clients: new Set(),
      watcher: null,
    });
  }

  const session = sessions.get(sessionId);
  session.clients.add(ws);

  function broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const c of session.clients) {
      if (c.readyState === 1) c.send(payload);
    }
  }

  if (!session.ptyProcess) {
    const claudePath = process.env.CLAUDE_PATH || 'claude';
    try {
      session.ptyProcess = pty.spawn(claudePath, [], {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: session.workspacePath,
        env: { ...process.env, TERM: 'xterm-256color', HOME: process.env.HOME },
      });

      session.ptyProcess.onData((data) => broadcast({ type: 'output', data }));
      session.ptyProcess.onExit(({ exitCode }) => {
        broadcast({ type: 'exit', code: exitCode });
        session.ptyProcess = null;
      });
    } catch (err) {
      ws.send(JSON.stringify({
        type: 'error',
        data: `Failed to start Claude Code: ${err.message}\nMake sure 'claude' CLI is installed and in your PATH.`,
      }));
    }

    if (!session.watcher) {
      session.watcher = chokidar.watch(session.workspacePath, {
        ignored: /(node_modules|\.git|\.cache|dist|\.vite)/,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 300 },
      });
      session.watcher.on('all', (event, filePath) => {
        broadcast({ type: 'fs', event, path: path.relative(session.workspacePath, filePath) });
      });
    }
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'input' && session.ptyProcess) {
      session.ptyProcess.write(msg.data);
    } else if (msg.type === 'resize' && session.ptyProcess) {
      session.ptyProcess.resize(msg.cols || 120, msg.rows || 40);
    }
  });

  ws.on('close', () => session.clients.delete(ws));
});

// ---------- Start ----------

server.listen(PORT, () => {
  console.log(`\n  klyr is running at http://localhost:${PORT}\n`);
});
