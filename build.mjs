// build.mjs
// Node 18+
//
// Usage: node build.mjs [srcDir=manual] [outDir=build]
//
// Features:
// - Copies assets, cleans legacy HTML (IE/ActiveX), merges frames
// - Flat nav from en/html/, filters empty titles
// - Duplicate detection (SimHash + Jaccard), UI can hide/dim duplicates
// - Fast title search (150ms debounce + rAF chunking)
// - NEW: Full-text search (optional) via Web Worker + prebuilt index (build/_fulltext.json)
// - Responsive UI with mobile sidebar + overlay; hamburger last-in-body
// - Robust stacking (sidebar above overlay); overlay doesn’t cover sidebar

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_SRC = "manual";
const DEFAULT_OUT = "build";

// Duplicate thresholds
const HAMMING_MAX = 3;
const JACCARD_MIN = 0.98;

// Nav scope
const NAV_ROOT_PREFIX = "en/html/";

// Fulltext index settings
const FT_INDEX_FILE = "_fulltext.json";
const FT_SNIPPET_CHARS = 400;     // snippet length per page
const FT_MAX_TOKENS_PER_PAGE = 4000; // cap tokens/page to keep JSON small

// File-type buckets
const HTML_EXTS = new Set([".html", ".htm"]);
const TEXT_EXTS = new Set([".css", ".js", ".json", ".txt", ".xml", ".csv"]);
const BINARY_EXTS = new Set([
  ".png",".jpg",".jpeg",".gif",".webp",".bmp",".ico",".svg",
  ".woff",".woff2",".ttf",".otf",".eot",
  ".mp3",".wav",".ogg",".mp4",".webm",".avi",".mov",".m4v",
  ".pdf",".zip",".rar",".7z",".db",".exe",".inf"
]);

// Exclusions
const EXCLUDE_FROM_NAV = [
  /^_COM\//i,
  /\/ESMBLANK\.HTML$/i,
  /^HONDAESM\.HTML$/i
];

const SUSPICIOUS_SCRIPT = /activex|hhctrl|classid|createobject|ActiveXObject|mshta/i;
const EVENT_ATTR_RE = /^on[a-z]+$/i;

// ------------- utils -------------
function toPosix(p){ return p.split(path.sep).join("/"); }
function isHtml(p){ return HTML_EXTS.has(path.extname(p).toLowerCase()); }
function isBinary(p){ return BINARY_EXTS.has(path.extname(p).toLowerCase()); }
function isText(p){ return TEXT_EXTS.has(path.extname(p).toLowerCase()); }
async function ensureDir(p){ await fs.mkdir(p, { recursive: true }); }

async function* walk(dir) {
  for (const d of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) yield* walk(full);
    else yield full;
  }
}

async function readUtf8(abs) { return await fs.readFile(abs, "utf8"); }

function cleanBasicHtml(html, { keepScripts=false } = {}) {
  const $ = cheerio.load(html, { decodeEntities:false });
  $("frameset, frame").remove();

  if (!keepScripts) {
    $("script").each((_, el)=>{
      const src = $(el).attr("src") || "";
      const code = $(el).html() || "";
      if (SUSPICIOUS_SCRIPT.test(src) || SUSPICIOUS_SCRIPT.test(code)) $(el).remove();
    });
  }

  $("*").each((_, el)=>{
    for (const [k] of Object.entries(el.attribs || {})) {
      if (EVENT_ATTR_RE.test(k)) $(el).removeAttr(k);
    }
  });

  if ($("meta[charset]").length === 0) $("head").prepend('<meta charset="utf-8">');
  if ($("title").length === 0) $("head").append("<title></title>");
  return $;
}

// Strictly read <title>
function headTitleStrict($) { return ($("title").first().text() || ""); }

// Normalize titles
function normalizeTitle(str) {
  return (str || "")
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF\u2060\u00AD]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function isMeaningfulTitle(str) {
  const t = normalizeTitle(str);
  return t.length > 0 && /[\p{L}\p{N}]/u.test(t);
}

// Display title to write back
function displayTitle($, fallback="") {
  const raw = ($("title").first().text() || "").trim();
  if (raw) return raw;
  const h1 = $("h1").first().text().trim();
  return h1 || fallback;
}

