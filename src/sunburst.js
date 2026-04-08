// Sunburst layout — D3 partition in polar coordinates + Canvas chapter ring.
// Exposes the same { id, label, mount, unmount, onLangChange } interface as
// the icicle and tidy-tree layouts.
import {
  state as shared, buildHierarchy, themeTokens,
  openReader, showTooltip, hideTooltip,
  bookLabel, groupLabel, I18N, TAU, debounce,
} from './shared.js?v=10';

// Radial bands (fraction of overall radius)
//   hub  →  testament  →  group  →  book  →  chapter
const RING = { hub: 0.10, testament: 0.18, group: 0.30, book: 0.58, chapter: 1.00 };

// Threshold (radians) below which a book label gets a radial leader line outside the chart
const LEADER_THRESHOLD = 0.022;

// Only fall back to a horizontal label at the top of the ring band when an
// arc spans (near-)full circle — i.e. it's the focused node or one of its
// ancestors after a zoom.
const WIDE_ARC = Math.PI * 1.85;  // ~333°
const VISIBLE_EPSILON = 0.001;

export const sunburstLayout = createSunburstLayout();

function createSunburstLayout() {
  // Per-layout state (recreated on mount)
  let root, chapters, focus;
  let stage, svg, gSel, canvas, ctx;
  let svgW = 0, svgH = 0, chartSize = 0, radius = 0, dpr = 1;
  let anim = null;
  let resizeHandler = null;

  function mount(container) {
    stage = container;
    root = buildHierarchy(shared.data);
    // Polar partition for sunburst — stores relative x0/x1 on each node.
    d3.partition().size([TAU, 1])(root);
    root.each(d => {
      if      (d.depth === 0) { d.r0 = 0;              d.r1 = RING.hub; }
      else if (d.depth === 1) { d.r0 = RING.hub;        d.r1 = RING.testament; }
      else if (d.depth === 2) { d.r0 = RING.testament;  d.r1 = RING.group; }
      else if (d.depth === 3) { d.r0 = RING.group;      d.r1 = RING.book; }
      else                    { d.r0 = RING.book;       d.r1 = RING.chapter; }
      d.X0 = d.x0; d.X1 = d.x1;
    });
    chapters = root.descendants().filter(d => d.depth === 4);
    focus = root;

    setup();
    render();
    resizeHandler = debounce(() => { setup(); render(); }, 120);
    window.addEventListener('resize', resizeHandler);
  }

  function unmount() {
    if (anim) { cancelAnimationFrame(anim); anim = null; }
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
    if (stage) stage.innerHTML = '';
    stage = svg = gSel = canvas = ctx = null;
  }

  function setup() {
    const w = Math.max(320, stage.clientWidth || window.innerWidth || 800);
    const h = Math.max(320, stage.clientHeight || window.innerHeight || 800);
    svgW = w; svgH = h;

    const isMobile = w < 720 || h < 720;
    const vMargin = isMobile ? 4 : 8;
    const hMargin = isMobile ? 14 : 22;
    radius = Math.min(w / 2 - hMargin, h / 2 - vMargin);
    chartSize = radius * 2 + 4;
    dpr = window.devicePixelRatio || 1;

    // Canvas — chapter ring
    canvas = stage.querySelector('canvas.sunburst-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'sunburst-canvas';
      stage.appendChild(canvas);
    }
    canvas.width  = chartSize * dpr;
    canvas.height = chartSize * dpr;
    canvas.style.width  = chartSize + 'px';
    canvas.style.height = chartSize + 'px';
    canvas.style.marginLeft = -(chartSize / 2) + 'px';
    canvas.style.marginTop  = -(chartSize / 2) + 'px';
    ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.translate(chartSize / 2, chartSize / 2);

    // SVG — full stage rectangle (labels can extend to screen edges)
    svg = stage.querySelector('svg.sunburst');
    if (!svg) {
      svg = d3.select(stage).append('svg').attr('class', 'sunburst').node();
    }
    d3.select(svg)
      .attr('viewBox', [-w/2, -h/2, w, h])
      .attr('width', w).attr('height', h)
      .style('margin-left', -(w / 2) + 'px')
      .style('margin-top',  -(h / 2) + 'px');
    const sel = d3.select(svg);
    sel.selectAll('*').remove();
    gSel = sel.append('g');
  }

  function render() {
    drawChapterCanvas();
    drawSvg();
  }

  function drawChapterCanvas() {
    if (!ctx) return;
    const R = radius;
    const big = R * 2 + 200;
    ctx.clearRect(-big, -big, big * 2, big * 2);
    const TK = themeTokens();

    const r0 = RING.book * R + 0.5;
    const r1 = RING.chapter * R;
    const HALF = Math.PI / 2;

    // 1. Filled annular wedges, one per chapter
    for (const d of chapters) {
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

    // 2. Verse tick marks
    const minStep = 1.4 / r1;
    const tickLen = Math.min(6, (r1 - r0) * 0.18);
    const tickInner = r1 - tickLen;
    ctx.lineWidth = 0.4;
    ctx.strokeStyle = TK.tick;
    ctx.beginPath();
    for (const d of chapters) {
      const span = d.x1 - d.x0;
      const verses = d.value;
      if (verses < 2) continue;
      const step = span / verses;
      if (step < minStep) continue;
      for (let i = 1; i < verses; i++) {
        const a = d.x0 + step * i - HALF;
        const cs = Math.cos(a), sn = Math.sin(a);
        ctx.moveTo(cs * tickInner, sn * tickInner);
        ctx.lineTo(cs * r1, sn * r1);
      }
    }
    ctx.stroke();

    // 3. Chapter boundary lines (within same book)
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = TK.chap;
    ctx.beginPath();
    for (let i = 0; i < chapters.length - 1; i++) {
      const d = chapters[i];
      if (chapters[i + 1].parent !== d.parent) continue;
      const a = d.x1 - HALF;
      const cs = Math.cos(a), sn = Math.sin(a);
      ctx.moveTo(cs * r0, sn * r0);
      ctx.lineTo(cs * r1, sn * r1);
    }
    ctx.stroke();

    // 4. Book boundary lines
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = TK.book;
    ctx.beginPath();
    const books = root.descendants().filter(n => n.depth === 3);
    for (const b of books) {
      const a = b.x1 - HALF;
      const cs = Math.cos(a), sn = Math.sin(a);
      ctx.moveTo(cs * r0, sn * r0);
      ctx.lineTo(cs * r1, sn * r1);
    }
    ctx.stroke();

    // 5. Outer & inner ring strokes
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
    if (!gSel) return;
    const g = gSel;
    g.selectAll('*').remove();
    const R = radius;

    const arc = d3.arc()
      .startAngle(d => d.x0)
      .endAngle(d => d.x1)
      .innerRadius(d => d.r0 * R)
      .outerRadius(d => d.r1 * R)
      .padAngle(d => d.depth === 1 ? 0.008 : (d.depth === 2 ? 0.004 : 0.002))
      .padRadius(R);

    const inner = root.descendants().filter(d => d.depth >= 1 && d.depth <= 3);
    g.selectAll('path.arc')
      .data(inner, nodeId)
      .enter()
      .append('path')
      .attr('class', d => 'arc depth-' + d.depth)
      .attr('d', arc)
      .attr('fill', d => d.depth === 1
        ? (d.data.name === 'OT' ? 'var(--ot-fill)' : 'var(--nt-fill)')
        : d.color)
      .attr('stroke', d => d.depth === 2 ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.35)')
      .attr('stroke-width', d => d.depth === 2 ? 0.9 : 0.6)
      .style('display', d => (d.x1 - d.x0) > 0.0005 ? null : 'none')
      .style('cursor', 'pointer')
      .on('click', (_, d) => zoomTo(d));

    // Group labels (depth 2)
    const defs = g.append('defs');
    const groups = root.descendants().filter(d => d.depth === 2 && (d.x1 - d.x0) > VISIBLE_EPSILON);
    const groupLeaders = [];
    groups.forEach((d, i) => {
      const text = groupLabel(d.data.group, shared.lang);
      const fitted = drawCurvedLabel(g, defs, d, R, `g-label-${i}`, 'group-label', 11, text);
      if (fitted) return;
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
      groupLeaders.push({ d, text });
    });

    // Book labels (depth 3)
    const books = root.descendants().filter(d => d.depth === 3 && (d.x1 - d.x0) > VISIBLE_EPSILON);
    const wide   = books.filter(d => (d.x1 - d.x0) >= LEADER_THRESHOLD);
    const narrow = books.filter(d => (d.x1 - d.x0) <  LEADER_THRESHOLD);
    const horizontalBooks = wide.filter(d => (d.x1 - d.x0) >= WIDE_ARC);
    const radialBooks     = wide.filter(d => (d.x1 - d.x0) <  WIDE_ARC);

    horizontalBooks.forEach(d => {
      drawHorizontalLabel(g, d, R, 'book-label', 14, bookLabel(d.data.name, shared.lang));
    });

    const bookHanClass = shared.lang === 'zh' ? ' han' : '';
    g.selectAll('text.book-label.radial')
      .data(radialBooks)
      .enter()
      .append('text')
      .attr('class', 'book-label radial' + bookHanClass)
      .attr('transform', d => bookLabelTransform(d))
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .style('font-size', d => labelFontSize(d) + 'px')
      .text(d => bookLabel(d.data.name, shared.lang, (d.x1 - d.x0) < 0.05));

    // Leader-line labels for narrow books
    const leaders = g.append('g').attr('class', 'leaders');
    const MIN_GAP = 14;
    const xMax = svgW / 2 - 12;
    const yMax = svgH / 2 - 12;

    const placed = narrow.map(d => {
      const a = (d.x0 + d.x1) / 2;
      const cosA = Math.cos(a - Math.PI/2);
      const sinA = Math.sin(a - Math.PI/2);
      const onRight = cosA >= 0;
      const tx = Math.abs(cosA) > 1e-6 ? xMax / Math.abs(cosA) : Infinity;
      const ty = Math.abs(sinA) > 1e-6 ? yMax / Math.abs(sinA) : Infinity;
      const t = Math.min(tx, ty);
      return {
        d, a, cosA, sinA, onRight,
        x: cosA * t, y: sinA * t,
        label: bookLabel(d.data.name, shared.lang),
      };
    });

    ['right', 'left'].forEach(side => {
      const arr = placed.filter(p => (p.onRight ? 'right' : 'left') === side)
        .sort((a, b) => a.y - b.y);
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].y - arr[i-1].y < MIN_GAP) arr[i].y = arr[i-1].y + MIN_GAP;
      }
      for (let i = arr.length - 2; i >= 0; i--) {
        if (arr[i+1].y - arr[i].y < MIN_GAP) arr[i].y = arr[i+1].y - MIN_GAP;
      }
    });

    for (const p of placed) {
      const ax = Math.cos(p.a - Math.PI/2) * (RING.chapter * R + 2);
      const ay = Math.sin(p.a - Math.PI/2) * (RING.chapter * R + 2);
      const mid = 0.55;
      const bx = ax + (p.x - ax) * mid;
      const by = ay + (p.y - ay) * mid;
      leaders.append('polyline')
        .attr('class', 'leader-line')
        .attr('points', `${ax},${ay} ${bx},${by} ${p.x},${p.y}`)
        .attr('fill', 'none')
        .attr('stroke', 'var(--fg-dim, #8a8472)')
        .attr('stroke-width', 0.5);
      leaders.append('text')
        .attr('class', 'leader-label')
        .attr('x', p.x + (p.onRight ? -4 : 4))
        .attr('y', p.y)
        .attr('dy', '0.32em')
        .attr('text-anchor', p.onRight ? 'end' : 'start')
        .text(p.label);
    }

    // Testament labels (depth 1)
    const t = I18N.ui[shared.lang];
    root.descendants()
      .filter(d => d.depth === 1 && (d.x1 - d.x0) > VISIBLE_EPSILON)
      .forEach((d, i) => {
        const text = d.data.name === 'OT' ? t.ot : t.nt;
        drawCurvedLabel(g, defs, d, R, `t-label-${i}`, 'testament-label', 13, text);
      });

    // Group leader-line labels for super-narrow groups
    if (groupLeaders.length) {
      const leadersG = g.append('g').attr('class', 'group-leaders');
      groupLeaders.forEach(({ d, text }) => {
        const a = (d.x0 + d.x1) / 2 - Math.PI / 2;
        const cs = Math.cos(a), sn = Math.sin(a);
        const r0p = ((d.r0 + d.r1) / 2) * R;
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
    const hubR = RING.hub * R - 1;
    center.append('circle')
      .attr('r', hubR)
      .attr('fill', 'var(--bg-soft, #16161d)')
      .attr('stroke', 'var(--accent)')
      .attr('stroke-width', 1.2)
      .style('cursor', 'pointer')
      .on('click', () => zoomTo(root));
    center.append('circle')
      .attr('r', hubR - 4)
      .attr('fill', 'none')
      .attr('stroke', 'var(--accent)')
      .attr('stroke-width', 0.4)
      .attr('opacity', 0.5)
      .style('pointer-events', 'none');
    center.append('text')
      .attr('class', 'name' + (shared.lang === 'zh' ? ' han' : ''))
      .attr('y', 6)
      .text(t.bible);

    // Hover + click layer
    d3.select(svg)
      .on('mousemove', onCanvasHover)
      .on('mouseleave', hideTooltip)
      .on('click', onCanvasClick);

    if (canvas) canvas.style.pointerEvents = 'none';
  }

  function drawHorizontalLabel(gSel, d, R, className, fontSize, text) {
    const r = ((d.r0 + d.r1) / 2) * R;
    const han = shared.lang === 'zh' ? ' han' : '';
    gSel.append('text')
      .attr('class', className + ' horizontal' + han)
      .attr('x', 0)
      .attr('y', -r)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .style('font-size', fontSize + 'px')
      .text(text);
    return true;
  }

  function drawCurvedLabel(gSel, defs, d, R, pathId, className, fontSize, text) {
    const span = d.x1 - d.x0;
    if (span >= WIDE_ARC) return drawHorizontalLabel(gSel, d, R, className, fontSize, text);
    const r = ((d.r0 + d.r1) / 2) * R;
    const arcLen = span * r;
    const isCJK = /[\u3000-\u9fff]/.test(text);
    const charW = isCJK ? fontSize * 1.05 : fontSize * 0.55;
    const textW = text.length * charW;
    if (arcLen < textW + 4) return false;

    const midAngle = (d.x0 + d.x1) / 2;
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
    const sx = Math.cos(a0) * r, sy = Math.sin(a0) * r;
    const ex = Math.cos(a1) * r, ey = Math.sin(a1) * r;
    const large = span > Math.PI ? 1 : 0;

    defs.append('path')
      .attr('id', pathId)
      .attr('d', `M ${sx},${sy} A ${r},${r} 0 ${large} ${sweep} ${ex},${ey}`);

    const han = shared.lang === 'zh' ? ' han' : '';
    gSel.append('text')
      .attr('class', className + han)
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
    const angle = (d.x0 + d.x1) / 2;
    const r = ((d.r0 + d.r1) / 2) * radius;
    const deg = (angle * 180 / Math.PI) - 90;
    const flip = (deg > 90 || deg < -90) ? 180 : 0;
    return `rotate(${deg}) translate(${r},0) rotate(${flip})`;
  }

  function labelFontSize(d) {
    const arcLen = (d.x1 - d.x0) * ((d.r0 + d.r1) / 2) * radius;
    return Math.max(8, Math.min(13, arcLen / 4));
  }

  function nodeId(d) {
    return d.ancestors().map(a => a.data.name).reverse().join('/');
  }

  // ── Hit testing ────────────────────────────────────────

  function onCanvasHover(event) {
    const rect = svg.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width/2;
    const y = event.clientY - rect.top - rect.height/2;
    const dist = Math.hypot(x, y);
    const R = radius;

    if (dist >= RING.book * R && dist <= RING.chapter * R) {
      let theta = Math.atan2(y, x) + Math.PI/2;
      if (theta < 0) theta += TAU;
      const chap = findChapter(theta);
      if (chap) {
        const book = chap.parent;
        const t = I18N.ui[shared.lang];
        const bn = bookLabel(book.data.name, shared.lang);
        const detail = shared.lang === 'zh'
          ? `${t.chapter}${chap.data.name}章 · ${chap.value} ${t.verses}`
          : `${t.chapter} ${chap.data.name} · ${chap.value} ${t.verses}`;
        showTooltip(`<div class="book">${bn}</div><div class="detail">${detail}</div>`, event);
        return;
      }
    }
    hideTooltip();
  }

  function onCanvasClick(event) {
    if (event.target.tagName === 'path' || event.target.tagName === 'circle') return;
    const rect = svg.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width/2;
    const y = event.clientY - rect.top - rect.height/2;
    const dist = Math.hypot(x, y);
    const R = radius;
    if (dist < RING.book * R || dist > RING.chapter * R) return;
    let theta = Math.atan2(y, x) + Math.PI/2;
    if (theta < 0) theta += TAU;
    const chap = findChapter(theta);
    if (chap) openReader(chap);
  }

  function findChapter(theta) {
    const arr = chapters;
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

  // ── Zoom ────────────────────────────────────────────────

  function zoomTo(target) {
    if (!target) return;
    if (target === focus) {
      if (focus === root) return;
      target = root;
    }
    focus = target;

    const span = focus.X1 - focus.X0;
    root.each(d => {
      d.sx0 = d.x0;
      d.sx1 = d.x1;
      d.tx0 = Math.max(0, Math.min(1, (d.X0 - focus.X0) / span)) * TAU;
      d.tx1 = Math.max(0, Math.min(1, (d.X1 - focus.X0) / span)) * TAU;
    });

    gSel.selectAll('text, defs, .leaders, .group-leaders, polyline.leader-line')
      .interrupt().style('opacity', 0);

    if (anim) cancelAnimationFrame(anim);
    const duration = 720;
    const start = performance.now();

    function ease(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2; }

    function frame(now) {
      const e = ease(Math.min(1, (now - start) / duration));
      root.each(d => {
        d.x0 = d.sx0 + (d.tx0 - d.sx0) * e;
        d.x1 = d.sx1 + (d.tx1 - d.sx1) * e;
      });
      const arc = currentArcGen();
      gSel.selectAll('path.arc').attr('d', arc);
      drawChapterCanvas();
      if (e < 1) {
        anim = requestAnimationFrame(frame);
      } else {
        anim = null;
        render();
      }
    }
    anim = requestAnimationFrame(frame);
  }

  function currentArcGen() {
    const R = radius;
    return d3.arc()
      .startAngle(d => d.x0)
      .endAngle(d => d.x1)
      .innerRadius(d => d.r0 * R)
      .outerRadius(d => d.r1 * R)
      .padAngle(d => d.depth === 1 ? 0.008 : (d.depth === 2 ? 0.004 : 0.002))
      .padRadius(R);
  }

  function onLangChange() { render(); }

  return {
    id: 'sunburst',
    label: { en: 'Sunburst', zh: '径向' },
    mount, unmount, onLangChange,
    zoomToRoot() { zoomTo(root); },
  };
}
