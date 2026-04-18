'use strict';

// ─── Constantes ───────────────────────────────────────────────────────────────
const STATUT_PRIO  = { a_faire_rapidement:0, en_cours:1, bloque:2, en_attente:3, annule:4, fait:5 };
const STATUT_LABEL = { a_faire_rapidement:'Urgent', en_cours:'En cours', bloque:'Bloque', en_attente:'En attente', annule:'Annule', fait:'Fait' };
const STATUT_COLOR = { a_faire_rapidement:'#c0504a', en_cours:'#4a82c0', bloque:'#c07840', en_attente:'#b89030', annule:'#505878', fait:'#3a9e60' };
const STATUTS_LIST = ['a_faire_rapidement','en_cours','en_attente','bloque','annule','fait'];

// ─── Etat ─────────────────────────────────────────────────────────────────────
let currentTasks   = [];
let currentConfig  = null;
let agentsConfig   = [];
let collapsedRepos = new Set(JSON.parse(localStorage.getItem('collapsedRepos') || '[]'));
let visibleFaites  = new Set();
let openNotes      = new Set();
let editingTaskId  = null;
let refreshTimer   = null;
let addBarOpen     = false;

// ─── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  currentConfig = await window.taskAPI.getConfig();
  agentsConfig  = (currentConfig.agents && currentConfig.agents.length) ? currentConfig.agents : [];

  applyTheme(currentConfig.theme || 'dark');
  populateAgentSelects();

  const dbPath = await window.taskAPI.getDbPath();
  document.getElementById('db-path-display').textContent = truncatePath(dbPath, 50);
  document.getElementById('db-path-display').title = dbPath;

  bindHeaderButtons();
  bindModal();
  bindSettingsPanel();
  bindGuidePanel();
  bindAddForm();

  await refreshTasks();
  resetRefreshTimer();

  window.taskAPI.onDbChanged(() => { showDot(true); refreshTasks(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'F5')     { e.preventDefault(); refreshTasks(); }
    if (e.key === 'Escape') { closeModal(); closeAllDropdowns(); closeSidePanel('settings-overlay'); closeSidePanel('guide-overlay'); }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.statut-wrapper')) closeAllDropdowns();
  });
}

function getAgentEmoji(id) {
  const a = agentsConfig.find(x => x.id === id);
  return a ? (a.emoji || '') : '';
}

function populateAgentSelects() {
  const optionsHtml = agentsConfig.map(a =>
    `<option value="${esc(a.id)}">${esc(a.emoji || '')} ${esc(a.label || a.id)}</option>`
  ).join('');
  const fAgent = document.getElementById('f-agent');
  const mAgent = document.getElementById('m-agent');
  if (fAgent) fAgent.innerHTML = optionsHtml;
  if (mAgent) mAgent.innerHTML = optionsHtml;
}

// ─── Theme ────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  const t = (theme === 'light') ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = (t === 'dark') ? '\u{1F319}' : '\u2600\uFE0F';
}

async function toggleTheme() {
  const cur  = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = (cur === 'dark') ? 'light' : 'dark';
  applyTheme(next);
  currentConfig = await window.taskAPI.saveConfig({ theme: next });
}

// ─── Header buttons ───────────────────────────────────────────────────────────
function bindHeaderButtons() {
  document.getElementById('btn-theme').addEventListener('click',    toggleTheme);
  document.getElementById('btn-refresh').addEventListener('click',  refreshTasks);
  document.getElementById('btn-add-toggle').addEventListener('click', toggleAddBar);
  document.getElementById('btn-settings').addEventListener('click', openSettingsPanel);
  document.getElementById('btn-guide').addEventListener('click',    openGuidePanel);
}

// ─── Refresh & rendu ──────────────────────────────────────────────────────────
async function refreshTasks() {
  showDot(true);
  try {
    const r = await window.taskAPI.getTasks();
    if (r && r.error) { showToast('Erreur DB : ' + r.error, 'error'); return; }
    currentTasks = r || [];
    renderTasks(currentTasks);
    const nb = currentTasks.filter(t => t.statut !== 'fait').length;
    document.getElementById('task-count').textContent = nb ? `${nb} tache${nb>1?'s':''} active${nb>1?'s':''}` : '';
  } catch(err) { showToast('Erreur : ' + err.message, 'error'); }
  finally { showDot(false); resetRefreshTimer(); }
}

