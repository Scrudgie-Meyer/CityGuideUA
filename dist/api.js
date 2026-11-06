/** Browser data-access layer: server-owned catalogue and local private favourites. */
const savedKey = 'cityguide-web-favourites-v1';

/** Decode API errors without leaking HTTP details into view code. */
async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? 'Сервер тимчасово недоступний');
  }
  return data;
}

/** Read the committed catalogue from the server database. */
export function getCatalogue() {
  return request('/api/cities');
}

/** Refresh shared records through the server's Wikidata ingestion module. */
export function refreshCatalogue() {
  return request('/api/refresh', { method: 'POST' });
}

/** Execute a bounded SELECT against the server's persisted RDF graph. */
export function executeQuery(query) {
  return request('/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
}

/** Recover valid favourite identifiers from browser storage. */
export function loadFavourites() {
  try {
    const value = JSON.parse(localStorage.getItem(savedKey));
    return new Set(Array.isArray(value) ? value.filter((id) => /^Q[1-9]\d*$/.test(id)) : []);
  } catch {
    return new Set();
  }
}

/** Persist a private selection; report when browser storage is unavailable. */
export function saveFavourites(ids) {
  try {
    localStorage.setItem(savedKey, JSON.stringify([...ids]));
    return true;
  } catch {
    return false;
  }
}
