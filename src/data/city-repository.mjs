/** SQLite data-access layer. The database, rather than a browser cache, owns the graph. */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildRdf, validateSnapshot } from '../../dist/core.js';

const columns = [
  'qid',
  'name',
  'description',
  'latitude',
  'longitude',
  'population',
  'population_date',
  'revision',
  'fetched_at',
];

/** Persist cities, raw source entities, import revisions and indexed RDF triples. */
export class CityRepository {
  /** Open a file or an isolated in-memory database, then apply schema migration 1. */
  constructor(filename) {
    if (filename !== ':memory:') {
      mkdirSync(dirname(filename), { recursive: true });
    }
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) {
      this.db.close();
      throw new Error('Unsupported database schema version');
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cities (
        qid TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
        latitude REAL CHECK(latitude BETWEEN -90 AND 90),
        longitude REAL CHECK(longitude BETWEEN -180 AND 180),
        population INTEGER CHECK(population >= 0), population_date TEXT,
        revision INTEGER NOT NULL CHECK(revision >= 0), fetched_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS cities_population ON cities(population);
      CREATE TABLE IF NOT EXISTS source_entities (
        qid TEXT PRIMARY KEY REFERENCES cities(qid) ON DELETE CASCADE,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rdf_triples (
        subject TEXT NOT NULL, predicate TEXT NOT NULL, object TEXT NOT NULL,
        PRIMARY KEY(subject, predicate, object)
      );
      CREATE INDEX IF NOT EXISTS rdf_predicate_object ON rdf_triples(predicate, object);
      CREATE TABLE IF NOT EXISTS catalog_state (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        revision INTEGER NOT NULL, fetched_at TEXT NOT NULL
      );
      PRAGMA user_version=1;
    `);
  }

  /** Read normalized records; caller never receives a live SQLite statement. */
  listCities() {
    return this.db
      .prepare('SELECT * FROM cities ORDER BY qid')
      .all()
      .map((row) => ({ ...row }));
  }

  /** Return a consistent catalogue version for API responses and graph cache keys. */
  snapshot() {
    const state = this.db
      .prepare('SELECT revision, fetched_at FROM catalog_state WHERE singleton=1')
      .get();
    return {
      revision: state?.revision ?? 0,
      fetched_at: state?.fetched_at ?? null,
      cities: this.listCities(),
    };
  }

  /** Merge an entire validated import and rebuild its RDF projection atomically. */
  upsertBatch(snapshot, entities = {}) {
    validateSnapshot(snapshot);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const insert = this.db.prepare(
        `INSERT INTO cities (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')}) ON CONFLICT(qid) DO UPDATE SET ${columns
          .slice(1)
          .map((c) => `${c}=excluded.${c}`)
          .join(',')}`,
      );
      const source = this.db.prepare(
        'INSERT INTO source_entities(qid,payload) VALUES(?,?) ON CONFLICT(qid) DO UPDATE SET payload=excluded.payload',
      );
      for (const city of snapshot.cities) {
        insert.run(...columns.map((c) => city[c]));
        if (entities[city.qid]) {
          source.run(city.qid, JSON.stringify(entities[city.qid]));
        }
      }
      const rdf = buildRdf(this.listCities());
      this.db.exec('DELETE FROM rdf_triples');
      const triple = this.db.prepare('INSERT INTO rdf_triples VALUES (?,?,?)');
      for (const line of rdf.trim().split('\n')) {
        const match = /^<([^>]+)> <([^>]+)> (.+) \.$/.exec(line);
        if (!match) {
          throw new Error('Invalid generated RDF statement');
        }
        triple.run(match[1], match[2], match[3]);
      }
      this.db
        .prepare(
          `INSERT INTO catalog_state VALUES(1,1,?) ON CONFLICT(singleton) DO UPDATE SET revision=revision+1, fetched_at=excluded.fetched_at`,
        )
        .run(snapshot.fetched_at);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.snapshot();
  }

  /** Serialize the persisted triple table, without rebuilding it from browser data. */
  exportRdf() {
    return (
      this.db
        .prepare('SELECT * FROM rdf_triples ORDER BY subject,predicate,object')
        .all()
        .map((row) => `<${row.subject}> <${row.predicate}> ${row.object} .`)
        .join('\n') + '\n'
    );
  }

  /** Expose small database counts for catalogue metadata and operational checks. */
  stats() {
    return {
      cities: this.db.prepare('SELECT count(*) AS count FROM cities').get().count,
      triples: this.db.prepare('SELECT count(*) AS count FROM rdf_triples').get().count,
    };
  }

  /** Return the preserved source entity when a live import has fetched it. */
  sourceEntity(qid) {
    const row = this.db.prepare('SELECT payload FROM source_entities WHERE qid=?').get(qid);
    return row ? JSON.parse(row.payload) : null;
  }

  /** Create a consistent online backup, including committed WAL transactions. */
  backup(destination) {
    this.db.prepare('VACUUM INTO ?').run(destination);
  }

  /** Release the SQLite handle during application shutdown. */
  close() {
    this.db.close();
  }
}
