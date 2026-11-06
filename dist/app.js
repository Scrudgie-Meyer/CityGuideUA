import { IDS, POPULATION_QUERY, dateLabel, selectCities } from './core.js';
import {
  getCatalogue,
  refreshCatalogue,
  executeQuery,
  loadFavourites,
  saveFavourites,
} from './api.js';
const $ = (id) => document.getElementById(id),
  format = new Intl.NumberFormat('uk-UA');
let snapshot,
  saved = new Set(),
  savedOnly = false,
  working = false;
const palettes = [
  ['#dce6d5', '#4a6a48'],
  ['#e6dfcb', '#8c7b50'],
  ['#d9e6e4', '#4f7772'],
  ['#e4e5d7', '#7a8059'],
  ['#e7ddd2', '#957855'],
  ['#dde3ea', '#647c92'],
];
/** Create a DOM node using textContent rather than interpolated HTML. */
function el(tag, text, className) {
  const n = document.createElement(tag);
  if (text !== undefined) {
    n.textContent = text;
  }
  if (className) {
    n.className = className;
  }
  return n;
}
/** Show an accessible operation result without replacing catalogue content. */
function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
/** Toggle a private favourite and update visible cards. */
function toggle(qid) {
  saved.has(qid) ? saved.delete(qid) : saved.add(qid);
  if (!saveFavourites(saved)) {
    status('Браузер не дозволив зберегти обране. Вибір діятиме до закриття сторінки.', true);
  }
  render();
}
/** Switch the all/saved view and its accessible pressed state. */
function setFilter(only) {
  savedOnly = only;
  $('all-tab').classList.toggle('active', !only);
  $('saved-tab').classList.toggle('active', only);
  $('all-tab').setAttribute('aria-pressed', String(!only));
  $('saved-tab').setAttribute('aria-pressed', String(only));
  render();
}
/** Render the current filtered catalogue and data provenance. */
function render() {
  if (!snapshot) {
    return;
  }
  const cities = selectCities(snapshot.cities, {
    search: $('search').value,
    savedOnly,
    saved,
    sort: $('sort').value,
  });
  $('saved-count').textContent = saved.size;
  document.getElementById('catalog-total').textContent = snapshot.cities.length;
  $('result-count').textContent = `Показано ${cities.length} з ${snapshot.cities.length} міст`;
  $('snapshot-date').textContent =
    `Дані завантажено ${new Date(snapshot.fetched_at).toLocaleDateString('uk-UA')}`;
  $('city-grid').replaceChildren(...cities.map(card));
  $('empty').hidden = !!cities.length;
  $('empty-description').textContent = savedOnly
    ? 'Додайте місто до обраного, натиснувши на сердечко.'
    : 'Спробуйте іншу назву або очистьте пошук.';
}
/** Create a city card with private favourite and detail actions. */
function card(c) {
  const article = el('article', undefined, 'city-card'),
    art = el('div', undefined, 'city-art');
  const index = Math.max(0, IDS.indexOf(c.qid)),
    [bg, ink] = palettes[index % palettes.length];
  art.style.setProperty('--art-bg', bg);
  art.style.setProperty('--art-ink', ink);
  art.append(el('span', c.name.slice(0, 1), 'initial'));
  const coord = el('span', undefined, 'art-coord');
  coord.append(
    el('span', c.latitude !== null ? `${c.latitude.toFixed(2)}° N` : 'Координати'),
    el('br'),
    el('span', c.longitude !== null ? `${c.longitude.toFixed(2)}° E` : 'не вказано'),
  );
  art.append(coord);
  const save = el('button', saved.has(c.qid) ? '♥' : '♡', 'save-button');
  save.setAttribute('aria-pressed', String(saved.has(c.qid)));
  save.setAttribute(
    'aria-label',
    `${saved.has(c.qid) ? 'Прибрати з обраного' : 'Додати до обраного'}: ${c.name}`,
  );
  save.onclick = () => {
    toggle(c.qid);
    const next = document.querySelector(`[data-save="${c.qid}"]`);
    next?.focus({ preventScroll: true });
  };
  save.dataset.save = c.qid;
  art.append(save);
  const body = el('div', undefined, 'card-content');
  body.append(el('h3', c.name, 'card-title'), el('p', c.description, 'city-description'));
  const data = el('div', undefined, 'card-data'),
    population = el(
      'div',
      c.population !== null ? format.format(c.population) : 'Немає даних',
      'population',
    );
  population.append(el('span', 'населення за джерелом'));
  data.append(population, el('span', dateLabel(c.population_date), 'observation'));
  body.append(data);
  const bottom = el('div', undefined, 'card-bottom'),
    open = el('button', undefined, 'card-open');
  open.append(document.createTextNode('Про місто'), el('span', '↗'));
  open.setAttribute('aria-label', `Про місто ${c.name}`);
  open.onclick = () => openDetail(c);
  bottom.append(el('span', c.qid, 'qid'), open);
  body.append(bottom);
  article.append(art, body);
  return article;
}
/** Open a source-backed detail dialog for the selected city. */
function openDetail(c) {
  const box = $('detail-content');
  box.replaceChildren();
  const title = el('h2', c.name, 'detail-title');
  title.id = 'detail-title';
  box.append(title, el('p', c.description, 'detail-description'));
  const dl = el('dl', undefined, 'detail-grid');
  for (const [label, value] of [
    ['Населення за джерелом', c.population !== null ? format.format(c.population) : 'Не вказано'],
    ['Дата спостереження', dateLabel(c.population_date)],
    ['Широта', c.latitude !== null ? `${c.latitude.toFixed(4)}°` : 'Не вказано'],
    ['Довгота', c.longitude !== null ? `${c.longitude.toFixed(4)}°` : 'Не вказано'],
  ]) {
    const group = el('div');
    group.append(el('dt', label), el('dd', value));
    dl.append(group);
  }
  box.append(dl);
  const prov = el('div', undefined, 'provenance');
  const link = el('a', `http://www.wikidata.org/entity/${c.qid}`);
  link.href = `https://www.wikidata.org/wiki/${c.qid}`;
  link.target = '_blank';
  link.rel = 'noreferrer';
  prov.append(
    el('strong', 'Походження даних'),
    el('br'),
    link,
    el('br'),
    document.createTextNode(
      `Редакція ${c.revision} · отримано ${new Date(c.fetched_at).toLocaleString('uk-UA')}`,
    ),
  );
  box.append(prov);
  const note = el(
    'p',
    'Населення є історичним значенням за наведеною датою, а не поточною оцінкою.',
    'small-note',
  );
  box.append(note);
  const actions = el('div', undefined, 'detail-actions'),
    save = el('button', saved.has(c.qid) ? 'Прибрати з обраного' : 'Додати до обраного', 'primary');
  save.onclick = () => {
    toggle(c.qid);
    save.textContent = saved.has(c.qid) ? 'Прибрати з обраного' : 'Додати до обраного';
  };
  actions.append(save);
  if (c.latitude !== null) {
    const map = el('a', 'Відкрити на карті ↗', 'secondary');
    map.href = `https://www.openstreetmap.org/?mlat=${c.latitude}&mlon=${c.longitude}#map=12/${c.latitude}/${c.longitude}`;
    map.target = '_blank';
    map.rel = 'noreferrer';
    actions.append(map);
  }
  box.append(actions);
  if (!$('city-dialog').open) {
    $('city-dialog').showModal();
  }
}
/** Plot the catalogue coordinates and labels on the geographic overview. */
function map() {
  const svg = $('geo-map'),
    ns = 'http://www.w3.org/2000/svg';
  svg.replaceChildren();
  /** Append a data-driven SVG primitive to the coordinate diagram. */
  function shape(tag, attrs, text) {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) {
      node.setAttribute(k, v);
    }
    if (text) {
      node.textContent = text;
    }
    svg.append(node);
    return node;
  }
  for (let x = 65; x <= 500; x += 87) {
    shape('line', {
      x1: x,
      y1: 45,
      x2: x,
      y2: 315,
      stroke: '#cad4bd',
      'stroke-width': '.7',
      'stroke-dasharray': '2 5',
    });
  }
  for (let y = 45; y <= 315; y += 54) {
    shape('line', {
      x1: 45,
      y1: y,
      x2: 515,
      y2: y,
      stroke: '#cad4bd',
      'stroke-width': '.7',
      'stroke-dasharray': '2 5',
    });
  }
  const offsets = {
    Q1899: [10, -12],
    Q36036: [10, -12],
    Q1874: [10, 20],
    Q157144: [10, 21],
    Q156713: [-68, -12],
    Q156726: [-90, 24],
    Q157055: [10, 20],
    Q48256: [-55, -12],
    Q157835: [-60, 24],
    Q43070: [-30, -14],
  };
  for (const c of snapshot.cities) {
    if (c.latitude === null) {
      continue;
    }
    const x = 65 + ((c.longitude - 23.5) / 15) * 435,
      y = 315 - ((c.latitude - 46) / 6) * 270;
    shape('circle', {
      cx: x,
      cy: y,
      r: c.qid === 'Q1899' ? 11 : 6,
      fill: c.qid === 'Q1899' ? '#173b36' : '#8b9e71',
      stroke: '#f1f5e6',
      'stroke-width': 3,
    });
    const [dx, dy] = offsets[c.qid] ?? [10, -12];
    shape(
      'text',
      {
        x: x + dx,
        y: y + dy,
        fill: '#4c644a',
        'font-size': c.qid === 'Q1899' ? 15 : 11,
        'font-family': 'Segoe UI,Arial',
        'font-weight': c.qid === 'Q1899' ? 600 : 400,
      },
      c.name,
    );
  }
}
/** Refresh shared server records, retaining the visible catalogue on failure. */
async function refresh() {
  if (working) {
    return;
  }
  working = true;
  $('refresh').disabled = true;
  status('Сервер оновлює каталог із Wikidata…');
  try {
    snapshot = await refreshCatalogue();
    render();
    map();
    status('Каталог і RDF-граф оновлено в серверній базі даних.');
    $('query-result').replaceChildren();
    $('query-status').textContent = 'Граф оновлено. Виконайте запит до нових даних.';
  } catch (error) {
    status(error.message, true);
  } finally {
    working = false;
    $('refresh').disabled = false;
  }
}
/** Execute SELECT on the server and render returned RDF terms as safe DOM nodes. */
async function query() {
  $('run-query').disabled = true;
  $('query-status').textContent = 'Сервер виконує SPARQL-запит…';
  try {
    const result = await executeQuery($('query').value.trim());
    const output = $('query-result');
    output.replaceChildren();
    if (result.rows.length) {
      const table = el('table'),
        head = el('thead'),
        hr = el('tr');
      result.variables.forEach((name) => hr.append(el('th', name)));
      head.append(hr);
      table.append(head);
      const body = el('tbody');
      for (const row of result.rows) {
        const tr = el('tr');
        for (const name of result.variables) {
          const term = row[name],
            td = el('td');
          if (term?.termType === 'NamedNode' && /^https?:\/\//.test(term.value)) {
            const a = el('a', term.value.replace('http://www.wikidata.org/entity/', 'wd:'));
            a.href = term.value;
            a.target = '_blank';
            a.rel = 'noreferrer';
            td.append(a);
          } else {
            td.textContent = term?.value ?? '—';
          }
          tr.append(td);
        }
        body.append(tr);
      }
      table.append(body);
      output.append(table);
    }
    $('query-status').textContent =
      result.triples +
      ' RDF-трійки · ' +
      result.total +
      ' результатів. Виконано на сервері' +
      (result.total > 200 ? ' · показано перші 200.' : '.');
  } catch (error) {
    $('query-result').replaceChildren();
    $('query-status').textContent = 'Помилка запиту: ' + error.message;
  } finally {
    $('run-query').disabled = false;
  }
}
/** Read the authoritative server catalogue and restore private favourites. */
async function start() {
  try {
    snapshot = await getCatalogue();
    saved = loadFavourites();
    $('query').value = POPULATION_QUERY;
    render();
    map();
  } catch {
    status(
      'Не вдалося прочитати базу даних. Перезавантажте сторінку або перевірте з’єднання.',
      true,
    );
    $('result-count').textContent = 'Каталог недоступний';
  }
}
$('search').addEventListener('input', render);
$('sort').addEventListener('change', render);
$('all-tab').onclick = () => setFilter(false);
$('saved-tab').onclick = () => setFilter(true);
$('saved-nav').onclick = () => {
  setFilter(true);
  $('catalog').scrollIntoView({ behavior: 'smooth' });
};
$('reset').onclick = () => {
  $('search').value = '';
  setFilter(false);
};
$('refresh').onclick = refresh;
$('close-dialog').onclick = () => $('city-dialog').close();
$('city-dialog').addEventListener('click', (e) => {
  if (e.target === $('city-dialog')) {
    const r = $('city-dialog').getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      $('city-dialog').close();
    }
  }
});
$('export').onclick = () => {
  window.location.assign('/api/graph');
};
$('run-query').onclick = query;
$('reset-query').onclick = () => {
  $('query').value = POPULATION_QUERY;
};
start();
