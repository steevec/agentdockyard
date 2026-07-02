#!/usr/bin/env node
/**
 * scripts/build-agent.js
 *
 * Compile agent.py en agent.exe (standalone, sans Python requis) via PyInstaller.
 * Depose le resultat dans dist-agent/agent.exe, prêt pour electron-builder
 * (extraResources du package.json).
 *
 * Prerequis pour le DEVELOPPEUR qui fait le build :
 *   1. Python 3.8+ installe et accessible dans le PATH
 *   2. PyInstaller : pip install pyinstaller
 *
 * Les UTILISATEURS finaux n'ont rien a installer : agent.exe est autonome.
 */

const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT        = path.resolve(__dirname, '..');
const AGENT_PY    = path.join(ROOT, 'agent.py');
const DIST_AGENT  = path.join(ROOT, 'dist-agent');
const BUILD_TMP   = path.join(ROOT, 'build-agent-tmp');
const SPEC_FILE   = path.join(ROOT, 'agent.spec');

function log(msg)  { console.log(`[build-agent] ${msg}`); }
function fail(msg) { console.error(`[build-agent] ERREUR: ${msg}`); process.exit(1); }

function which(bin, args = ['--version']) {
  try {
    const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 10000 });
    if (!r.error && r.status === 0) return true;
  } catch (_) {}
  return false;
}

function findPython() {
  for (const cmd of ['python', 'python3', 'py']) {
    if (which(cmd)) return cmd;
  }
  return null;
}

function ensurePyInstaller(python) {
  const r = spawnSync(python, ['-m', 'PyInstaller', '--version'], { encoding: 'utf8', timeout: 15000 });
  return (!r.error && r.status === 0);
}

function clean() {
  for (const p of [DIST_AGENT, BUILD_TMP, SPEC_FILE]) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {}
  }
}

function main() {
  if (!fs.existsSync(AGENT_PY)) fail(`agent.py introuvable : ${AGENT_PY}`);

  const python = findPython();
  if (!python) {
    fail('Python introuvable dans le PATH.\n' +
         '  Installez Python 3.8+ depuis https://python.org\n' +
         '  Puis : pip install pyinstaller');
  }
  log(`Python detecte : ${python}`);

  if (!ensurePyInstaller(python)) {
    fail('PyInstaller non installe.\n' +
         '  Executez : pip install pyinstaller');
  }
  log('PyInstaller : OK');

  clean();
  log('Nettoyage dist-agent/ effectue');

  log('Compilation de agent.py -> agent.exe ...');
  // --onedir (et non --onefile) : en onefile, CHAQUE invocation extrait tout le
  // runtime Python dans %TEMP% avant de s executer (~300-800 ms de CPU/disque/
  // antivirus par appel). Or l agent est spawne a chaque refresh UI et a chaque
  // appel API des agents IA. En onedir, le demarrage est quasi instantane.
  const r = spawnSync(python, [
    '-m', 'PyInstaller',
    '--onedir',
    '--clean',                  // ignore les caches PyInstaller (build reproductible)
    '--noupx',                  // pas de compression UPX (souvent flaggee par les antivirus)
    '--name', 'agent',
    '--console',                // mode console (cli)
    '--distpath',   DIST_AGENT,
    '--workpath',   BUILD_TMP,
    '--specpath',   ROOT,
    AGENT_PY,
  ], { encoding: 'utf8', stdio: 'inherit' });

  if (r.status !== 0) fail(`PyInstaller a echoue (code ${r.status})`);

  // Verifier la sortie selon l'OS (layout onedir : dist-agent/agent/agent.exe + _internal/)
  const outName = process.platform === 'win32' ? 'agent.exe' : 'agent';
  const outDir  = path.join(DIST_AGENT, 'agent');
  const outPath = path.join(outDir, outName);
  if (!fs.existsSync(outPath)) fail(`Executable attendu introuvable : ${outPath}`);

  const dirSize = (p) => fs.readdirSync(p, { withFileTypes: true }).reduce((acc, e) => {
    const full = path.join(p, e.name);
    return acc + (e.isDirectory() ? dirSize(full) : fs.statSync(full).size);
  }, 0);
  log(`OK - dossier agent/ genere : ${outDir} (${(dirSize(outDir) / 1024 / 1024).toFixed(1)} MB au total)`);

  // Nettoyer les artefacts temporaires (laisse dist-agent/agent.exe)
  try { fs.rmSync(BUILD_TMP, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(SPEC_FILE, { force: true }); } catch (_) {}

  // Smoke test : appeler agent.exe avec action 'lister' dans un dossier temp
  const os  = require('os');
  const tmp = path.join(os.tmpdir(), `agent-smoke-${Date.now()}.db`);
  const rt  = spawnSync(outPath, ['{"action":"lister"}', tmp], { encoding: 'utf8', timeout: 8000 });
  try { fs.unlinkSync(tmp); } catch (_) {}
  if (rt.status !== 0 || !rt.stdout || !rt.stdout.includes('"statut"')) {
    console.error(rt.stderr || rt.stdout);
    fail('Smoke test echoue - l\'exe genere ne repond pas correctement');
  }
  log('Smoke test OK (action lister -> reponse JSON valide)');
}

main();
