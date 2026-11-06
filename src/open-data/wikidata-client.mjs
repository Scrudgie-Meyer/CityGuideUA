/** External-data boundary: bounded Wikidata requests and pure domain conversion. */
import { parseCity, validateSnapshot } from '../../dist/core.js';

/** Download complete batches; a failed request never partially updates SQLite. */
export class WikidataClient {
  /** Allow HTTP injection for deterministic failure tests without contacting Wikidata. */
  constructor({ fetchImpl = fetch } = {}) {
    this.fetch = fetchImpl;
  }

  /** Fetch arbitrary valid QIDs in batches of 50, preserving raw entities and revisions. */
  async fetchCities(ids) {
    if (
      !ids.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !/^Q[1-9]\d*$/.test(id))
    ) {
      throw new Error('Invalid Wikidata identifiers');
    }
    const entities = {};
    for (let i = 0; i < ids.length; i += 50) {
      const params = new URLSearchParams({
        action: 'wbgetentities',
        ids: ids.slice(i, i + 50).join('|'),
        props: 'info|labels|descriptions|claims',
        languages: 'uk|en',
        format: 'json',
      });
      const response = await this.fetch('https://www.wikidata.org/w/api.php?' + params, {
        signal: AbortSignal.timeout(35000),
        headers: {
          'User-Agent': 'CityGuideUA/2.0 (educational linked-data catalogue)',
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error(`Wikidata HTTP ${response.status}`);
      }
      const body = await response.json();
      if (body.error || !body.entities) {
        throw new Error('Invalid Wikidata response');
      }
      Object.assign(entities, body.entities);
    }
    const fetched_at = new Date().toISOString();
    const snapshot = validateSnapshot(
      { fetched_at, cities: ids.map((id) => parseCity(entities[id] ?? {}, fetched_at)) },
      { expectedIds: ids },
    );
    return { snapshot, entities };
  }
}
