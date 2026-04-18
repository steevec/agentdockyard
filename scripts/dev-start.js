#!/usr/bin/env node
/**
 * scripts/dev-start.js
 *
 * Lance Electron en mode dev apres avoir UNSET la variable ELECTRON_RUN_AS_NODE.
 * Raison : certains environnements (ex: Claude Code) definissent cette variable
 * pour leur propre runtime, ce qui fait que `electron .` se comporte comme Node
 * classique et rend `require('electron')` retourner un string au lieu de l'API.
 *
 * En production (utilisateur final lance AgentDockyard.exe), la variable n'est
 * pas definie, donc ce contournement n'est utile qu'en dev.
 */

const { spawn } = require('child_process');
const path      = require('path');

const electronBin = require('electron');
if (typeof electronBin !== 'string') {
  console.error('[dev-start] require("electron") n a pas retourne un path. Anomalie.');
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBin, [path.resolve(__dirname, '..')], {
  stdio: 'inherit',
  env,
  windowsHide: false,
});

child.on('close', code => process.exit(code === null ? 1 : code));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { if (!child.killed) child.kill(sig); });
}