function extractBodyInnerHtml(doc$) {
  const body = doc$("body");
  return body.length ? (body.html() ?? "") : (doc$.root().html() ?? "");
}

function looksLikeFrameset($) { return $("frameset").length > 0 && $("frame").length > 0; }
function isExcludedFromNav(relPath) { return EXCLUDE_FROM_NAV.some(rx => rx.test(relPath)); }

function includeInFlatNav(relPath, strictTitle) {
  const p = relPath.toLowerCase();
  return (
    p.startsWith(NAV_ROOT_PREFIX) &&
    !/_pr[12]\.html?$/.test(p) &&
    !isExcludedFromNav(relPath) &&
    isMeaningfulTitle(strictTitle)
  );
}

function resolveRelative(fromRel, hrefRel) {
  const baseDir = path.posix.dirname(fromRel);
  return toPosix(path.posix.normalize(path.posix.join(baseDir, hrefRel)));
}

function* candidateTargets(id) {
  yield `${id}.html`;
  yield `${id}_PR.html`;
  yield `${id}_PR1.html`;
  yield `${id}_PR2.html`;
}

// Text normalization for compare/index
function normalizeTextForCompare($) {
  $("script, style, noscript").remove();
  const txt = ($("body").text() || "")
    .toLowerCase()
    .replace(/[\u0000-\u001F]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return txt;
}
function tokenize(text) { return text.split(" ").filter(w => w.length > 2); }

// Simhash helpers
function fnv1a64(str) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * prime) & 0xFFFFFFFFFFFFFFFFn;
  }
  return hash;
}
function simhash64(tokens) {
  const bits = 64;
  const v = new Array(bits).fill(0);
  for (const t of tokens) {
    const h = fnv1a64(t);
    for (let i = 0; i < bits; i++) {
      const bit = (h >> BigInt(i)) & 1n;
      v[i] += (bit === 1n ? 1 : -1);
    }
  }
  let sig = 0n;
  for (let i = 0; i < bits; i++) if (v[i] > 0) sig |= (1n << BigInt(i));
  return sig;
}
function hamming64(a, b) {
  let x = a ^ b, count = 0;
  while (x) { x &= (x - 1n); count++; }
  return count;
}
function jaccard(aSet, bSet) {
  let inter = 0;
  const seen = new Set(aSet);
  for (const x of bSet) { if (seen.has(x)) inter++; seen.add(x); }
  const union = seen.size;
  return union === 0 ? 1 : inter / union;
}

