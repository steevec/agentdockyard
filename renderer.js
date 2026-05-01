'use strict';

// ─── Constantes ───────────────────────────────────────────────────────────────
const STATUT_PRIO  = { a_faire_rapidement:0, en_cours:1, bloque:2, en_attente:3, annule:4, fait:5 };
const STATUT_COLOR = { a_faire_rapidement:'#c0504a', en_cours:'#4a82c0', bloque:'#c07840', en_attente:'#b89030', annule:'#505878', fait:'#3a9e60' };
const STATUTS_LIST = ['a_faire_rapidement','en_cours','en_attente','bloque','annule','fait'];

// ─── i18n ─────────────────────────────────────────────────────────────────────
let currentLang = 'en';

function t(key) {
  const dict = (window.I18N && window.I18N[currentLang]) || {};
  const fallback = (window.I18N && window.I18N['en']) || {};
  return dict[key] !== undefined ? dict[key] : (fallback[key] !== undefined ? fallback[key] : key);
}

function statusLabel(s) { return t('statut_' + s) || s; }

function applyI18n() {
  // Scan générique : tous les éléments [data-i18n] → textContent
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const val = t(key);
    if (val && val !== key) el.textContent = val;
  });

  // Placeholders
  const fRepo = document.getElementById('f-repo');
  if (fRepo) fRepo.placeholder = t('form_repo_ph');
  const fSujet = document.getElementById('f-sujet');
  if (fSujet) fSujet.placeholder = t('form_sujet_ph');
  const fContexte = document.getElementById('f-contexte');
  if (fContexte) fContexte.placeholder = t('form_contexte_ph');
  const fNote = document.getElementById('f-note');
  if (fNote) fNote.placeholder = t('form_note_ph');

  // Titles (tooltip)
  const btnTheme = document.getElementById('btn-theme');
  if (btnTheme) btnTheme.title = t('btn_theme_title');
  const btnSettings = document.getElementById('btn-settings');
  if (btnSettings) btnSettings.title = t('btn_settings_title');
  const btnGuide = document.getElementById('btn-guide');
  if (btnGuide) btnGuide.title = t('btn_guide_title');
  const btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) btnRefresh.title = t('btn_refresh_title');

  // Status select options
  updateStatusSelectOptions('f-statut', false);
  updateStatusSelectOptions('m-statut', true);

  // Bannière mise à jour
  const installBtn = document.getElementById('update-install-btn');
  if (installBtn) installBtn.textContent = t('update_install_btn') || 'Restart & Install';
}

