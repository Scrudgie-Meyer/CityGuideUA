/** Browser data-access module tested in Node with replaced fetch and localStorage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { executeQuery, getCatalogue, loadFavourites, saveFavourites } from '../dist/api.js';

const key = 'cityguide-web-favourites-v1';

/** Minimal in-memory replacement for the browser localStorage. */
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (name) => (data.has(name) ? data.get(name) : null),
    setItem: (name, value) => data.set(name, String(value)),
  };
}

test('favourites keep only valid Wikidata identifiers', () => {
  globalThis.localStorage = fakeStorage({ [key]: JSON.stringify(['Q1899', 'bad', 'Q0', 42]) });
  assert.deepEqual([...loadFavourites()], ['Q1899']);
});

test('broken or missing storage values give an empty selection', () => {
  globalThis.localStorage = fakeStorage({ [key]: '{not json' });
  assert.equal(loadFavourites().size, 0);
  globalThis.localStorage = fakeStorage();
  assert.equal(loadFavourites().size, 0);
});

test('saving favourites reports unavailable storage', () => {
  globalThis.localStorage = fakeStorage();
  assert.equal(saveFavourites(new Set(['Q1899'])), true);
  assert.deepEqual([...loadFavourites()], ['Q1899']);
  globalThis.localStorage = {
    setItem: () => {
      throw new Error('quota exceeded');
    },
  };
  assert.equal(saveFavourites(new Set(['Q1899'])), false);
});

test('API errors use the server message or a fallback', async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: 'Зачекайте' }) });
  await assert.rejects(getCatalogue(), /Зачекайте/);
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
  await assert.rejects(getCatalogue(), /Сервер тимчасово недоступний/);
});

test('SPARQL query is sent as a JSON POST request', async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  let sent;
  globalThis.fetch = async (url, options) => {
    sent = { url, options };
    return { ok: true, json: async () => ({ rows: [] }) };
  };
  assert.deepEqual(await executeQuery('SELECT * WHERE {}'), { rows: [] });
  assert.equal(sent.url, '/api/query');
  assert.equal(sent.options.method, 'POST');
  assert.deepEqual(JSON.parse(sent.options.body), { query: 'SELECT * WHERE {}' });
});
