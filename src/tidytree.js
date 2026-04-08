// Tidy-tree layout — d3.tree() node-link diagram with collapsible chapters.
// Shares data, colors, reader and state with the sunburst via shared.js.
import {
  state, buildHierarchy,
  openReader, showTooltip, hideTooltip,
  bookLabel, groupLabel, I18N, tween,
} from './shared.js?v=2';

export function createTreeLayout(orientation /* 'v' | 'h' */) {
  const isVertical = orientation === 'v';
  const id = isVertical ? 'tree-v' : 'tree-h';

  // Per-layout state
  let root;
  let stage, svg, g;
  let scrollWrap;
  let W = 0, H = 0;
  let contentW = 0, contentH = 0;
  let resizeHandler = null;
  // Track which nodes are "expanded" beyond the default book-level collapse.
  const expanded = new Set();  // node ids

  function nodeId(d) {
    return d.ancestors().map(a => a.data.name).reverse().join('/');
  }

  function mount(container) {
    stage = container;
    root = buildHierarchy(state.data);
    // Initially collapse all chapters (depth 4) — show groups + books only.
    collapseBelow(root, 3);

    setup();
    render();
    window.addEventListener('resize', (resizeHandler = debounce(() => {
      setup(); render();
    }, 120)));
  }

  function unmount() {
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    stage.innerHTML = '';
    stage = svg = g = scrollWrap = null;
    expanded.clear();
  }

  function debounce(fn, ms) {
    let t;
    return () => { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  // Walk the tree and move descendants at/below `deepest` into _children.
  function collapseBelow(node, deepest) {
    if (node.depth >= deepest) {
      if (node.children) {
        node._children = node.children;
        node.children = null;
      }
    } else if (node.children) {
      node.children.forEach(c => collapseBelow(c, deepest));
    }
  }

  function toggle(node) {
    if (node.children) {
      node._children = node.children;
      node.children = null;
      expanded.delete(nodeId(node));
    } else if (node._children) {
      node.children = node._children;
      node._children = null;
      expanded.add(nodeId(node));
    }
  }

  function visibleLeaves() {
    // Count leaves of the currently-expanded view
    let n = 0;
    (function walk(d) {
      if (!d.children) { n++; return; }
      d.children.forEach(walk);
    })(root);
    return n;
  }

  function setup() {
    W = Math.max(320, stage.clientWidth || window.innerWidth || 800);
    H = Math.max(320, stage.clientHeight || window.innerHeight || 800);

    // Scroll container lets users pan through long trees
    if (!scrollWrap) {
      scrollWrap = document.createElement('div');
      scrollWrap.className = 'tree-scroll';
      stage.appendChild(scrollWrap);
    }
    scrollWrap.style.width = W + 'px';
    scrollWrap.style.height = H + 'px';
    scrollWrap.style.marginLeft = -(W / 2) + 'px';
    scrollWrap.style.marginTop  = -(H / 2) + 'px';

    if (!svg) {
      svg = d3.select(scrollWrap).append('svg').attr('class', 'tree-svg').node();
      g = d3.select(svg).append('g').node();
    }
  }

  function render() {
    const leaves = Math.max(1, visibleLeaves());
    // Use nodeSize for a scrollable layout; min spacing per leaf.
    const leafGap = leaves > 200 ? 16 : 22;
    const levelGap = 120;

    const treeLayout = isVertical
      ? d3.tree().nodeSize([leafGap, levelGap])
      : d3.tree().nodeSize([leafGap, levelGap]);

    treeLayout(root);

    // Remap coordinates based on orientation:
    //   d3.tree with nodeSize([x, y]): node.x is breadth, node.y is depth.
    //   Vertical: render as (x, y)
    //   Horizontal: render as (y, x)
    const nodes = root.descendants();
    const links = root.links();

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach(d => {
      const rx = isVertical ? d.x : d.y;
      const ry = isVertical ? d.y : d.x;
      d.rx = rx;
      d.ry = ry;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    });

    const padX = 80, padY = 60;
    contentW = Math.max(W, (maxX - minX) + padX * 2);
    contentH = Math.max(H, (maxY - minY) + padY * 2);
    const offX = padX - minX;
    const offY = padY - minY;

    d3.select(svg)
      .attr('width', contentW)
      .attr('height', contentH)
      .attr('viewBox', [0, 0, contentW, contentH]);

    const gSel = d3.select(g);
    gSel.selectAll('*').remove();
    gSel.attr('transform', `translate(${offX}, ${offY})`);

    // Links
    const linkGen = isVertical
      ? d3.linkVertical().x(d => d.rx).y(d => d.ry)
      : d3.linkHorizontal().x(d => d.rx).y(d => d.ry);

    gSel.append('g')
      .attr('class', 'tree-links')
      .selectAll('path')
      .data(links)
      .enter()
      .append('path')
      .attr('d', d => linkGen({ source: d.source, target: d.target }))
      .attr('fill', 'none')
      .attr('stroke', 'var(--fg-dim)')
      .attr('stroke-width', 1)
      .attr('opacity', 0.55);

    // Nodes
    const nodeSel = gSel.append('g')
      .attr('class', 'tree-nodes')
      .selectAll('g.tree-node')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'tree-node')
      .attr('transform', d => `translate(${d.rx}, ${d.ry})`)
      .style('cursor', 'pointer')
      .on('click', (_, d) => onNodeClick(d))
      .on('mouseenter', (event, d) => onNodeHover(event, d))
      .on('mouseleave', hideTooltip);

    nodeSel.append('circle')
      .attr('r', d => nodeRadius(d))
      .attr('fill', d => d.depth === 0
        ? 'var(--bg-soft)'
        : d.depth === 1
          ? (d.data.name === 'OT' ? 'var(--ot-fill)' : 'var(--nt-fill)')
          : (d.color || 'var(--fg-dim)'))
      .attr('stroke', d => d.depth === 0 ? 'var(--accent)' : 'rgba(0,0,0,0.6)')
      .attr('stroke-width', d => d.depth === 0 ? 1.5 : 0.8);

    // Labels
    const hanClass = state.lang === 'zh' ? ' han' : '';
    nodeSel.append('text')
      .attr('class', d => labelClass(d) + hanClass)
      .attr('x', d => {
        if (isVertical) return 0;
        return d.children || d._children ? -8 : 8;
      })
      .attr('y', d => {
        if (!isVertical) return 0;
        return d.children || d._children ? -10 : 12;
      })
      .attr('text-anchor', d => {
        if (isVertical) return 'middle';
        return d.children || d._children ? 'end' : 'start';
      })
      .attr('dominant-baseline', isVertical ? 'auto' : 'middle')
      .style('font-size', d => nodeFontSize(d) + 'px')
      .text(d => nodeLabel(d));

    // After render, scroll root into view (centered)
    if (scrollWrap && root.rx !== undefined) {
      const rx = root.rx + offX;
      const ry = root.ry + offY;
      scrollWrap.scrollLeft = Math.max(0, rx - W / 2);
      scrollWrap.scrollTop  = Math.max(0, ry - H / 2);
    }
  }

  function nodeRadius(d) {
    if (d.depth === 0) return 14;
    if (d.depth === 1) return 9;
    if (d.depth === 2) return 7;
    if (d.depth === 3) return 5;
    return 3;
  }

  function nodeFontSize(d) {
    if (d.depth === 0) return 14;
    if (d.depth === 1) return 12;
    if (d.depth === 2) return 11;
    if (d.depth === 3) return 10;
    return 9;
  }

  function nodeLabel(d) {
    const t = I18N.ui[state.lang];
    if (d.depth === 0) return t.bible;
    if (d.depth === 1) return d.data.name === 'OT' ? t.ot : t.nt;
    if (d.depth === 2) return groupLabel(d.data.group, state.lang);
    if (d.depth === 3) return bookLabel(d.data.name, state.lang);
    return d.data.name;  // chapter number
  }

  function labelClass(d) {
    if (d.depth === 0) return 'tree-root-label';
    if (d.depth === 1) return 'testament-label';
    if (d.depth === 2) return 'group-label';
    if (d.depth === 3) return 'book-label radial';
    return 'tree-chapter-label';
  }

  function onNodeHover(event, d) {
    const t = I18N.ui[state.lang];
    if (d.depth === 4) {
      const book = d.parent;
      const bn = bookLabel(book.data.name, state.lang);
      const detail = state.lang === 'zh'
        ? `${t.chapter}${d.data.name}章 · ${d.value} ${t.verses}`
        : `${t.chapter} ${d.data.name} · ${d.value} ${t.verses}`;
      showTooltip(`<div class="book">${bn}</div><div class="detail">${detail}</div>`, event);
    } else if (d.depth === 3) {
      const bn = bookLabel(d.data.name, state.lang);
      const detail = state.lang === 'zh'
        ? `${(d._children || d.children || []).length} 章 · ${d.value} ${t.verses}`
        : `${(d._children || d.children || []).length} chapters · ${d.value} ${t.verses}`;
      showTooltip(`<div class="book">${bn}</div><div class="detail">${detail}</div>`, event);
    }
  }

  function onNodeClick(d) {
    if (d.depth === 4) {
      openReader(d);
      return;
    }
    // Toggle expand/collapse for book (→ shows chapters)
    if (d.depth >= 1 && (d.children || d._children)) {
      toggle(d);
      render();
    }
  }

  function onLangChange() { render(); }

  return {
    id,
    label: isVertical
      ? { en: 'Tree V', zh: '树纵' }
      : { en: 'Tree H', zh: '树横' },
    mount, unmount, onLangChange,
    zoomToRoot() {
      // Collapse everything back to book level
      expanded.clear();
      collapseBelow(root, 3);
      render();
    },
  };
}
