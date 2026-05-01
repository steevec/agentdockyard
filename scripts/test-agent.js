#!/usr/bin/env node
/**
 * scripts/test-agent.js
 *
 * Smoke tests pour agent.py : lance la version Python (mode dev) et verifie
 * que chaque action principale repond correctement. Utile pour la CI avant
 * de packager. Ne necessite pas Electron, juste Python 3.
 *
 * Usage : node scripts/test-agent.js
 *         npm test
 */

'use strict';

const { spawnSync } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..');
const AGENT_PY  = path.join(ROOT, 'agent.py');
const DB_PATH   = path.join(os.tmpdir(), `agentdockyard-test-${Date.now()}.db`);

let PYTHON = null;
for (const cmd of ['python', 'python3', 'py']) {
  const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (!r.error && r.status === 0) { PYTHON = cmd; break; }
}
if (!PYTHON) {
  console.error('[test-agent] Python introuvable - smoke test skip.');
  process.exit(0);
}

function call(payload) {
  const r = spawnSync(PYTHON, [AGENT_PY, JSON.stringify(payload), DB_PATH], {
    encoding: 'utf8', timeout: 10000,
  });
  // agent.py imprime du JSON valide meme en cas d erreur (avant sys.exit(1)).
  // On parse stdout independamment du code de sortie pour garder le contrat.
  try { return JSON.parse(r.stdout || '{}'); }
  catch (e) {
    return { __parseError: e.message, __stdout: r.stdout, __stderr: r.stderr, __exitCode: r.status };
  }
}

let failed = 0;
function check(label, cond, detail) {
  const ok = !!cond;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' -- ' + detail : ''}`);
  if (!ok) failed++;
}

try {
  // ─── add ──
  const r1 = call({ action: 'ajouter', agent: 'test', sujet: 'Smoke', note: 'plan' });
  check('ajouter renvoie OK + id', r1 && r1.statut === 'OK' && r1.id, JSON.stringify(r1));
  const id = r1 && r1.id;

  // ─── recuperer ──
  const r2 = call({ action: 'recuperer', id });
  check('recuperer renvoie la tache', r2 && r2.statut === 'OK' && r2.tache && r2.tache.id === id);

  // ─── modifier ──
  const r3 = call({ action: 'modifier', id, note: 'plan modifie' });
  check('modifier renvoie OK', r3 && r3.statut === 'OK');

  // ─── reclamer ──
  const r4 = call({ action: 'reclamer', id, agent: 'tester' });
  check('reclamer renvoie OK', r4 && r4.statut === 'OK');

  // ─── lister ──
  const r5 = call({ action: 'lister' });
  check('lister renvoie taches[]', r5 && r5.statut === 'OK' && Array.isArray(r5.taches) && r5.taches.length >= 1);

  // ─── compter ──
  const r6 = call({ action: 'compter' });
  check('compter renvoie count', r6 && r6.statut === 'OK' && typeof r6.count === 'number');

  // ─── changer_statut ──
  const r7 = call({ action: 'changer_statut', id, statut: 'bloque' });
  check('changer_statut renvoie OK', r7 && r7.statut === 'OK');

  // ─── statut invalide ──
  const r8 = call({ action: 'changer_statut', id, statut: 'qq_chose_de_pas_valide' });
  check('changer_statut rejette statut inconnu', r8 && r8.statut === 'NOK');

  // ─── cloturer ──
  const r9 = call({ action: 'cloturer', id, note: 'compte rendu' });
  check('cloturer renvoie OK + tache', r9 && r9.statut === 'OK' && r9.tache && r9.tache.statut === 'fait');

  // ─── lister exclut fait par defaut ──
  const r10 = call({ action: 'lister' });
  const hasFait = r10 && Array.isArray(r10.taches) && r10.taches.some(t => t.statut === 'fait');
  check('lister exclut fait par defaut', !hasFait);

  // ─── lister inclure_fait ──
  const r11 = call({ action: 'lister', inclure_fait: true });
  const hasFaitNow = r11 && Array.isArray(r11.taches) && r11.taches.some(t => t.statut === 'fait');
  check('lister inclure_fait=true ramene les fait', hasFaitNow);

  // ─── action inconnue ──
  const r12 = call({ action: 'pas_une_action' });
  check('action inconnue renvoie NOK', r12 && r12.statut === 'NOK');

  // ─── champs obligatoires manquants ──
  const r13 = call({ action: 'ajouter' });
  check('ajouter sans agent renvoie NOK', r13 && r13.statut === 'NOK');

  // ─── annuler ──
  const r14 = call({ action: 'annuler', id });
  check('annuler renvoie OK', r14 && r14.statut === 'OK');

} finally {
  try { fs.unlinkSync(DB_PATH); } catch (_) { /* ignore */ }
  try { fs.unlinkSync(DB_PATH + '-journal'); } catch (_) { /* ignore */ }
}

console.log(failed === 0 ? '\nSmoke OK' : `\n${failed} test(s) en echec`);
process.exit(failed === 0 ? 0 : 1);