function resetRefreshTimer() {
  const secs = (currentConfig && currentConfig.interface && currentConfig.interface.refresh_secondes) || 30;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshTasks, Math.max(5, secs) * 1000);
}

function showDot(active) {
  document.getElementById('refresh-dot').classList.toggle('active', active);
}

function toggleAddBar() {
  addBarOpen = !addBarOpen;
  document.getElementById('add-bar').classList.toggle('open', addBarOpen);
  if (addBarOpen) setTimeout(() => document.getElementById('f-sujet').focus(), 320);
}

function renderTasks(tasks) {
  const container = document.getElementById('tasks-container');
  const cfgIf = (currentConfig && currentConfig.interface) || {};
  const showFait   = cfgIf.afficher_fait   !== false;
  const showAnnule = cfgIf.afficher_annule === true;
  const maxPerGrp  = Math.max(0, cfgIf.max_par_groupe || 0);

  const visibleTasks = tasks.filter(t => {
    if (t.statut === 'annule' && !showAnnule) return false;
    return true;
  });

  if (!visibleTasks.length) {
    container.innerHTML = `<div id="empty-state"><div class="icon">\u2705</div><div>Aucune tache en cours</div></div>`;
    return;
  }

  const groupes = {};
  for (const t of visibleTasks) {
    const repo  = t.repo  || '_hors_repo_';
    const agent = t.agent || 'inconnu';
    if (!groupes[repo])        groupes[repo]       = {};
    if (!groupes[repo][agent]) groupes[repo][agent] = [];
    groupes[repo][agent].push(t);
  }

  function repoActif(repo) {
    return Object.values(groupes[repo]).flat().some(t => t.statut !== 'fait' && t.statut !== 'annule');
  }
  const repoKeys = Object.keys(groupes).sort((a, b) => {
    if (a === '_hors_repo_') return 1;
    if (b === '_hors_repo_') return -1;
    const aA = repoActif(a), bA = repoActif(b);
    if (aA !== bA) return aA ? -1 : 1;
    return a.localeCompare(b);
  });

  container.innerHTML = repoKeys.map(r => renderRepoGroup(r, groupes[r], { showFait, maxPerGrp })).join('');

  const closedIds = new Set(visibleTasks.filter(t => t.statut === 'fait' || t.statut === 'annule').map(t => t.id));
  for (const id of [...openNotes]) {
    if (closedIds.has(id)) { openNotes.delete(id); continue; }
    const el  = document.getElementById(`note-${id}`);
    const btn = el && el.previousElementSibling;
    if (el) { el.classList.add('visible'); if (btn) btn.textContent = '\u{1F4C4} Masquer la note'; }
  }
}

function renderRepoGroup(repo, agentsMap, opts) {
  const nom  = (repo === '_hors_repo_') ? 'Hors repo' : repo;
  const b64  = btoa(unescape(encodeURIComponent(repo)));
  const coll = collapsedRepos.has(repo);

  let total = 0, faites = [];
  const agentsActifs = {};
  for (const ag of Object.keys(agentsMap).sort()) {
    for (const t of agentsMap[ag]) {
      total++;
      if (t.statut === 'fait') faites.push(t);
      else { if (!agentsActifs[ag]) agentsActifs[ag] = []; agentsActifs[ag].push(t); }
    }
  }

  let h = `<div class="groupe-repo${coll ? ' collapsed' : ''}" id="repo-${b64}">`;
  h += `<div class="groupe-repo-titre" onclick='toggleRepo(${j(repo)},${j(b64)})'>`;
  h += `<span class="repo-fleche">\u25BE</span>`;
  h += `<span class="repo-icone">${repo === 'Cowork' ? '\u2699\uFE0F' : '\u{1F4C1}'}</span>`;
  h += `<span class="repo-nom">${esc(nom)}</span>`;
  h += `<span class="repo-compteur">${total}</span>`;
  h += `</div>`;
  h += `<div class="groupe-repo-contenu">`;

  for (const ag of Object.keys(agentsActifs).sort()) {
    let taches = agentsActifs[ag].sort((a, b) => {
      const pa = STATUT_PRIO[a.statut] ?? 5, pb = STATUT_PRIO[b.statut] ?? 5;
      return pa !== pb ? pa - pb : (a.date_creation || '').localeCompare(b.date_creation || '');
    });
    if (opts && opts.maxPerGrp > 0) taches = taches.slice(0, opts.maxPerGrp);
    h += `<div class="groupe-agent">`;
    h += `<div class="groupe-agent-titre">${getAgentEmoji(ag) || '\u{1F527}'} ${esc(ag)}</div>`;
    h += taches.map(t => renderCard(t)).join('');
    h += `</div>`;
  }

  if (faites.length && (!opts || opts.showFait !== false)) {
    const fVis = visibleFaites.has(repo);
    h += `<button class="btn-toggle-faites" onclick='toggleFaites(${j(repo)},${j(b64)})'>`;
    h += `${fVis ? '\u25BE' : '\u25B8'} \u2705 ${faites.length} tache${faites.length>1?'s':''} terminee${faites.length>1?'s':''}`;
    h += `</button>`;
    h += `<div class="taches-faites${fVis ? ' visible' : ''}" id="faites-${b64}">`;
    h += `<div class="groupe-agent">`;
    h += faites.map(t => renderCard(t)).join('');
    h += `</div></div>`;
  }

  h += `</div></div>`;
  return h;
}

