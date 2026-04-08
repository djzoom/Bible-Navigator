// Morph transition between the sunburst (polar) and icicle-v (rectangular)
// layouts. Renders chapters on a canvas as polygon approximations whose
// vertices are interpolated between polar and rectangular positions.
// At t=0 the chart looks exactly like the sunburst, at t=1 it looks exactly
// like the icicle-v.
import { state as shared, buildHierarchy, themeTokens, tween, TAU } from './shared.js?v=6';

// Same radial bands the sunburst layout uses (fractions of the "depth" axis).
const BAND = [0, 0.10, 0.18, 0.30, 0.58, 1.00];

const POLY_SAMPLES = 10;  // number of sample points along the inner/outer arc

/**
 * Run a sunburst ⇄ icicle-v morph on `stage`.
 *
 *   stage    — .chart-stage element
 *   fromId   — 'sunburst' | 'icicle-v'
 *   toId     — 'sunburst' | 'icicle-v'
 *   duration — ms
 *
 * Returns a promise that resolves after the morph finishes. The caller is
 * responsible for unmounting the previous layout before calling and mounting
 * the target layout after.
 */
export function runMorph(stage, fromId, toId, duration = 700) {
  return new Promise(resolve => {
    const w = Math.max(320, stage.clientWidth  || 800);
    const h = Math.max(320, stage.clientHeight || 800);
    const dpr = window.devicePixelRatio || 1;

    // Build fresh hierarchy and partition on [0,1] along both axes so we get
    // canonical breadth / depth fractions.
    const root = buildHierarchy(shared.data);
    d3.partition().size([1, 1]).padding(0)(root);

    // For each node, compute both the polar centroid/band and the rect box.
    // Breadth = x0/x1 (fractions of full circle / full width).
    // Depth is fixed by BAND[depth]..BAND[depth+1].
    const nodes = root.descendants();
    const chapters = nodes.filter(d => d.depth === 4);
    const books    = nodes.filter(d => d.depth === 3);
    const groups   = nodes.filter(d => d.depth === 2);
    const testaments = nodes.filter(d => d.depth === 1);

    // Canvas radii / rectangle dimensions
    const isMobile = w < 720 || h < 720;
    const vMargin = isMobile ? 4 : 8;
    const hMargin = isMobile ? 14 : 22;
    const R = Math.min(w / 2 - hMargin, h / 2 - vMargin);

    // For vertical icicle: full width (W) and full height (H).
    const W = w;
    const H = h;

    // Canvas overlay
    const canvas = document.createElement('canvas');
    canvas.className = 'morph-canvas';
    canvas.style.position = 'absolute';
    canvas.style.top = '50%';
    canvas.style.left = '50%';
    canvas.style.marginLeft = -(w / 2) + 'px';
    canvas.style.marginTop  = -(h / 2) + 'px';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '5';
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    stage.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.translate(w / 2, h / 2);    // origin at center

    // Morph choreography (t ∈ [0, 1]):
    //
    //   Phase 1  [0, P1)  — rigid 90° CW rotation of the whole ring
    //     Every chapter rotates as one body. Genesis slides from 12 o'clock
    //     to 3 o'clock, Revelation rides along right next to it.
    //
    //   Phase 2  [P1, 1]  — the ring spins CCW while books peel off
    //     The whole ring keeps rotating counter-clockwise at a constant rate
    //     during phase 2 (exactly one full turn: -τ radians). On top of that
    //     rotation, books "peel off" the ring onto the vertical list in the
    //     same order they sit on the ring: Genesis (b=0) leaves first and
    //     locks into y=-H/2, then Exodus, Leviticus, … and finally
    //     Revelation (b=1), which rides the full turn of the spin before
    //     sliding to y=+H/2.
    //
    //   This preserves the correspondence: you can watch a single book
    //   travel from its ring slot to its list slot without losing it, and
    //   it matches the user's description ("Genesis keeps its orientation
    //   and gradually rises; Revelation at the tail spins counter-clockwise
    //   once and ends up at the bottom of the list").
    //
    //   Running t in reverse plays the mirror sequence: Revelation descends
    //   while rotating clockwise and rejoins Genesis at the top, reforming
    //   the ring, which then unrotates 90° CCW back to the sunburst.
    const P1 = 0.30;
    const TRANS_DURATION = 0.42;  // how long each individual book's peel-off takes
    function blend(b, d, t) {
      const baseAngle = b * TAU - Math.PI / 2;  // Genesis starts at 12 o'clock
      const r = d * R;
      const rectX = (d - 0.5) * W;
      const rectY = (b - 0.5) * H;

      // Phase 1 — rigid rotation
      if (t <= P1) {
        const u = t / P1;
        const angle = baseAngle + u * (Math.PI / 2);  // +π/2 = visual CW in Y-down
        return [Math.cos(angle) * r, Math.sin(angle) * r];
      }

      // Phase 2 — spinning unroll
      const u = (t - P1) / (1 - P1);
      const rotatedAngle = baseAngle + Math.PI / 2;    // position at end of phase 1

      // 2a. Entire ring turns -τ radians over phase 2 (one full CCW turn)
      const ringRotation = -u * TAU;
      const spunAngle = rotatedAngle + ringRotation;
      const spunX = Math.cos(spunAngle) * r;
      const spunY = Math.sin(spunAngle) * r;

      // 2b. Each book begins its individual peel-off at its own staggered
      //     start time so that Genesis (b=0) leaves the ring first and
      //     Revelation (b=1) leaves last. "Start" slides from 0 to
      //     (1 − TRANS_DURATION) as b goes 0 → 1.
      const transitionStart = b * (1 - TRANS_DURATION);
      const raw = (u - transitionStart) / TRANS_DURATION;
      const clamped = raw < 0 ? 0 : raw > 1 ? 1 : raw;
      // Quintic ease-in-out so the peel-off looks like a confident glide
      const tU = clamped < 0.5
        ? 16 * clamped * clamped * clamped * clamped * clamped
        : 1 - Math.pow(-2 * clamped + 2, 5) / 2;

      return [
        spunX + (rectX - spunX) * tU,
        spunY + (rectY - spunY) * tU,
      ];
    }

    // Build a polygon for an annular-sector node (sunburst chapter becomes
    // a rectangle as t→1). Sample N points along the outer arc and N along
    // the inner arc.
    function nodePolygon(node, t) {
      const b0 = node.x0, b1 = node.x1;
      const depth = node.depth;
      const d0 = BAND[depth];
      const d1 = BAND[depth + 1];
      if (b1 - b0 < 1e-7) return null;
      const pts = [];
      // Outer boundary (d1)
      for (let i = 0; i <= POLY_SAMPLES; i++) {
        const s = i / POLY_SAMPLES;
        const b = b0 + (b1 - b0) * s;
        pts.push(blend(b, d1, t));
      }
      // Inner boundary (d0) in reverse
      for (let i = POLY_SAMPLES; i >= 0; i--) {
        const s = i / POLY_SAMPLES;
        const b = b0 + (b1 - b0) * s;
        pts.push(blend(b, d0, t));
      }
      return pts;
    }

    function drawPolygon(pts, fillStyle) {
      if (!pts || pts.length < 3) return;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fillStyle = fillStyle;
      ctx.fill();
    }

    function draw(t) {
      ctx.clearRect(-w, -h, w * 2, h * 2);
      const TK = themeTokens();

      // Draw from deepest ring outward so the hub stays on top.
      // Actually draw from shallowest to deepest so chapters are on top.
      // Testament (1)
      for (const d of testaments) {
        const poly = nodePolygon(d, t);
        drawPolygon(poly, d.data.name === 'OT'
          ? getComputedStyle(document.documentElement).getPropertyValue('--ot-fill').trim() || '#261810'
          : getComputedStyle(document.documentElement).getPropertyValue('--nt-fill').trim() || '#0a1822');
      }
      // Group (2)
      for (const d of groups) drawPolygon(nodePolygon(d, t), d.color);
      // Book (3)
      for (const d of books) drawPolygon(nodePolygon(d, t), d.color);
      // Chapter (4)
      for (const d of chapters) drawPolygon(nodePolygon(d, t), d.color);

      // Subtle strokes between groups / books to preserve hierarchy legibility
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = TK.book;
      for (const b of books) {
        const poly = nodePolygon(b, t);
        if (!poly) continue;
        ctx.beginPath();
        ctx.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
        ctx.closePath();
        ctx.stroke();
      }
    }

    const fromT = fromId === 'sunburst' ? 0 : 1;
    const toT   = toId   === 'sunburst' ? 0 : 1;

    function ease(e) { return e < 0.5 ? 4*e*e*e : 1 - Math.pow(-2*e + 2, 3) / 2; }

    const start = performance.now();
    function frame(now) {
      const raw = Math.min(1, (now - start) / duration);
      const e = ease(raw);
      const t = fromT + (toT - fromT) * e;
      draw(t);
      if (raw < 1) {
        requestAnimationFrame(frame);
      } else {
        // Clean up the morph canvas
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        resolve();
      }
    }
    // Draw the starting frame immediately so there's no flash
    draw(fromT);
    requestAnimationFrame(frame);
  });
}
