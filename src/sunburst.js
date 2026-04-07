// Bible Sunburst — D3 partition + Canvas chapter ring (perf)
import { I18N, bookLabel, groupLabel } from './i18n.js';

// Radial bands (fraction of overall radius)
//   hub  →  testament  →  group  →  book  →  chapter
const RING = { hub: 0.10, testament: 0.18, group: 0.30, book: 0.58, chapter: 1.00 };
// Threshold (radians) below which a book label gets a radial leader line outside the chart
const LEADER_THRESHOLD = 0.022;

// Canonical order of groups within each testament
const OT_GROUPS = ['Law', 'History', 'Wisdom', 'MajorProph', 'MinorProph'];
const NT_GROUPS = ['Gospel', 'Acts', 'Pauline', 'General', 'Apoc'];

// Color hues per book group
const HUES = {
  Law:        28, History:    42, Wisdom:     56, MajorProph: 14, MinorProph: 0,
  Gospel:    200, Acts:      178, Pauline:   220, General:   258, Apoc:      292,
};

const BOOK_GROUP = {
  'Genesis':'Law','Exodus':'Law','Leviticus':'Law','Numbers':'Law','Deuteronomy':'Law',
  'Joshua':'History','Judges':'History','Ruth':'History',
  '1 Samuel':'History','2 Samuel':'History','1 Kings':'History','2 Kings':'History',
  '1 Chronicles':'History','2 Chronicles':'History','Ezra':'History','Nehemiah':'History','Esther':'History',
  'Job':'Wisdom','Psalms':'Wisdom','Proverbs':'Wisdom','Ecclesiastes':'Wisdom','Song of Solomon':'Wisdom',
  'Isaiah':'MajorProph','Jeremiah':'MajorProph','Lamentations':'MajorProph','Ezekiel':'MajorProph','Daniel':'MajorProph',
  'Hosea':'MinorProph','Joel':'MinorProph','Amos':'MinorProph','Obadiah':'MinorProph','Jonah':'MinorProph',
  'Micah':'MinorProph','Nahum':'MinorProph','Habakkuk':'MinorProph','Zephaniah':'MinorProph','Haggai':'MinorProph',
  'Zechariah':'MinorProph','Malachi':'MinorProph',
  'Matthew':'Gospel','Mark':'Gospel','Luke':'Gospel','John':'Gospel',
  'Acts':'Acts',
  'Romans':'Pauline','1 Corinthians':'Pauline','2 Corinthians':'Pauline','Galatians':'Pauline',
  'Ephesians':'Pauline','Philippians':'Pauline','Colossians':'Pauline',
  '1 Thessalonians':'Pauline','2 Thessalonians':'Pauline','1 Timothy':'Pauline','2 Timothy':'Pauline',
  'Titus':'Pauline','Philemon':'Pauline',
  'Hebrews':'General','James':'General','1 Peter':'General','2 Peter':'General',
  '1 John':'General','2 John':'General','3 John':'General','Jude':'General',
  'Revelation':'Apoc',
};

const state = {
  lang: 'en',
  data: null,
  root: null,
  focus: null,
  size: 0,
  radius: 0,
  dpr: 1,
  svg: null,
  g: null,
  canvas: null,
  ctx: null,
  chapters: [],   // flat list of leaf nodes
};

const $ = sel => document.querySelector(sel);
const TAU = Math.PI * 2;

export async function init() {
  state.lang = localStorage.getItem('bs-lang') || 'en';
  if (localStorage.getItem('bs-theme') === 'light') document.documentElement.classList.add('light');

  const res = await fetch('./data/bible.json');
  state.data = await res.json();

  applyI18n();
  buildHierarchy();
  setup();
  render();
  bindControls();
  window.addEventListener('resize', debounce(() => { setup(); render(); }, 120));
}

