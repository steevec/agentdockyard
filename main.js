/**
 * main.js - Electron main process
 * AgentDockyard - stockage SQLite via agent (Python en dev, .exe autonome en prod).
 *
 * En dev  : spawnSync('python', ['agent.py', payload, dbPath])
 * En prod : spawnSync(process.resourcesPath + '/agent.exe', [payload, dbPath])
 *           -> l'utilisateur n'a besoin de rien installer.
 *
 * Watcher sur tasks.db pour notifier le renderer quand un agent externe ecrit.
 */

const { app, BrowserWindow, ipcMain, screen, dialog, shell } = require('electron');
const path            = require('path');
const fs              = require('fs');
const { spawnSync }   = require('child_process');
const { autoUpdater } = require('electron-updater');

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

const USER_DATA   = IS_PACKAGED ? app.getPath('userData') : __dirname;
const DB_PATH     = path.join(USER_DATA, 'tasks.db');
const CONFIG_PATH = path.join(USER_DATA, 'config.json');

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG_DEFAULT = {
  theme: 'dark',
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

// ─── Appel agent ──────────────────────────────────────────────────────────────
function callAgent(payload) {
  let bin, args;
  if (IS_PACKAGED) {
    bin  = AGENT_EXE_PATH;
    args = [JSON.stringify(payload), DB_PATH];
  } else {
    if (!PYTHON_CMD) return { statut: 'NOK', message: 'Python introuvable (mode dev)' };
    bin  = PYTHON_CMD;
    args = [AGENT_SCRIPT_DEV, JSON.stringify(payload), DB_PATH];
  }
  const result = spawnSync(bin, args, { encoding: 'utf8', timeout: 10000 });
  if (result.error) {
    console.error('callAgent spawn error:', result.error.message);
    return { statut: 'NOK', message: result.error.message };
  }
  if (result.status !== 0) {
    console.error('callAgent stderr:', result.stderr);
  }
  try {
    return JSON.parse(result.stdout || '{}');
  } catch (e) {
    console.error('callAgent JSON parse error:', result.stdout, e.message);
    return { statut: 'NOK', message: 'JSON invalide: ' + (result.stdout || '').slice(0, 120) };
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

  if (IS_PACKAGED) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => { /* silencieux */ });
    }, 15000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── electron-updater ─────────────────────────────────────────────────────────
autoUpdater.autoDownload         = false;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-available', (info) => {
  if (!mainWindow) return;
  const r = dialog.showMessageBoxSync(mainWindow, {
    type: 'info',
    title: 'Mise a jour disponible',
    message: `AgentDockyard v${info.version} est disponible.\nVoulez-vous la telecharger ?`,
    buttons: ['Telecharger', 'Plus tard'],
    defaultId: 0,
  });
  if (r === 0) autoUpdater.downloadUpdate();
});

autoUpdater.on('update-downloaded', () => {
  if (!mainWindow) return;
  const r = dialog.showMessageBoxSync(mainWindow, {
    type: 'info',
    title: 'Pret a installer',
    message: 'La mise a jour a ete telechargee.\nAgentDockyard va redemarrer pour l\'appliquer.',
    buttons: ['Redemarrer', 'Plus tard'],
    defaultId: 0,
  });
  if (r === 0) autoUpdater.quitAndInstall();
});

autoUpdater.on('error', (err) => {
  console.error('[updater] error:', err && err.message);
});

// ─── IPC : gestion des taches ─────────────────────────────────────────────────
ipcMain.handle('get-tasks', () => {
  const r = callAgent({ action: 'lister' });
  return r.taches || [];
});

ipcMain.handle('add-task', (event, d) => {
  lastOwnWrite = Date.now();
  const r = callAgent({
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

ipcMain.handle('update-task', (event, d) => {
  lastOwnWrite = Date.now();
  const payload = { action: 'modifier', id: d.id };
  const allowed = ['agent','repo','sujet','contexte','note','statut'];
  for (const k of allowed) {
    if (d[k] !== undefined) payload[k] = d[k];
  }
  const r = callAgent(payload);
  return { changes: r.statut === 'OK' ? 1 : 0 };
});

ipcMain.handle('close-task', (event, { id, note }) => {
  lastOwnWrite = Date.now();
  const r = callAgent({ action: 'cloturer', id, note: note || '' });
  return { changes: r.statut === 'OK' ? 1 : 0 };
});

ipcMain.handle('delete-task', (event, id) => {
  lastOwnWrite = Date.now();
  const r = callAgent({ action: 'annuler', id });
  return { changes: r.statut === 'OK' ? 1 : 0 };
});

ipcMain.handle('claim-task', (event, { id, agent }) => {
  lastOwnWrite = Date.now();
  const r = callAgent({ action: 'reclamer', id, agent });
  return { changes: r.statut === 'OK' ? 1 : 0 };
});

ipcMain.handle('release-task', (event, id) => {
  lastOwnWrite = Date.now();
  const r = callAgent({ action: 'liberer', id });
  return { changes: r.statut === 'OK' ? 1 : 0 };
});

ipcMain.handle('set-status', (event, { id, statut }) => {
  lastOwnWrite = Date.now();
  const r = callAgent({ action: 'changer_statut', id, statut });
  return r.statut === 'OK' ? { changes: 1 } : { error: r.message };
});

ipcMain.handle('get-db-path',    () => DB_PATH);
ipcMain.handle('get-agent-path', () => AGENT_PATH);
ipcMain.handle('get-version',    () => app.getVersion());

// ─── IPC : configuration ──────────────────────────────────────────────────────
ipcMain.handle('get-config',  () => loadConfig());
ipcMain.handle('save-config', (event, partial) => saveConfig(partial));

// ─── IPC : purge / export / dossier / external ────────────────────────────────
ipcMain.handle('purge-now', () => {
  lastOwnWrite = Date.now();
  const r = callAgent({ action: 'purger_maintenant' });
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

ipcMain.handle('check-for-updates', async () => {
  if (!IS_PACKAGED) return { available: false, dev: true };
  try {
    const r = await autoUpdater.checkForUpdates();
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
