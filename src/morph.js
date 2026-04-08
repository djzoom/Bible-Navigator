// Morph transition between the sunburst (polar) and icicle-v (rectangular)
// layouts. Renders chapters on a canvas as polygon approximations whose
// vertices are interpolated between polar and rectangular positions.
// At t=0 the chart looks exactly like the sunburst, at t=1 it looks exactly
// like the icicle-v.
import { state as shared, buildHierarchy, themeTokens, tween, TAU } from './shared.js?v=11';

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

    // Outward Arc Slide (2D, no overlap, no mirror/3D cues):
    //
    // There is a single reference curve at the outer edge of the chapter
    // ring (d = 1). This curve is ALWAYS a circular arc of a single smoothly
    // varying radius, length and orientation, morphing from a full circle
    // at t = 0 into a straight vertical line at t = 1.
    //
    //   t = 0 : full circle of radius R, Genesis pinned at (0, -R), curve
    //           traversed clockwise so breadth b = 0 is at 12 o'clock and
    //           b = 1 wraps back onto Genesis (closed ring).
    //   t = 1 : vertical line at x = 0.5·W, running from (0.5·W, -H/2) down
    //           to (0.5·W, +H/2), Genesis at the top and Revelation at the
    //           bottom.
    //
    // For intermediate t, the arc length L(t) interpolates from 2π·R → H,
    // the subtended angle α(t) interpolates from 2π → 0, so the radius
    // ρ(t) = L(t)/α(t) grows smoothly from R to infinity. The arc's
    // starting point G(t) and its starting tangent τ(t) both interpolate
    // linearly, which places the arc in the plane and rotates it so that
    // Genesis's tangent points from east (t=0) to south (t=1).
    //
    // A point at breadth b is at arc-length s = b · L(t) along this curve,
    // measured from Genesis going in the traversal direction. At t = 0
    // that direction is clockwise around the ring; as the curve opens,
    // Revelation slides continuously along the OUTSIDE of the (shrinking)
    // loop until, at t = 1, it has arrived at the bottom of the vertical
    // line. It never passes through the interior of the former ring and
    // never overlaps with any other book's trajectory.
    //
    // The depth coordinate d is applied as a transverse offset from the
    // reference curve toward the "inside" (the arc's center, or leftward
    // at t = 1). The offset magnitude is (1 − d) · transScale(t), where
    // transScale(t) = (1 − t)·R + t·W. This makes d = 1 stay on the
    // reference curve, d = 0 land on the hub (at origin at t = 0, at
    // x = −W/2 at t = 1), and d = 0.58 (inner edge of the chapter ring)
    // sit at the inner wall of the chapter band throughout.
    //
    // Because the whole mapping is a pure 2D parameterisation with a
    // strictly monotonic arc-length coordinate, no polygon ever passes
    // over another and there is no 3D / mirror illusion.
    //
    // Running t backwards plays the mirror motion automatically: the
    // vertical line gently curls back into the ring.
    const LINEAR_EPS = 0.002;  // switch to straight-line formula when α drops below this

    // All the t-dependent reference-curve constants. blend(b, d, t) and the
    // tick / boundary drawing code all read from this.
    //
    // The depth scale used to be min(linearScale, ρ). The hard min produced a
    // visible kink in scale'(t) at the moment ρ caught up to linearScale (≈ t
    // = 0.81 for W = 800, R = 300, H = 600), which read as a "stutter" in the
    // middle of the morph. Replacing it with a cubic R + (W − R)·t³ keeps the
    // depth scale strictly under ρ for the entire morph on typical canvases
    // (max of (1−t)·t² · 2π·(W−R) ≈ 465 < H = 600), so no clamp is needed and
    // scale(t) is C¹ everywhere. A defensive Math.min against ρ remains in
    // case the canvas aspect is so extreme that the cubic would still cross
    // the arc center.
    function tState(t) {
      const tangentAngle = t * Math.PI / 2;
      const tx = Math.cos(tangentAngle);
      const ty = Math.sin(tangentAngle);
      const Gx = (0.5 * W) * t;                       // 0 → 0.5·W
      const Gy = -R * (1 - t) + (-H / 2) * t;          // -R → -H/2
      const L = 2 * Math.PI * R * (1 - t) + H * t;    // 2πR → H
      const alpha = 2 * Math.PI * (1 - t);             // 2π → 0
      // Cubic ease-out for the depth scale: starts at R, ends at W, smooth
      // first derivative throughout. R·(1−t³) + W·t³ = R + (W−R)·t³.
      const cubicScale = R + (W - R) * t * t * t;
      return { t, tx, ty, Gx, Gy, L, alpha, cubicScale };
    }

    function blend(b, d, t) {
      const S = tState(t);
      const { tx, ty, Gx, Gy, L, alpha, cubicScale } = S;

      let arcX, arcY, transX, transY, transScale;

      if (alpha < LINEAR_EPS) {
        // Near t = 1 — treat the ref curve as a straight line from G in
        // the tangent direction. The arc radius is "infinite" so the depth
        // scale is just the cubic value (≈ W).
        const s = b * L;
        arcX = Gx + tx * s;
        arcY = Gy + ty * s;
        // Transverse direction (toward where the hub ends up): rotate90CW(τ)
        transX = -ty;
        transY = tx;
        transScale = cubicScale;
      } else {
        const rho = L / alpha;
        // Arc center = G + ρ · rotate90CW(τ). In Y-down rotate90CW = (−y, x).
        const Cx = Gx + rho * -ty;
        const Cy = Gy + rho * tx;
        // Angle from center C to G
        const phi0 = Math.atan2(Gy - Cy, Gx - Cx);
        // Traverse along arc by arc-length s. Going clockwise in Y-down
        // means the math angle INCREASES.
        const s = b * L;
        const phi = phi0 + s / rho;
        arcX = Cx + rho * Math.cos(phi);
        arcY = Cy + rho * Math.sin(phi);
        // Transverse (inward) direction: from the arc point toward C.
        const dx = Cx - arcX;
        const dy = Cy - arcY;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        transX = dx / dist;
        transY = dy / dist;
        // The cubic was chosen so it stays under ρ on typical canvases, so
        // there is no kink in scale'(t). The Math.min is a defensive safety
        // net for extreme aspect ratios where the cubic could still cross C.
        transScale = Math.min(cubicScale, rho);
      }

      const offset = (1 - d) * transScale;

      return [
        arcX + transX * offset,
        arcY + transY * offset,
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
      const S = tState(t);  // shared with tick / boundary code below

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

      // ── 5. Verse tick marks within each chapter ──
      // The chapter ring's "明暗" (brightness) variation in both the sunburst
      // and the icicle final views comes from a combination of the per-chapter
      // lightness ramp AND thin verse tick lines across the outer ~18 % of
      // each chapter cell. Without these ticks the morph's mid-frames lose
      // the textured striping that makes the outer ring read as detailed.
      const chapBand = 1 - BAND[4];
      const tickInnerD = 1 - 0.18 * chapBand;
      ctx.lineWidth = 0.4;
      ctx.strokeStyle = TK.tick;
      ctx.beginPath();
      for (const c of chapters) {
        const verses = c.value;
        if (verses < 2) continue;
        const span = c.x1 - c.x0;
        // Skip if individual verses would be smaller than ~1.4 px on the
        // outer edge of the ref curve (S.L · span is the outer arc length).
        const outerLen = S.L * span;
        if (outerLen / verses < 1.4) continue;
        for (let i = 1; i < verses; i++) {
          const bv = c.x0 + (i / verses) * span;
          const [x0, y0] = blend(bv, tickInnerD, t);
          const [x1, y1] = blend(bv, 1, t);
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
        }
      }
      ctx.stroke();

      // ── 6. Chapter boundary lines (within the same book) ──
      // Same role as in sunburst.js / icicle.js: a slightly thicker stroke
      // between adjacent chapters of the same book.
      ctx.lineWidth = 0.7;
      ctx.strokeStyle = TK.chap;
      ctx.beginPath();
      for (let i = 0; i < chapters.length - 1; i++) {
        const c0 = chapters[i];
        const c1 = chapters[i + 1];
        if (c1.parent !== c0.parent) continue;
        const bb = c0.x1;  // shared breadth
        const [x0, y0] = blend(bb, BAND[4], t);
        const [x1, y1] = blend(bb, 1, t);
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      }
      ctx.stroke();

      // ── 7. Book boundary lines (across the chapter band only) ──
      // Strongest separator: the line between two adjacent books inside the
      // chapter ring.
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = TK.book;
      ctx.beginPath();
      for (const bk of books) {
        const bb = bk.x1;
        const [x0, y0] = blend(bb, BAND[4], t);
        const [x1, y1] = blend(bb, 1, t);
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      }
      ctx.stroke();

      // ── 8. Outline each book polygon for hierarchy legibility ──
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