function applyI18n() {
  const t = I18N.ui[state.lang];
  $('#title').textContent      = t.title;
  $('#subtitle').textContent   = t.subtitle;
  $('#hint').textContent       = t.hint;
  $('#btn-lang').textContent   = t.lang;
  $('#btn-reset').textContent  = t.reset;
  document.documentElement.lang = state.lang;
}

// ── Hierarchy ─────────────────────────────────────────────

function buildHierarchy() {
  // Inject a "group" level (Pentateuch / Historical / etc.) between Testament and Book.
  const grouped = {
    name: 'Bible',
    children: state.data.children.map(testament => {
      const order = testament.name === 'OT' ? OT_GROUPS : NT_GROUPS;
      const buckets = {};
      for (const b of testament.children) {
        const g = BOOK_GROUP[b.name] || 'Other';
        (buckets[g] = buckets[g] || []).push(b);
      }
      return {
        name: testament.name,
        children: order
          .filter(g => buckets[g])
          .map(g => ({ name: g, group: g, children: buckets[g] }))
      };
    }),
  };

  state.root = d3.hierarchy(grouped)
    .sum(d => d.value || 0)
    .sort(() => 0);

  d3.partition().size([TAU, 1])(state.root);

  // Depth: 0 root, 1 testament, 2 group, 3 book, 4 chapter
  state.root.each(d => {
    if      (d.depth === 0) { d.r0 = 0;              d.r1 = RING.hub; }
    else if (d.depth === 1) { d.r0 = RING.hub;        d.r1 = RING.testament; }
    else if (d.depth === 2) { d.r0 = RING.testament;  d.r1 = RING.group; }
    else if (d.depth === 3) { d.r0 = RING.group;      d.r1 = RING.book; }
    else                    { d.r0 = RING.book;       d.r1 = RING.chapter; }
    d.X0 = d.x0; d.X1 = d.x1;
  });

  state.chapters = state.root.descendants().filter(d => d.depth === 4);
  state.focus = state.root;

  // Pre-compute colors
  // Group ring: solid hue
  state.root.descendants().filter(d => d.depth === 2).forEach(d => {
    const hue = HUES[d.data.group] ?? 30;
    d.color = d3.hsl(hue, 0.55, 0.36).toString();
  });
  // Book ring: same hue, slightly lighter
  state.root.descendants().filter(d => d.depth === 3).forEach(d => {
    const hue = HUES[d.parent.data.group] ?? 30;
    d.color = d3.hsl(hue, 0.55, 0.46).toString();
  });
  // Chapter ring: hue with lightness ramp by chapter index within book
  state.chapters.forEach(d => {
    const book = d.parent;
    const hue  = HUES[book.parent.data.group] ?? 30;
    const idx  = book.children.indexOf(d);
    const tot  = book.children.length;
    const l    = 0.45 + (idx / Math.max(1, tot - 1)) * 0.25;
    d.color = d3.hsl(hue, 0.50, l).toString();
  });
}

// ── Setup canvas + svg ────────────────────────────────────

function setup() {
  const wrap = $('.chart-wrap');
  const w = wrap.clientWidth  || window.innerWidth  || 800;
  const h = wrap.clientHeight || window.innerHeight || 800;
  const size = Math.max(320, Math.min(w, h) - 16);
  state.size = size;
  // Leave margin around the chart for leader-line labels (~70px each side)
  state.radius = (size / 2) - 70;
  state.dpr = window.devicePixelRatio || 1;

  // Canvas — chapter ring (1189 arcs, full perf)
  let canvas = wrap.querySelector('canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'sunburst-canvas';
    wrap.appendChild(canvas);
  }
  canvas.width  = size * state.dpr;
  canvas.height = size * state.dpr;
  canvas.style.width  = size + 'px';
  canvas.style.height = size + 'px';
  state.canvas = canvas;
  state.ctx = canvas.getContext('2d');
  state.ctx.setTransform(1, 0, 0, 1, 0, 0);
  state.ctx.scale(state.dpr, state.dpr);
  state.ctx.translate(size / 2, size / 2);

  // SVG — testament + book + labels + interactions
  let svg = wrap.querySelector('svg.sunburst');
  if (!svg) {
    svg = d3.select(wrap).append('svg').attr('class', 'sunburst').node();
  }
  d3.select(svg)
    .attr('viewBox', [-size/2, -size/2, size, size])
    .attr('width', size).attr('height', size);
  state.svg = d3.select(svg);
  state.svg.selectAll('*').remove();
  state.g = state.svg.append('g');
}

