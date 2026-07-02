/**
 * http-api.js - Local HTTP bridge for AgentDockyard.
 *
 * The API accepts the same JSON payload as agent.exe and forwards it to the
 * existing agent process. It does not implement task business logic.
 */

const http = require('http');
const { spawn } = require('child_process');

const MAX_BODY_BYTES = 1024 * 1024;
const AGENT_TIMEOUT_MS = 10000;

function jsonResponse(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    // Accumuler des Buffers puis concatener : convertir chunk par chunk en
    // string corromprait un caractere UTF-8 multi-octets coupe entre 2 chunks.
    const chunks = [];
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        chunks.length = 0;
        req.resume();
        reject(Object.assign(new Error('Body too large'), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (err) {
        reject(Object.assign(new Error('Invalid JSON'), { statusCode: 400 }));
      }
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function callAgentRaw(payload, options) {
  return new Promise((resolve) => {
    const payloadJson = JSON.stringify(payload);
    const dbPath = options.dbPath;
    let bin;
    let args;

    if (options.isPackaged) {
      bin = options.agentExePath;
      args = [payloadJson, dbPath];
    } else {
      const pythonCmd = options.getPythonCmd();
      if (!pythonCmd) {
        resolve({
          stdout: '',
          stderr: 'Python introuvable (mode dev)',
          exitCode: 1,
        });
        return;
      }
      bin = pythonCmd;
      args = [options.agentScriptDev, payloadJson, dbPath];
    }

    let stdout = '';
    let stderr = '';
    let done = false;
    let child;

    try {
      // windowsHide obligatoire : agent.exe est une app console et le défaut
      // Node est false — sans lui, chaque appel API fait flasher une fenêtre
      // console qui vole le focus clavier.
      child = spawn(bin, args, { windowsHide: true });
    } catch (err) {
      resolve({
        stdout: '',
        stderr: 'Spawn impossible : ' + (err && err.message || 'erreur inconnue'),
        exitCode: 1,
      });
      return;
    }

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill(); } catch (_) { /* ignore */ }
      resolve({ stdout, stderr: stderr || 'Timeout', exitCode: 1 });
    }, AGENT_TIMEOUT_MS);

    // setEncoding : evite de corrompre un caractere UTF-8 multi-octets coupe
    // entre deux chunks du pipe stdout/stderr.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code === null ? 1 : code });
    });
    child.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ stdout, stderr: err.message, exitCode: 1 });
    });
  });
}

function hasValidToken(req, cfg) {
  if (!cfg.token) return true;
  return req.headers['x-agentdockyard-token'] === cfg.token;
}

function agentCallSucceeded(result) {
  if (result.exitCode !== 0) return false;
  try {
    const parsed = JSON.parse(result.stdout || '{}');
    if (parsed && parsed.statut === 'NOK') return false;
  } catch (_) {
    // Non-JSON stdout is handled by the caller through the raw stdout field.
  }
  return true;
}

// Verifie si un AgentDockyard repond deja sur host:port via /health. Sur Windows,
// deux process du meme utilisateur peuvent bind 127.0.0.1:port simultanement sans
// EADDRINUSE : Windows repartit alors les connexions entrantes entre les deux
// serveurs de facon non deterministe. Le verrou d'instance unique d'Electron ne
// couvre pas le cas "build dev + app installee" (userData differents), donc on
// sonde le port avant de demarrer pour ne pas dedoubler le service.
function probeHealth(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.request(
      { host, port, path: '/health', method: 'GET', timeout: timeoutMs },
      (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          try {
            const j = JSON.parse(body || '{}');
            resolve(j && j.service === 'AgentDockyard HTTP API');
          } catch (_) { resolve(false); }
        });
      }
    );
    req.on('error', () => resolve(false));   // personne n'ecoute -> port libre
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function startHttpApi(options) {
  const cfg = options.config && options.config.httpApi ? options.config.httpApi : {};
  if (!cfg.enabled) {
    console.log('[http-api] disabled');
    return null;
  }

  const host = cfg.host || '127.0.0.1';
  const port = Number(cfg.port) || 17891;

  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
    } catch (_) {
      jsonResponse(res, 400, { ok: false, error: 'Bad request URL' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      jsonResponse(res, 200, {
        ok: true,
        service: 'AgentDockyard HTTP API',
        version: options.version,
        time: new Date().toISOString(),
      });
      return;
    }

    if (req.method !== 'POST' || url.pathname !== '/api/agentdockyard') {
      jsonResponse(res, 404, { ok: false, error: 'Not found' });
      return;
    }

    if (!hasValidToken(req, cfg)) {
      jsonResponse(res, 401, { ok: false, error: 'Invalid token' });
      return;
    }

    let payload;
    try {
      payload = await readJsonBody(req);
    } catch (err) {
      jsonResponse(res, err.statusCode || 400, { ok: false, error: err.message });
      return;
    }

    const result = await callAgentRaw(payload, options);
    const ok = agentCallSucceeded(result);
    jsonResponse(res, ok ? 200 : 500, {
      ok,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      payload,
    });
  });

  server.on('error', (err) => {
    console.error(`[http-api] listen failed on ${host}:${port}:`, err && err.message);
  });

  // Ne demarrer que si aucun autre AgentDockyard ne tient deja le port (cf.
  // probeHealth). Sinon on laisse l'instance existante seule maitre du port pour
  // eviter que des appels d'agents tombent sur la mauvaise base.
  probeHealth(host, port, 1500).then((alreadyRunning) => {
    if (alreadyRunning) {
      console.warn(`[http-api] un AgentDockyard repond deja sur ${host}:${port} — serveur HTTP non demarre pour cette instance`);
      return;
    }
    server.listen(port, host, () => {
      console.log(`[http-api] listening on http://${host}:${port}`);
    });
  });

  return server;
}

module.exports = { startHttpApi };