function renderCard(t) {
  const isFait  = t.statut === 'fait';
  const isClaim = !!(t.reclame_par && t.reclame_par.trim());
  const hasNote = !!(t.note && t.note.trim());
  const hasCtx  = !!(t.contexte && t.contexte.trim());
  const dateCr  = formatDate(t.date_creation);
  const dateCl  = t.date_cloture ? ' \u00B7 Clos ' + formatDate(t.date_cloture) : '';

  let h = `<div class="task-card" data-statut="${t.statut}" id="task-${t.id}">`;
  h += `<div class="task-id-col"><div class="task-id-bubble s-${t.statut}">${t.id}</div></div>`;
  h += `<div class="task-body">`;
  h += `<div class="task-top">`;
  h += `<span class="task-sujet" onclick="openEditModal(${t.id})">${esc(t.sujet)}</span>`;

  h += `<div class="statut-wrapper">`;
  h += `<button class="task-statut-badge badge-${t.statut}" onclick="toggleDropdown(event,${t.id})">${STATUT_LABEL[t.statut] || t.statut}</button>`;
  h += `<div class="statut-dropdown" id="dd-${t.id}">`;
  for (const s of STATUTS_LIST) {
    if (s === t.statut) continue;
    h += `<div class="statut-opt" onclick='changeStatut(${t.id},${j(s)})'>`;
    h += `<span class="statut-opt-dot" style="background:${STATUT_COLOR[s]}"></span>`;
    h += `${STATUT_LABEL[s]}</div>`;
  }
  h += `</div></div>`;

  h += `<div class="task-actions">`;
  if (!isFait) h += `<button class="btn-act btn-fait" onclick="doCloseTask(${t.id})">\u2713 Fait</button>`;
  h += `<button class="btn-act btn-edit"   onclick="openEditModal(${t.id})">\u270E</button>`;
  h += `<button class="btn-act btn-delete" onclick="doDeleteTask(${t.id})">\u2715</button>`;
  h += `</div>`;
  h += `</div>`;

  if (hasCtx) h += `<div class="task-contexte">${esc(t.contexte)}</div>`;

  if (hasNote) {
    h += `<span class="task-note-toggle" onclick="toggleNote(${t.id})">\u{1F4C4} Voir la note</span>`;
    h += `<div class="task-note" id="note-${t.id}">${esc(t.note)}</div>`;
  }

  h += `<div class="task-footer">`;
  h += `<span class="task-date">${dateCr}${dateCl}</span>`;
  if (isClaim) {
    h += `<span class="task-claimed">\u{1F512} ${esc(t.reclame_par)} `;
    h += `<button class="btn-liberer" onclick="doReleaseTask(${t.id})">\u2715 Liberer</button></span>`;
  }
  h += `</div>`;

  h += `</div></div>`;
  return h;
}

// ─── Dropdown statut ───────────────────────────────────────────────────────────
function toggleDropdown(e, id) {
  e.stopPropagation();
  const dd = document.getElementById(`dd-${id}`);
  const wasOpen = dd.classList.contains('open');
  closeAllDropdowns();
  if (!wasOpen) dd.classList.add('open');
}

function closeAllDropdowns() {
  document.querySelectorAll('.statut-dropdown.open').forEach(d => d.classList.remove('open'));
}

