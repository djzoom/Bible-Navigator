// Morph transition between the sunburst (polar) and icicle-v (rectangular)
// layouts. Renders chapters on a canvas as polygon approximations whose
// vertices are interpolated between polar and rectangular positions.
// At t=0 the chart looks exactly like the sunburst, at t=1 it looks exactly
// like the icicle-v.
import { state as shared, buildHierarchy, themeTokens, tween, TAU } from './shared.js?v=7';

// Exactly the same fractional bands as sunburst's RING:
//   hub  [0, 0.10)  ·  testament [0.10, 0.18)  ·  group [0.18, 0.30)
//   book [0.30, 0.58)  ·  chapter [0.58, 1.00]
// Icicle uses the same numbers so the transition is proportionally seamless.
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

    // Direct polar ↔ rectangular blend — no rigid rotation, no spin, no
    // mirror flipping. Every node's position interpolates in a straight
    // line between its sunburst coordinate and its icicle coordinate. The
    // outer cubic ease makes the motion start and end gently so the
    // topological change (ring opening up into a list) is continuous.
    //
    //   Genesis (b≈0, angle -π/2)  →  top of the vertical list (y = -H/2)
    //   Middle book (b≈0.5, angle +π/2, bottom of sunburst)  →  middle (y = 0)
    //   Revelation (b≈1, angle wraps to -π/2)  →  bottom of the list (y = +H/2)
    //
    // Because Genesis and Revelation share the same sunburst point (the
    // seam at 12 o'clock) but different icicle destinations, the morph
    // inherently separates them — that separation IS the topological
    // change from a closed ring into an open line, and making every
    // node's path a straight line is the shortest and smoothest way to
    // show it.
    //
    // Running t from 1 → 0 plays the reverse automatically: the line
    // closes back into the ring.
    function blend(b, d, t) {
      const baseAngle = b * TAU - Math.PI / 2;     // Genesis at 12 o'clock
      const r = d * R;
      const polarX = Math.cos(baseAngle) * r;
      const polarY = Math.sin(baseAngle) * r;
      const rectX = (d - 0.5) * W;
      const rectY = (b - 0.5) * H;
      return [
        polarX + (rectX - polarX) * t,
        polarY + (rectY - polarY) * t,
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