function updateStatusSelectOptions(selectId, includeFait) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const cur = sel.value;
  const options = [
    { v: 'en_cours',             label: statusLabel('en_cours') },
    { v: 'a_faire_rapidement',   label: '\uD83D\uDD34 ' + statusLabel('a_faire_rapidement') },
    { v: 'en_attente',           label: statusLabel('en_attente') },
    { v: 'bloque',               label: statusLabel('bloque') },
    { v: 'annule',               label: statusLabel('annule') },
  ];
  if (includeFait) options.push({ v: 'fait', label: '\u2705 ' + statusLabel('fait') });
  sel.innerHTML = options.map(o => `<option value="${o.v}"${o.v === cur ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
}

// ─── Etat ─────────────────────────────────────────────────────────────────────
let currentTasks     = [];
let currentConfig    = null;
let agentsConfig     = [];
let collapsedRepos   = new Set(JSON.parse(localStorage.getItem('collapsedRepos') || '[]'));
let visibleFaites    = new Set();
let openNotes        = new Set();
let openDropdowns    = new Set();
let editingTaskId    = null;
let refreshTimer     = null;
let refreshInFlight  = false;
let dbRefreshTimer   = null;
let lastRenderKey    = '';
let pendingAutoRefresh = false;
let addBarOpen       = false;
let previewFilename  = null;  // snapshot en cours d'apercu (null = pas en mode preview)

let widgetsConfig    = [];
let widgetValues     = new Map();  // idx -> derniere valeur recuperee (string)
let widgetTimers     = new Map();  // idx -> setInterval id

// ─── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  currentConfig = await window.taskAPI.getConfig();
  agentsConfig  = (currentConfig.agents && currentConfig.agents.length) ? currentConfig.agents : [];

  currentLang = currentConfig.language || 'en';
  applyI18n();
  applyTheme(currentConfig.theme || 'dark');
  populateAgentSelects();

  const dbPath = await window.taskAPI.getDbPath();
  document.getElementById('db-path-display').textContent = truncatePath(dbPath, 50);
  document.getElementById('db-path-display').title = dbPath;

  bindHeaderButtons();
  bindModal();
  bindSettingsPanel();
  bindGuidePanel();
  bindSnapshotsPanel();
  bindPreviewOverlay();
  bindAddForm();

  await refreshTasks();
  resetRefreshTimer();
  applyWidgetsFromConfig();

  window.taskAPI.onDbChanged(scheduleDbRefresh);

  // Bannière de mise à jour
  if (window.taskAPI.onUpdateAvailable) {
    window.taskAPI.onUpdateAvailable((version) => {
      showUpdateBanner(t('update_downloading') || `Update v${version} downloading…`, false);
    });
  }
  if (window.taskAPI.onUpdateDownloaded) {
    window.taskAPI.onUpdateDownloaded(() => {
      showUpdateBanner(t('update_ready') || 'Update ready — restart to install', true);
    });
  }
  document.getElementById('update-dismiss-btn').addEventListener('click', () => {
    document.getElementById('update-banner').style.display = 'none';
  });
  document.getElementById('update-install-btn').addEventListener('click', () => {
    window.taskAPI.installUpdate();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'F5')     { e.preventDefault(); refreshTasks({ force: true }); }
    if (e.key === 'Escape') {
      closeModal();
      closeAllDropdowns();
      closeSidePanel('settings-overlay');
      closeSidePanel('guide-overlay');
      closeSidePanel('snapshots-overlay');
      if (previewFilename) closePreview();
    }
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
  const th = (theme === 'light') ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', th);
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = (th === 'dark') ? '\u{1F319}' : '\u2600\uFE0F';
}

async function toggleTheme() {
  const cur  = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = (cur === 'dark') ? 'light' : 'dark';
  applyTheme(next);
  currentConfig = await window.taskAPI.saveConfig({ theme: next });
}

// ─── Header buttons ───────────────────────────────────────────────────────────
function bindHeaderButtons() {
  document.getElementById('btn-theme').addEventListener('click',      toggleTheme);
  document.getElementById('btn-refresh').addEventListener('click',    () => refreshTasks({ force: true }));
  document.getElementById('btn-add-toggle').addEventListener('click', toggleAddBar);
  document.getElementById('btn-settings').addEventListener('click',   openSettingsPanel);
  document.getElementById('btn-guide').addEventListener('click',      openGuidePanel);
  document.getElementById('btn-snapshots').addEventListener('click',  openSnapshotsPanel);
}

// ─── Refresh & rendu ──────────────────────────────────────────────────────────
async function refreshTasks(opts = {}) {
  const force = !!opts.force;
  // Pendant une interaction utilisateur, on gele l'affichage live pour ne pas
  // remplacer le DOM sous la souris ou dans un panneau/modal ouvert.
  if (!force && isRefreshBlockedByInteraction()) {
    pendingAutoRefresh = true;
    showDot(false);
    resetRefreshTimer();
    return;
  }
  if (refreshInFlight) { resetRefreshTimer(); return; }
  refreshInFlight = true;
  showDot(true);
  try {
    const r = await window.taskAPI.getTasks();
    if (r && r.error) { showToast('Erreur DB : ' + r.error, 'error'); return; }
    currentTasks = r || [];
    renderTasks(currentTasks, { force });
    const nb = currentTasks.filter(tk => tk.statut !== 'fait').length;
    document.getElementById('task-count').textContent = nb ? `${nb} ${nb > 1 ? t('tasks_active_many') : t('tasks_active_one')}` : '';
  } catch(err) { showToast('Erreur : ' + err.message, 'error'); }
  finally { refreshInFlight = false; showDot(false); resetRefreshTimer(); }
}

function resetRefreshTimer() {
  const secs = (currentConfig && currentConfig.interface && currentConfig.interface.refresh_secondes) || 30;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshTasks, Math.max(5, secs) * 1000);
}

function isSidePanelOpen() {
  return !!document.querySelector('.side-panel-overlay.visible');
}

function isModalOpen() {
  return !!document.querySelector('#modal-overlay.visible');
}

function isRefreshBlockedByInteraction() {
  return !!previewFilename || isSidePanelOpen() || isModalOpen() || addBarOpen || openDropdowns.size > 0;
}

function scheduleDbRefresh() {
  clearTimeout(dbRefreshTimer);
  dbRefreshTimer = setTimeout(() => {
    if (isRefreshBlockedByInteraction()) {
      pendingAutoRefresh = true;
      showDot(false);
      resetRefreshTimer();
      return;
    }
    refreshTasks();
  }, 250);
}

function flushPendingRefresh() {
  if (!pendingAutoRefresh || isRefreshBlockedByInteraction()) return;
  pendingAutoRefresh = false;
  refreshTasks();
}

function showDot(active) {
  document.getElementById('refresh-dot').classList.toggle('active', active);
}

function toggleAddBar() {
  addBarOpen = !addBarOpen;
  document.getElementById('add-bar').classList.toggle('open', addBarOpen);
  if (addBarOpen) setTimeout(() => document.getElementById('f-sujet').focus(), 320);
  else flushPendingRefresh();
}

function buildTasksHtml(tasks, opts) {
  const visibleTasks = tasks.filter(tk => {
    if (tk.statut === 'annule' && !opts.showAnnule) return false;
    return true;
  });

  if (!visibleTasks.length) {
    return `<div id="empty-state"><div class="icon">\u2705</div><div>${esc(t('empty_no_tasks'))}</div></div>`;
  }

  const groupes = {};
  for (const tk of visibleTasks) {
    const repo  = tk.repo  || '_hors_repo_';
    const agent = tk.agent || 'inconnu';
    if (!groupes[repo])        groupes[repo]       = {};
    if (!groupes[repo][agent]) groupes[repo][agent] = [];
    groupes[repo][agent].push(tk);
  }

  const repoMaxDate = {};
  for (const repo of Object.keys(groupes)) {
    let max = '';
    for (const tk of Object.values(groupes[repo]).flat()) {
      if (tk.statut === 'fait' || tk.statut === 'annule') continue;
      const d = tk.date_creation || '';
      if (d > max) max = d;
    }
    repoMaxDate[repo] = max;
  }
  const repoKeys = Object.keys(groupes).sort((a, b) => {
    if (a === '_hors_repo_') return 1;
    if (b === '_hors_repo_') return -1;
    const aMax = repoMaxDate[a], bMax = repoMaxDate[b];
    const aA = !!aMax, bA = !!bMax;
    if (aA !== bA) return aA ? -1 : 1;
    if (aMax !== bMax) return bMax.localeCompare(aMax);
    return a.localeCompare(b);
  });

  return repoKeys.map(r => renderRepoGroup(r, groupes[r], { showFait: opts.showFait, maxPerGrp: opts.maxPerGrp })).join('');
}

function renderTasks(tasks, opts = {}) {
  const container = document.getElementById('tasks-container');
  const cfgIf = (currentConfig && currentConfig.interface) || {};
  const showFait   = cfgIf.afficher_fait   !== false;
  const showAnnule = cfgIf.afficher_annule === true;
  const maxPerGrp  = Math.max(0, cfgIf.max_par_groupe || 0);
  const renderKey  = JSON.stringify({
    lang: currentLang,
    showFait,
    showAnnule,
    maxPerGrp,
    tasks,
  });

  if (!opts.force && renderKey === lastRenderKey) return;

  container.innerHTML = buildTasksHtml(tasks, { showFait, showAnnule, maxPerGrp });
  lastRenderKey = renderKey;

  const visibleTasks = tasks.filter(tk => tk.statut !== 'annule' || showAnnule);
  const closedIds    = new Set(visibleTasks.filter(tk => tk.statut === 'fait' || tk.statut === 'annule').map(tk => tk.id));
  for (const id of [...openNotes]) {
    if (closedIds.has(id)) { openNotes.delete(id); continue; }
    const el  = document.getElementById(`note-${id}`);
    const btn = el && el.previousElementSibling;
    if (el) { el.classList.add('visible'); if (btn) btn.textContent = t('task_note_hide'); }
  }
  for (const id of [...openDropdowns]) {
    const dd = document.getElementById(`dd-${id}`);
    if (dd) dd.classList.add('open'); else openDropdowns.delete(id);
  }
}

// ─── Widgets d'affichage (au-dessus du flux de taches) ────────────────────────
function applyWidgetsFromConfig() {
  widgetsConfig = Array.isArray(currentConfig && currentConfig.widgets) ? currentConfig.widgets : [];
  stopWidgetTimers();
  widgetValues = new Map();
  renderWidgets();
  startWidgetTimers();
}

function stopWidgetTimers() {
  for (const id of widgetTimers.values()) clearInterval(id);
  widgetTimers.clear();
}

function startWidgetTimers() {
  widgetsConfig.forEach((w, idx) => {
    if (w && w.type === 'url' && w.url) {
      fetchWidget(idx);
      const secs = Math.max(10, Math.min(3600, parseInt(w.refresh_secondes, 10) || 60));
      const t = setInterval(() => fetchWidget(idx), secs * 1000);
      widgetTimers.set(idx, t);
    }
  });
}

async function fetchWidget(idx) {
  const w = widgetsConfig[idx];
  if (!w || w.type !== 'url' || !w.url) return;
  try {
    const r = await window.taskAPI.fetchWidgetUrl(w.url, w.timeout_secondes);
    if (r && r.ok) {
      const raw = r.value || '';
      widgetValues.set(idx, w.allow_html ? raw : raw.slice(0, 300));
    } else {
      widgetValues.set(idx, '\u26A0 ' + ((r && r.error) || 'erreur'));
    }
  } catch (e) {
    widgetValues.set(idx, '\u26A0 ' + e.message);
  }
  renderWidgets();
}

function renderWidgets() {
  const container = document.getElementById('widgets-container');
  if (!container) return;
  if (!widgetsConfig.length) { container.innerHTML = ''; return; }
  container.innerHTML = '';
  widgetsConfig.forEach((w, idx) => {
    if (!w) return;
    let value;
    if (w.type === 'text') value = w.content || '';
    else if (w.type === 'url') value = widgetValues.has(idx) ? widgetValues.get(idx) : '\u2026';
    else return;

    const line = document.createElement('div');
    const isHtml = !!w.allow_html;
    line.className = 'widget-line widget-type-' + w.type + (isHtml ? ' widget-line-html' : '');

    if (w.label && w.label.trim()) {
      const lab = document.createElement('span');
      lab.className = 'widget-label';
      lab.textContent = w.label;
      line.appendChild(lab);
    }

    if (isHtml) {
      const val = document.createElement('div');
      val.className = 'widget-value-html';
      val.innerHTML = value;
      executeScriptsIn(val);
      line.appendChild(val);
    } else {
      const val = document.createElement('span');
      val.className = 'widget-value';
      val.textContent = value;
      line.appendChild(val);
    }
    container.appendChild(line);
  });
}

// Re-execute <script> tags injected via innerHTML (browsers skip them otherwise).
// Scripts executed here run in the global window context (even from a shadow root),
// so they can use jQuery ($) exposed on window via assets/vendor/jquery.min.js.
function executeScriptsIn(root) {
  const scripts = root.querySelectorAll('script');
  scripts.forEach((oldScript) => {
    const newScript = document.createElement('script');
    for (const attr of oldScript.attributes) newScript.setAttribute(attr.name, attr.value);
    newScript.text = oldScript.textContent;
    oldScript.parentNode.replaceChild(newScript, oldScript);
  });
}

function renderRepoGroup(repo, agentsMap, opts) {
  const nom  = (repo === '_hors_repo_') ? 'Hors repo' : repo;
  const b64  = btoa(unescape(encodeURIComponent(repo)));
  const coll = collapsedRepos.has(repo);

  let total = 0, todo = 0, faites = [];
  const agentsActifs = {};
  for (const ag of Object.keys(agentsMap).sort()) {
    for (const tk of agentsMap[ag]) {
      total++;
      if (tk.statut === 'fait') {
        faites.push(tk);
      } else {
        if (tk.statut !== 'annule') todo++;
        if (!agentsActifs[ag]) agentsActifs[ag] = [];
        agentsActifs[ag].push(tk);
      }
    }
  }
  const todoLabel = todo > 1 ? t('repo_todo_many') : t('repo_todo_one');

  let h = `<div class="groupe-repo${coll ? ' collapsed' : ''}" id="repo-${b64}">`;
  h += `<div class="groupe-repo-titre" onclick='toggleRepo(${j(repo)},${j(b64)})'>`;
  h += `<span class="repo-fleche">\u25BE</span>`;
  h += `<span class="repo-icone">${repo === 'Cowork' ? '\u2699\uFE0F' : '\u{1F4C1}'}</span>`;
  h += `<span class="repo-nom">${esc(nom)} <span class="repo-todo">(${todo} ${esc(todoLabel)})</span></span>`;
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
    h += taches.map(tk => renderCard(tk)).join('');
    h += `</div>`;
  }

  if (faites.length && (!opts || opts.showFait !== false)) {
    faites.sort((a, b) => {
      const da = a.date_cloture || a.date_creation || '';
      const db = b.date_cloture || b.date_creation || '';
      return db.localeCompare(da);
    });
    const fVis = visibleFaites.has(repo);
    h += `<button class="btn-toggle-faites" onclick='toggleFaites(${j(repo)},${j(b64)})'>`;
    const doneLabel = faites.length > 1 ? t('repo_done_many') : t('repo_done_one');
    h += `${fVis ? '\u25BE' : '\u25B8'} \u2705 ${faites.length} ${esc(doneLabel)}`;
    h += `</button>`;
    h += `<div class="taches-faites${fVis ? ' visible' : ''}" id="faites-${b64}">`;
    h += `<div class="groupe-agent">`;
    h += faites.map(tk => renderCard(tk)).join('');
    h += `</div></div>`;
  }

  h += `</div></div>`;
  return h;
}

function renderCard(task) {
  const isFait  = task.statut === 'fait';
  const isClaim = !!(task.reclame_par && task.reclame_par.trim());
  const hasNote = !!(task.note && task.note.trim());
  const hasCtx  = !!(task.contexte && task.contexte.trim());
  const dateCr  = formatDate(task.date_creation);
  const dateCl  = task.date_cloture ? ' ' + t('task_closed_prefix') + formatDate(task.date_cloture) : '';

  let h = `<div class="task-card" data-statut="${task.statut}" id="task-${task.id}">`;
  h += `<div class="task-id-col"><div class="task-id-bubble s-${task.statut}">${task.id}</div></div>`;
  h += `<div class="task-body">`;
  h += `<div class="task-top">`;
  h += `<span class="task-sujet" onclick="openEditModal(${task.id})">${esc(task.sujet)}</span>`;

  h += `<div class="statut-wrapper">`;
  h += `<button class="task-statut-badge badge-${task.statut}" onclick="toggleDropdown(event,${task.id})">${esc(statusLabel(task.statut))}</button>`;
  h += `<div class="statut-dropdown" id="dd-${task.id}">`;
  for (const s of STATUTS_LIST) {
    if (s === task.statut) continue;
    h += `<div class="statut-opt" onclick='changeStatut(${task.id},${j(s)})'>`;
    h += `<span class="statut-opt-dot" style="background:${STATUT_COLOR[s]}"></span>`;
    h += `${esc(statusLabel(s))}</div>`;
  }
  h += `</div></div>`;

  h += `<div class="task-actions">`;
  if (!isFait) h += `<button class="btn-act btn-fait" onclick="doCloseTask(${task.id})">${esc(t('task_done_btn'))}</button>`;
  h += `<button class="btn-act btn-edit"   onclick="openEditModal(${task.id})">\u270E</button>`;
  h += `<button class="btn-act btn-delete" onclick="doDeleteTask(${task.id})">\u2715</button>`;
  h += `</div>`;
  h += `</div>`;

  if (hasCtx) h += `<div class="task-contexte">${esc(task.contexte)}</div>`;

  if (hasNote) {
    h += `<span class="task-note-toggle" onclick="toggleNote(${task.id})">${esc(t('task_note_show'))}</span>`;
    h += `<div class="task-note" id="note-${task.id}">${esc(task.note)}</div>`;
  }

  h += `<div class="task-footer">`;
  h += `<span class="task-date">${dateCr}${dateCl}</span>`;
  if (isClaim) {
    h += `<span class="task-claimed">\u{1F512} ${esc(task.reclame_par)} `;
    h += `<button class="btn-liberer" onclick="doReleaseTask(${task.id})">${esc(t('task_release_btn'))}</button></span>`;
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
  if (!wasOpen) { dd.classList.add('open'); openDropdowns.add(id); }
}

function closeAllDropdowns() {
  document.querySelectorAll('.statut-dropdown.open').forEach(d => d.classList.remove('open'));
  openDropdowns.clear();
}

async function changeStatut(id, statut) {
  closeAllDropdowns();
  await window.taskAPI.setStatus(id, statut);
  showToast(`${t('toast_status_updated')} ${statusLabel(statut)}`, 'success');
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
  const doneLabel = nb > 1 ? t('repo_done_many') : t('repo_done_one');
  btn.innerHTML = `${vis ? '\u25BE' : '\u25B8'} \u2705 ${nb} ${esc(doneLabel)}`;
}

function toggleNote(id) {
  const el = document.getElementById(`note-${id}`);
  const btn = el && el.previousElementSibling;
  if (!el || !btn) return;
  el.classList.toggle('visible');
  const isOpen = el.classList.contains('visible');
  if (isOpen) openNotes.add(id); else openNotes.delete(id);
  btn.textContent = isOpen ? t('task_note_hide') : t('task_note_show');
}

// ─── Formulaire ajout ──────────────────────────────────────────────────────────
function bindAddForm() {
  document.getElementById('add-form').addEventListener('submit', submitAddForm);
  document.getElementById('f-cancel').addEventListener('click', () => {
    document.getElementById('add-form').reset();
    if (addBarOpen) toggleAddBar();
  });
}

async function submitAddForm(e) {
  e.preventDefault();
  const form = e.target;
  const data = {
    agent: form.agent.value, repo: form.repo.value.trim(),
    sujet: form.sujet.value.trim(), statut: form.statut.value,
    contexte: form.contexte.value.trim(), note: form.note.value.trim(),
  };
  if (!data.sujet) { showToast(t('form_sujet_required') || 'Sujet obligatoire', 'error'); return; }
  const r = await window.taskAPI.addTask(data);
  if (!r || !r.id) { showToast(t('toast_add_error') || 'Erreur creation tache', 'error'); return; }
  showToast(t('toast_task_created').replace('ID', r.id), 'success');
  form.sujet.value = ''; form.contexte.value = ''; form.note.value = '';
  if (addBarOpen) toggleAddBar();
  await refreshTasks();
}

// ─── Actions ───────────────────────────────────────────────────────────────────
async function doCloseTask(id) {
  await window.taskAPI.closeTask(id, '');
  showToast(t('toast_task_closed').replace('ID', id), 'success');
  await refreshTasks();
}

async function doDeleteTask(id) {
  const msg = (t('confirm_delete') || 'Delete task #ID?').replace('ID', id);
  if (!confirm(msg)) return;
  await window.taskAPI.deleteTask(id);
  showToast(t('toast_task_deleted').replace('ID', id), 'success');
  await refreshTasks();
}

async function doReleaseTask(id) {
  await window.taskAPI.releaseTask(id);
  showToast(t('toast_claim_released'), 'success');
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
  const task = currentTasks.find(x => x.id === id);
  if (!task) return;
  editingTaskId = id;
  document.getElementById('modal-title').textContent = `${t('modal_title_prefix')} #${id}`;
  document.getElementById('m-agent').value    = task.agent    || '';
  document.getElementById('m-repo').value     = task.repo     || '';
  document.getElementById('m-statut').value   = task.statut   || 'en_cours';
  document.getElementById('m-sujet').value    = task.sujet    || '';
  document.getElementById('m-contexte').value = task.contexte || '';
  document.getElementById('m-note').value     = task.note     || '';
  document.getElementById('modal-overlay').classList.add('visible');
  document.getElementById('m-sujet').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('visible');
  editingTaskId = null;
  flushPendingRefresh();
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
  if (!data.sujet) { showToast(t('form_sujet_required') || 'Sujet obligatoire', 'error'); return; }
  const orig = currentTasks.find(x => x.id === editingTaskId);
  if (data.statut === 'fait' && orig && orig.statut !== 'fait') {
    await window.taskAPI.closeTask(editingTaskId, data.note);
    await window.taskAPI.updateTask({ id: editingTaskId, agent: data.agent, repo: data.repo, sujet: data.sujet, contexte: data.contexte });
  } else {
    await window.taskAPI.updateTask(data);
  }
  showToast(t('toast_task_updated').replace('ID', editingTaskId), 'success');
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
  flushPendingRefresh();
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

  document.getElementById('btn-add-widget').addEventListener('click', () => {
    addWidgetRow({ type: 'text', label: '', content: '', url: '', refresh_secondes: 60 });
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

  // Langue
  const cfgLangSel = document.getElementById('cfg-language');
  if (cfgLangSel && window.LANGUAGES) {
    cfgLangSel.innerHTML = window.LANGUAGES.map(l =>
      `<option value="${esc(l.code)}"${l.code === currentLang ? ' selected' : ''}>${esc(l.flag + ' ' + l.name)}</option>`
    ).join('');
  }

  // Agents
  renderAgentsList(agentsConfig);

  // Widgets
  renderWidgetsList(currentConfig.widgets || []);

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

// ─── Widgets (UI parametres) ──────────────────────────────────────────────────
function renderWidgetsList(widgets) {
  const container = document.getElementById('cfg-widgets-list');
  container.innerHTML = '';
  for (const w of (widgets || [])) addWidgetRow(w);
}

function addWidgetRow(widget) {
  const container = document.getElementById('cfg-widgets-list');
  const w = widget || { type: 'text', label: '', content: '', url: '', refresh_secondes: 60 };
  const row = document.createElement('div');
  row.className = 'widget-row';
  const typeTextLabel = t('widget_type_text') || 'Texte';
  const typeUrlLabel  = t('widget_type_url')  || 'URL';
  const htmlLabel   = t('widget_html_label')   || 'HTML';
  const htmlTooltip = t('widget_html_tooltip') || 'Rendu HTML brut (style, script, jQuery) — desactive l echappement';
  row.innerHTML = `
    <div class="widget-row-line">
      <select class="w-type">
        <option value="text"${w.type === 'text' ? ' selected' : ''}>${esc(typeTextLabel)}</option>
        <option value="url"${w.type === 'url' ? ' selected' : ''}>${esc(typeUrlLabel)}</option>
      </select>
      <input type="text" class="w-label" placeholder="${esc(t('widget_label_ph') || 'Libelle (optionnel)')}" value="${esc(w.label || '')}">
      <label class="w-html-toggle" title="${esc(htmlTooltip)}">
        <input type="checkbox" class="w-html"${w.allow_html ? ' checked' : ''}>
        <span>${esc(htmlLabel)}</span>
      </label>
      <button class="btn-remove" title="Supprimer">&times;</button>
    </div>
    <div class="widget-row-line">
      <input type="text" class="w-content" value="${esc(w.type === 'url' ? (w.url || '') : (w.content || ''))}">
      <input type="number" class="w-refresh" min="10" max="3600" value="${w.refresh_secondes || 60}" title="${esc(t('widget_refresh_tooltip') || 'Delai (sec) entre chaque requete URL')}">
      <span class="w-refresh-suffix">s</span>
      <input type="number" class="w-timeout" min="2" max="60" value="${w.timeout_secondes || 15}" title="${esc(t('widget_timeout_tooltip') || 'Timeout (sec) de la requete URL')}">
      <span class="w-timeout-suffix">s timeout</span>
    </div>
  `;
  const selType    = row.querySelector('.w-type');
  const inpContent = row.querySelector('.w-content');
  const inpRefresh = row.querySelector('.w-refresh');
  const suffix     = row.querySelector('.w-refresh-suffix');
  const inpTimeout = row.querySelector('.w-timeout');
  const tSuffix    = row.querySelector('.w-timeout-suffix');
  const updateMode = () => {
    const isUrl = selType.value === 'url';
    inpContent.placeholder = isUrl
      ? (t('widget_url_ph')  || 'https://...')
      : (t('widget_text_ph') || 'Texte a afficher...');
    inpRefresh.style.display = isUrl ? '' : 'none';
    suffix.style.display     = isUrl ? '' : 'none';
    inpTimeout.style.display = isUrl ? '' : 'none';
    tSuffix.style.display    = isUrl ? '' : 'none';
  };
  selType.addEventListener('change', updateMode);
  updateMode();
  row.querySelector('.btn-remove').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function collectWidgetsFromUI() {
  const rows = document.querySelectorAll('#cfg-widgets-list .widget-row');
  const out = [];
  rows.forEach(r => {
    const type      = r.querySelector('.w-type').value;
    const label     = r.querySelector('.w-label').value.trim();
    const content   = r.querySelector('.w-content').value.trim();
    const refresh   = parseInt(r.querySelector('.w-refresh').value, 10) || 60;
    const timeout   = parseInt(r.querySelector('.w-timeout').value, 10) || 15;
    const allowHtml = !!(r.querySelector('.w-html') && r.querySelector('.w-html').checked);
    if (type === 'text' && content) {
      out.push({ type: 'text', label, content, allow_html: allowHtml });
    } else if (type === 'url' && /^https?:\/\//i.test(content)) {
      out.push({
        type: 'url',
        label,
        url: content,
        refresh_secondes: Math.max(10, Math.min(3600, refresh)),
        timeout_secondes: Math.max(2, Math.min(60, timeout)),
        allow_html: allowHtml,
      });
    }
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
    agents:  collectAgentsFromUI(),
    widgets: collectWidgetsFromUI(),
    language: (document.getElementById('cfg-language') || {}).value || currentLang,
  };
  currentConfig = await window.taskAPI.saveConfig(patch);
  agentsConfig  = currentConfig.agents || [];
  currentLang   = currentConfig.language || 'en';
  applyTheme(currentConfig.theme || 'dark');
  applyI18n();
  populateAgentSelects();
  applyWidgetsFromConfig();
  showToast(t('toast_settings_saved') || '\u2705 Settings saved', 'success');
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
  if (!b) { showToast('Window not found', 'error'); return; }
  document.getElementById('cfg-win-x').value = b.x;
  document.getElementById('cfg-win-y').value = b.y;
  document.getElementById('cfg-win-w').value = b.width;
  document.getElementById('cfg-win-h').value = b.height;
  document.getElementById('cfg-win-enabled').checked = true;
  showToast(t('toast_win_position_copied'), 'success');
}

async function applyBoundsFromForm() {
  const win = readWindowFromUI();
  const xVal = win.x === null ? 0 : win.x;
  const yVal = win.y === null ? 0 : win.y;
  const r = await window.taskAPI.applyWindowBounds({ x: xVal, y: yVal, width: win.width, height: win.height });
  if (r && r.ok) showToast(t('toast_win_repositioned'), 'success');
  else showToast('Window positioning failed', 'error');
}

async function doPurgeNow() {
  if (!confirm(t('confirm_purge'))) return;
  const r = await window.taskAPI.purgeNow();
  if (r && r.statut === 'OK') {
    showToast(t('toast_purge_ok').replace('COUNT', r.deleted || 0), 'success');
    await refreshTasks();
  } else {
    showToast('Purge error: ' + ((r && r.message) || 'error'), 'error');
  }
}

async function doOpenDbFolder() {
  await window.taskAPI.openDbFolder();
}

async function doExportJson() {
  const r = await window.taskAPI.exportJson();
  if (r && r.ok) showToast(t('toast_export_ok').replace('COUNT', r.count).replace('PATH', r.path), 'success');
  else showToast('Export error: ' + ((r && r.error) || 'error'), 'error');
}

async function doCheckUpdates() {
  showToast(t('toast_searching_updates'), 'success');
  const r = await window.taskAPI.checkUpdates();
  if (r && r.dev) { showToast('Dev mode: update check skipped', 'success'); return; }
  if (r && r.available) showToast(`\u2705 Update available: v${r.version}`, 'success');
  else if (r && r.error) showToast('Update error: ' + r.error, 'error');
  else showToast(t('toast_up_to_date'), 'success');
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
  const config    = await window.taskAPI.getConfig();
  const quote     = `"${agentPath}"`;
  const httpCfg   = (config && config.httpApi) || {};
  const httpHost  = httpCfg.host || '127.0.0.1';
  const httpPort  = httpCfg.port || 17891;
  const localHost = httpHost === '0.0.0.0' ? '127.0.0.1' : httpHost;
  const baseUrl   = `http://${localHost}:${httpPort}`;
  const remoteUrl = `http://IP_DU_PC_WINDOWS:${httpPort}`;

  document.getElementById('guide-agent-path').textContent = agentPath;

  const httpExamples = document.getElementById('guide-http-examples');
  if (httpExamples) httpExamples.textContent = buildHttpExamples(baseUrl, remoteUrl, httpHost, httpPort);

  const httpPrompt = document.getElementById('guide-http-prompt');
  if (httpPrompt) httpPrompt.textContent = buildHttpPrompt(remoteUrl);

  const unified = document.getElementById('guide-unified');
  if (unified) unified.textContent = buildUnifiedPrompt(quote);

  openSidePanel('guide-overlay');
}

function buildHttpExamples(baseUrl, remoteUrl, configuredHost, port) {
  return (
`# API HTTP locale AgentDockyard
# Config actuelle : host=${configuredHost}, port=${port}
# Fichier de config Windows :
# %APPDATA%\\AgentDockyard\\config.json
#
# Pour un agent sur le meme PC :
#   host=127.0.0.1 suffit.
#
# Pour Claude Cowork, une sandbox Linux ou une machine du reseau :
#   mettre host=0.0.0.0, redemarrer AgentDockyard, puis autoriser TCP ${port}
#   dans le pare-feu Windows si la connexion est refusee.
#
# Token :
#   si httpApi.token est vide, aucun header n'est requis.
#   si httpApi.token est rempli, ajouter :
#   -H "X-AgentDockyard-Token: VOTRE_TOKEN"

# Config minimale pour acces reseau local
{
  "httpApi": {
    "enabled": true,
    "host": "0.0.0.0",
    "port": ${port},
    "token": ""
  }
}

# PowerShell local
Invoke-RestMethod -Method Get -Uri "${baseUrl}/health"

Invoke-RestMethod -Method Post \`
  -Uri "${baseUrl}/api/agentdockyard" \`
  -ContentType "application/json" \`
  -Body '{"action":"ajouter","agent":"claude-cowork","repo":"AgentDockyard","sujet":"Test HTTP local","statut":"en_cours","note":"Cree via API HTTP locale"}'

# Sandbox ou autre machine du reseau local
curl ${remoteUrl}/health

curl -X POST ${remoteUrl}/api/agentdockyard \\
  -H "Content-Type: application/json" \\
  -d '{"action":"ajouter","agent":"claude-cowork","repo":"AgentDockyard","sujet":"Test HTTP depuis sandbox","statut":"en_cours","note":"Cree sans acces dossier"}'`
  );
}

function buildHttpPrompt(remoteUrl) {
  return (
`## AgentDockyard - HTTP task management

You can use AgentDockyard through its local HTTP API.
Base URL: ${remoteUrl}

Use HTTP only:
- Do not ask for Windows folder access.
- Do not call agent.exe directly.
- Do not write to tasks.db directly.
- If the API is unreachable, continue the main work and mention the failure.
- Use short timeouts when you run curl from automation.

Health check:
curl ${remoteUrl}/health

Main endpoint:
POST ${remoteUrl}/api/agentdockyard
Content-Type: application/json

The JSON body is the same payload used by agent.exe.

Mandatory workflow:
1. Create a task as soon as the work starts.
2. Keep the task note updated during meaningful steps.
3. Use changer_statut with bloque or en_attente when needed.
4. Close the task with a useful summary when the work is done.
5. If you detect a separate issue, create a new task for it.

Create:
curl -X POST ${remoteUrl}/api/agentdockyard \\
  -H "Content-Type: application/json" \\
  -d '{"action":"ajouter","agent":"YOUR-AGENT-ID","repo":"REPO_NAME","sujet":"Short description","statut":"en_cours","note":"OBJECTIF : ...\\n\\nPLAN D ACTION :\\n1. ...\\n2. ...\\n\\nETAT D AVANCEMENT :\\n- [ ] Demarrage"}'

Update:
curl -X POST ${remoteUrl}/api/agentdockyard \\
  -H "Content-Type: application/json" \\
  -d '{"action":"modifier","id":ID,"note":"Progress: step X done, Y remaining"}'

Close:
curl -X POST ${remoteUrl}/api/agentdockyard \\
  -H "Content-Type: application/json" \\
  -d '{"action":"cloturer","id":ID,"note":"Full summary of what was done"}'

Block:
curl -X POST ${remoteUrl}/api/agentdockyard \\
  -H "Content-Type: application/json" \\
  -d '{"action":"changer_statut","id":ID,"statut":"bloque","note":"Precise reason for blocker"}'

Create a follow-up task:
curl -X POST ${remoteUrl}/api/agentdockyard \\
  -H "Content-Type: application/json" \\
  -d '{"action":"ajouter","agent":"YOUR-AGENT-ID","repo":"REPO_NAME","sujet":"Verifier/corriger : short issue","statut":"a_faire_rapidement","note":"PROBLEME DETECTE : ...\\n\\nCONTEXTE : ...\\n\\nACTION ATTENDUE : ..."}'

Available actions:
ajouter | modifier | cloturer | annuler | changer_statut | reclamer | liberer | lister | lister_par_agent | lister_par_repo | recuperer | compter

Available statuses:
en_cours | a_faire_rapidement | en_attente | bloque | fait | annule`
  );
}

function buildUnifiedPrompt(quotedPath) {
  const isExe = /\.exe"?$/i.test(quotedPath.replace(/\\\\/g, '\\'));
  const invoke = isExe ? quotedPath : `python ${quotedPath}`;

  return (
`## AgentDockyard - Task Management

You have access to AgentDockyard to declare and track your tasks in real time.
Script : ${invoke}

Use this CLI prompt when agent.exe or agent.py is directly accessible.
For Claude Cowork, sandboxes, remote machines, or scheduled jobs without local file access, use the HTTP prompt in the AgentDockyard guide instead.

=== MANDATORY RULES ===
1. ALWAYS declare your tasks as soon as you start.
2. ALWAYS close with a summary note.
3. NEVER leave a task en_cours when you stop.

=== COMMANDS ===

Start a task :
${invoke} '{"action":"ajouter","agent":"YOUR-AGENT-ID","repo":"REPO_NAME","sujet":"Short description","statut":"en_cours"}'

Update (progress) :
${invoke} '{"action":"modifier","id":ID,"note":"Progress: step X done, Y remaining"}'

Close (task done) :
${invoke} '{"action":"cloturer","id":ID,"note":"Full summary of what was done"}'

Report a blocker :
${invoke} '{"action":"changer_statut","id":ID,"statut":"bloque","note":"Precise reason for blocker"}'

Put on hold :
${invoke} '{"action":"changer_statut","id":ID,"statut":"en_attente","note":"Waiting for what"}'

Claim a task (mark it as yours) :
${invoke} '{"action":"reclamer","id":ID,"agent":"YOUR-AGENT-ID"}'

Release a claim :
${invoke} '{"action":"liberer","id":ID}'

List active tasks (excludes fait/annule by default, lighter responses) :
${invoke} '{"action":"lister"}'

List by repo (active only) :
${invoke} '{"action":"lister_par_repo","repo":"REPO_NAME"}'

Include closed (fait) tasks too :
${invoke} '{"action":"lister_par_repo","repo":"REPO_NAME","inclure_fait":true}'

Only closed tasks (to read past summaries) :
${invoke} '{"action":"lister_par_repo","repo":"REPO_NAME","statut":"fait"}'

=== AVAILABLE STATUSES ===
en_cours | a_faire_rapidement | en_attente | bloque | fait | annule

# Note (Linux / Cowork): AgentDockyard handles VirtioFS access automatically.
# If agent.exe (Windows) is not accessible, use the Python version:
#   python /path/to/agent.py '{"action":"..."}'`
  );
}

// ─── Snapshots horaires ───────────────────────────────────────────────────────
function bindSnapshotsPanel() {
  const overlay = document.getElementById('snapshots-overlay');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSidePanel('snapshots-overlay'); });
  document.getElementById('snapshots-close').addEventListener('click', () => closeSidePanel('snapshots-overlay'));
}

async function openSnapshotsPanel() {
  const snapshots = await window.taskAPI.listSnapshots();
  renderSnapshotsList(snapshots || []);
  openSidePanel('snapshots-overlay');
}

function renderSnapshotsList(snapshots) {
  const container = document.getElementById('snapshots-list');
  if (!snapshots.length) {
    container.innerHTML = `<div class="snapshots-empty">
      <div class="icon">\u{1F550}</div>
      <div>${esc(t('snapshots_empty_1'))}</div>
      <div style="margin-top:6px;font-size:11px;opacity:.8">${esc(t('snapshots_empty_2'))}</div>
    </div>`;
    return;
  }

  // Regrouper par jour (YYYYMMDD) en conservant l'ordre (plus recent en premier)
  const byDay = new Map();  // key = YYYYMMDD, value = array
  for (const s of snapshots) {
    const d = new Date(s.timestamp);
    const key = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(s);
  }

  const today     = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86400000));

  let h = '';
  for (const [key, list] of byDay) {
    let label;
    if (key === today)     label = t('snapshots_today');
    else if (key === yesterday) label = t('snapshots_yesterday');
    else {
      label = `${key.slice(6,8)}/${key.slice(4,6)}/${key.slice(0,4)}`;
    }
    h += `<div class="snapshots-day">`;
    h += `<div class="snapshots-day-header">${esc(label)}</div>`;
    for (const s of list) {
      const d = new Date(s.timestamp);
      const hh = String(d.getHours()).padStart(2,'0');
      const mm = String(d.getMinutes()).padStart(2,'0');
      const kb = Math.round((s.size || 0) / 1024);
      const badge = s.beforeRestore ? `<span class="snapshot-badge-restore">${esc(t('snapshots_badge_before_restore'))}</span>` : '';
      h += `<div class="snapshot-item${s.beforeRestore ? ' before-restore' : ''}" onclick='openPreview(${j(s.filename)})'>`;
      h += `<span class="snapshot-item-time">${hh}:${mm}</span>`;
      h += `<span class="snapshot-item-meta">${badge}</span>`;
      h += `<span class="snapshot-item-size">${kb} Ko</span>`;
      h += `</div>`;
    }
    h += `</div>`;
  }
  container.innerHTML = h;
}

function dayKey(d) {
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

function bindPreviewOverlay() {
  document.getElementById('preview-close-btn').addEventListener('click',   closePreview);
  document.getElementById('preview-restore-btn').addEventListener('click', confirmRestore);
}

async function openPreview(filename) {
  closeSidePanel('snapshots-overlay');
  const r = await window.taskAPI.previewSnapshot(filename);
  if (!r || !r.ok) {
    showToast(t('snapshots_preview_error') + (r && r.error ? ' : ' + r.error : ''), 'error');
    return;
  }
  previewFilename = filename;
  const d = new Date(r.timestamp);
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  const dateLabel = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${hh}h${mm}`;
  const subKey = r.beforeRestore ? 'preview_banner_sub_before_restore' : 'preview_banner_sub';
  document.getElementById('preview-banner-sub').textContent = t(subKey).replace('DATE', dateLabel);

  const body = document.getElementById('preview-tasks-container');
  body.innerHTML = buildTasksHtml(r.taches || [], { showFait: true, showAnnule: true, maxPerGrp: 0 });

  // Badge "preview" sur chaque carte pour renforcer le signal visuel
  body.querySelectorAll('.task-card').forEach(card => {
    const ribbon = document.createElement('div');
    ribbon.className   = 'preview-ribbon';
    ribbon.textContent = t('preview_ribbon');
    card.appendChild(ribbon);
  });

  document.getElementById('preview-overlay').classList.add('visible');
}

function closePreview() {
  previewFilename = null;
  document.getElementById('preview-overlay').classList.remove('visible');
  document.getElementById('preview-tasks-container').innerHTML = '';
}

async function confirmRestore() {
  if (!previewFilename) return;
  const msg = t('preview_restore_confirm');
  if (!confirm(msg)) return;
  const r = await window.taskAPI.restoreSnapshot(previewFilename);
  if (r && r.ok) {
    showToast(t('preview_restore_ok'), 'success');
    closePreview();
    await refreshTasks();
  } else {
    showToast(t('preview_restore_error') + (r && r.error ? ' : ' + r.error : ''), 'error');
  }
}

// ─── Banniere mise a jour ─────────────────────────────────────────────────────
function showUpdateBanner(msg, showInstall) {
  const banner = document.getElementById('update-banner');
  const text   = document.getElementById('update-banner-text');
  const btn    = document.getElementById('update-install-btn');
  if (!banner) return;
  text.textContent = msg;
  btn.style.display = showInstall ? 'inline-block' : 'none';
  banner.style.display = 'flex';
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
window.openPreview     = openPreview;

document.addEventListener('DOMContentLoaded', init);
