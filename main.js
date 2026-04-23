/**
 * main.js - Electron main process
 * AgentDockyard - stockage SQLite via agent (Python en dev, .exe autonome en prod).
 *
 * En dev  : spawn('python', ['agent.py', payload, dbPath])
 * En prod : spawn(process.resourcesPath + '/agent.exe', [payload, dbPath])
 *           -> l'utilisateur n'a besoin de rien installer.
 *
 * Watcher sur tasks.db pour notifier le renderer quand un agent externe ecrit.
 */

const { app, BrowserWindow, ipcMain, screen, dialog, shell } = require('electron');
const path            = require('path');
const fs              = require('fs');
const http            = require('http');
const https           = require('https');
const { URL }         = require('url');
const { spawnSync, spawn } = require('child_process');

// electron-updater : lazy-load pour ne pas crasher en dev (il appelle app.getVersion() au require)
let _autoUpdater = null;
function getAutoUpdater() {
  if (_autoUpdater) return _autoUpdater;
  _autoUpdater = require('electron-updater').autoUpdater;
  _autoUpdater.autoDownload         = false;
  _autoUpdater.autoInstallOnAppQuit = true;

  _autoUpdater.on('update-available', (info) => {
    // Telechargement silencieux, notification in-app uniquement
    _autoUpdater.downloadUpdate().catch(() => {});
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', info.version);
    }
  });

  _autoUpdater.on('update-downloaded', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded');
    }
  });

  _autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err && err.message);
  });

  return _autoUpdater;
}

// ─── Chemins ──────────────────────────────────────────────────────────────────
const IS_PACKAGED = app.isPackaged;

// agent executable : en prod c'est un .exe autonome (Windows) ou binaire (Mac/Linux).
// En dev, on appelle le script Python.
function agentExecutableName() {
  if (process.platform === 'win32') return 'agent.exe';
  return 'agent';
}

const AGENT_EXE_PATH = IS_PACKAGED
  ? path.join(process.resourcesPath, agentExecutableName())
  : null; // dev -> pas d'exe, on utilise python + agent.py

const AGENT_SCRIPT_DEV = path.join(__dirname, 'agent.py');

// AGENT_PATH : chemin a exposer aux agents IA pour leurs appels CLI
const AGENT_PATH = IS_PACKAGED ? AGENT_EXE_PATH : AGENT_SCRIPT_DEV;

const USER_DATA     = IS_PACKAGED ? app.getPath('userData') : __dirname;
const DB_PATH       = path.join(USER_DATA, 'tasks.db');
const CONFIG_PATH   = path.join(USER_DATA, 'config.json');
const SNAPSHOTS_DIR = path.join(USER_DATA, 'snapshots');

const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;  // 1h
const SNAPSHOT_MAX_AGE_MS  = 7 * 24 * 60 * 60 * 1000;  // 7 jours
const SNAPSHOT_MAX_COUNT   = 200;  // garde-fou dur : 168 horaires + marge pour les before-restore

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG_DEFAULT = {
  theme: 'dark',
  language: 'en',
  purge: {
    enabled: true,
    delai_fait_jours: 90,
    delai_annule_jours: 90,
    au_demarrage: false,
  },
  reclamation: {
    expiration_heures: 24,
  },
  interface: {
    refresh_secondes: 30,
    afficher_fait: true,
    afficher_annule: false,
    max_par_groupe: 0,
  },
  agents: [
    { id: 'claude-cowork', label: 'claude-cowork', emoji: '\u2699\uFE0F' },
    { id: 'claude-code',   label: 'claude-code',   emoji: '\u{1F916}'    },
    { id: 'copilot',       label: 'copilot',       emoji: '\u2708\uFE0F' },
    { id: 'codex',         label: 'codex',         emoji: '\u{1F4DF}'    },
    { id: 'steeve',        label: 'steeve',        emoji: '\u{1F464}'    },
  ],
  window: {
    enabled: false,
    autoRemember: false,
    displayIndex: 0,
    displayId: null,
    x: null,
    y: null,
    xRelative: false,
    yRelative: false,
    width: 1200,
    height: 900,
    fullWidth: false,
    fullHeight: false,
  },
  widgets: [],
};

