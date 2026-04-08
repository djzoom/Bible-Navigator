// Shared primitives for all layouts: hierarchy build, colors, reader drawer,
// lang state, gestures. Layout modules (sunburst / icicle / tidytree) each
// import from here so they stay ~100% consistent on data + styling.
import { I18N, bookLabel, groupLabel } from './i18n.js?v=4';

// ── Canonical book groups ─────────────────────────────────

export const OT_GROUPS = ['Law', 'History', 'Wisdom', 'MajorProph', 'MinorProph'];
export const NT_GROUPS = ['Gospel', 'Acts', 'Pauline', 'General', 'Apoc'];

export const BOOK_GROUP = {
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

// ── Color palette ─────────────────────────────────────────

export const HUES = {
  Law:        32, History:    42, Wisdom:     54, MajorProph: 18, MinorProph: 8,
  Gospel:    202, Acts:      188, Pauline:   218, General:   234, Apoc:      252,
};
export const SAT_GROUP   = 0.42;
export const LIGHT_GROUP = 0.36;
export const SAT_BOOK    = 0.46;
export const LIGHT_BOOK  = 0.50;
export const SAT_CHAP    = 0.42;
export const CHAP_LIGHT_LO = 0.38;
export const CHAP_LIGHT_HI = 0.66;

// ── Shared app state (singleton) ──────────────────────────

export const state = {
  lang: 'en',
  data: null,              // raw JSON from data/bible.json
};

export const TAU = Math.PI * 2;
export const $ = sel => document.querySelector(sel);

// ── Hierarchy construction ────────────────────────────────

/**
 * Build a d3.hierarchy from the raw Bible JSON, injecting a "group" level
 * (Pentateuch, Historical, ...) between testament and book. Pre-computes a
 * `.color` on every node at depths 2–4 so layouts just read it.
 *
 * Returns a fresh hierarchy — callers can safely run d3.partition /
 * d3.tree / etc. on it without clashing with other layouts.
 */
export function buildHierarchy(rawData) {
  const grouped = {
    name: 'Bible',
    children: rawData.children.map(testament => {
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

  const root = d3.hierarchy(grouped)
    .sum(d => d.value || 0)
    .sort(() => 0);

  // Pre-compute colors once
  root.descendants().filter(d => d.depth === 2).forEach(d => {
    const hue = HUES[d.data.group] ?? 30;
    d.color = d3.hsl(hue, SAT_GROUP, LIGHT_GROUP).toString();
  });
  root.descendants().filter(d => d.depth === 3).forEach(d => {
    const hue   = HUES[d.parent.data.group] ?? 30;
    const sibs  = d.parent.children;
    const idx   = sibs.indexOf(d);
    const offset = idx % 2 === 0 ? 0 : 0.04;
    d.color = d3.hsl(hue, SAT_BOOK, LIGHT_BOOK + offset).toString();
  });
  root.descendants().filter(d => d.depth === 4).forEach(d => {
    const book = d.parent;
    const hue  = HUES[book.parent.data.group] ?? 30;
    const idx  = book.children.indexOf(d);
    const tot  = book.children.length;
    const t    = idx / Math.max(1, tot - 1);
    const l    = CHAP_LIGHT_LO + t * (CHAP_LIGHT_HI - CHAP_LIGHT_LO);
    d.color = d3.hsl(hue, SAT_CHAP, l).toString();
  });

  return root;
}

// ── Theme tokens from CSS vars (for canvas drawing) ───────

export function themeTokens() {
  const cs = getComputedStyle(document.documentElement);
  return {
    tick: cs.getPropertyValue('--tick-color').trim() || 'rgba(0,0,0,0.50)',
    chap: cs.getPropertyValue('--chapter-stroke').trim() || 'rgba(0,0,0,0.85)',
    book: cs.getPropertyValue('--book-stroke').trim() || 'rgba(0,0,0,0.95)',
    ring: cs.getPropertyValue('--ring-stroke').trim() || 'rgba(0,0,0,0.50)',
  };
}

// ── Reader drawer (lazy-loaded scripture text) ────────────

const textCache = new Map();
let currentReaderChapter = null;

export function bookSlug(name) { return name.replace(/\s+/g, ''); }

async function loadBookText(bookName, lang) {
  const key = `${lang}/${bookSlug(bookName)}`;
  if (textCache.has(key)) return textCache.get(key);
  const promise = fetch(`./data/text/${lang}/${bookSlug(bookName)}.json`)
    .then(r => { if (!r.ok) throw new Error('not found'); return r.json(); });
  textCache.set(key, promise);
  try { return await promise; }
  catch (e) { textCache.delete(key); throw e; }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function openReader(chapter) {
  const book = chapter.parent;
  const bookEl = $('#reader-book');
  const chEl = $('#reader-chapter');
  const body = $('#reader-body');
  const t = I18N.ui[state.lang];

  currentReaderChapter = chapter;
  bookEl.textContent = bookLabel(book.data.name, state.lang);
  chEl.textContent = state.lang === 'zh'
    ? `${t.chapter}${chapter.data.name}章 · ${chapter.value} ${t.verses}`
    : `${t.chapter} ${chapter.data.name} · ${chapter.value} ${t.verses}`;
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

export function closeReader() {
  $('#reader').classList.remove('open');
  document.body.classList.remove('reader-open');
}

export function refreshReaderIfOpen() {
  if (currentReaderChapter && $('#reader').classList.contains('open')) {
    openReader(currentReaderChapter);
  }
}

// ── Tooltip helper ────────────────────────────────────────

export function showTooltip(html, event) {
  const tip = $('#tooltip');
  tip.innerHTML = html;
  tip.classList.add('visible');
  tip.style.left = (event.clientX + 14) + 'px';
  tip.style.top = (event.clientY + 14) + 'px';
}

export function hideTooltip() {
  $('#tooltip').classList.remove('visible');
}

// ── i18n helpers for the header ───────────────────────────

export function applyI18n() {
  const t = I18N.ui[state.lang];
  const set = (sel, txt) => { const el = $(sel); if (el) el.textContent = txt; };
  set('#title', t.title);
  set('#subtitle', t.subtitle);
  set('#hint', t.hint);
  set('#btn-lang', t.lang);
  set('#btn-reset', t.reset);
  document.documentElement.lang = state.lang;
}

// ── Utility: debounce ─────────────────────────────────────

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ── Ease + rAF tween helper for layout zoom animations ────

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Run a tween from 0→1 over `duration` ms, calling `onFrame(e)` each animation
 * frame with the eased progress `e`. Returns a handle with `.cancel()`.
 */
export function tween(duration, onFrame) {
  let raf = 0;
  const start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const e = easeInOutCubic(t);
    onFrame(e);
    if (t < 1) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return { cancel() { if (raf) cancelAnimationFrame(raf); } };
}

// Re-export i18n labels so layout modules only import shared.
export { I18N, bookLabel, groupLabel };
