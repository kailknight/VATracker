/* VA Tracker — reads the VA data published by OnePopHealth (Admin Dashboard → VA tab). */
(() => {
  // Where the data lives. GitHub Pages serves it with CORS enabled, so this site can read it directly.
  const DATA_URL = 'https://pophealth-odc.github.io/onepophealth/data/va.json';

  // Column names in va.json (the Excel header row).
  const COL = {
    deadline: 'SLA Deadline',
    status: 'SLA Status',
    days: 'Days to SLA Breach',
    strategy: 'Remediation Strategy',
    odc: 'ODC Primary'
  };
  const UNASSIGNED = '(Unassigned)';

  // SLA buckets by days left until the SLA deadline (not yet breached).
  const BUCKETS = [
    { key: 'd15', label: '< 15 days', sub: '0–15 days left', max: 15, tone: '#ea580c' },
    { key: 'd30', label: '< 30 days', sub: '16–30 days left', max: 30, tone: '#d97706' },
    { key: 'd45', label: '< 45 days', sub: '31–45 days left', max: 45, tone: '#ca8a04' },
    { key: 'd60', label: '< 60 days', sub: '46–60 days left', max: 60, tone: '#2563eb' },
    { key: 'd61', label: '> 61 days', sub: '61+ days left', max: Infinity, tone: '#16a34a' }
  ];
  const ALERTS = [
    { key: 'breach', label: 'SLA Status = Breach', sub: 'deadline has passed', tone: '#b91c1c' },
    { key: 'nostrategy', label: 'No Remediation Strategy', sub: 'Remediation Strategy is blank', tone: '#7c3aed' },
    { key: 'all', label: 'Total findings', sub: 'all rows in scope', tone: '#374151' }
  ];
  const CATEGORY = Object.fromEntries([...BUCKETS, ...ALERTS].map(c => [c.key, c]));

  const $ = (id) => document.getElementById(id);
  let data = null;       // { columns, rows, updatedAt, updatedBy }
  let items = [];        // enriched rows
  let detailCols = [];   // columns shown in the details table
  let detail = null;     // { category, odc } currently open
  let sort = { col: '__days', desc: false };

  // ---------- helpers ----------
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'text') node.textContent = v;
      else if (k === 'style') Object.assign(node.style, v);
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c !== null && c !== undefined) node.append(c);
    return node;
  }

  // "30/4/2026" (D/M/YYYY, as exported), "2026-04-30", or an Excel serial number.
  function parseDate(s) {
    s = String(s || '').trim();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(1899, 11, 30); d.setDate(d.getDate() + Math.floor(+s)); return d; }
    return null;
  }

  function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

  // Days left are recalculated from the SLA Deadline against today, so the numbers stay current
  // between uploads. Falls back to the exported "Days to SLA Breach" if the deadline can't be read.
  function enrich(row, idx, now) {
    const get = (name) => (idx[name] === undefined ? '' : String(row[idx[name]] ?? '').trim());
    const deadline = parseDate(get(COL.deadline));
    let days = deadline ? Math.round((deadline - now) / 86400000) : parseInt(get(COL.days), 10);
    if (Number.isNaN(days)) days = null;
    const breached = days !== null ? days < 0 : /breach/i.test(get(COL.status));
    const bucket = breached || days === null ? null : BUCKETS.find(b => days <= b.max).key;
    return {
      row, days, breached, bucket,
      odc: get(COL.odc) || UNASSIGNED,
      noStrategy: !get(COL.strategy),
      text: row.join('\u0001').toLowerCase()
    };
  }

  function inCategory(it, key) {
    if (key === 'all') return true;
    if (key === 'breach') return it.breached;
    if (key === 'nostrategy') return it.noStrategy;
    return it.bucket === key;
  }

  const selectedOdc = () => $('odcFilter').value;
  const scoped = (odc = selectedOdc()) => odc ? items.filter(it => it.odc === odc) : items;

  // ---------- loading ----------
  async function load() {
    $('error').hidden = true;
    $('updated').textContent = 'Loading…';
    try {
      const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      $('updated').textContent = '';
      $('error').textContent = `Couldn't load the VA data from ${DATA_URL} (${err.message}).`;
      $('error').hidden = false;
      return;
    }
    // Older files stored rows as objects; convert to arrays.
    if (data.rows.length && !Array.isArray(data.rows[0])) data.rows = data.rows.map(r => data.columns.map(c => r[c] ?? ''));

    const idx = Object.fromEntries(data.columns.map((c, i) => [c, i]));
    const now = today();
    items = data.rows.map(r => enrich(r, idx, now));
    // Hide placeholder columns ("Column 16" …) that are empty in every row.
    detailCols = data.columns.map((c, i) => ({ name: c, i }))
      .filter(c => !/^Column \d+$/.test(c.name) || data.rows.some(r => String(r[c.i] ?? '').trim() !== ''));

    const when = data.updatedAt ? new Date(data.updatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '';
    $('updated').textContent = `${data.rows.length.toLocaleString()} findings · data updated ${when}${data.updatedBy ? ' by ' + data.updatedBy : ''}`;

    buildFilter();
    render();
  }

  function buildFilter() {
    const sel = $('odcFilter');
    const wanted = decodeURIComponent((location.hash.match(/odc=([^&]*)/) || [])[1] || '') || sel.value;
    const counts = {};
    for (const it of items) counts[it.odc] = (counts[it.odc] || 0) + 1;
    const names = Object.keys(counts).sort((a, b) => (a === UNASSIGNED) - (b === UNASSIGNED) || a.localeCompare(b));
    sel.replaceChildren(
      el('option', { value: '', text: `All (${items.length})` }),
      ...names.map(n => el('option', { value: n, text: `${n} (${counts[n]})` }))
    );
    sel.value = names.includes(wanted) ? wanted : '';
  }

  // ---------- rendering ----------
  function card(cat, odc) {
    const n = scoped(odc).filter(it => inCategory(it, cat.key)).length;
    const active = detail && detail.category === cat.key && detail.odc === odc;
    return el('button', {
      type: 'button', class: `card${n ? '' : ' zero'}${active ? ' active' : ''}`, style: { '--tone': cat.tone },
      title: 'Show details', onclick: () => openDetails(cat.key, odc)
    }, [
      el('div', { class: 'num', text: n.toLocaleString() }),
      el('div', { class: 'label', text: cat.label }),
      el('div', { class: 'sub', text: cat.sub })
    ]);
  }

  function render() {
    const odc = selectedOdc();
    $('scope').textContent = odc ? `Showing ${scoped().length} findings for ${odc}` : '';
    $('slaCards').replaceChildren(...BUCKETS.map(b => card(b, odc)));
    $('alertCards').replaceChildren(...ALERTS.map(a => card(a, odc)));
    renderMatrix();
    if (detail) renderDetails();
  }

  function renderMatrix() {
    const cats = [...BUCKETS, ALERTS[0], ALERTS[1], ALERTS[2]];
    const groups = {};
    for (const it of items) (groups[it.odc] = groups[it.odc] || []).push(it);
    const names = Object.keys(groups).sort((a, b) => (a === UNASSIGNED) - (b === UNASSIGNED) || groups[b].length - groups[a].length);

    const cell = (list, cat, odc) => {
      const n = list.filter(it => inCategory(it, cat.key)).length;
      const td = el('td', { class: `n${cat.key === 'breach' ? ' breach' : ''}` });
      td.append(n ? el('button', { type: 'button', class: 'cell', text: n.toLocaleString(), title: 'Show details', onclick: () => openDetails(cat.key, odc) })
        : el('span', { class: 'zero', text: '0' }));
      return td;
    };
    $('matrix').replaceChildren(
      el('thead', {}, el('tr', {}, [el('th', { text: 'ODC Primary' }), ...cats.map(c => el('th', { class: 'n', text: c.key === 'all' ? 'Total' : c.label }))])),
      el('tbody', {}, [
        ...names.map(n => el('tr', {}, [el('td', { text: n }), ...cats.map(c => cell(groups[n], c, n))])),
        el('tr', { class: 'total' }, [el('td', { text: 'All' }), ...cats.map(c => cell(items, c, ''))])
      ])
    );
  }

  // ---------- details ----------
  function openDetails(category, odc) {
    detail = { category, odc };
    $('detailsSearch').value = '';
    $('details').hidden = false;
    render();
    $('details').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderDetails() {
    const q = $('detailsSearch').value.trim().toLowerCase();
    let list = scoped(detail.odc).filter(it => inCategory(it, detail.category));
    const total = list.length;
    if (q) list = list.filter(it => it.text.includes(q));

    const val = (it, col) => col === '__days' ? (it.days ?? Infinity) : col === '__sla' ? (it.breached ? 1 : 0) : String(it.row[col] ?? '');
    list = [...list].sort((a, b) => {
      const x = val(a, sort.col), y = val(b, sort.col);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return sort.desc ? -c : c;
    });

    const cat = CATEGORY[detail.category];
    $('detailsTitle').textContent = `${cat.key === 'all' ? 'All findings' : cat.label} — ${detail.odc || 'All ODC Primary'} · ` +
      (q ? `${list.length} of ${total}` : `${total}`) + ' rows';

    const cols = [{ name: 'Days left (today)', key: '__days' }, { name: 'SLA (today)', key: '__sla' }, ...detailCols.map(c => ({ name: c.name, key: c.i }))];
    const head = el('tr', {}, cols.map(c => el('th', {
      text: c.name, class: sort.col === c.key ? `sorted${sort.desc ? ' desc' : ''}` : undefined,
      onclick: () => { sort = { col: c.key, desc: sort.col === c.key ? !sort.desc : false }; renderDetails(); }
    })));
    const body = list.length ? list.map(it => el('tr', {}, cols.map(c => {
      if (c.key === '__days') return el('td', { class: `days${it.breached ? ' neg' : ''}`, text: it.days === null ? '—' : String(it.days) });
      if (c.key === '__sla') return el('td', {}, el('span', { class: `pill ${it.breached ? 'breach' : 'ok'}`, text: it.breached ? 'Breached' : 'Within SLA' }));
      const v = String(it.row[c.key] ?? '');
      return v.length > 60 || v.includes('\n') ? el('td', { class: 'wrap' }, el('div', { text: v })) : el('td', { text: v });
    }))) : [el('tr', {}, el('td', { class: 'empty', colspan: cols.length, text: 'No rows.' }))];

    $('detailsTable').replaceChildren(el('thead', {}, head), el('tbody', {}, body));
  }

  // ---------- events ----------
  $('odcFilter').onchange = () => {
    const v = selectedOdc();
    history.replaceState(null, '', v ? `#odc=${encodeURIComponent(v)}` : location.pathname);
    if (detail) detail.odc = v;
    render();
  };
  $('detailsSearch').oninput = () => renderDetails();
  $('closeDetails').onclick = () => { detail = null; $('details').hidden = true; render(); };
  $('refreshBtn').onclick = load;

  load();
})();