function deepMerge(base, patch) {
  if (patch === null || patch === undefined) return base;
  if (typeof base !== 'object' || typeof patch !== 'object' || Array.isArray(base) || Array.isArray(patch)) {
    return patch !== undefined ? patch : base;
  }
  const out = { ...base };
  for (const k of Object.keys(patch)) {
    out[k] = (k in base) ? deepMerge(base[k], patch[k]) : patch[k];
  }
  return out;
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return deepMerge(CONFIG_DEFAULT, raw);
    }
  } catch (e) {
    console.error('[config] lecture echouee :', e.message);
  }
  return JSON.parse(JSON.stringify(CONFIG_DEFAULT));
}

function saveConfig(partial) {
  const current = loadConfig();
  const merged  = deepMerge(current, partial);
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
  } catch (e) {
    console.error('[config] ecriture echouee :', e.message);
  }
  return merged;
}

// ─── Detection Python (dev uniquement) ────────────────────────────────────────
let PYTHON_CMD = null;
function detectPython() {
  for (const cmd of ['python', 'python3', 'py']) {
    try {
      const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 5000 });
      if (!r.error && r.status === 0) return cmd;
    } catch (_) { /* ignore */ }
  }
  return null;
}

// ─── Appel agent (async — ne bloque pas le main process ni la fenetre) ────────
function callAgent(payload, dbPathOverride) {
  return new Promise((resolve) => {
    const dbPath = dbPathOverride || DB_PATH;
    let bin, args;
    if (IS_PACKAGED) {
      bin  = AGENT_EXE_PATH;
      args = [JSON.stringify(payload), dbPath];
    } else {
      if (!PYTHON_CMD) return resolve({ statut: 'NOK', message: 'Python introuvable (mode dev)' });
      bin  = PYTHON_CMD;
      args = [AGENT_SCRIPT_DEV, JSON.stringify(payload), dbPath];
    }

    let stdout = '';
    let stderr = '';
    let done   = false;

    // spawn() AVANT setTimeout : si spawn jette une exception synchrone
    // (binaire bloque par antivirus, introuvable, etc.) on doit sortir tout
    // de suite. Un setTimeout qui referencerait un child jamais initialise
    // crashe le main process en TDZ (ReferenceError: Cannot access 'child'
    // before initialization) des que le timer fire.
    let child;
    try {
      child = spawn(bin, args);
    } catch (err) {
      console.error('[callAgent] spawn a lance une exception :', err && err.message);
      return resolve({ statut: 'NOK', message: 'Spawn impossible : ' + (err && err.message || 'erreur inconnue') });
    }

    const timer = setTimeout(() => {
      if (!done) { done = true; try { child.kill(); } catch (_) {} resolve({ statut: 'NOK', message: 'Timeout' }); }
    }, 10000);

    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code !== 0) console.error('callAgent stderr:', stderr);
      try {
        resolve(JSON.parse(stdout || '{}'));
      } catch (e) {
        console.error('callAgent JSON parse error:', stdout, e.message);
        resolve({ statut: 'NOK', message: 'JSON invalide: ' + stdout.slice(0, 120) });
      }
    });
    child.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      console.error('callAgent spawn error:', err.message);
      resolve({ statut: 'NOK', message: err.message });
    });
  });
}

// ─── Snapshots horaires ───────────────────────────────────────────────────────
// Un snapshot = une copie binaire de tasks.db dans snapshots/.
// Nom : snapshot-YYYYMMDD-HHmmss.db (+ suffix "-before-restore" pour les backups
// automatiques crees avant un remplacement).
// Rotation : snapshots de plus de 7 jours supprimes, avec un plafond dur a 200
// fichiers (168 horaires + marge pour les backups before-restore).