async function changeStatut(id, statut) {
  closeAllDropdowns();
  await window.taskAPI.setStatus(id, statut);
  showToast(`Statut mis a jour -> ${STATUT_LABEL[statut]}`, 'success');
  await refreshTasks();
}

// ─── Toggle ────────────────────────────────────────────────────────────────────
function toggleRepo(repo, b64) {
  const el = document.getElementById(`repo-${b64}`);
  if (!el) return;
  el.classList.toggle('collapsed');
  if (collapsedRepos.has(repo)) collapsedRepos.delete(repo); else collapsedRepos.add(repo);
  localStorage.setItem('collapsedRepos', JSON.stringify([...collapsedRepos]));
}

function toggleFaites(repo, b64) {
  const el = document.getElementById(`faites-${b64}`);
  if (!el) return;
  el.classList.toggle('visible');
  if (visibleFaites.has(repo)) visibleFaites.delete(repo); else visibleFaites.add(repo);
  const btn = el.previousElementSibling;
  const nb = el.querySelectorAll('.task-card').length;
  const vis = el.classList.contains('visible');
  btn.innerHTML = `${vis ? '\u25BE' : '\u25B8'} \u2705 ${nb} tache${nb>1?'s':''} terminee${nb>1?'s':''}`;
}

function toggleNote(id) {
  const el = document.getElementById(`note-${id}`);
  const btn = el && el.previousElementSibling;
  if (!el || !btn) return;
  el.classList.toggle('visible');
  const isOpen = el.classList.contains('visible');
  if (isOpen) openNotes.add(id); else openNotes.delete(id);
  btn.textContent = isOpen ? '\u{1F4C4} Masquer la note' : '\u{1F4C4} Voir la note';
}

// ─── Formulaire ajout ──────────────────────────────────────────────────────────
function bindAddForm() {
  document.getElementById('add-form').addEventListener('submit', submitAddForm);
}

async function submitAddForm(e) {
  e.preventDefault();
  const form = e.target;
  const data = {
    agent: form.agent.value, repo: form.repo.value.trim(),
    sujet: form.sujet.value.trim(), statut: form.statut.value,
    contexte: form.contexte.value.trim(), note: form.note.value.trim(),
  };
  if (!data.sujet) { showToast('Le sujet est obligatoire', 'error'); return; }
  const r = await window.taskAPI.addTask(data);
  if (r.error) { showToast('Erreur : ' + r.error, 'error'); return; }
  showToast(`Tache #${r.id} creee \u2705`, 'success');
  form.sujet.value = ''; form.contexte.value = ''; form.note.value = '';
  if (addBarOpen) toggleAddBar();
  await refreshTasks();
}

// ─── Actions ───────────────────────────────────────────────────────────────────
async function doCloseTask(id) {
  await window.taskAPI.closeTask(id, '');
  showToast(`Tache #${id} cloturee \u2705`, 'success');
  await refreshTasks();
}

async function doDeleteTask(id) {
  if (!confirm(`Supprimer la tache #${id} definitivement ?`)) return;
  await window.taskAPI.deleteTask(id);
  showToast(`Tache #${id} supprimee`, 'success');
  await refreshTasks();
}

async function doReleaseTask(id) {
  await window.taskAPI.releaseTask(id);
  showToast('Reclamation liberee', 'success');
  await refreshTasks();
}

// ─── Modal edition ─────────────────────────────────────────────────────────────
function bindModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  document.getElementById('modal-close').addEventListener('click',  closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click',   saveModal);
}

function openEditModal(id) {
  const t = currentTasks.find(x => x.id === id);
  if (!t) return;
  editingTaskId = id;
  document.getElementById('modal-title').textContent = `Modifier tache #${id}`;
  document.getElementById('m-agent').value    = t.agent    || '';
  document.getElementById('m-repo').value     = t.repo     || '';
  document.getElementById('m-statut').value   = t.statut   || 'en_cours';
  document.getElementById('m-sujet').value    = t.sujet    || '';
  document.getElementById('m-contexte').value = t.contexte || '';
  document.getElementById('m-note').value     = t.note     || '';
  document.getElementById('modal-overlay').classList.add('visible');
  document.getElementById('m-sujet').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('visible');
  editingTaskId = null;
}

