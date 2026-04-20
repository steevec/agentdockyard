#!/usr/bin/env node
/**
 * scripts/regen-latest-yml.js
 *
 * Regenere dist/latest.yml apres que les installers ont ete signes par SignPath.
 *
 * Probleme resolu :
 *   electron-updater verifie le sha512 du .exe telecharge contre celui declare
 *   dans latest.yml. Apres signature Authenticode, le .exe est modifie (table
 *   de signatures ajoutee) -> son sha512 change, et latest.yml devient invalide.
 *   Les clients en auto-update echoueraient avec une erreur d integrite.
 *
 * Solution :
 *   Reparcourir dist/latest.yml, pour chaque fichier reference (files[].url
 *   et path:), recalculer sha512 (base64) et size depuis le .exe signe.
 *
 * Pas de dependance externe : parsing regex sur le format standard d electron-
 * builder (suffisant car latest.yml est genere automatiquement, le format est
 * stable et simple).
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const DIST_DIR   = path.join(__dirname, '..', 'dist');
const LATEST_YML = path.join(DIST_DIR, 'latest.yml');

function sha512Base64(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha512').update(data).digest('base64');
}

function fileSize(filePath) {
  return fs.statSync(filePath).size;
}

function log(msg) { console.log(`[regen-latest-yml] ${msg}`); }
function fail(msg) { console.error(`[regen-latest-yml] ERREUR: ${msg}`); process.exit(1); }

if (!fs.existsSync(LATEST_YML)) fail(`${LATEST_YML} introuvable`);

let yml = fs.readFileSync(LATEST_YML, 'utf8');
let updates = 0;

// Entries dans la liste "files:"
//   - url: AgentDockyard-Setup-1.4.0.exe
//     sha512: <base64>
//     size: <bytes>
const filesRegex = /^(\s*-\s*url:\s*)(\S+\.exe)(\s*\r?\n\s*sha512:\s*)(\S+)(\s*\r?\n\s*size:\s*)(\d+)/gm;
yml = yml.replace(filesRegex, (m, p1, url, p2, oldSha, p3, oldSize) => {
  const p = path.join(DIST_DIR, url);
  if (!fs.existsSync(p)) { log(`${url} absent, skip`); return m; }
  const newSha  = sha512Base64(p);
  const newSize = fileSize(p);
  log(`files[].${url} : sha512 ${oldSha.slice(0,16)}... -> ${newSha.slice(0,16)}..., size ${oldSize} -> ${newSize}`);
  updates++;
  return `${p1}${url}${p2}${newSha}${p3}${newSize}`;
});

// Entry racine "path: X.exe\nsha512: <...>" (correspond au Setup principal)
const pathRegex = /^(path:\s*)(\S+\.exe)(\s*\r?\n\s*sha512:\s*)(\S+)/m;
yml = yml.replace(pathRegex, (m, p1, pathFile, p2, oldSha) => {
  const p = path.join(DIST_DIR, pathFile);
  if (!fs.existsSync(p)) { log(`${pathFile} (path:) absent, skip`); return m; }
  const newSha = sha512Base64(p);
  log(`path:${pathFile} : sha512 ${oldSha.slice(0,16)}... -> ${newSha.slice(0,16)}...`);
  updates++;
  return `${p1}${pathFile}${p2}${newSha}`;
});

if (updates === 0) fail('aucune entry trouvee dans latest.yml, verifier le format');

fs.writeFileSync(LATEST_YML, yml, 'utf8');
log(`latest.yml mis a jour (${updates} hashes recalcules)`);
