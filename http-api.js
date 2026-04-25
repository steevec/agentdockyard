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
    let body = '';
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        body = '';
        req.resume();
        reject(Object.assign(new Error('Body too large'), { statusCode: 413 }));
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(body || '{}'));
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
      child = spawn(bin, args);
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

function startHttpApi(options) {
  const cfg = options.config && options.config.httpApi ? options.config.httpApi : {};
  if (!cfg.enabled) {
    console.log('[http-api] disabled');
    return null;
  }

  const host = cfg.host || '127.0.0.1';
  const port = Number(cfg.port) || 17891;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);

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

  server.listen(port, host, () => {
    console.log(`[http-api] listening on http://${host}:${port}`);
  });

  return server;
}

module.exports = { startHttpApi };