async function saveModal() {
  if (!editingTaskId) return;
  const data = {
    id: editingTaskId,
    agent:    document.getElementById('m-agent').value,
    repo:     document.getElementById('m-repo').value.trim(),
    sujet:    document.getElementById('m-sujet').value.trim(),
    statut:   document.getElementById('m-statut').value,
    contexte: document.getElementById('m-contexte').value.trim(),
    note:     document.getElementById('m-note').value.trim(),
  };
  if (!data.sujet) { showToast('Le sujet est obligatoire', 'error'); return; }
  const orig = currentTasks.find(x => x.id === editingTaskId);
  if (data.statut === 'fait' && orig && orig.statut !== 'fait') {
    await window.taskAPI.closeTask(editingTaskId, data.note);
    await window.taskAPI.updateTask({ id: editingTaskId, agent: data.agent, repo: data.repo, sujet: data.sujet, contexte: data.contexte });
  } else {
    await window.taskAPI.updateTask(data);
  }
  showToast(`Tache #${editingTaskId} mise a jour \u2705`, 'success');
  closeModal();
  await refreshTasks();
}

// ─── Panneau lateral generique ────────────────────────────────────────────────
function openSidePanel(overlayId) {
  document.getElementById(overlayId).classList.add('visible');
}

function closeSidePanel(overlayId) {
  const el = document.getElementById(overlayId);
  if (el) el.classList.remove('visible');
}

// ─── Panneau Parametres ───────────────────────────────────────────────────────
function bindSettingsPanel() {
  const overlay = document.getElementById('settings-overlay');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSidePanel('settings-overlay'); });
  document.getElementById('settings-close').addEventListener('click',  () => closeSidePanel('settings-overlay'));
  document.getElementById('settings-cancel').addEventListener('click', () => closeSidePanel('settings-overlay'));
  document.getElementById('settings-save').addEventListener('click',   saveSettings);

  // Theme radios - changement immediat (sans sauvegarder l'ensemble)
  document.querySelectorAll('input[name="theme"]').forEach(r => {
    r.addEventListener('change', async () => {
      applyTheme(r.value);
      currentConfig = await window.taskAPI.saveConfig({ theme: r.value });
    });
  });

  document.getElementById('btn-purge-now').addEventListener('click',     doPurgeNow);
  document.getElementById('btn-open-folder').addEventListener('click',   doOpenDbFolder);
  document.getElementById('btn-export-json').addEventListener('click',   doExportJson);
  document.getElementById('btn-check-updates').addEventListener('click', doCheckUpdates);
  document.getElementById('link-sitecrea').addEventListener('click',     (e) => { e.preventDefault(); window.taskAPI.openExternal('https://sitecrea.fr/'); });
  document.getElementById('link-github').addEventListener('click',       (e) => { e.preventDefault(); window.taskAPI.openExternal('https://github.com/steevec/agentdockyard'); });

  document.getElementById('btn-win-detect').addEventListener('click',       loadDisplays);
  document.getElementById('btn-win-save-current').addEventListener('click', saveCurrentBounds);
  document.getElementById('btn-win-apply-now').addEventListener('click',    applyBoundsFromForm);

  document.getElementById('btn-add-agent').addEventListener('click', () => {
    addAgentRow({ id: '', label: '', emoji: '' });
  });
}

