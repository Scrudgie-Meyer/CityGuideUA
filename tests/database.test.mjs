import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { CityRepository } from '../src/data/city-repository.mjs';
import { CatalogService } from '../src/services/catalog-service.mjs';
import { WikidataClient } from '../src/open-data/wikidata-client.mjs';
import { databasePath, projectRoot } from '../src/config.mjs';
import { POPULATION_QUERY } from '../dist/core.js';

const seed = JSON.parse(readFileSync(new URL('../dist/cities.json', import.meta.url), 'utf8'));
const raw = JSON.parse(readFileSync(new URL('./wikidata-fixture.json', import.meta.url), 'utf8'));

test('SQLite persists catalogue growth and RDF across closing and reopening', () => {
  const directory = mkdtempSync(path.join(projectRoot, '.cache-db-test-'));
  try {
    let r = new CityRepository(path.join(directory, 'catalog.sqlite'));
    r.upsertBatch(seed);
    // This synthetic extra record tests expansion, and is never shipped as catalogue data.
    const extra = { ...seed.cities[0], qid: 'Q999999999', name: 'Тестове місто' };
    r.upsertBatch({ fetched_at: seed.fetched_at, cities: [extra] });
    assert.deepEqual(r.stats(), { cities: 13, triples: 156 });
    r.close();
    r = new CityRepository(path.join(directory, 'catalog.sqlite'));
    assert.equal(r.listCities().find((c) => c.qid === extra.qid).name, extra.name);
    assert.equal(r.snapshot().revision, 2);
    assert.equal(r.stats().triples, 156);
    const service = new CatalogService(r);
    assert.equal(service.catalogue().cityCount, 13);
    r.backup(path.join(directory, 'backup.sqlite'));
    r.close();
    const backup = new CityRepository(path.join(directory, 'backup.sqlite'));
    assert.equal(backup.stats().cities, 13);
    backup.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('mid-transaction source serialization failure rolls back cities, graph and revision', () => {
  const r = new CityRepository(':memory:');
  try {
    r.upsertBatch(seed);
    const before = r.exportRdf();
    const city = { ...seed.cities[0], name: 'Changed' };
    const circular = {};
    circular.self = circular;
    assert.throws(() =>
      r.upsertBatch({ fetched_at: seed.fetched_at, cities: [city] }, { [city.qid]: circular }),
    );
    assert.equal(r.exportRdf(), before);
    assert.equal(r.snapshot().revision, 1);
  } finally {
    r.close();
  }
});

test('failed network refresh preserves catalogue and raw sources', async () => {
  const r = new CityRepository(':memory:');
  try {
    const service = new CatalogService(r, {
      client: {
        fetchCities: async () => {
          throw new Error('offline');
        },
      },
    });
    await assert.rejects(service.refresh(), /offline/);
    assert.deepEqual(r.stats(), { cities: 12, triples: 144 });
  } finally {
    r.close();
  }
});

test('Wikidata client converts genuine fixtures and rejects an incomplete batch', async () => {
  const good = new WikidataClient({
    fetchImpl: async () => ({ ok: true, json: async () => ({ entities: raw.entities }) }),
  });
  const result = await good.fetchCities(['Q1899', 'Q36036']);
  assert.equal(result.snapshot.cities.length, 2);
  const r = new CityRepository(':memory:');
  try {
    r.upsertBatch(result.snapshot, result.entities);
    assert.equal(r.sourceEntity('Q1899').lastrevid, raw.entities.Q1899.lastrevid);
  } finally {
    r.close();
  }
  const missing = new WikidataClient({
    fetchImpl: async () => ({ ok: true, json: async () => ({ entities: {} }) }),
  });
  await assert.rejects(missing.fetchCities(['Q1899']));
  await assert.rejects(good.fetchCities(['not-a-QID']));
});

test('worker queries persisted RDF and rejects external/overlong/invalid queries', async () => {
  const r = new CityRepository(':memory:');
  try {
    const s = new CatalogService(r);
    const result = await s.query(POPULATION_QUERY);
    assert.equal(result.total, 7);
    assert.equal(result.rows[0].name.value, 'Київ');
    await assert.rejects(s.query('SELECT * WHERE { SERVICE <https://example.org> { ?s ?p ?o } }'));
    await assert.rejects(s.query('x'.repeat(8193)));
    await assert.rejects(s.query('invalid SPARQL'));
    const timeout = new CatalogService(r, { queryTimeoutMs: 1 });
    await assert.rejects(timeout.query(POPULATION_QUERY), /вичерпано/);
  } finally {
    r.close();
  }
});

test('Railway refuses to use an ephemeral database without a volume', () => {
  assert.throws(() => databasePath({ RAILWAY_ENVIRONMENT_ID: 'test' }), /Volume/);
  assert.equal(
    databasePath({ RAILWAY_VOLUME_MOUNT_PATH: '/persistent' }),
    path.join('/persistent', 'cityguide.sqlite'),
  );
});