// ── Render ────────────────────────────────────────────────

function render() {
  drawChapterCanvas();
  drawSvg();
}

function themeTokens() {
  const cs = getComputedStyle(document.documentElement);
  return {
    tick:    cs.getPropertyValue('--tick-color').trim()     || 'rgba(0,0,0,0.55)',
    chap:    cs.getPropertyValue('--chapter-stroke').trim() || 'rgba(0,0,0,0.85)',
    book:    cs.getPropertyValue('--book-stroke').trim()    || 'rgba(0,0,0,0.95)',
    ring:    cs.getPropertyValue('--ring-stroke').trim()    || 'rgba(0,0,0,0.55)',
  };
}

function drawChapterCanvas() {
  const ctx = state.ctx, R = state.radius;
  const big = R * 2 + 200;
  ctx.clearRect(-big, -big, big * 2, big * 2);
  const TK = themeTokens();

  const r0 = RING.book * R + 0.5;
  const r1 = RING.chapter * R;
  const HALF = Math.PI / 2;

  // ── 1. Filled annular wedges, one per chapter ──
  for (const d of state.chapters) {
    const a0 = d.x0 - HALF;
    const a1 = d.x1 - HALF;
    if (a1 - a0 < 1e-7) continue;
    ctx.beginPath();
    ctx.arc(0, 0, r0, a0, a1, false);
    ctx.arc(0, 0, r1, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = d.color;
    ctx.fill();
  }

  // ── 2. Verse tick marks (short outer notches) ──
  // Only drawn where angular spacing is ≥ ~0.8 px on the outer ring,
  // otherwise the lines collapse to a smear and waste cycles.
  const minStep = 0.8 / r1;          // radians per pixel on outer ring
  const tickLen = Math.min(6, (r1 - r0) * 0.18);
  const tickInner = r1 - tickLen;
  ctx.lineWidth = 0.4;
  ctx.strokeStyle = TK.tick;
  ctx.beginPath();
  for (const d of state.chapters) {
    const span = d.x1 - d.x0;
    const verses = d.value;
    if (verses < 2) continue;
    const step = span / verses;
    if (step < minStep) continue;      // sub-pixel: skip
    // Draw verse boundary at indices 1..verses-1 (skip 0 and last — those are chapter walls)
    for (let i = 1; i < verses; i++) {
      const a = d.x0 + step * i - HALF;
      const cs = Math.cos(a), sn = Math.sin(a);
      ctx.moveTo(cs * tickInner, sn * tickInner);
      ctx.lineTo(cs * r1,        sn * r1);
    }
  }
  ctx.stroke();

  // ── 3. Chapter boundary lines (full radial, slightly thicker) ──
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = TK.chap;
  ctx.beginPath();
  for (let i = 0; i < state.chapters.length; i++) {
    const d = state.chapters[i];
    // Only draw a separator if the next chapter belongs to the SAME book —
    // book boundaries are stronger and drawn separately below.
    if (i === state.chapters.length - 1) continue;
    const next = state.chapters[i + 1];
    if (next.parent !== d.parent) continue;
    const a = d.x1 - HALF;
    const cs = Math.cos(a), sn = Math.sin(a);
    ctx.moveTo(cs * r0, sn * r0);
    ctx.lineTo(cs * r1, sn * r1);
  }
  ctx.stroke();

  // ── 4. Book boundary lines (strongest) ──
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = TK.book;
  ctx.beginPath();
  const books = state.root.descendants().filter(n => n.depth === 3);
  for (const b of books) {
    const a = b.x1 - HALF;
    const cs = Math.cos(a), sn = Math.sin(a);
    ctx.moveTo(cs * r0, sn * r0);
    ctx.lineTo(cs * r1, sn * r1);
  }
  ctx.stroke();

  // ── 5. Outer & inner ring strokes ──
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = TK.ring;
  ctx.beginPath();
  ctx.arc(0, 0, r1, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r0, 0, TAU);
  ctx.stroke();
}

function drawSvg() {
  const g = state.g;
  g.selectAll('*').remove();
  const R = state.radius;

  const arc = d3.arc()
    .startAngle(d => d.x0)
    .endAngle(d => d.x1)
    .innerRadius(d => d.r0 * R)
    .outerRadius(d => d.r1 * R)
    .padAngle(d => d.depth === 1 ? 0.008 : (d.depth === 2 ? 0.004 : 0.002))
    .padRadius(R);

  // Testament + Group + Book arcs (depths 1, 2, 3)
  const inner = state.root.descendants().filter(d => d.depth >= 1 && d.depth <= 3);
  g.selectAll('path.arc')
    .data(inner, d => nodeId(d))
    .enter()
    .append('path')
    .attr('class', d => 'arc depth-' + d.depth)
    .attr('d', arc)
    .attr('fill', d => d.depth === 1
      ? (d.data.name === 'OT' ? 'var(--ot-fill)' : 'var(--nt-fill)')
      : d.color)
    .attr('stroke', 'rgba(0,0,0,0.35)')
    .attr('stroke-width', 0.6)
    .style('display', d => (d.x1 - d.x0) > 0.0005 ? null : 'none')
    .style('cursor', 'pointer')
    .on('click', (_, d) => zoomTo(d));

  // Treat anything narrower than this (in radians) as "collapsed" — no label.
  const VISIBLE_EPSILON = 0.001;

  // Group labels (depth 2) — curved if it fits, radial if narrow, leader-line if very narrow
  const defs = g.append('defs');
  const groups = state.root.descendants().filter(d => d.depth === 2 && (d.x1 - d.x0) > VISIBLE_EPSILON);
  const groupLeaders = [];
  groups.forEach((d, i) => {
    const text = groupLabel(d.data.group, state.lang);
    const fitted = drawCurvedLabel(g, defs, d, R, `g-label-${i}`, 'group-label', 11, text);
    if (fitted) return;
    // Try radial label inside the arc
    const arcLen = (d.x1 - d.x0) * ((d.r0 + d.r1) / 2) * R;
    if (arcLen > 14) {
      g.append('text')
        .attr('class', 'group-label')
        .attr('transform', bookLabelTransform(d))
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .style('font-size', '10px')
        .text(text);
      return;
    }
    // Otherwise queue for an outside leader line
    groupLeaders.push({ d, text });
  });

  // Book labels — split into "in-arc" (wide) and "leader-line" (narrow). Depth 3.
  // Skip books that are collapsed (their parent group is not in focus).
  const books = state.root.descendants().filter(d => d.depth === 3 && (d.x1 - d.x0) > VISIBLE_EPSILON);
  const wide   = books.filter(d => (d.x1 - d.x0) >= LEADER_THRESHOLD);
  const narrow = books.filter(d => (d.x1 - d.x0) <  LEADER_THRESHOLD);

  // In-arc labels for wide books (oriented along arc tangent)
  g.selectAll('text.book-label')
    .data(wide)
    .enter()
    .append('text')
    .attr('class', 'book-label')
    .attr('transform', d => bookLabelTransform(d))
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .style('font-size', d => labelFontSize(d) + 'px')
    .text(d => bookLabel(d.data.name, state.lang, (d.x1 - d.x0) < 0.05));

  // Leader-line labels for narrow books with vertical collision avoidance.
  // Strategy: split into left/right half, sort by angle, then adjust Y so adjacent
  // labels are at least MIN_GAP px apart.
  const leaders = g.append('g').attr('class', 'leaders');
  const MIN_GAP = 13;
  const labelR = RING.chapter * R + 28;     // radial distance of label baseline

  const placed = narrow.map(d => {
    const a = (d.x0 + d.x1) / 2;
    const cosA = Math.cos(a - Math.PI/2);
    const sinA = Math.sin(a - Math.PI/2);
    const onRight = cosA >= 0;
    return {
      d, a, cosA, sinA, onRight,
      x: cosA * labelR,
      y: sinA * labelR,
      anchorX: cosA * (RING.chapter * R + 4),
      anchorY: sinA * (RING.chapter * R + 4),
      origRadius: ((d.r0 + d.r1) / 2) * R,
      label: bookLabel(d.data.name, state.lang),
    };
  });

  // Resolve vertical collisions, side by side
  ['right', 'left'].forEach(side => {
    const arr = placed.filter(p => (p.onRight ? 'right' : 'left') === side)
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].y - arr[i-1].y < MIN_GAP) arr[i].y = arr[i-1].y + MIN_GAP;
    }
    // Also push from below upward so we don't run off bottom
    for (let i = arr.length - 2; i >= 0; i--) {
      if (arr[i+1].y - arr[i].y < MIN_GAP) arr[i].y = arr[i+1].y - MIN_GAP;
    }
  });

  for (const p of placed) {
    // Anchor point on chapter ring
    const ax = Math.cos(p.a - Math.PI/2) * (RING.chapter * R + 2);
    const ay = Math.sin(p.a - Math.PI/2) * (RING.chapter * R + 2);
    // Bend point: same x as label, midway radially
    const bx = p.onRight ? Math.max(ax, p.x - 18) : Math.min(ax, p.x + 18);
    const by = p.y;
    leaders.append('polyline')
      .attr('class', 'leader-line')
      .attr('points', `${ax},${ay} ${bx},${by} ${p.x},${by}`)
      .attr('fill', 'none')
      .attr('stroke', 'var(--fg-dim, #8a8472)')
      .attr('stroke-width', 0.6);
    leaders.append('text')
      .attr('class', 'leader-label')
      .attr('x', p.x + (p.onRight ? 4 : -4))
      .attr('y', p.y)
      .attr('dy', '0.32em')
      .attr('text-anchor', p.onRight ? 'start' : 'end')
      .text(p.label);
  }

  // Testament labels (depth 1) — curved text along the arc
  const t = I18N.ui[state.lang];
  state.root.descendants()
    .filter(d => d.depth === 1 && (d.x1 - d.x0) > VISIBLE_EPSILON)
    .forEach((d, i) => {
      const text = d.data.name === 'OT' ? t.ot : t.nt;
      drawCurvedLabel(g, defs, d, R, `t-label-${i}`, 'testament-label', 13, text);
    });

  // Group leader-line labels (for groups too narrow even for radial)
  if (groupLeaders.length) {
    const leadersG = g.append('g').attr('class', 'group-leaders');
    groupLeaders.forEach(({ d, text }) => {
      const a = (d.x0 + d.x1) / 2 - Math.PI / 2;
      const cs = Math.cos(a), sn = Math.sin(a);
      const r0p = ((d.r0 + d.r1) / 2) * R;
      // Lead inward toward the testament ring's outer edge so it doesn't
      // collide with book labels above.
      const r1p = RING.testament * R + 2;
      leadersG.append('line')
        .attr('x1', cs * r0p).attr('y1', sn * r0p)
        .attr('x2', cs * r1p).attr('y2', sn * r1p)
        .attr('stroke', 'var(--fg-dim)')
        .attr('stroke-width', 0.5);
      leadersG.append('text')
        .attr('class', 'group-label small')
        .attr('x', cs * (r1p - 4))
        .attr('y', sn * (r1p - 4))
        .attr('text-anchor', cs >= 0 ? 'end' : 'start')
        .attr('dominant-baseline', sn >= 0 ? 'hanging' : 'auto')
        .style('font-size', '9px')
        .text(text);
    });
  }

  // Center hub
  const center = g.append('g').attr('class', 'center-label');
  center.append('circle')
    .attr('r', RING.hub * R - 1)
    .attr('fill', 'var(--bg-soft, #16161d)')
    .attr('stroke', 'var(--border, #2a2a35)')
    .attr('stroke-width', 1)
    .style('cursor', 'pointer')
    .on('click', () => zoomTo(state.root));
  center.append('text')
    .attr('class', 'name')
    .attr('y', 4)
    .text(t.bible);

  // Hover layer (full SVG, polar hit-test)
  state.svg
    .on('mousemove', onCanvasHover)
    .on('mouseleave', onLeave);

  // Mouse layer for canvas hit-testing
  bindCanvasHitTest();
}