async function openSettingsPanel() {
  currentConfig = await window.taskAPI.getConfig();
  agentsConfig  = (currentConfig.agents && currentConfig.agents.length) ? currentConfig.agents : [];

  // Apparence
  document.querySelectorAll('input[name="theme"]').forEach(r => { r.checked = (r.value === (currentConfig.theme || 'dark')); });

  // Purge
  document.getElementById('cfg-purge-enabled').checked   = !!(currentConfig.purge && currentConfig.purge.enabled);
  document.getElementById('cfg-purge-fait').value        = (currentConfig.purge && currentConfig.purge.delai_fait_jours)   || 90;
  document.getElementById('cfg-purge-annule').value      = (currentConfig.purge && currentConfig.purge.delai_annule_jours) || 90;
  document.getElementById('cfg-purge-demarrage').checked = !!(currentConfig.purge && currentConfig.purge.au_demarrage);

  // Reclamations
  document.getElementById('cfg-reclam-heures').value = (currentConfig.reclamation && currentConfig.reclamation.expiration_heures) || 24;

  // Interface
  const cfgIf = currentConfig.interface || {};
  document.getElementById('cfg-refresh').value       = cfgIf.refresh_secondes || 30;
  document.getElementById('cfg-show-fait').checked   = cfgIf.afficher_fait   !== false;
  document.getElementById('cfg-show-annule').checked = cfgIf.afficher_annule === true;
  document.getElementById('cfg-max-groupe').value    = cfgIf.max_par_groupe  || 0;

  // Fenetre
  const win = currentConfig.window || {};
  document.getElementById('cfg-win-auto-remember').checked = !!win.autoRemember;
  document.getElementById('cfg-win-enabled').checked       = !!win.enabled;
  document.getElementById('cfg-win-x').value       = (typeof win.x === 'number') ? win.x : '';
  document.getElementById('cfg-win-y').value       = (typeof win.y === 'number') ? win.y : '';
  document.getElementById('cfg-win-w').value       = win.width  || 1200;
  document.getElementById('cfg-win-h').value       = win.height || 900;
  document.getElementById('cfg-win-fullwidth').checked  = !!win.fullWidth;
  document.getElementById('cfg-win-fullheight').checked = !!win.fullHeight;
  await loadDisplays(win.displayIndex || 0);

  // Agents
  renderAgentsList(agentsConfig);

  // DB path + version
  const dbPath = await window.taskAPI.getDbPath();
  document.getElementById('cfg-db-path').textContent = dbPath;
  const version = await window.taskAPI.getVersion();
  document.getElementById('cfg-version').textContent = version;

  openSidePanel('settings-overlay');
}

function renderAgentsList(agents) {
  const container = document.getElementById('cfg-agents-list');
  container.innerHTML = '';
  for (const a of agents) addAgentRow(a);
}