let snapshotTimer = null;

function ensureSnapshotsDir() {
  try { fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true }); } catch (_) { /* ignore */ }
}

function snapshotStamp(d) {
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${Y}${M}${D}-${h}${m}${s}`;
}

function parseSnapshotName(filename) {
  // snapshot-YYYYMMDD-HHmmss.db  ou  snapshot-YYYYMMDD-HHmmss-before-restore.db
  const m = /^snapshot-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(-before-restore)?\.db$/.exec(filename);
  if (!m) return null;
  const [_, Y, Mo, D, h, mi, s, suffix] = m;
  const date = new Date(Number(Y), Number(Mo) - 1, Number(D), Number(h), Number(mi), Number(s));
  if (isNaN(date.getTime())) return null;
  return {
    filename,
    date,
    timestamp:     date.getTime(),
    beforeRestore: !!suffix,
  };
}

function listSnapshotFiles() {
  ensureSnapshotsDir();
  let entries = [];
  try { entries = fs.readdirSync(SNAPSHOTS_DIR); } catch (_) { return []; }
  const out = [];
  for (const f of entries) {
    const meta = parseSnapshotName(f);
    if (!meta) continue;
    try {
      const st = fs.statSync(path.join(SNAPSHOTS_DIR, f));
      meta.size = st.size;
    } catch (_) { meta.size = 0; }
    out.push(meta);
  }
  out.sort((a, b) => b.timestamp - a.timestamp);  // plus recent en premier
  return out;
}

function takeSnapshot(suffix) {
  if (!fs.existsSync(DB_PATH)) return null;
  ensureSnapshotsDir();
  const stamp = snapshotStamp(new Date());
  const name  = `snapshot-${stamp}${suffix ? '-' + suffix : ''}.db`;
  const dest  = path.join(SNAPSHOTS_DIR, name);
  try {
    fs.copyFileSync(DB_PATH, dest);
    return name;
  } catch (e) {
    console.error('[snapshot] copie echouee :', e.message);
    return null;
  }
}

function rotateSnapshots() {
  const all = listSnapshotFiles();
  const now = Date.now();
  const tooOld = all.filter(s => (now - s.timestamp) > SNAPSHOT_MAX_AGE_MS);
  for (const s of tooOld) {
    try { fs.unlinkSync(path.join(SNAPSHOTS_DIR, s.filename)); } catch (_) { /* ignore */ }
  }
  // Plafond dur : si on depasse SNAPSHOT_MAX_COUNT, supprimer les plus anciens
  const remaining = listSnapshotFiles();
  if (remaining.length > SNAPSHOT_MAX_COUNT) {
    const excess = remaining.slice(SNAPSHOT_MAX_COUNT);
    for (const s of excess) {
      try { fs.unlinkSync(path.join(SNAPSHOTS_DIR, s.filename)); } catch (_) { /* ignore */ }
    }
  }
}

function maybeTakeHourlySnapshot() {
  const list = listSnapshotFiles().filter(s => !s.beforeRestore);
  const last = list[0];  // plus recent
  if (!last || (Date.now() - last.timestamp) >= SNAPSHOT_INTERVAL_MS) {
    takeSnapshot();
  }
  rotateSnapshots();
}

function startSnapshotScheduler() {
  // 1) Snapshot "initial" si aucune sauvegarde recente
  try { maybeTakeHourlySnapshot(); } catch (e) { console.error('[snapshot] init :', e.message); }

  // 2) Aligner le prochain tick sur l'heure pile suivante (HH:00:00), puis interval 1h
  const now      = new Date();
  const msToNext = (60 - now.getMinutes()) * 60 * 1000 - now.getSeconds() * 1000 - now.getMilliseconds();

  setTimeout(() => {
    try { maybeTakeHourlySnapshot(); } catch (e) { console.error('[snapshot] tick :', e.message); }
    snapshotTimer = setInterval(() => {
      try { maybeTakeHourlySnapshot(); } catch (e) { console.error('[snapshot] tick :', e.message); }
    }, SNAPSHOT_INTERVAL_MS);
  }, Math.max(1000, msToNext));
}

function stopSnapshotScheduler() {
  if (snapshotTimer) { clearInterval(snapshotTimer); snapshotTimer = null; }
}

async function previewSnapshotTasks(filename) {
  const meta = parseSnapshotName(filename);
  if (!meta) return { ok: false, error: 'Nom de snapshot invalide' };
  const full = path.join(SNAPSHOTS_DIR, filename);
  if (!fs.existsSync(full)) return { ok: false, error: 'Snapshot introuvable' };
  const r = await callAgent({ action: 'lister', inclure_fait: true, inclure_annule: true }, full);
  if (r && Array.isArray(r.taches)) {
    return {
      ok: true,
      filename,
      timestamp: meta.timestamp,
      beforeRestore: meta.beforeRestore,
      taches: r.taches,
    };
  }
  return { ok: false, error: (r && r.message) || 'Lecture du snapshot echouee' };
}

function restoreSnapshotFile(filename) {
  const meta = parseSnapshotName(filename);
  if (!meta) return { ok: false, error: 'Nom de snapshot invalide' };
  const src = path.join(SNAPSHOTS_DIR, filename);
  if (!fs.existsSync(src)) return { ok: false, error: 'Snapshot introuvable' };
  // Securite : snapshot de l'etat courant AVANT d'ecraser
  const backupName = takeSnapshot('before-restore');
  try {
    fs.copyFileSync(src, DB_PATH);
    lastOwnWrite = Date.now();
    return { ok: true, backup: backupName };
  } catch (e) {
    return { ok: false, error: e.message, backup: backupName };
  }
}

// ─── Fenetre ──────────────────────────────────────────────────────────────────
let mainWindow;
let dbWatcher;
let debounceTimer;
let lastOwnWrite = 0;

function applyWindowConfig(win, cfg) {
  const winCfg = cfg.window || {};
  if (!winCfg.enabled) return false;

  const displays = screen.getAllDisplays();
  let display = displays[0];
  if (typeof winCfg.displayIndex === 'number' && displays[winCfg.displayIndex]) {
    display = displays[winCfg.displayIndex];
  } else if (winCfg.displayId !== null && winCfg.displayId !== undefined) {
    const found = displays.find(d => d.id === winCfg.displayId);
    if (found) display = found;
  }
  const { bounds } = display;

  let x = (typeof winCfg.x === 'number') ? winCfg.x : bounds.x;
  let y = (typeof winCfg.y === 'number') ? winCfg.y : bounds.y;
  if (winCfg.xRelative) x = bounds.x + (winCfg.x || 0);
  if (winCfg.yRelative) y = bounds.y + (winCfg.y || 0);

  let width  = winCfg.fullWidth  ? bounds.width  : (winCfg.width  || 1200);
  let height = winCfg.fullHeight ? bounds.height : (winCfg.height ||  900);

  const shadowOffset = process.platform === 'win32' ? 8 : 0;
  if (winCfg.fullWidth) {
    width = bounds.width + shadowOffset * 2;
    x = bounds.x - shadowOffset;
  }

  try { win.setBounds({ x, y, width, height }); } catch (e) { console.error('[window] setBounds failed:', e.message); }
  return true;
}

function setupAutoRemember(win) {
  let debounce;
  const save = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const cfg = loadConfig();
      if (!cfg.window || !cfg.window.autoRemember) return;
      const b = win.getBounds();
      const displays = screen.getAllDisplays();
      const display = displays.find(d =>
        b.x >= d.bounds.x && b.x < d.bounds.x + d.bounds.width &&
        b.y >= d.bounds.y && b.y < d.bounds.y + d.bounds.height
      ) || displays[0];
      saveConfig({
        window: {
          enabled: true,
          autoRemember: true,
          displayIndex: displays.indexOf(display),
          displayId: display.id,
          x: b.x, y: b.y,
          xRelative: false, yRelative: false,
          width:  b.width, height: b.height,
          fullWidth: false, fullHeight: false,
        },
      });
    }, 1000);
  };
  win.on('moved',   save);
  win.on('resized', save);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1200,
    height:  900,
    show: false,
    minWidth:  760,
    minHeight: 600,
    backgroundColor: '#18181b',
    title: 'AgentDockyard',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.key === 'F12' || (input.key === 'I' && input.control && input.shift)) && input.type === 'keyDown') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  mainWindow.loadFile('index.html');

  const cfg = loadConfig();

  mainWindow.once('ready-to-show', () => {
    const applied = applyWindowConfig(mainWindow, cfg);
    if (!applied) {
      const primary = screen.getPrimaryDisplay();
      const { width: sw, height: sh, x: sx, y: sy } = primary.workArea;
      const winW = Math.min(1200, sw);
      const winH = Math.min( 900, sh);
      mainWindow.setBounds({
        x: sx + Math.floor((sw - winW) / 2),
        y: sy + Math.floor((sh - winH) / 2),
        width:  winW,
        height: winH,
      });
    }
    mainWindow.show();
  });

  if (cfg.window && cfg.window.autoRemember) setupAutoRemember(mainWindow);

  function startWatcher() {
    if (!fs.existsSync(DB_PATH)) return;
    dbWatcher = fs.watch(DB_PATH, () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (Date.now() - lastOwnWrite < 600) return;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('db-changed');
        }
      }, 400);
    });
  }
  startWatcher();

  mainWindow.on('closed', () => {
    if (dbWatcher) { dbWatcher.close(); dbWatcher = null; }
    mainWindow = null;
  });
}

// ─── Smooth scrolling & performance flags ────────────────────────────────────
app.commandLine.appendSwitch('enable-smooth-scrolling');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Dev : detecter Python. Prod : pas de Python requis, on a agent.exe autonome.
  if (!IS_PACKAGED) {
    PYTHON_CMD = detectPython();
    if (!PYTHON_CMD) {
      dialog.showMessageBoxSync({
        type: 'warning',
        title: 'Mode dev - Python requis',
        message: 'En mode developpement, AgentDockyard execute agent.py via Python.\n\n' +
                 'Python introuvable dans le PATH.\n' +
                 'Installez Python 3.8+ (python.org) pour tester en dev.\n\n' +
                 'L\'executable final (.exe) n\'a pas cette dependance.',
        buttons: ['OK'],
      });
    }
  } else if (!fs.existsSync(AGENT_EXE_PATH)) {
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'Installation incomplete',
      message: `Le composant ${agentExecutableName()} est manquant.\n\n` +
               `Chemin attendu : ${AGENT_EXE_PATH}\n\n` +
               'Reinstallez AgentDockyard depuis github.com/steevec/agentdockyard/releases',
      buttons: ['OK'],
    });
    app.quit();
    return;
  }

  fs.mkdirSync(USER_DATA, { recursive: true });

  try {
    const cfg = loadConfig();
    if (cfg.purge && cfg.purge.au_demarrage && cfg.purge.enabled) {
      callAgent({ action: 'purger_maintenant' });
    }
  } catch (e) { /* ignore */ }

  createWindow();

  try { startSnapshotScheduler(); } catch (e) { console.error('[snapshot] scheduler :', e.message); }

  if (IS_PACKAGED) {
    setTimeout(() => {
      try { getAutoUpdater().checkForUpdates().catch(() => { /* silencieux */ }); }
      catch (e) { console.error('[updater] init failed:', e.message); }
    }, 15000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopSnapshotScheduler();
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC : gestion des taches ─────────────────────────────────────────────────
ipcMain.handle('get-tasks', async () => {
  // L UI affiche les taches cloturees (fait) et annulees selon les preferences :
  // le filtrage se fait cote renderer, on demande donc tout au backend.
  const r = await callAgent({ action: 'lister', inclure_fait: true, inclure_annule: true });
  return r.taches || [];
});

ipcMain.handle('add-task', async (event, d) => {
  lastOwnWrite = Date.now();
  const r = await callAgent({
    action:   'ajouter',
    agent:    d.agent    || '',
    repo:     d.repo     || '',
    sujet:    d.sujet    || '',
    contexte: d.contexte || '',
    note:     d.note     || '',
    statut:   d.statut   || 'en_cours',
  });
  return { id: r.id };
});

ipcMain.handle('update-task', async (event, d) => {
  lastOwnWrite = Date.now();
  const payload = { action: 'modifier', id: d.id };
  const allowed = ['agent','repo','sujet','contexte','note','statut'];
  for (const k of allowed) {
    if (d[k] !== undefined) payload[k] = d[k];
  }
  const r = await callAgent(payload);
  return { changes: r.statut === 'OK' ? 1 : 0 };
});

ipcMain.handle('close-task', async (event, { id, note }) => {
  lastOwnWrite = Date.now();
  const r = await callAgent({ action: 'cloturer', id, note: note || '' });
  return { changes: r.statut === 'OK' ? 1 : 0 };
});

ipcMain.handle('delete-task', async (event, id) => {
  lastOwnWrite = Date.now();
  const r = await callAgent({ action: 'annuler', id });
  return { changes: r.statut === 'OK' ? 1 : 0 };
});

ipcMain.handle('claim-task', async (event, { id, agent }) => {
  lastOwnWrite = Date.now();
  const r = await callAgent({ action: 'reclamer', id, agent });
  return { changes: r.statut === 'OK' ? 1 : 0 };
});

ipcMain.handle('release-task', async (event, id) => {
  lastOwnWrite = Date.now();
  const r = await callAgent({ action: 'liberer', id });
  return { changes: r.statut === 'OK' ? 1 : 0 };
});

ipcMain.handle('set-status', async (event, { id, statut }) => {
  lastOwnWrite = Date.now();
  const r = await callAgent({ action: 'changer_statut', id, statut });
  return r.statut === 'OK' ? { changes: 1 } : { error: r.message };
});

ipcMain.handle('get-db-path',    () => DB_PATH);
ipcMain.handle('get-agent-path', () => AGENT_PATH);
ipcMain.handle('get-version',    () => app.getVersion());

// ─── IPC : configuration ──────────────────────────────────────────────────────
ipcMain.handle('get-config',  () => loadConfig());
ipcMain.handle('save-config', (event, partial) => saveConfig(partial));

// ─── IPC : mise a jour in-app ─────────────────────────────────────────────────
ipcMain.handle('install-update', () => {
  if (_autoUpdater) _autoUpdater.quitAndInstall();
});

// ─── IPC : purge / export / dossier / external ────────────────────────────────
ipcMain.handle('purge-now', async () => {
  lastOwnWrite = Date.now();
  const r = await callAgent({ action: 'purger_maintenant' });
  return r;
});

ipcMain.handle('export-json', () => {
  const r = callAgent({ action: 'exporter_json' });
  if (r && r.statut === 'OK' && Array.isArray(r.taches)) {
    const stamp    = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `agentdockyard-export-${stamp}.json`;
    const exportPath = path.join(USER_DATA, filename);
    try {
      fs.writeFileSync(exportPath, JSON.stringify(r.taches, null, 2), 'utf8');
      return { ok: true, path: exportPath, count: r.taches.length };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  return { ok: false, error: (r && r.message) || 'Echec export' };
});

ipcMain.handle('open-db-folder', () => {
  shell.openPath(USER_DATA);
  return { ok: true, path: USER_DATA };
});

ipcMain.handle('open-external', (event, url) => {
  if (typeof url !== 'string') return;
  if (!/^https?:\/\//i.test(url)) return;
  shell.openExternal(url);
});

// ─── IPC : widgets (fetch URL cote main pour contourner CSP renderer) ─────────
// Renvoie { ok, value, error }. Le body est limite a 8 Ko et trim pour eviter
// qu une reponse volumineuse accidentelle ne pollue l UI.
ipcMain.handle('fetch-widget-url', async (event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'URL invalide (http(s) requis)' };
  }
  let parsed;
  try { parsed = new URL(url); } catch (e) { return { ok: false, error: 'URL malformee' }; }
  const lib = parsed.protocol === 'https:' ? https : http;
  const MAX_BYTES    = 256 * 1024;
  const TIMEOUT_MS   = 5000;

  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (done) return; done = true; resolve(r); };

    const req = lib.get(url, { timeout: TIMEOUT_MS, headers: { 'User-Agent': 'AgentDockyard-Widget/1.0' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        finish({ ok: false, error: `Redirection ${res.statusCode} (non suivie)` });
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        finish({ ok: false, error: `HTTP ${res.statusCode}` });
        return;
      }
      let size = 0;
      const chunks = [];
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) {
          chunks.push(c.slice(0, MAX_BYTES - (size - c.length)));
          req.destroy();
        } else {
          chunks.push(c);
        }
      });
      res.on('end', () => {
        const value = Buffer.concat(chunks).toString('utf8').trim();
        finish({ ok: true, value });
      });
      res.on('error', (e) => finish({ ok: false, error: e.message }));
    });
    req.on('timeout', () => { req.destroy(); finish({ ok: false, error: 'Timeout' }); });
    req.on('error', (e) => finish({ ok: false, error: e.message }));
  });
});

ipcMain.handle('check-for-updates', async () => {
  if (!IS_PACKAGED) return { available: false, dev: true };
  try {
    const r = await getAutoUpdater().checkForUpdates();
    if (r && r.updateInfo && r.updateInfo.version && r.updateInfo.version !== app.getVersion()) {
      return { available: true, version: r.updateInfo.version };
    }
    return { available: false };
  } catch (e) {
    return { available: false, error: e.message };
  }
});

// ─── IPC : multi-ecrans & fenetre ─────────────────────────────────────────────
ipcMain.handle('get-displays', () => {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    index: i,
    id: d.id,
    label: `Ecran ${i + 1} (${d.bounds.width}x${d.bounds.height}) @ (${d.bounds.x}, ${d.bounds.y})`,
    bounds: d.bounds,
    workArea: d.workArea,
    isPrimary: d.id === primaryId,
    scaleFactor: d.scaleFactor,
  }));
});

ipcMain.handle('get-window-bounds', () => {
  return mainWindow ? mainWindow.getBounds() : null;
});

ipcMain.handle('apply-window-bounds', (event, bounds) => {
  if (!mainWindow || !bounds) return { ok: false };
  try {
    const { x, y, width, height } = bounds;
    mainWindow.setBounds({ x, y, width, height }, true);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ─── IPC : snapshots horaires ─────────────────────────────────────────────────
ipcMain.handle('snapshot-list', () => {
  return listSnapshotFiles().map(s => ({
    filename:      s.filename,
    timestamp:     s.timestamp,
    size:          s.size,
    beforeRestore: s.beforeRestore,
  }));
});

ipcMain.handle('snapshot-preview', async (event, filename) => {
  return previewSnapshotTasks(filename);
});

ipcMain.handle('snapshot-restore', async (event, filename) => {
  const r = restoreSnapshotFile(filename);
  if (r.ok && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('db-changed');
  }
  return r;
});
