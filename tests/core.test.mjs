import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  IDS,
  parseCity,
  dateLabel,
  selectCities,
  validateSnapshot,
  buildRdf,
  POPULATION_QUERY,
} from '../dist/core.js';
const data = JSON.parse(fs.readFileSync(new URL('../dist/cities.json', import.meta.url), 'utf8'));
test('all 12 expected real city IDs and provenance are preserved', () => {
  assert.equal(validateSnapshot(data), data);
  assert.deepEqual(new Set(data.cities.map((c) => c.qid)), new Set(IDS));
});
test('Unicode search, absent result and population sort', () => {
  assert.equal(selectCities(data.cities, { search: 'ЛЬВІВ' })[0].qid, 'Q36036');
  assert.equal(selectCities(data.cities, { search: 'no-such-city' }).length, 0);
  assert.equal(selectCities(data.cities, { sort: 'population' })[0].qid, 'Q1899');
});
test('favourites filter', () => {
  assert.deepEqual(
    selectCities(data.cities, { savedOnly: true, saved: new Set(['Q1899']) }).map((c) => c.qid),
    ['Q1899'],
  );
});
test('Wikibase year and month precision', () => {
  assert.equal(dateLabel('+2022-00-00T00:00:00Z'), '2022');
  assert.equal(dateLabel('+2022-01-00T00:00:00Z'), '2022-01');
  assert.equal(dateLabel(null), 'Дату не вказано');
});
test('incomplete expected batches and duplicate snapshots do not pass validation', () => {
  assert.throws(() =>
    validateSnapshot({ ...data, cities: data.cities.slice(1) }, { expectedIds: IDS }),
  );
  assert.throws(() => validateSnapshot({ ...data, cities: Array(12).fill(data.cities[0]) }));
});
test('negative population and invalid coordinates rejected', () => {
  for (const patch of [{ population: -1 }, { latitude: 95 }, { latitude: null, longitude: 30 }]) {
    const cities = structuredClone(data.cities);
    Object.assign(cities[0], patch);
    assert.throws(() => validateSnapshot({ ...data, cities }));
  }
});
test('real source conversion agrees with original Python importer', () => {
  const raw = JSON.parse(
    fs.readFileSync(new URL('./wikidata-fixture.json', import.meta.url), 'utf8'),
  );
  for (const expected of data.cities) {
    assert.deepEqual(parseCity(raw.entities[expected.qid], raw.fetched_at), expected);
  }
});
test('RDF contains exactly 144 statements and dated observations', () => {
  const rdf = buildRdf(data.cities);
  assert.equal(rdf.trim().split('\n').length, 144);
  assert.match(rdf, /Observation/);
  assert.match(rdf, /oldid=/);
});
test('actual browser WASM SPARQL execution and Turtle parsing', async () => {
  const { Store, initSync } = await import('../dist/vendor/web.js');
  initSync({ module: fs.readFileSync(new URL('../dist/vendor/web_bg.wasm', import.meta.url)) });
  const store = new Store();
  store.load(buildRdf(data.cities), { format: 'text/turtle' });
  assert.equal(store.size, 144);
  const rows = store.query(POPULATION_QUERY);
  assert.equal(rows.length, 7);
  assert.equal(rows[0].get('name').value, 'Київ');
  assert.equal(Number(rows[0].get('population').value), 2952301);
  assert.throws(() => store.query('invalid SPARQL'));
  const second = new Store(store.match());
  assert.equal(second.size, 144);
});