function addAgentRow(agent) {
  const container = document.getElementById('cfg-agents-list');
  const row = document.createElement('div');
  row.className = 'agent-row';
  row.innerHTML = `
    <input type="text" placeholder="emoji" value="${esc(agent.emoji || '')}" style="width:52px;flex:0 0 52px">
    <input type="text" placeholder="id (ex: claude-code)" value="${esc(agent.id || '')}">
    <input type="text" placeholder="label" value="${esc(agent.label || '')}">
    <button class="btn-remove" title="Supprimer">&times;</button>
  `;
  row.querySelector('.btn-remove').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function collectAgentsFromUI() {
  const rows = document.querySelectorAll('#cfg-agents-list .agent-row');
  const out = [];
  rows.forEach(r => {
    const inputs = r.querySelectorAll('input');
    const emoji = inputs[0].value.trim();
    const id    = inputs[1].value.trim();
    const label = inputs[2].value.trim() || id;
    if (id) out.push({ id, label, emoji });
  });
  return out;
}

async function saveSettings() {
  const win = readWindowFromUI();
  const patch = {
    theme: (document.querySelector('input[name="theme"]:checked') || {}).value || 'dark',
    purge: {
      enabled:            document.getElementById('cfg-purge-enabled').checked,
      delai_fait_jours:   parseInt(document.getElementById('cfg-purge-fait').value,   10) || 90,
      delai_annule_jours: parseInt(document.getElementById('cfg-purge-annule').value, 10) || 90,
      au_demarrage:       document.getElementById('cfg-purge-demarrage').checked,
    },
    reclamation: {
      expiration_heures: parseInt(document.getElementById('cfg-reclam-heures').value, 10) || 24,
    },
    interface: {
      refresh_secondes: parseInt(document.getElementById('cfg-refresh').value, 10) || 30,
      afficher_fait:    document.getElementById('cfg-show-fait').checked,
      afficher_annule:  document.getElementById('cfg-show-annule').checked,
      max_par_groupe:   parseInt(document.getElementById('cfg-max-groupe').value, 10) || 0,
    },
    window: win,
    agents: collectAgentsFromUI(),
  };
  currentConfig = await window.taskAPI.saveConfig(patch);
  agentsConfig  = currentConfig.agents || [];
  applyTheme(currentConfig.theme || 'dark');
  populateAgentSelects();
  showToast('\u2705 Parametres sauvegardes', 'success');
  closeSidePanel('settings-overlay');
  resetRefreshTimer();
  await refreshTasks();
}

function readWindowFromUI() {
  const xVal = document.getElementById('cfg-win-x').value;
  const yVal = document.getElementById('cfg-win-y').value;
  return {
    enabled:      document.getElementById('cfg-win-enabled').checked,
    autoRemember: document.getElementById('cfg-win-auto-remember').checked,
    displayIndex: parseInt(document.getElementById('cfg-win-display').value, 10) || 0,
    x: xVal === '' ? null : parseInt(xVal, 10),
    y: yVal === '' ? null : parseInt(yVal, 10),
    xRelative: false,
    yRelative: false,
    width:  parseInt(document.getElementById('cfg-win-w').value, 10) || 1200,
    height: parseInt(document.getElementById('cfg-win-h').value, 10) || 900,
    fullWidth:  document.getElementById('cfg-win-fullwidth').checked,
    fullHeight: document.getElementById('cfg-win-fullheight').checked,
  };
}

async function loadDisplays(selectedIndex) {
  const displays = await window.taskAPI.getDisplays();
  const sel = document.getElementById('cfg-win-display');
  sel.innerHTML = displays.map((d) =>
    `<option value="${d.index}">${esc(d.label)}${d.isPrimary ? ' [principal]' : ''}</option>`
  ).join('');
  if (typeof selectedIndex === 'number') sel.value = selectedIndex;
  document.getElementById('cfg-win-screens-info').innerHTML = displays.map(d =>
    `<div class="screen-badge">Ecran ${d.index + 1} : ${d.bounds.width}x${d.bounds.height} @ (${d.bounds.x}, ${d.bounds.y}) \u00D7${d.scaleFactor}${d.isPrimary ? ' [principal]' : ''}</div>`
  ).join('');
}

async function saveCurrentBounds() {
  const b = await window.taskAPI.getWindowBounds();
  if (!b) { showToast('Fenetre introuvable', 'error'); return; }
  document.getElementById('cfg-win-x').value = b.x;
  document.getElementById('cfg-win-y').value = b.y;
  document.getElementById('cfg-win-w').value = b.width;
  document.getElementById('cfg-win-h').value = b.height;
  document.getElementById('cfg-win-enabled').checked = true;
  showToast('\u2705 Position actuelle copiee dans les champs', 'success');
}

async function applyBoundsFromForm() {
  const win = readWindowFromUI();
  const xVal = win.x === null ? 0 : win.x;
  const yVal = win.y === null ? 0 : win.y;
  const r = await window.taskAPI.applyWindowBounds({ x: xVal, y: yVal, width: win.width, height: win.height });
  if (r && r.ok) showToast('\u2705 Fenetre repositionnee', 'success');
  else showToast('Echec du positionnement', 'error');
}

async function doPurgeNow() {
  if (!confirm('Vider toutes les taches fait/annule cloturees ? Cette action est irreversible.')) return;
  const r = await window.taskAPI.purgeNow();
  if (r && r.statut === 'OK') {
    showToast(`\u2705 ${r.deleted || 0} tache(s) supprimee(s)`, 'success');
    await refreshTasks();
  } else {
    showToast('Echec purge : ' + ((r && r.message) || 'erreur'), 'error');
  }
}

async function doOpenDbFolder() {
  await window.taskAPI.openDbFolder();
}

async function doExportJson() {
  const r = await window.taskAPI.exportJson();
  if (r && r.ok) showToast(`\u2705 Export : ${r.count} tache(s) \u2192 ${r.path}`, 'success');
  else showToast('Echec export : ' + ((r && r.error) || 'erreur'), 'error');
}

async function doCheckUpdates() {
  showToast('Recherche de mises a jour...', 'success');
  const r = await window.taskAPI.checkUpdates();
  if (r && r.dev) { showToast('Mode dev : verification ignoree', 'success'); return; }
  if (r && r.available) showToast(`\u2705 Mise a jour disponible : v${r.version}`, 'success');
  else if (r && r.error) showToast('Erreur MAJ : ' + r.error, 'error');
  else showToast('Vous etes deja sur la derniere version', 'success');
}

// ─── Panneau Guide ────────────────────────────────────────────────────────────
function bindGuidePanel() {
  const overlay = document.getElementById('guide-overlay');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSidePanel('guide-overlay'); });
  document.getElementById('guide-close').addEventListener('click', () => closeSidePanel('guide-overlay'));

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
    });
  });

  document.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', async () => {
      const src = document.getElementById(btn.dataset.copyFrom);
      if (!src) return;
      const text = src.textContent;
      try {
        await navigator.clipboard.writeText(text);
        btn.classList.add('copied');
        const orig = btn.textContent;
        btn.textContent = '\u2705 Copie !';
        setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1800);
      } catch (e) {
        showToast('Echec copie : ' + e.message, 'error');
      }
    });
  });
}

