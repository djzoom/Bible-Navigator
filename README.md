# Bible Sunburst

A radial hierarchical visualization of the entire Protestant Bible — Testament → Book → Chapter — drawn as a clock-face sunburst with D3.js.

- **66 books · 1,189 chapters · 31,102 verses** (KJV verse counts)
- Arc length is weighted by verse count
- Hover any chapter to see its verse count
- Click any book to zoom in; click the center to reset
- Toggle 中 / EN and dark / light themes
- Zero build, single static folder, deploy anywhere

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

A static server is required because `index.html` fetches `data/bible.json`.

## Project structure

```
.
├── index.html         # entry
├── data/bible.json    # hierarchical Bible data (testament → book → chapter)
├── src/
│   ├── sunburst.js    # D3 partition + arc rendering + zoom
│   ├── i18n.js        # EN/ZH book names + UI strings
│   └── styles.css     # theme variables, layout
├── .nojekyll          # GitHub Pages: serve files as-is
└── README.md
```

## Deploy on GitHub Pages

1. `git init && git add . && git commit -m "init"`
2. Create a repo and push to `main`
3. Repo **Settings → Pages → Source: `main` / root**
4. Visit `https://<user>.github.io/<repo>/`

`.nojekyll` is included so the `data/` and `src/` folders are served verbatim.

## Embed in an existing site

**Option A — iframe**

```html
<iframe src="https://yoursite.com/bible-sunburst/" width="900" height="900" frameborder="0"></iframe>
```

**Option B — copy the folder** into your site at any path. The fetch URL `./data/bible.json` is relative, so it just works.

## Algorithm

- `d3.hierarchy(data).sum(d => d.value)` — leaves are chapters; `value` is verse count
- `.sort(null)` — preserve canonical book order (otherwise Genesis would not be first)
- `d3.partition()` produces `x0/x1` (angles); radii are remapped manually so the chapter ring is the widest
- `d3.arc()` with `padAngle` for visible separators
- Zoom rescales `x0/x1` so the focused subtree spans the full circle, animated via `attrTween`

## Data source

Verse counts derived from the public-domain KJV text in
[scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases).
Regenerate with the snippet in `data/build.py` (if present) or run:

```bash
curl -sL https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/KJV.json -o /tmp/kjv.json
# then run the python script that produced data/bible.json (see commit history)
```

## License

Code: MIT. Bible text & verse counts: public domain.