// ------------- main -------------
async function main() {
  const srcDir = path.resolve(process.argv[2] || DEFAULT_SRC);
  const outDir = path.resolve(process.argv[3] || DEFAULT_OUT);
  await ensureDir(outDir);

  const allPaths = new Set();
  for await (const abs of walk(srcDir)) {
    allPaths.add(toPosix(path.relative(srcDir, abs)));
  }

  // Copy non-HTML
  for (const rel of allPaths) {
    if (isHtml(rel)) continue;
    const srcAbs = path.join(srcDir, rel);
    const destAbs = path.join(outDir, rel);
    await ensureDir(path.dirname(destAbs));
    if (isBinary(rel)) await fs.writeFile(destAbs, await fs.readFile(srcAbs));
    else if (isText(rel)) await fs.writeFile(destAbs, await readUtf8(srcAbs), "utf8");
    else await fs.writeFile(destAbs, await fs.readFile(srcAbs));
  }

  const candidates = [];
  const fulltext = []; // {p,t,w,s}

  // Process HTML
  for (const rel of [...allPaths].filter(isHtml)) {
    const srcAbs = path.join(srcDir, rel);
    const outAbs = path.join(outDir, rel);
    await ensureDir(path.dirname(outAbs));

    const raw = await readUtf8(srcAbs);
    const $ = cheerio.load(raw, { decodeEntities:false });

    if (looksLikeFrameset($)) {
      const frames = [];
      $("frame").each((_, el)=>{
        const name = $(el).attr("name") || "";
        const src = $(el).attr("src") || "";
        if (src) frames.push({ name, src });
      });

      if (frames.length === 2) {
        const aRel = resolveRelative(rel, frames[0].src);
        const bRel = resolveRelative(rel, frames[1].src);
        const aHtml = isHtml(aRel) && allPaths.has(aRel) ? await readUtf8(path.join(srcDir, aRel)) : "";
        const bHtml = isHtml(bRel) && allPaths.has(bRel) ? await readUtf8(path.join(srcDir, bRel)) : "";

        const $a = cleanBasicHtml(aHtml);
        const $b = cleanBasicHtml(bHtml);
        const left = extractBodyInnerHtml($a);
        const right = extractBodyInnerHtml($b);

        const strictTitle = normalizeTitle(headTitleStrict($));
        const dispTitle = displayTitle($, path.basename(rel));

        const merged = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${dispTitle}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin:0; background:#fff; color:#111; font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
  .grid { display:grid; grid-template-columns: 360px 1fr; min-height: 100vh; }
  .pane { padding: 12px 16px; border-right:1px solid #eceff1; }
  .pane:last-child { border-right:0; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid #ddd; padding: 4px 6px; }
  a { color: #0b63ce; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <div class="grid">
    <aside class="pane">${left}</aside>
    <main class="pane">${right}</main>
  </div>
</body>
</html>`;
        await fs.writeFile(outAbs, merged, "utf8");

        if (includeInFlatNav(rel, strictTitle)) {
          const $$ = cheerio.load(merged, { decodeEntities:false });
          const norm = normalizeTextForCompare($$);
          const toks = tokenize(norm);
          candidates.push({ path: rel, strictTitle, dispTitle, textLen: norm.length, simhash: simhash64(toks) });

          // Fulltext entry (from both panes text)
          const ftTokens = Array.from(new Set(toks)).slice(0, FT_MAX_TOKENS_PER_PAGE);
          fulltext.push({
            p: rel,
            t: dispTitle,
            w: ftTokens.join(" "),
            s: norm.slice(0, FT_SNIPPET_CHARS)
          });
        }
        continue;
      }

      // Multi-frame fallback
      const strictTitle = normalizeTitle(headTitleStrict($));
      const dispTitle = displayTitle($, path.basename(rel));
      const list = frames.map(f => {
        const href = f.src || "";
        const label = f.name || href || "frame";
        return `<li><a href="${href}">${label}</a></li>`;
      }).join("\n");
      const fallback = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${dispTitle}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body>
<h1>${dispTitle}</h1>
<p>This page used frames. Choose a pane to open:</p>
<ul>${list}</ul>
</body></html>`;
      await fs.writeFile(outAbs, fallback, "utf8");

      if (includeInFlatNav(rel, strictTitle)) {
        const $$ = cheerio.load(fallback, { decodeEntities:false });
        const norm = normalizeTextForCompare($$);
        const toks = tokenize(norm);
        candidates.push({ path: rel, strictTitle, dispTitle, textLen: norm.length, simhash: simhash64(toks) });
        const ftTokens = Array.from(new Set(toks)).slice(0, FT_MAX_TOKENS_PER_PAGE);
        fulltext.push({ p: rel, t: dispTitle, w: ftTokens.join(" "), s: norm.slice(0, FT_SNIPPET_CHARS) });
      }
      continue;
    }

    // Normal HTML
    const doc$ = cleanBasicHtml(raw, { keepScripts:true });

    // Convert javascript:parent.* links
    doc$("a[href^='javascript:parent.']").each((_, el)=>{
      const js = doc$(el).attr("href") || "";
      let replaced = false;

      let m = js.match(/parent\.Prt\(\s*'([^']+)'\s*(?:,\s*'?\d'?)?\s*\)/i);
      if (m) {
        const id = m[1];
        for (const cand of candidateTargets(id)) {
          const candidateRel = resolveRelative(rel, cand);
          if (allPaths.has(candidateRel)) { doc$(el).attr("href", cand); replaced = true; break; }
        }
      }
      if (!replaced) {
        m = js.match(/parent\.Cts\(\s*'([^']+)'/i);
        if (m) {
          const id = m[1];
          for (const cand of candidateTargets(id)) {
            const candidateRel = resolveRelative(rel, cand);
            if (allPaths.has(candidateRel)) { doc$(el).attr("href", cand); replaced = true; break; }
          }
        }
      }
      if (!replaced) {
        m = js.match(/parent\.Jmp\(\s*'([^']+)'\s*\)/i);
        if (m) { doc$(el).attr("href", "#"); replaced = true; }
      }
      if (!replaced) doc$(el).attr("href", "#");
    });

    const strictTitle = normalizeTitle(headTitleStrict(doc$));
    const dispTitle = displayTitle(doc$, path.basename(rel));

    // Write cleaned page
    doc$("title").first().text(dispTitle);
    await fs.writeFile(outAbs, doc$.html() ?? "", "utf8");

    // Add to nav + fulltext
    const include = includeInFlatNav(rel, strictTitle);
    if (include) {
      const norm = normalizeTextForCompare(doc$);
      const toks = tokenize(norm);
      candidates.push({ path: rel, strictTitle, dispTitle, textLen: norm.length, simhash: simhash64(toks) });

      const ftTokens = Array.from(new Set(toks)).slice(0, FT_MAX_TOKENS_PER_PAGE);
      fulltext.push({
        p: rel,
        t: dispTitle,
        w: ftTokens.join(" "),
        s: norm.slice(0, FT_SNIPPET_CHARS)
      });
    }
  }

  // Deduplicate by strict title
  const byTitle = new Map();
  for (const c of candidates) {
    if (!byTitle.has(c.strictTitle)) byTitle.set(c.strictTitle, []);
    byTitle.get(c.strictTitle).push(c);
  }

  const navItems = [];
  const dedupeReport = [];

  for (const [titleRaw, arr] of byTitle.entries()) {
    const title = normalizeTitle(titleRaw);
    if (!isMeaningfulTitle(title)) continue;

    if (arr.length === 1) {
      navItems.push({ title, path: arr[0].path, dup: false });
      continue;
    }

    arr.sort((a,b)=> b.textLen - a.textLen);
    const canonical = arr[0];
    const keep = [canonical];
    const dupes = [];

    for (let i=1; i<arr.length; i++) {
      const cand = arr[i];
      let isDup = false;

      const ham = Number(hamming64(canonical.simhash, cand.simhash));
      if (ham <= HAMMING_MAX) {
        isDup = true;
      } else {
        const canHtml = await readUtf8(path.join(outDir, canonical.path));
        const cHtml = await readUtf8(path.join(outDir, cand.path));
        const $$a = cheerio.load(canHtml, { decodeEntities:false });
        const $$b = cheerio.load(cHtml, { decodeEntities:false });
        const setA = new Set(tokenize(normalizeTextForCompare($$a)));
        const setB = new Set(tokenize(normalizeTextForCompare($$b)));
        const jac = jaccard(setA, setB);
        if (jac >= JACCARD_MIN) isDup = true;
      }

      if (isDup) dupes.push(cand);
      else keep.push(cand);
    }

    for (const k of keep) navItems.push({ title, path: k.path, dup: false });
    for (const d of dupes) navItems.push({ title, path: d.path, dup: true });

    if (dupes.length) {
      dedupeReport.push({
        title,
        kept: keep.map(k=>k.path),
        duplicates: dupes.map(d=>d.path),
        reason: `HAMMING<=${HAMMING_MAX} or JACCARD>=${JACCARD_MIN}`
      });
    }
  }

  navItems.sort((a,b)=> a.title.localeCompare(b.title, undefined, { sensitivity:"base" }));

  await fs.writeFile(
    path.join(outDir, "_dedupe-report.json"),
    JSON.stringify({ thresholds: { HAMMING_MAX, JACCARD_MIN }, groups: dedupeReport }, null, 2),
    "utf8"
  );

  // Write fulltext index (only included pages)
  await fs.writeFile(path.join(outDir, FT_INDEX_FILE), JSON.stringify(fulltext), "utf8");

  const filteredNavItems = navItems.filter(it => isMeaningfulTitle(it.title));

  await writeIndexFlat(outDir, filteredNavItems);
  console.log(`✅ Done. Open: ${path.join(outDir, "index.html")}`);
  console.log(`🔎 Full-text index: ${path.join(outDir, FT_INDEX_FILE)} (${fulltext.length} entries)`);
  console.log(`ℹ️  Dedupe report: ${path.join(outDir, "_dedupe-report.json")}`);
}

async function writeIndexFlat(outDir, navItems) {
  const listHtml = navItems.map(p =>
    `<li class="page${p.dup ? " dup" : ""}"><a href="#${encodeURIComponent(p.path)}" data-path="${p.path}" data-dup="${p.dup ? "1" : "0"}">${p.title}</a></li>`
  ).join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Honda Accord 7 service manual</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root {
      --bg:#0b0c0f; --panel:#111319; --muted:#262a33; --muted-2:#1d2230; --text:#f4f6fb; --sub:#aab2c5; --accent:#0b63ce;
      --sidebarW: min(86vw, 420px);
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body { margin:0; background:var(--bg); color:var(--text); font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }

    .app { display:grid; grid-template-columns: 360px 1fr; height:100vh; overflow:hidden; }
    aside { border-right:1px solid var(--muted); background:var(--panel); height:100vh; overflow:auto; position:relative; z-index:1000; }
    main { height:100vh; position:relative; z-index:0; }

    header { padding:12px; border-bottom:1px solid var(--muted); display:flex; align-items:center; gap:10px; }
    .brand { font-weight:600; flex:1; }

    .toolbar { display:flex; align-items:center; gap:12px; padding:10px 12px 0; flex-wrap: wrap; }
    .toolbar label { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--sub); user-select:none; cursor:pointer; white-space:nowrap; }
    .search { padding:10px 12px 12px; }
    .search input { width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--muted); background:#0e1117; color:var(--text); }
    nav { padding: 0 8px 16px; }
    nav ul { list-style:none; padding-left:0; margin:6px 0; }
    nav li.page a { display:block; padding:6px 8px; border-radius:8px; color:var(--text); text-decoration:none; }
    nav li.page a:hover { background: var(--muted); }
    nav li.page.dup a { color: var(--sub); background: var(--muted-2); }
    nav .count { color: var(--sub); font-size: 12px; padding: 0 12px 8px; }
    .snippet { color: var(--sub); font-size: 12px; padding: 0 8px 8px; margin-top: -4px; white-space: normal; }
    .badge { font-size: 11px; padding: 1px 6px; border:1px solid var(--muted); border-radius: 999px; color: var(--sub); margin-left: 6px; }

    iframe { width:100%; height:100%; border:0; background:#fff; }
    .hint { color: var(--sub); padding: 8px 12px; font-size:12px; }

    .overlay {
      position: fixed;
      top: 0; right: 0; bottom: 0; left: 0;
      background: rgba(0,0,0,0);
      transition: background .2s ease;
      pointer-events: none;
      z-index: 900;
    }
    body.sidebar-open .overlay {
      background: rgba(0,0,0,0.4);
      pointer-events: auto;
      left: var(--sidebarW);
    }

    .hamburger {
      position: fixed;
      top: calc(env(safe-area-inset-top, 0px) + 10px);
      left: calc(env(safe-area-inset-left, 0px) + 10px);
      background: transparent;
      border: 0;
      font-size: 34px;
      line-height: 1;
      width: 52px; height: 52px;
      cursor: pointer;
      color: #000;
      -webkit-text-stroke: 2px rgba(255,255,255,0.95);
      text-shadow: 0 0 4px rgba(255,255,255,0.95), 0 0 8px rgba(255,255,255,0.75);
      display: none;
      z-index: 1100;
    }
    body.sidebar-open .hamburger {
      color: #fff;
      -webkit-text-stroke: 2px rgba(0,0,0,0.8);
      text-shadow: 0 0 4px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.6);
    }
    .hamburger:focus { outline:2px solid var(--accent); border-radius:8px; }

    @media (max-width: 900px) {
      .app { grid-template-columns: 1fr; }
      aside {
        position: fixed;
        top: 0; left: 0; bottom: 0;
        width: var(--sidebarW);
        transform: translateX(-100%);
        transition: transform .2s ease;
        box-shadow: 0 0 40px rgba(0,0,0,0.35);
      }
      body.sidebar-open aside { transform: translateX(0); }
      .hamburger { display: inline-flex; align-items:center; justify-content:center; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside id="sidebar">
      <header>
        <div class="brand">Honda Accord 7 – service manual</div>
        <div class="count" id="count"></div>
      </header>

      <div class="toolbar">
        <label>
          <input type="checkbox" id="toggleHideDup" checked>
          Hide duplicates
        </label>
        <label>
          <input type="checkbox" id="toggleContent">
          Search in content
        </label>
      </div>

      <div class="search">
        <input id="search" placeholder="Search titles or content (⌘/Ctrl+K)" autocomplete="off">
      </div>

      <nav id="nav">
        <ul id="flat-list">
${listHtml}
        </ul>
      </nav>

      <div class="hint">Tip: Open last page: <a id="resume" href="#">resume reading</a></div>
    </aside>

    <main>
      <iframe id="content" src="about:blank" referrerpolicy="no-referrer"></iframe>
    </main>
  </div>

  <div class="overlay" id="overlay"></div>
  <button id="hamburger" class="hamburger" aria-label="Toggle navigation" aria-controls="sidebar" aria-expanded="false">☰</button>

  <script type="module">
    const navItems = ${JSON.stringify(navItems, null, 2)};
    const nav = document.getElementById('nav');
    const listEl = document.getElementById('flat-list');
    const frame = document.getElementById('content');
    const search = document.getElementById('search');
    const resume = document.getElementById('resume');
    const count = document.getElementById('count');
    const toggleHideDup = document.getElementById('toggleHideDup');
    const toggleContent = document.getElementById('toggleContent');

    const hamburger = document.getElementById('hamburger');
    const overlay = document.getElementById('overlay');

    function setSidebar(open) {
      document.body.classList.toggle('sidebar-open', open);
      hamburger?.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    hamburger?.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !document.body.classList.contains('sidebar-open');
      setSidebar(open);
    });
    overlay?.addEventListener('click', () => setSidebar(false));
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') setSidebar(false); });

    // Prefs
    const prefDupKey = 'accord:hideDup';
    const prefContentKey = 'accord:contentSearch';
    const savedDup = localStorage.getItem(prefDupKey);
    toggleHideDup.checked = savedDup !== null ? (savedDup === '1') : true;
    const savedContent = localStorage.getItem(prefContentKey);
    toggleContent.checked = savedContent === '1';

    count.textContent = navItems.length + " pages";

    function openPath(p) {
      frame.src = p;
      localStorage.setItem('accord:last', p);
      if (decodeURIComponent(location.hash.slice(1)) !== p) {
        history.replaceState(null, '', '#' + encodeURIComponent(p));
      }
      nav.querySelectorAll('a[data-path]').forEach(a => {
        a.style.background = '';
        if (a.getAttribute('data-path') === p) a.style.background = 'var(--muted)';
      });
      if (window.matchMedia('(max-width: 900px)').matches) setSidebar(false);
    }

    function handleHash() {
      const h = decodeURIComponent(location.hash.slice(1));
      if (h) openPath(h);
      else if (navItems.length) openPath(navItems[0].path);
    }

    nav.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-path]');
      if (!a) return;
      e.preventDefault();
      openPath(a.getAttribute('data-path'));
    });

    resume?.addEventListener('click', (e) => {
      e.preventDefault();
      const last = localStorage.getItem('accord:last');
      openPath(last || (navItems[0] && navItems[0].path));
    });

    // ----- Title filtering (fast) -----
    const items = (() => {
      const arr = [];
      const anchors = listEl.querySelectorAll('li.page a');
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        arr.push({
          title: (a.textContent || '').toLowerCase(),
          el: a.parentElement,
          isDup: a.getAttribute('data-dup') === '1',
          path: a.getAttribute('data-path')
        });
      }
      return arr;
    })();

    let searchTimer = null;
    let searchSeq = 0;

    function filterTitlesNow(q, hideDup) {
      const mySeq = ++searchSeq;
      let i = 0;
      const CHUNK = 1500;
      function step() {
        if (mySeq !== searchSeq) return;
        const end = Math.min(i + CHUNK, items.length);
        for (; i < end; i++) {
          const { title, el, isDup } = items[i];
          const match = q ? title.includes(q) : true;
          const visible = match && (!hideDup || !isDup);
          el.style.display = visible ? '' : 'none';
          // remove old snippets if any
          const sn = el.querySelector('.snippet'); if (sn) sn.remove();
        }
        if (i < items.length) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    function requestFilter() {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(applySearch, 150);
    }

    // ----- Full-text (content) search via Web Worker -----
    let ftWorker = null;
    let ftLoaded = false;

    async function ensureWorker() {
      if (ftWorker) return;
      const workerCode = `
        let data = null;
        function norm(s){return (s||"").toLowerCase();}
        self.onmessage = async (e)=> {
          const {type, payload} = e.data || {};
          if (type === 'load') {
            const url = payload.url;
            const res = await fetch(url);
            data = await res.json(); // [{p,t,w,s}]
            self.postMessage({type:'loaded', count: data.length});
          } else if (type === 'query') {
            if (!data) { self.postMessage({type:'results', items: []}); return; }
            const q = norm(payload.q || '').trim();
            if (q.length < 2) { self.postMessage({type:'results', items: []}); return; }
            const terms = q.split(/\\s+/).filter(x=>x.length>0);
            const items = [];
            for (let i=0;i<data.length;i++){
              const it = data[i];
              let ok = true, score=0;
              for (const t of terms){
                if (it.w.indexOf(t) === -1) { ok=false; break; }
                else score++;
              }
              if (ok) items.push({p:it.p, t:it.t, s:it.s, score});
            }
            items.sort((a,b)=> b.score - a.score || a.t.localeCompare(b.t));
            self.postMessage({type:'results', items: items.slice(0, 250)});
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      ftWorker = new Worker(URL.createObjectURL(blob));
      ftWorker.onmessage = (e) => {
        const {type, items} = e.data || {};
        if (type === 'loaded') { ftLoaded = true; applySearch(); }
        else if (type === 'results') { renderContentResults(items); }
      };
      ftWorker.postMessage({ type:'load', payload: { url: '${FT_INDEX_FILE}' }});
    }

    function renderContentResults(results) {
      // First hide everything, then show only matched ones (respect hideDup by filtering DOM after)
      const hideDup = !!toggleHideDup.checked;
      const visiblePaths = new Set(results.map(r=>r.p));
      items.forEach(({el, isDup, path})=>{
        const vis = visiblePaths.has(path) && (!hideDup || !isDup);
        el.style.display = vis ? '' : 'none';
        // remove any old snippet
        const old = el.querySelector('.snippet'); if (old) old.remove();
        if (vis) {
          const r = results.find(x=>x.p===path);
          if (r && r.s) {
            const sn = document.createElement('div');
            sn.className = 'snippet';
            sn.textContent = r.s + '…';
            el.appendChild(sn);
            // badge
            const a = el.querySelector('a');
            if (a && !a.querySelector('.badge')) {
              const b = document.createElement('span');
              b.className = 'badge';
              b.textContent = 'content';
              a.appendChild(b);
            }
          }
        }
      });
    }

    async function applySearch() {
      const q = (search.value || '').trim().toLowerCase();
      const hideDup = !!toggleHideDup.checked;
      const useContent = !!toggleContent.checked;

      // Title-only for short queries or when content search off
      if (!useContent || q.length < 2) {
        filterTitlesNow(q, hideDup);
        return;
      }
      // Content search
      await ensureWorker();
      if (!ftLoaded) return; // will apply after load
      ftWorker.postMessage({ type: 'query', payload: { q } });
    }

    search.addEventListener('input', requestFilter);
    toggleHideDup.addEventListener('change', () => {
      localStorage.setItem(prefDupKey, toggleHideDup.checked ? '1' : '0');
      requestFilter();
    });
    toggleContent.addEventListener('change', () => {
      localStorage.setItem(prefContentKey, toggleContent.checked ? '1' : '0');
      requestFilter();
    });

    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); search.focus(); search.select();
      }
    });

    // Initial
    filterTitlesNow('', !!toggleHideDup.checked);
    handleHash();
    window.addEventListener('hashchange', handleHash);
  </script>
</body>
</html>`;
  await fs.writeFile(path.join(outDir, "index.html"), html, "utf8");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
