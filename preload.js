/**
 * preload.js - Pont IPC entre main process et renderer
 *
 * Expose window.taskAPI au renderer via contextBridge.
 * Chaque methode correspond a un handler ipcMain.handle() dans main.js.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taskAPI', {

  // ─── Taches ─────────────────────────────────────────────────────────────────
  getTasks:    ()            => ipcRenderer.invoke('get-tasks'),
  addTask:     (data)        => ipcRenderer.invoke('add-task', data),
  updateTask:  (data)        => ipcRenderer.invoke('update-task', data),
  closeTask:   (id, note)    => ipcRenderer.invoke('close-task', { id, note }),
  deleteTask:  (id)          => ipcRenderer.invoke('delete-task', id),
  claimTask:   (id, agent)   => ipcRenderer.invoke('claim-task', { id, agent }),
  releaseTask: (id)          => ipcRenderer.invoke('release-task', id),
  setStatus:   (id, statut)  => ipcRenderer.invoke('set-status', { id, statut }),

  // ─── Chemins & version ──────────────────────────────────────────────────────
  getDbPath:    ()           => ipcRenderer.invoke('get-db-path'),
  getAgentPath: ()           => ipcRenderer.invoke('get-agent-path'),
  getVersion:   ()           => ipcRenderer.invoke('get-version'),

  // ─── Configuration ──────────────────────────────────────────────────────────
  getConfig:    ()           => ipcRenderer.invoke('get-config'),
  saveConfig:   (partial)    => ipcRenderer.invoke('save-config', partial),

  // ─── Actions parametres ─────────────────────────────────────────────────────
  purgeNow:     ()           => ipcRenderer.invoke('purge-now'),
  exportJson:   ()           => ipcRenderer.invoke('export-json'),
  openDbFolder: ()           => ipcRenderer.invoke('open-db-folder'),
  openExternal: (url)        => ipcRenderer.invoke('open-external', url),
  checkUpdates: ()           => ipcRenderer.invoke('check-for-updates'),

  // ─── Multi-ecrans & fenetre ─────────────────────────────────────────────────
  getDisplays:       ()       => ipcRenderer.invoke('get-displays'),
  getWindowBounds:   ()       => ipcRenderer.invoke('get-window-bounds'),
  applyWindowBounds: (bounds) => ipcRenderer.invoke('apply-window-bounds', bounds),

  // ─── Snapshots horaires ─────────────────────────────────────────────────────
  listSnapshots:    ()         => ipcRenderer.invoke('snapshot-list'),
  previewSnapshot:  (filename) => ipcRenderer.invoke('snapshot-preview', filename),
  restoreSnapshot:  (filename) => ipcRenderer.invoke('snapshot-restore', filename),

  // ─── Watcher externe ────────────────────────────────────────────────────────
  onDbChanged:  (cb) => ipcRenderer.on('db-changed', cb),
  offDbChanged: (cb) => ipcRenderer.removeListener('db-changed', cb),

  // ─── Mises a jour in-app ────────────────────────────────────────────────────
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available',  (e, v) => cb(v)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', () => cb()),
  installUpdate: () => ipcRenderer.invoke('install-update'),
});
