/** Isolated read-only SPARQL execution; the parent terminates overlong queries. */
import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { initSync, Store } from '../../dist/vendor/web.js';

try {
  initSync({ module: readFileSync(new URL('../../dist/vendor/web_bg.wasm', import.meta.url)) });
  const store = new Store();
  store.load(workerData.rdf, { format: 'application/n-triples' });
  const result = store.query(workerData.query);
  if (!Array.isArray(result) || result.some((row) => !(row instanceof Map))) {
    throw new Error('Використайте SELECT-запит');
  }
  const variables = [...new Set(result.flatMap((row) => [...row.keys()]))];
  const rows = result
    .slice(0, 200)
    .map((row) =>
      Object.fromEntries(
        [...row].map(([key, value]) => [key, { value: value.value, termType: value.termType }]),
      ),
    );
  parentPort.postMessage({ variables, rows, total: result.length, triples: store.size });
  store.free();
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
