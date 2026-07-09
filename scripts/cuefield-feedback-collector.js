#!/usr/bin/env node
const http = require('http');
const path = require('path');

const { appendCuefieldFeedback, readCuefieldFeedbackStats } = require('../cuefield/feedback-log');

const PORT = Number(process.env.CUEFIELD_FEEDBACK_COLLECTOR_PORT || 3787);
const HOST = process.env.CUEFIELD_FEEDBACK_COLLECTOR_HOST || '127.0.0.1';
const TOKEN = process.env.CUEFIELD_FEEDBACK_COLLECTOR_TOKEN || '';
const FILE = process.env.CUEFIELD_FEEDBACK_COLLECTOR_FILE || path.join(process.cwd(), 'data', 'cuefield-remote-feedback.jsonl');
const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function isAuthorized(req) {
  if (!TOKEN) return true;
  return req.headers.authorization === `Bearer ${TOKEN}`;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (!isAuthorized(req)) {
    sendJson(res, 401, { ok: false, error: 'UNAUTHORIZED' });
    return;
  }
  if (req.method === 'GET') {
    sendJson(res, 200, { ok: true, stats: readCuefieldFeedbackStats(FILE) });
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
    return;
  }
  try {
    const body = await readJsonBody(req);
    const input = body && body.record ? body.record : body;
    const record = appendCuefieldFeedback(FILE, input);
    sendJson(res, 202, { ok: true, record });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err && err.message ? err.message : 'FEEDBACK_COLLECT_FAILED' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Cuefield feedback collector listening on http://${HOST}:${PORT}`);
  console.log(`Writing feedback to ${FILE}`);
});
