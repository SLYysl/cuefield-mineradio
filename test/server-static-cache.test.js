const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('static app shell assets are served without browser caching', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(server, /function staticCacheHeaders/);
  assert.match(server, /no-store, no-cache, must-revalidate, proxy-revalidate/);
  assert.match(server, /ext === '\.html'/);
  assert.match(server, /ext === '\.js'/);
  assert.match(server, /ext === '\.css'/);
});