// Draws a curved label that follows the arc centerline of a ring node.
// Returns true if the label was actually drawn, false if it didn't fit.
function drawCurvedLabel(g, defs, d, R, pathId, className, fontSize, text) {
  const span = d.x1 - d.x0;
  const r = ((d.r0 + d.r1) / 2) * R;
  const arcLen = span * r;
  // Rough text-width estimate; CJK chars are wider, ASCII narrower
  const isCJK = /[\u3000-\u9fff]/.test(text);
  const charW = isCJK ? fontSize * 1.05 : fontSize * 0.55;
  const textW = text.length * charW;
  if (arcLen < textW + 4) return false;

  const midAngle = (d.x0 + d.x1) / 2;
  // Top half of circle (12 o'clock to 6 o'clock through right) puts text upright
  // when path goes counter-clockwise; bottom half needs reversed direction.
  const isBottom = midAngle > Math.PI / 2 && midAngle < 3 * Math.PI / 2;

  let a0, a1, sweep;
  if (isBottom) {
    a0 = d.x1 - Math.PI / 2;
    a1 = d.x0 - Math.PI / 2;
    sweep = 0;
  } else {
    a0 = d.x0 - Math.PI / 2;
    a1 = d.x1 - Math.PI / 2;
    sweep = 1;
  }
  const sx = Math.cos(a0) * r;
  const sy = Math.sin(a0) * r;
  const ex = Math.cos(a1) * r;
  const ey = Math.sin(a1) * r;
  const large = span > Math.PI ? 1 : 0;

  defs.append('path')
    .attr('id', pathId)
    .attr('d', `M ${sx},${sy} A ${r},${r} 0 ${large} ${sweep} ${ex},${ey}`);

  g.append('text')
    .attr('class', className)
    .style('font-size', fontSize + 'px')
    .attr('dominant-baseline', 'central')
    .append('textPath')
    .attr('href', `#${pathId}`)
    .attr('startOffset', '50%')
    .attr('text-anchor', 'middle')
    .text(text);
  return true;
}

