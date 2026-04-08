// Icicle layout — rectangular space-filling partition with two orientations.
// Shares data, colors, reader and state with the sunburst via shared.js.
import {
  state, buildHierarchy, themeTokens,
  openReader, showTooltip, hideTooltip,
  bookLabel, groupLabel, I18N, tween,
  findByPath, pathOf,
} from './shared.js?v=15';

// Depth bands — identical to sunburst RING so every level takes up the same
// fraction of the depth axis in both views.
//   0=root hub [0, .10) · 1=testament [.10, .18) · 2=group [.18, .30)
//   3=book [.30, .58)   · 4=chapter [.58, 1.0]
const BAND = [0, 0.10, 0.18, 0.30, 0.58, 1.00];

export function createIcicleLayout(orientation /* 'v' | 'h' */) {
  // 'v' = books flow vertically (Genesis at top, Revelation at bottom),
  //       hierarchy depth runs left→right (Bible hub on the left).
  // 'h' = books flow horizontally, depth runs top→bottom.
  const booksVertical = orientation === 'v';
  const id = booksVertical ? 'icicle-v' : 'icicle-h';

  // Per-layout state
  let root, chapters;
  let W = 0, H = 0;
  let breadth = 0, depth = 0;
  let stage, svg, g, canvas, ctx;
  let dpr = 1;
  let focus = null;
  let anim = null;
  let resizeHandler = null;

  function mount(container) {
    stage = container;
    root = buildHierarchy(state.data);
    chapters = root.descendants().filter(d => d.depth === 4);
    // Restore focus from shared state so it survives layout switches.
    focus = findByPath(root, state.focusPath) || root;

    setup();
    render();
    window.addEventListener('resize', (resizeHandler = debounce(() => {
      setup(); render();
    }, 120)));
  }

  function unmount() {
    if (anim) anim.cancel();
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    stage.innerHTML = '';
    stage = svg = g = canvas = ctx = null;
  }

  function debounce(fn, ms) {
    let t;
    return () => { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  function setup() {
    W = Math.max(320, stage.clientWidth  || window.innerWidth  || 800);
    H = Math.max(320, stage.clientHeight || window.innerHeight || 800);
    dpr = window.devicePixelRatio || 1;

    // booksVertical: breadth (book axis) is vertical, hierarchy depth is horizontal
    breadth = booksVertical ? H : W;
    depth   = booksVertical ? W : H;

    // Canvas for chapter rectangles
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'icicle-canvas';
      stage.appendChild(canvas);
    }
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    canvas.style.marginLeft = -(W / 2) + 'px';
    canvas.style.marginTop  = -(H / 2) + 'px';
    ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // SVG overlay
    if (!svg) {
      svg = d3.select(stage).append('svg').attr('class', 'icicle-svg').node();
    }
    d3.select(svg)
      .attr('viewBox', [0, 0, W, H])
      .attr('width', W).attr('height', H)
      .style('margin-left', -(W / 2) + 'px')
      .style('margin-top',  -(H / 2) + 'px');
    const sel = d3.select(svg);
    sel.selectAll('*').remove();
    g = sel.append('g');

    sel.on('click', onStageClick);
    sel.on('mousemove', onStageHover);
    sel.on('mouseleave', hideTooltip);

    layoutNodes();
  }

  // Convert a (breadth, depth) coordinate into an (x, y) screen coordinate.
  //   booksVertical = true  → depth on X axis, breadth on Y axis
  //   booksVertical = false → breadth on X axis, depth on Y axis
  function toXY(b0, b1, d0, d1) {
    if (booksVertical) return { x: d0, y: b0, w: d1 - d0, h: b1 - b0 };
    return               { x: b0, y: d0, w: b1 - b0, h: d1 - d0 };
  }

  // Run partition and stamp each node with its pixel-space rectangle.
  function layoutNodes() {
    const focusBand = [focus.X0 ?? 0, focus.X1 ?? 1];
    // For the first time, compute canonical [0, 1] bounds along breadth axis
    // from a temporary partition. We keep them as `.X0/.X1` on each node
    // for stable zoom reference.
    if (root.X0 === undefined) {
      d3.partition().size([1, 1]).padding(0)(root);
      root.each(d => { d.X0 = d.x0; d.X1 = d.x1; });
    }

    // Build target rectangles based on current focus.
    const focusX0 = focus.X0, focusX1 = focus.X1, span = focusX1 - focusX0;
    const focusDepth = focus.depth;

    // Match the sunburst's focus semantics: stretch the focus subtree's
    // breadth to fill the breadth axis. DEPTH bands always use absolute
    // BAND values so the levels above focus stay visible (as full-width
    // strips), the focus itself is a full-width strip, and its descendants
    // are subdivided beneath it — a direct rectangular analogue of the
    // sunburst's behavior.
    root.each(d => {
      const bx0 = (Math.max(0, Math.min(1, (d.X0 - focusX0) / span))) * breadth;
      const bx1 = (Math.max(0, Math.min(1, (d.X1 - focusX0) / span))) * breadth;
      const raw0 = BAND[Math.max(0, d.depth)] ?? 0;
      const raw1 = BAND[Math.max(0, d.depth + 1)] ?? 1;
      const dy0 = raw0 * depth;
      const dy1 = raw1 * depth;

      d.bx0 = bx0; d.bx1 = bx1;
      d.dy0 = dy0; d.dy1 = dy1;
      const r = toXY(bx0, bx1, dy0, dy1);
      d.rx = r.x; d.ry = r.y; d.rw = r.w; d.rh = r.h;
    });
  }

  function render() {
    drawChapterCanvas();
    drawSvg();
  }

  function drawChapterCanvas() {
    if (!ctx) return;
    const TK = themeTokens();
    ctx.clearRect(0, 0, W, H);

    // 1. Fill each chapter rect
    for (const d of chapters) {
      if (d.rw <= 0 || d.rh <= 0) continue;
      if (d.rw < 0.5 || d.rh < 0.5) continue;
      ctx.fillStyle = d.color;
      ctx.fillRect(d.rx, d.ry, d.rw, d.rh);
    }

    // 2. Verse tick marks along the breadth axis within each chapter
    ctx.lineWidth = 0.4;
    ctx.strokeStyle = TK.tick;
    ctx.beginPath();
    for (const d of chapters) {
      // breadth axis is the book direction; in booksVertical mode that's Y
      const bLen = booksVertical ? d.rh : d.rw;
      const verses = d.value;
      if (verses < 2 || bLen < 2) continue;
      const step = bLen / verses;
      if (step < 1.4) continue;
      for (let i = 1; i < verses; i++) {
        if (booksVertical) {
          // ticks are horizontal lines at varying y, drawn near the far edge of the chapter
          const y = d.ry + step * i;
          ctx.moveTo(d.rx + d.rw * 0.82, y);
          ctx.lineTo(d.rx + d.rw, y);
        } else {
          const x = d.rx + step * i;
          ctx.moveTo(x, d.ry + d.rh * 0.82);
          ctx.lineTo(x, d.ry + d.rh);
        }
      }
    }
    ctx.stroke();

    // 3. Chapter boundary lines inside same book (perpendicular to breadth)
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = TK.chap;
    ctx.beginPath();
    for (let i = 0; i < chapters.length - 1; i++) {
      const d = chapters[i];
      const next = chapters[i + 1];
      if (next.parent !== d.parent) continue;
      if (booksVertical) {
        // separator between consecutive chapters is a horizontal line at y = end of chapter
        const y = d.ry + d.rh;
        ctx.moveTo(d.rx, y);
        ctx.lineTo(d.rx + d.rw, y);
      } else {
        const x = d.rx + d.rw;
        ctx.moveTo(x, d.ry);
        ctx.lineTo(x, d.ry + d.rh);
      }
    }
    ctx.stroke();

    // 4. Book boundaries (strongest)
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = TK.book;
    ctx.beginPath();
    const books = root.descendants().filter(n => n.depth === 3);
    for (const b of books) {
      if (b.rw <= 0 || b.rh <= 0) continue;
      if (booksVertical) {
        const y = b.ry + b.rh;
        ctx.moveTo(b.rx, y);
        ctx.lineTo(b.rx + b.rw, y);
      } else {
        const x = b.rx + b.rw;
        ctx.moveTo(x, b.ry);
        ctx.lineTo(x, b.ry + b.rh);
      }
    }
    ctx.stroke();
  }

  function drawSvg() {
    if (!g) return;
    g.selectAll('*').remove();

    const inner = root.descendants().filter(d => d.depth >= 1 && d.depth <= 3);

    g.selectAll('rect.arc')
      .data(inner)
      .enter()
      .append('rect')
      .attr('class', d => 'arc depth-' + d.depth)
      .attr('x', d => d.rx)
      .attr('y', d => d.ry)
      .attr('width',  d => Math.max(0, d.rw))
      .attr('height', d => Math.max(0, d.rh))
      .attr('fill', d => d.depth === 1
        ? (d.data.name === 'OT' ? 'var(--ot-fill)' : 'var(--nt-fill)')
        : d.color)
      .attr('stroke', d => d.depth === 2 ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.35)')
      .attr('stroke-width', d => d.depth === 2 ? 1.0 : 0.6)
      .style('display', d => (d.rw > 0.5 && d.rh > 0.5) ? null : 'none')
      .style('cursor', 'pointer')
      .on('click', (_, d) => zoomTo(d));

    // Testament + group labels: use the simple in-rect placement (they
    // always have plenty of space).
    [1, 2].forEach(dep => {
      const nodes = inner.filter(d => d.depth === dep);
      nodes.forEach(d => drawLabel(d, dep));
    });
    // Book labels: collision-avoided so all 66 show and no two overlap.
    drawBookLabels(inner.filter(d => d.depth === 3));

    // Hub (root) "Bible" label at top of stage
    const rootNode = root;
    if (rootNode.rw > 40 && rootNode.rh > 20) {
      const t = I18N.ui[state.lang];
      g.append('text')
        .attr('class', 'center-label')
        .attr('x', rootNode.rx + rootNode.rw / 2)
        .attr('y', rootNode.ry + rootNode.rh / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .style('font-family', 'var(--font-serif)')
        .style('font-size', '15px')
        .style('font-weight', '700')
        .style('fill', 'var(--accent-strong)')
        .text(t.bible);
    }
  }

  function drawLabel(d, depth) {
    if (d.rw < 4 || d.rh < 4) return;
    let text;
    if (depth === 1) {
      const t = I18N.ui[state.lang];
      text = d.data.name === 'OT' ? t.ot : t.nt;
    } else if (depth === 2) {
      text = groupLabel(d.data.group, state.lang);
    } else {
      text = bookLabel(d.data.name, state.lang);
    }

    const fontSize = depth === 1 ? 13 : depth === 2 ? 11 : 10;
    const isCJK = /[\u3000-\u9fff]/.test(text);
    const charW = isCJK ? fontSize * 1.05 : fontSize * 0.55;
    const textW = text.length * charW;

    const hanClass = state.lang === 'zh' ? ' han' : '';
    const cx = d.rx + d.rw / 2;
    const cy = d.ry + d.rh / 2;

    // Horizontal fit
    if (d.rw >= textW + 4 && d.rh >= fontSize + 2) {
      g.append('text')
        .attr('class', `${labelClass(depth)}${hanClass}`)
        .attr('x', cx)
        .attr('y', cy)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .style('font-size', fontSize + 'px')
        .text(text);
      return;
    }
    // Vertical fit (rotate 90°)
    if (d.rh >= textW + 4 && d.rw >= fontSize + 2) {
      g.append('text')
        .attr('class', `${labelClass(depth)}${hanClass}`)
        .attr('x', 0).attr('y', 0)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('transform', `translate(${cx},${cy}) rotate(-90)`)
        .style('font-size', fontSize + 'px')
        .text(text);
      return;
    }
    // If neither orientation fits the full name, skip the label entirely
    // rather than showing an abbreviation — full names only.
  }

  function labelClass(depth) {
    return depth === 1 ? 'testament-label'
         : depth === 2 ? 'group-label'
         : 'book-label radial';
  }

  // Draw all book labels with collision avoidance so every book shows its
  // full name and no two labels overlap.
  //
  // Strategy (booksVertical):
  //   1. For each book, compute the ideal label Y as the rect's vertical
  //      centroid and the X as the right edge of the book column (so text
  //      extends leftward into the column and never into the chapter band).
  //   2. Sort by Y, two-pass relaxation with MIN_GAP vertical spacing so
  //      adjacent labels can't touch.
  //   3. Draw a thin leader line from the rect centroid to the shifted Y
  //      whenever the label got pushed away from its natural position.
  //
  // booksHorizontal mode is symmetric (X <-> Y).
  function drawBookLabels(books) {
    if (!books.length) return;
    const fontSize = 10;
    const MIN_GAP = fontSize + 2;
    const hanClass = state.lang === 'zh' ? ' han' : '';
    const layer = g.append('g').attr('class', 'book-labels');

    // 1. Compute natural positions + label text
    const placed = books.map(d => {
      const text = bookLabel(d.data.name, state.lang);
      const isCJK = /[\u3000-\u9fff]/.test(text);
      const charW = isCJK ? fontSize * 1.05 : fontSize * 0.55;
      const textW = text.length * charW;
      if (booksVertical) {
        return {
          d, text, textW,
          // Anchor at the right edge of the book column, text flows left.
          anchorX: d.rx + d.rw - 4,
          anchorY: d.ry + d.rh / 2,
          naturalY: d.ry + d.rh / 2,
          y: d.ry + d.rh / 2,
        };
      } else {
        return {
          d, text, textW,
          anchorX: d.rx + d.rw / 2,
          anchorY: d.ry + d.rh - 4,
          naturalY: d.rx + d.rw / 2,
          y: d.rx + d.rw / 2,
        };
      }
    });

    // 2. Sort by natural position and relax
    placed.sort((a, b) => a.naturalY - b.naturalY);
    // Forward pass: push down
    for (let i = 1; i < placed.length; i++) {
      if (placed[i].y - placed[i - 1].y < MIN_GAP) {
        placed[i].y = placed[i - 1].y + MIN_GAP;
      }
    }
    // Backward pass: push up (so we don't run off the bottom edge)
    for (let i = placed.length - 2; i >= 0; i--) {
      if (placed[i + 1].y - placed[i].y < MIN_GAP) {
        placed[i].y = placed[i + 1].y - MIN_GAP;
      }
    }

    // 3. Draw leader (if shifted) + text
    for (const p of placed) {
      const shifted = Math.abs(p.y - p.naturalY) > 0.5;
      if (booksVertical) {
        if (shifted) {
          layer.append('line')
            .attr('x1', p.d.rx + p.d.rw)
            .attr('y1', p.anchorY)
            .attr('x2', p.anchorX)
            .attr('y2', p.y)
            .attr('stroke', 'var(--fg-dim)')
            .attr('stroke-width', 0.5)
            .attr('opacity', 0.6);
        }
        layer.append('text')
          .attr('class', `book-label${hanClass}`)
          .attr('x', p.anchorX)
          .attr('y', p.y)
          .attr('text-anchor', 'end')
          .attr('dominant-baseline', 'middle')
          .style('font-size', fontSize + 'px')
          .text(p.text);
      } else {
        // Horizontal books layout: place labels below each book column,
        // collision-resolved on X instead of Y.
        if (shifted) {
          layer.append('line')
            .attr('x1', p.naturalY)
            .attr('y1', p.d.ry + p.d.rh)
            .attr('x2', p.y)
            .attr('y2', p.anchorY + 8)
            .attr('stroke', 'var(--fg-dim)')
            .attr('stroke-width', 0.5)
            .attr('opacity', 0.6);
        }
        layer.append('text')
          .attr('class', `book-label${hanClass}`)
          .attr('x', p.y)
          .attr('y', p.anchorY + 8)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'hanging')
          .style('font-size', fontSize + 'px')
          .text(p.text);
      }
    }
  }

  // ── Interactions ──────────────────────────────────────

  function onStageHover(event) {
    // Hit-test the chapter level on canvas via pixel coords
    const rect = svg.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const chap = findChapterAt(x, y);
    if (chap) {
      const book = chap.parent;
      const t = I18N.ui[state.lang];
      const bn = bookLabel(book.data.name, state.lang);
      const detail = state.lang === 'zh'
        ? `${t.chapter}${chap.data.name}章 · ${chap.value} ${t.verses}`
        : `${t.chapter} ${chap.data.name} · ${chap.value} ${t.verses}`;
      showTooltip(`<div class="book">${bn}</div><div class="detail">${detail}</div>`, event);
    } else {
      hideTooltip();
    }
  }

  function onStageClick(event) {
    if (event.target.tagName === 'rect' || event.target.tagName === 'text') return;
    const rect = svg.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const chap = findChapterAt(x, y);
    if (chap) openReader(chap);
  }

  function findChapterAt(x, y) {
    for (const d of chapters) {
      if (x >= d.rx && x <= d.rx + d.rw && y >= d.ry && y <= d.ry + d.rh) return d;
    }
    return null;
  }

  // ── Zoom (tween rectangles) ───────────────────────────

  function zoomTo(target) {
    if (!target) return;
    if (target === focus && focus !== root) target = root;
    else if (target === focus) return;

    focus = target;
    // Persist focus for layout switches
    state.focusPath = pathOf(focus);

    // Snapshot current rects
    root.each(d => {
      d.sRx = d.rx; d.sRy = d.ry; d.sRw = d.rw; d.sRh = d.rh;
    });

    // Compute target rects
    layoutNodes();
    root.each(d => {
      d.tRx = d.rx; d.tRy = d.ry; d.tRw = d.rw; d.tRh = d.rh;
      // Restore starting state for now; frame loop will lerp.
      d.rx = d.sRx; d.ry = d.sRy; d.rw = d.sRw; d.rh = d.sRh;
    });

    if (anim) anim.cancel();
    anim = tween(600, e => {
      root.each(d => {
        d.rx = d.sRx + (d.tRx - d.sRx) * e;
        d.ry = d.sRy + (d.tRy - d.sRy) * e;
        d.rw = d.sRw + (d.tRw - d.sRw) * e;
        d.rh = d.sRh + (d.tRh - d.sRh) * e;
      });
      render();
    });
  }

  function onLangChange() { render(); }

  return {
    id,
    label: booksVertical
      ? { en: 'Icicle V', zh: '矩纵' }
      : { en: 'Icicle H', zh: '矩横' },
    mount, unmount, onLangChange,
    zoomToRoot() { zoomTo(root); },
  };
}
