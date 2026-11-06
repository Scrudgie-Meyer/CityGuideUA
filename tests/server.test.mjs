import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server.mjs';
import { CityRepository } from '../src/data/city-repository.mjs';

test('production HTTP server serves the app and isolates static files', async (t) => {
  const repository = new CityRepository(':memory:');
  const server = createAppServer({ repository });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    repository.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  await t.test('health endpoint', async () => {
    const r = await fetch(base + '/healthz');
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { status: 'ok' });
  });
  await t.test('real HTML and module MIME types', async () => {
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /CityGuide UA/);
    const js = await fetch(base + '/app.js');
    assert.match(js.headers.get('content-type'), /javascript/);
    assert.equal(js.headers.get('x-content-type-options'), 'nosniff');
    await js.body.cancel();
  });
  await t.test('real snapshot and WASM payload', async () => {
    const json = await fetch(base + '/cities.json');
    assert.equal((await json.json()).cities.length, 12);
    const wasm = await fetch(base + '/vendor/web_bg.wasm');
    assert.equal(wasm.status, 200);
    assert.equal(wasm.headers.get('content-type'), 'application/wasm');
    const bytes = new Uint8Array(await wasm.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 4)], [0, 97, 115, 109]);
  });
  await t.test('HEAD works without a response body', async () => {
    const r = await fetch(base + '/index.html', { method: 'HEAD' });
    assert.equal(r.status, 200);
    assert.ok(Number(r.headers.get('content-length')) > 0);
    assert.equal(await r.text(), '');
  });
  await t.test('missing files and private project files stay private', async () => {
    for (const route of ['/missing', '/package.json', '/.git/config', '/server.mjs']) {
      const r = await fetch(base + route);
      assert.equal(r.status, 404, route);
    }
  });
  await t.test('encoded traversal rejected', async () => {
    const r = await fetch(base + '/%2e%2e%2fpackage.json');
    assert.equal(r.status, 400);
  });
  await t.test('POST rejected', async () => {
    const r = await fetch(base + '/healthz', { method: 'POST' });
    assert.equal(r.status, 405);
    assert.equal(r.headers.get('allow'), 'GET, HEAD');
  });
  await t.test('catalogue API reads the seeded database', async () => {
    const r = await fetch(base + '/api/cities');
    const body = await r.json();
    assert.equal(body.cityCount, 12);
    assert.equal(body.tripleCount, 144);
    assert.equal(body.cities.length, 12);
  });
  await t.test('RDF export reads persistent triples', async () => {
    const r = await fetch(base + '/api/graph');
    assert.match(r.headers.get('content-type'), /turtle/);
    assert.match(r.headers.get('content-disposition'), /attachment/);
    assert.equal((await r.text()).trim().split('\n').length, 144);
  });
  await t.test('SPARQL runs on the server', async () => {
    const r = await fetch(base + '/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'SELECT ?s WHERE { ?s ?p ?o } LIMIT 1' }),
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).rows.length, 1);
  });
  await t.test('invalid JSON and query return 400', async () => {
    for (const body of ['{', JSON.stringify({ query: 'invalid' })]) {
      const r = await fetch(base + '/api/query', { method: 'POST', body });
      assert.equal(r.status, 400);
    }
  });
  await t.test('large JSON bodies are rejected before query execution', async () => {
    const r = await fetch(base + '/api/query', {
      method: 'POST',
      body: JSON.stringify({ query: 'x'.repeat(40000) }),
    });
    assert.equal(r.status, 413);
  });
});
