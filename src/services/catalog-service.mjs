/** Application layer coordinating domain validation, persistent storage and SPARQL. */
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { WikidataClient } from '../open-data/wikidata-client.mjs';

/** Keep use cases independent of HTTP handlers and browser DOM. */
export class CatalogService {
  /** Inject repository/client so tests use real SQLite without external requests. */
  constructor(
    repository,
    {
      client = new WikidataClient(),
      seedPath = new URL('../../dist/cities.json', import.meta.url),
      queryTimeoutMs = 5000,
    } = {},
  ) {
    this.repository = repository;
    this.client = client;
    this.queryTimeoutMs = queryTimeoutMs;
    this.importing = false;
    this.querying = false;
    this.lastRefresh = 0;
    if (!repository.stats().cities) {
      repository.upsertBatch(JSON.parse(readFileSync(seedPath, 'utf8')));
    }
  }

  /** Read the current committed catalogue and persistent graph counts. */
  catalogue() {
    const stats = this.repository.stats();
    return { ...this.repository.snapshot(), cityCount: stats.cities, tripleCount: stats.triples };
  }

  /** Refresh every already stored QID while retaining the old graph on any failure. */
  async refresh() {
    if (Date.now() - this.lastRefresh < 60000) {
      throw Object.assign(new Error('Зачекайте хвилину перед повторним оновленням'), {
        status: 429,
      });
    }
    this.lastRefresh = Date.now();
    return this.importCities(this.repository.listCities().map((city) => city.qid));
  }

  /** Add or update a batch; records outside the batch remain in the catalogue. */
  async importCities(ids) {
    if (this.importing) {
      throw Object.assign(new Error('Імпорт уже виконується'), { status: 409 });
    }
    this.importing = true;
    try {
      const { snapshot, entities } = await this.client.fetchCities(ids);
      return this.repository.upsertBatch(snapshot, entities);
    } finally {
      this.importing = false;
    }
  }

  /** Return RDF directly from persistent storage. */
  exportRdf() {
    return this.repository.exportRdf();
  }

  /** Run one bounded SELECT at a time, keeping the HTTP event loop responsive. */
  async query(source) {
    if (typeof source !== 'string' || !source.trim() || source.length > 8192) {
      throw Object.assign(new Error('Некоректна довжина SPARQL-запиту'), { status: 400 });
    }
    if (/\bSERVICE\b/i.test(source)) {
      throw Object.assign(new Error('Віддалений SERVICE вимкнено'), { status: 400 });
    }
    if (this.querying) {
      throw Object.assign(new Error('Інший запит ще виконується'), { status: 429 });
    }
    this.querying = true;
    try {
      return await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./sparql-worker.mjs', import.meta.url), {
          execArgv: [],
          workerData: { rdf: this.exportRdf(), query: source },
          resourceLimits: { maxOldGenerationSizeMb: 128 },
        });
        let finished = false;
        const done = (error, value) => {
          if (finished) {
            return;
          }
          finished = true;
          clearTimeout(timer);
          void worker.terminate();
          error ? reject(error) : resolve(value);
        };
        const timer = setTimeout(
          () => done(Object.assign(new Error('Час виконання запиту вичерпано'), { status: 408 })),
          this.queryTimeoutMs,
        );
        worker.once('message', (message) =>
          message.error
            ? done(Object.assign(new Error(message.error), { status: 400 }))
            : done(null, message),
        );
        worker.once('error', () => done(new Error('SPARQL worker failed')));
        worker.once('exit', () => {
          if (!finished) {
            done(new Error('SPARQL worker exited unexpectedly'));
          }
        });
      });
    } finally {
      this.querying = false;
    }
  }
}
