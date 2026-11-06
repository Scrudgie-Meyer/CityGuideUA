/** Domain and RDF functions shared by the browser and deterministic tests. */
export const IDS = [
  'Q1899',
  'Q36036',
  'Q1874',
  'Q42308',
  'Q48256',
  'Q157835',
  'Q157055',
  'Q157144',
  'Q157053',
  'Q43070',
  'Q156713',
  'Q156726',
];
export const POPULATION_QUERY = `PREFIX cg: <https://example.org/cityguide/>
PREFIX schema: <https://schema.org/>
SELECT ?city ?name ?population WHERE {
  ?city schema:name ?name;
    cg:populationObservation/schema:value ?population.
  FILTER (?population >= 500000)
} ORDER BY DESC(?population)`;

/** Select non-deprecated value claims, preferring the preferred Wikidata rank. */
export function claims(entity, property) {
  const rows = (entity.claims?.[property] ?? []).filter(
    (c) => c.rank !== 'deprecated' && c.mainsnak?.snaktype === 'value',
  );
  const preferred = rows.filter((c) => c.rank === 'preferred');
  return preferred.length ? preferred : rows;
}
/** Return the latest P585 qualifier, retaining Wikibase date precision. */
function claimDate(c) {
  return (
    (c.qualifiers?.P585 ?? [])
      .map((q) => q.datavalue?.value?.time ?? '')
      .sort()
      .at(-1) ?? ''
  );
}
/** Convert a Ukrainian Wikidata entity into a validated domain record. */
export function parseCity(entity, fetchedAt) {
  if (!/^Q[1-9]\d*$/.test(entity.id)) {
    throw new Error('Некоректний ідентифікатор міста');
  }
  if (!claims(entity, 'P17').some((c) => c.mainsnak.datavalue.value.id === 'Q212')) {
    throw new Error('Країна міста не відповідає каталогу');
  }
  const point = claims(entity, 'P625')[0]?.mainsnak.datavalue.value;
  if (
    point &&
    (!Number.isFinite(point.latitude) ||
      !Number.isFinite(point.longitude) ||
      Math.abs(point.latitude) > 90 ||
      Math.abs(point.longitude) > 180)
  ) {
    throw new Error('Некоректні координати');
  }
  const pops = claims(entity, 'P1082').sort((a, b) => claimDate(b).localeCompare(claimDate(a)));
  const population = pops.length ? Number(pops[0].mainsnak.datavalue.value.amount) : null;
  if (population !== null && (!Number.isSafeInteger(population) || population < 0)) {
    throw new Error('Некоректне населення');
  }
  return {
    qid: entity.id,
    name: entity.labels?.uk?.value ?? entity.labels?.en?.value ?? entity.id,
    description: entity.descriptions?.uk?.value ?? entity.descriptions?.en?.value ?? '',
    latitude: point?.latitude ?? null,
    longitude: point?.longitude ?? null,
    population,
    population_date: pops.length ? claimDate(pops[0]) || null : null,
    revision: entity.lastrevid ?? 0,
    fetched_at: fetchedAt,
  };
}
/** Validate a growing catalogue; optionally require an exact import batch. */
export function validateSnapshot(snapshot, { expectedIds } = {}) {
  if (
    !snapshot ||
    !Array.isArray(snapshot.cities) ||
    snapshot.cities.length === 0 ||
    !Number.isFinite(Date.parse(snapshot.fetched_at))
  ) {
    throw new Error('Некоректний знімок');
  }
  const ids = new Set(snapshot.cities.map((c) => c.qid));
  if (ids.size !== snapshot.cities.length) {
    throw new Error('Повторювані ідентифікатори');
  }
  if (expectedIds && (ids.size !== expectedIds.length || expectedIds.some((id) => !ids.has(id)))) {
    throw new Error('Неповний знімок');
  }
  for (const c of snapshot.cities) {
    if (
      !/^Q[1-9]\d*$/.test(c.qid) ||
      typeof c.name !== 'string' ||
      !c.name.trim() ||
      typeof c.description !== 'string' ||
      !Number.isInteger(c.revision) ||
      c.revision < 0 ||
      !Number.isFinite(Date.parse(c.fetched_at))
    ) {
      throw new Error('Некоректний запис');
    }
    if (c.population !== null && (!Number.isSafeInteger(c.population) || c.population < 0)) {
      throw new Error('Некоректне населення');
    }
    if ((c.latitude === null) !== (c.longitude === null)) {
      throw new Error('Неповні координати');
    }
    if (
      c.latitude !== null &&
      (!Number.isFinite(c.latitude) ||
        !Number.isFinite(c.longitude) ||
        Math.abs(c.latitude) > 90 ||
        Math.abs(c.longitude) > 180)
    ) {
      throw new Error('Некоректні координати');
    }
    if (c.population_date !== null && typeof c.population_date !== 'string') {
      throw new Error('Некоректна дата');
    }
  }
  return snapshot;
}
/** Format year/month/day precision without inventing zero months or days. */
export function dateLabel(value) {
  if (!value) {
    return 'Дату не вказано';
  }
  return value
    .replace(/^\+/, '')
    .split('T')[0]
    .replace(/-00-00$/, '')
    .replace(/-00$/, '');
}
/** Return a new Unicode-filtered catalogue in the selected display order. */
export function selectCities(
  cities,
  { search = '', savedOnly = false, saved = new Set(), sort = 'name' } = {},
) {
  const needle = search.trim().toLocaleLowerCase('uk');
  return cities
    .filter(
      (c) =>
        (c.name + ' ' + c.description).toLocaleLowerCase('uk').includes(needle) &&
        (!savedOnly || saved.has(c.qid)),
    )
    .sort((a, b) =>
      sort === 'population'
        ? (b.population ?? -1) - (a.population ?? -1)
        : a.name.localeCompare(b.name, 'uk'),
    );
}
/** N-Triples is a subset of Turtle, so exports remain readable by RDFLib. */
export function buildRdf(cities) {
  const rows = [],
    schema = 'https://schema.org/',
    prov = 'http://www.w3.org/ns/prov#',
    cg = 'https://example.org/cityguide/';
  const add = (s, p, o) => rows.push(`<${s}> <${p}> ${o} .`);
  const literal = (v) => JSON.stringify(String(v)).replace(/\u007f/g, '\\u007f');
  for (const c of cities) {
    const s = `http://www.wikidata.org/entity/${c.qid}`;
    add(s, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', `<${schema}City>`);
    add(s, schema + 'name', literal(c.name) + '@uk');
    add(s, schema + 'description', literal(c.description));
    add(s, 'http://www.wikidata.org/prop/direct/P17', '<http://www.wikidata.org/entity/Q212>');
    add(
      s,
      prov + 'wasDerivedFrom',
      `<https://www.wikidata.org/w/index.php?title=${c.qid}&oldid=${c.revision}>`,
    );
    add(
      s,
      prov + 'generatedAtTime',
      literal(c.fetched_at) + '^^<http://www.w3.org/2001/XMLSchema#dateTime>',
    );
    if (c.latitude !== null) {
      add(
        s,
        schema + 'latitude',
        literal(c.latitude) + '^^<http://www.w3.org/2001/XMLSchema#double>',
      );
      add(
        s,
        schema + 'longitude',
        literal(c.longitude) + '^^<http://www.w3.org/2001/XMLSchema#double>',
      );
    }
    if (c.population !== null) {
      const obs = cg + c.qid + '/population';
      add(s, cg + 'populationObservation', `<${obs}>`);
      add(obs, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', `<${schema}Observation>`);
      add(
        obs,
        schema + 'value',
        literal(c.population) + '^^<http://www.w3.org/2001/XMLSchema#integer>',
      );
      if (c.population_date) {
        add(obs, schema + 'observationDate', literal(c.population_date));
      }
    }
  }
  return rows.join('\n') + '\n';
}