async function openGuidePanel() {
  const agentPath = await window.taskAPI.getAgentPath();
  const escPath   = agentPath.replace(/\\/g, '\\\\');
  const quote     = `"${agentPath}"`;

  document.getElementById('guide-agent-path').textContent = agentPath;
  document.getElementById('guide-claude-code').textContent   = buildPromptBlock('claude-code',   quote, 'windows');
  document.getElementById('guide-claude-cowork').textContent = buildPromptBlock('claude-cowork', quote, 'linux');
  document.getElementById('guide-generic').textContent       = buildPromptBlock('NOM-DE-TON-AGENT', quote, 'generic');

  openSidePanel('guide-overlay');
}

function buildPromptBlock(agentId, quotedPath, variant) {
  const isExe = /\.exe"?$/i.test(quotedPath.replace(/\\\\/g, '\\'));
  const invoke = isExe ? quotedPath : `python ${quotedPath}`;

  let note = '';
  if (variant === 'linux') {
    note = '\n# Note : AgentDockyard gere automatiquement l\'acces VirtioFS (Linux / Cowork).\n# Si agent.exe Windows n\'est pas accessible, utiliser la version Python equivalente :\n#   python /chemin/vers/agent.py \'{"action":"..."}\'';
  }

  return (
`## AgentDockyard - Gestion des taches

Tu as acces a AgentDockyard pour declarer et suivre tes taches en temps reel.
Script : ${invoke}

=== REGLES OBLIGATOIRES ===
1. Declare TOUJOURS tes taches des que tu commences.
2. Cloture TOUJOURS avec une note de resume.
3. Ne laisse JAMAIS une tache en_cours si tu t'arretes.

=== COMMANDES ===

Demarrer une tache :
${invoke} '{"action":"ajouter","agent":"${agentId}","repo":"NOM_REPO","sujet":"Description courte","statut":"en_cours"}'

Mettre a jour (avancement) :
${invoke} '{"action":"modifier","id":ID,"note":"Avancement : etape X faite, reste Y"}'

Cloturer (fin de tache) :
${invoke} '{"action":"cloturer","id":ID,"note":"Resume complet de ce qui a ete fait"}'

Signaler un blocage :
${invoke} '{"action":"changer_statut","id":ID,"statut":"bloque","note":"Raison precise du blocage"}'

Mettre en attente :
${invoke} '{"action":"changer_statut","id":ID,"statut":"en_attente","note":"En attente de quoi"}'

Reclamer une tache (indiquer que tu la traites) :
${invoke} '{"action":"reclamer","id":ID,"agent":"${agentId}"}'

Liberer une reclamation :
${invoke} '{"action":"liberer","id":ID}'

Lister toutes les taches :
${invoke} '{"action":"lister"}'

Lister par repo :
${invoke} '{"action":"lister_par_repo","repo":"NOM_REPO"}'

=== STATUTS DISPONIBLES ===
en_cours | a_faire_rapidement | en_attente | bloque | fait | annule${note}`
  );
}

// ─── Utilitaires ───────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type='success') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = '', 3000);
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function j(s) { return JSON.stringify(s); }

function formatDate(d) {
  if (!d || d.length < 12) return d || '';
  return `${d.slice(6,8)}/${d.slice(4,6)}/${d.slice(0,4)} ${d.slice(8,10)}:${d.slice(10,12)}`;
}

function truncatePath(p, max) {
  if (!p || p.length <= max) return p;
  const head = p.slice(0, Math.floor(max / 2) - 2);
  const tail = p.slice(-Math.ceil(max / 2) + 2);
  return head + '\u2026' + tail;
}

// ─── Expose pour les onclick inline generes dynamiquement ─────────────────────
window.toggleDropdown  = toggleDropdown;
window.changeStatut    = changeStatut;
window.toggleRepo      = toggleRepo;
window.toggleFaites    = toggleFaites;
window.toggleNote      = toggleNote;
window.openEditModal   = openEditModal;
window.doCloseTask     = doCloseTask;
window.doDeleteTask    = doDeleteTask;
window.doReleaseTask   = doReleaseTask;

document.addEventListener('DOMContentLoaded', init);