function bookLabelTransform(d) {
  const R = state.radius;
  const angle = (d.x0 + d.x1) / 2;
  const r = ((d.r0 + d.r1) / 2) * R;
  const deg = (angle * 180 / Math.PI) - 90;
  const flip = (deg > 90 || deg < -90) ? 180 : 0;
  return `rotate(${deg}) translate(${r},0) rotate(${flip})`;
}

function labelFontSize(d) {
  const arcLen = (d.x1 - d.x0) * ((d.r0 + d.r1) / 2) * state.radius;
  return Math.max(8, Math.min(13, arcLen / 4));
}

function labelOpacity(d) {
  return (d.x1 - d.x0) > 0.02 ? 1 : 0;
}

function nodeId(d) {
  return d.ancestors().map(a => a.data.name).reverse().join('/');
}

// ── Hit testing (canvas chapter ring) ─────────────────────

function bindCanvasHitTest() {
  const canvas = state.canvas;
  canvas.style.pointerEvents = 'none'; // SVG handles events
  state.svg.on('click', onCanvasClick);
}

// Slug a book name into a filename key (e.g. "1 Samuel" → "1Samuel")
function bookSlug(name) {
  return name.replace(/\s+/g, '');
}

const textCache = new Map();   // key: lang + '/' + slug → { chapters: [[v1,v2,...], ...] }

