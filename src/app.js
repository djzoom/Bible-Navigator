// App entry — loads data, wires up shared controls + layout switcher.
import {
  state as shared, applyI18n, closeReader, refreshReaderIfOpen, $,
} from './shared.js?v=10';
import { sunburstLayout } from './sunburst.js?v=10';
import { createIcicleLayout } from './icicle.js?v=10';
import { runMorph } from './morph.js?v=10';

const layouts = {
  'sunburst': sunburstLayout,
  'icicle-v': createIcicleLayout('v'),
};

let active = null;
let stage = null;

async function init() {
  shared.lang = localStorage.getItem('bs-lang') || 'en';
  document.documentElement.classList.remove('light');
  localStorage.removeItem('bs-theme');

  const res = await fetch('./data/bible.json');
  shared.data = await res.json();

  stage = $('.chart-stage');
  applyI18n();
  bindControls();
  bindGestures();

  const initial = layouts[location.hash.slice(1)] ? location.hash.slice(1) : 'sunburst';
  switchTo(initial, { immediate: true });

  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (layouts[id]) switchTo(id);
  });
}

let switching = false;

async function switchTo(id, { immediate = false } = {}) {
  if (!layouts[id]) id = 'sunburst';
  if (active?.id === id) return;
  if (switching) return;
  switching = true;

  const fromId = active?.id;
  const canMorph =
    !immediate &&
    (fromId === 'sunburst' || fromId === 'icicle-v') &&
    (id === 'sunburst' || id === 'icicle-v');

  if (canMorph && stage) {
    // Unmount the current layout so its static SVG/canvas vanish; the morph
    // canvas will carry the animation through the intermediate frames, then
    // we mount the target layout at the end.
    if (active) active.unmount();
    active = null;
    await runMorph(stage, fromId, id, 1200);
    active = layouts[id];
    active.mount(stage);
  } else {
    if (!immediate && stage) {
      stage.style.opacity = '0';
      await new Promise(r => setTimeout(r, 160));
    }
    if (active) active.unmount();
    active = layouts[id];
    active.mount(stage);
    if (!immediate && stage) {
      requestAnimationFrame(() => {
        stage.style.transition = 'opacity 0.2s ease';
        stage.style.opacity = '1';
      });
    } else if (stage) {
      stage.style.opacity = '1';
    }
  }

  document.querySelectorAll('.layout-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.layout === id));

  if (location.hash.slice(1) !== id) {
    history.replaceState(null, '', '#' + id);
  }

  switching = false;
}

function bindControls() {
  $('#btn-lang').addEventListener('click', () => {
    shared.lang = shared.lang === 'en' ? 'zh' : 'en';
    localStorage.setItem('bs-lang', shared.lang);
    applyI18n();
    if (active?.onLangChange) active.onLangChange();
    refreshReaderIfOpen();
  });
  $('#btn-reset').addEventListener('click', () => {
    if (active?.zoomToRoot) active.zoomToRoot();
  });
  $('#reader-close').addEventListener('click', closeReader);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeReader();
  });
  // Layout switcher
  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTo(btn.dataset.layout));
  });
}

// Minimal pinch/pan/wheel gestures for the active layout's .chart-stage.
// Each layout is free to override behavior; this one applies CSS transform.
function bindGestures() {
  const wrap = $('.chart-wrap');
  if (!wrap) return;
  const getStage = () => $('.chart-stage');

  let scale = 1, panX = 0, panY = 0;
  let pinchStart = 0, scaleStart = 1, panStart = null;

  function apply() {
    const s = getStage();
    if (!s) return;
    s.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  }

  function dist(a, b) {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  wrap.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      pinchStart = dist(e.touches[0], e.touches[1]);
      scaleStart = scale;
      e.preventDefault();
    } else if (e.touches.length === 1 && scale > 1) {
      panStart = { x: e.touches[0].clientX - panX, y: e.touches[0].clientY - panY };
      e.preventDefault();
    }
  }, { passive: false });

  wrap.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && pinchStart) {
      const d = dist(e.touches[0], e.touches[1]);
      scale = Math.max(0.5, Math.min(6, scaleStart * d / pinchStart));
      apply();
      e.preventDefault();
    } else if (e.touches.length === 1 && panStart) {
      panX = e.touches[0].clientX - panStart.x;
      panY = e.touches[0].clientY - panStart.y;
      apply();
      e.preventDefault();
    }
  }, { passive: false });

  wrap.addEventListener('touchend', e => {
    if (e.touches.length === 0) { pinchStart = 0; panStart = null; }
  });

  wrap.addEventListener('wheel', e => {
    if (!e.ctrlKey && Math.abs(e.deltaY) < 4) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    scale = Math.max(0.5, Math.min(6, scale * factor));
    apply();
  }, { passive: false });
}

init();