async function loadBookText(bookName, lang) {
  const key = `${lang}/${bookSlug(bookName)}`;
  if (textCache.has(key)) return textCache.get(key);
  const promise = fetch(`./data/text/${lang}/${bookSlug(bookName)}.json`)
    .then(r => { if (!r.ok) throw new Error('not found'); return r.json(); });
  textCache.set(key, promise);
  try { return await promise; }
  catch (e) { textCache.delete(key); throw e; }
}

async function openReader(chapter) {
  const book = chapter.parent;
  const bookEl = $('#reader-book');
  const chEl = $('#reader-chapter');
  const body = $('#reader-body');
  const t = I18N.ui[state.lang];
  bookEl.textContent = bookLabel(book.data.name, state.lang);
  chEl.textContent = state.lang === 'zh'
    ? `${t.chapter}${chapter.data.name}章 · ${chapter.value} ${t.verses}`
    : `${t.chapter} ${chapter.data.name} · ${chapter.value} ${t.verses}`;
  currentReaderChapter = chapter;
  body.innerHTML = `<div class="loading">…</div>`;
  $('#reader').classList.add('open');
  document.body.classList.add('reader-open');
  try {
    const data = await loadBookText(book.data.name, state.lang);
    const chIdx = parseInt(chapter.data.name, 10) - 1;
    const verses = data.chapters[chIdx] || [];
    body.innerHTML = verses.map((v, i) =>
      `<div class="verse"><span class="vnum">${i+1}</span>${escapeHtml(v)}</div>`
    ).join('');
    body.scrollTop = 0;
  } catch (e) {
    body.innerHTML = `<div class="error">${state.lang === 'zh' ? '加载失败' : 'Failed to load'}</div>`;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function closeReader() {
  $('#reader').classList.remove('open');
  document.body.classList.remove('reader-open');
}

function onCanvasClick(event) {
  // Hit-test the chapter ring on click. Inner SVG arcs already have their own click handlers.
  if (event.target.tagName === 'path' || event.target.tagName === 'circle') return;
  const rect = state.svg.node().getBoundingClientRect();
  const x = event.clientX - rect.left - rect.width/2;
  const y = event.clientY - rect.top - rect.height/2;
  const dist = Math.hypot(x, y);
  const R = state.radius;
  if (dist < RING.book * R || dist > RING.chapter * R) return;
  let theta = Math.atan2(y, x) + Math.PI/2;
  if (theta < 0) theta += TAU;
  const chap = findChapter(theta);
  if (chap) openReader(chap);
}

function onCanvasHover(event) {
  const rect = state.svg.node().getBoundingClientRect();
  const x = event.clientX - rect.left - rect.width/2;
  const y = event.clientY - rect.top - rect.height/2;
  const dist = Math.hypot(x, y);
  const R = state.radius;

  const t = I18N.ui[state.lang];
  let html = null;

  if (dist >= RING.book * R && dist <= RING.chapter * R) {
    // Polar angle, normalized to [0, 2π) starting at top (-π/2)
    let theta = Math.atan2(y, x) + Math.PI/2;
    if (theta < 0) theta += TAU;
    // Binary search chapters
    const chap = findChapter(theta);
    if (chap) {
      const book = chap.parent;
      const bn = bookLabel(book.data.name, state.lang);
      const detail = state.lang === 'zh'
        ? `${t.chapter}${chap.data.name}章 · ${chap.value} ${t.verses}`
        : `${t.chapter} ${chap.data.name} · ${chap.value} ${t.verses}`;
      html = `<div class="book">${bn}</div><div class="detail">${detail}</div>`;
    }
  }

  const tip = $('#tooltip');
  if (html) {
    tip.innerHTML = html;
    tip.classList.add('visible');
    tip.style.left = (event.clientX + 14) + 'px';
    tip.style.top  = (event.clientY + 14) + 'px';
  } else {
    tip.classList.remove('visible');
  }
}

function findChapter(theta) {
  // chapters are sorted by x0 in canonical order; linear scan is fine (~600 max)
  // but binary search is cheap
  const arr = state.chapters;
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const d = arr[mid];
    if (theta < d.x0) hi = mid - 1;
    else if (theta >= d.x1) lo = mid + 1;
    else return d;
  }
  return null;
}

function onLeave() {
  $('#tooltip').classList.remove('visible');
}

// ── Zoom ──────────────────────────────────────────────────

function zoomTo(focus) {
  if (!focus) return;
  if (focus === state.focus) {
    if (state.focus === state.root) return;
    focus = state.root;
  }
  state.focus = focus;

  // Snapshot current angles + compute targets
  const span = focus.X1 - focus.X0;
  state.root.each(d => {
    d.sx0 = d.x0;
    d.sx1 = d.x1;
    d.tx0 = Math.max(0, Math.min(1, (d.X0 - focus.X0) / span)) * TAU;
    d.tx1 = Math.max(0, Math.min(1, (d.X1 - focus.X0) / span)) * TAU;
  });

  // Hide labels & leaders during the transition for clarity (and perf)
  state.g.selectAll('text, defs, .leaders, .group-leaders, polyline.leader-line')
    .interrupt().style('opacity', 0);

  if (state._anim) cancelAnimationFrame(state._anim);
  const duration = 720;
  const start = performance.now();

  function ease(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2; }

  function frame(now) {
    const e = ease(Math.min(1, (now - start) / duration));
    state.root.each(d => {
      d.x0 = d.sx0 + (d.tx0 - d.sx0) * e;
      d.x1 = d.sx1 + (d.tx1 - d.sx1) * e;
    });
    // Update only the path geometry that already exists (no full re-render)
    const arc = currentArcGen();
    state.g.selectAll('path.arc').attr('d', arc);
    drawChapterCanvas();
    if (e < 1) {
      state._anim = requestAnimationFrame(frame);
    } else {
      state._anim = null;
      // Final pass: rebuild labels for the new layout
      render();
    }
  }
  state._anim = requestAnimationFrame(frame);
}

function currentArcGen() {
  const R = state.radius;
  return d3.arc()
    .startAngle(d => d.x0)
    .endAngle(d => d.x1)
    .innerRadius(d => d.r0 * R)
    .outerRadius(d => d.r1 * R)
    .padAngle(d => d.depth === 1 ? 0.008 : (d.depth === 2 ? 0.004 : 0.002))
    .padRadius(R);
}

// ── Controls ──────────────────────────────────────────────

let currentReaderChapter = null;

function bindControls() {
  $('#btn-lang').addEventListener('click', () => {
    state.lang = state.lang === 'en' ? 'zh' : 'en';
    localStorage.setItem('bs-lang', state.lang);
    applyI18n();
    render();
    if (currentReaderChapter && $('#reader').classList.contains('open')) {
      openReader(currentReaderChapter);
    }
  });
  $('#btn-theme').addEventListener('click', () => {
    const r = document.documentElement;
    r.classList.toggle('light');
    localStorage.setItem('bs-theme', r.classList.contains('light') ? 'light' : 'dark');
    // Force a full repaint so canvas picks up new CSS-variable colors
    requestAnimationFrame(() => render());
  });
  $('#btn-reset').addEventListener('click', () => zoomTo(state.root));
  $('#reader-close').addEventListener('click', closeReader);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeReader();
  });
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

window.BibleSunburst = { init };
