// build.mjs
// Node 18+
//
// Usage: node build.mjs [srcDir=manual] [outDir=build]
//
// What this script does:
// - Copies all assets from srcDir to outDir, processing HTML files:
//   * Frame pages (2-pane) are merged into a single page
//   * IE/frameset/inline event cruft removed
//   * "javascript:parent.*" links converted to normal hrefs
// - Builds a flat navigation ONLY from pages under "en/html/"
// - Hides from nav: HONDAESM.HTML, ESMBLANK.HTML, pages with an empty/meaningless <title>
// - Performs conservative duplicate detection among same-title pages (SimHash + Jaccard)
//   and exposes duplicates in the left nav:
//     • Canonical items: normal style
//     • Duplicates: dimmed style (toggle via checkbox)
// - Outputs a dedupe report to outDir/_dedupe-report.json
// - Left pane search is fast: 150ms debounce + requestAnimationFrame chunking

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_SRC = "manual";
const DEFAULT_OUT = "build";

// ---- Duplicate detection thresholds ----
const HAMMING_MAX = 3;     // max bit differences (64-bit SimHash) to consider duplicate
const JACCARD_MIN = 0.98;  // min Jaccard similarity to consider duplicate

// Only include pages from this prefix in the flat nav:
const NAV_ROOT_PREFIX = "en/html/";

// File-type buckets
const HTML_EXTS = new Set([".html", ".htm"]);
const TEXT_EXTS = new Set([".css", ".js", ".json", ".txt", ".xml", ".csv"]);
const BINARY_EXTS = new Set([
  ".png",".jpg",".jpeg",".gif",".webp",".bmp",".ico",".svg",
  ".woff",".woff2",".ttf",".otf",".eot",
  ".mp3",".wav",".ogg",".mp4",".webm",".avi",".mov",".m4v",
  ".pdf",".zip",".rar",".7z",".db",".exe",".inf"
]);

// Paths/files to exclude from nav
const EXCLUDE_FROM_NAV = [
  /^_COM\//i,
  /\/ESMBLANK\.HTML$/i,
  /^HONDAESM\.HTML$/i
];

const SUSPICIOUS_SCRIPT = /activex|hhctrl|classid|createobject|ActiveXObject|mshta/i;
const EVENT_ATTR_RE = /^on[a-z]+$/i;

// -------------------- utility --------------------
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

  // Remove suspicious scripts (IE/ActiveX-era stuff)
  if (!keepScripts) {
    $("script").each((_, el)=>{
      const src = $(el).attr("src") || "";
      const code = $(el).html() || "";
      if (SUSPICIOUS_SCRIPT.test(src) || SUSPICIOUS_SCRIPT.test(code)) $(el).remove();
    });
  }

  // Strip inline event handlers
  $("*").each((_, el)=>{
    for (const [k] of Object.entries(el.attribs || {})) {
      if (EVENT_ATTR_RE.test(k)) $(el).removeAttr(k);
    }
  });

  // Ensure UTF-8 and a <title>
  if ($("meta[charset]").length === 0) $("head").prepend('<meta charset="utf-8">');
  if ($("title").length === 0) $("head").append("<title></title>");

  return $;
}

// Strictly read the <title> text only (no fallbacks)
function headTitleStrict($) {
  return ( $("title").first().text() || "" ).trim();
}

// Display title used in the actual HTML page (may fallback to h1 or filename)
function displayTitle($, fallback="") {
  let t = ($("title").first().text() || "").trim();
  if (!t) {
    const h1 = $("h1").first().text().trim();
    t = h1 || fallback;
  }
  return t || fallback;
}

// Title must be non-empty and contain at least one letter or digit
function isMeaningfulTitle(str) {
  const t = (str || "").trim();
  return t.length > 0 && /[\p{L}\p{N}]/u.test(t);
}

function extractBodyInnerHtml(doc$) {
  const body = doc$("body");
  return body.length ? (body.html() ?? "") : (doc$.root().html() ?? "");
}

function looksLikeFrameset($) { return $("frameset").length > 0 && $("frame").length > 0; }
function isExcludedFromNav(relPath) { return EXCLUDE_FROM_NAV.some(rx => rx.test(relPath)); }

function includeInFlatNav(relPath, strictTitle) {
  // Nav shows: only under NAV_ROOT_PREFIX, not PR1/PR2 panels, not excluded, and meaningful <title>
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

// -------------------- tokenization & simhash --------------------
function normalizeTextForCompare($) {
  // Extract body text only; lower-case; strip control chars & punctuation; squeeze whitespace
  $("script, style, noscript").remove();
  const txt = ($("body").text() || "")
    .toLowerCase()
    .replace(/[\u0000-\u001F]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return txt;
}

function tokenize(text) {
  // Basic word tokens; drop very short tokens (<=2) to reduce noise
  return text.split(" ").filter(w => w.length > 2);
}

function fnv1a64(str) {
  // FNV-1a 64-bit (BigInt)
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
  for (let i = 0; i < bits; i++) {
    if (v[i] > 0) sig |= (1n << BigInt(i));
  }
  return sig;
}

function hamming64(a, b) {
  let x = a ^ b;
  let count = 0;
  while (x) { x &= (x - 1n); count++; }
  return count;
}

function jaccard(aSet, bSet) {
  let inter = 0;
  const seen = new Set(aSet);
  for (const x of bSet) {
    if (seen.has(x)) inter++;
    seen.add(x);
  }
  const union = seen.size;
  return union === 0 ? 1 : inter / union;
}

// -------------------- main --------------------
async function main() {
  const srcDir = path.resolve(process.argv[2] || DEFAULT_SRC);
  const outDir = path.resolve(process.argv[3] || DEFAULT_OUT);
  await ensureDir(outDir);

  const allPaths = new Set();
  for await (const abs of walk(srcDir)) {
    allPaths.add(toPosix(path.relative(srcDir, abs)));
  }

  // Pass 1: copy non-HTML files
  for (const rel of allPaths) {
    if (isHtml(rel)) continue;
    const srcAbs = path.join(srcDir, rel);
    const destAbs = path.join(outDir, rel);
    await ensureDir(path.dirname(destAbs));
    if (isBinary(rel)) {
      await fs.writeFile(destAbs, await fs.readFile(srcAbs));
    } else if (isText(rel)) {
      await fs.writeFile(destAbs, await readUtf8(srcAbs), "utf8");
    } else {
      await fs.writeFile(destAbs, await fs.readFile(srcAbs));
    }
  }

  // Collect candidates for nav (with dedupe features)
  // Each: { path, strictTitle, dispTitle, textLen, simhash }
  const candidates = [];

  // Pass 2: process HTML files (and write them to outDir)
  for (const rel of [...allPaths].filter(isHtml)) {
    const srcAbs = path.join(srcDir, rel);
    const outAbs = path.join(outDir, rel);
    await ensureDir(path.dirname(outAbs));

    const raw = await readUtf8(srcAbs);
    const $ = cheerio.load(raw, { decodeEntities:false });

    if (looksLikeFrameset($)) {
      // Merge 2-frame pages into a single static page
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

        const dispTitle = displayTitle($, path.basename(rel));
        const strictTitle = headTitleStrict($);

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

        // Prepare dedupe signals from the merged HTML
        const $$ = cheerio.load(merged, { decodeEntities:false });
        const strict = headTitleStrict($);
        if (includeInFlatNav(rel, strict)) {
          const norm = normalizeTextForCompare($$);
          const toks = tokenize(norm);
          candidates.push({
            path: rel,
            strictTitle: strict,
            dispTitle,
            textLen: norm.length,
            simhash: simhash64(toks),
          });
        }
        continue;
      }

      // 3+ frames → simple fallback page
      const dispTitle = displayTitle($, path.basename(rel));
      const strictTitle = headTitleStrict($);
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

      const strict = headTitleStrict($);
      if (includeInFlatNav(rel, strict)) {
        const $$ = cheerio.load(fallback, { decodeEntities:false });
        const norm = normalizeTextForCompare($$);
        const toks = tokenize(norm);
        candidates.push({
          path: rel,
          strictTitle: strict,
          dispTitle,
          textLen: norm.length,
          simhash: simhash64(toks),
        });
      }
      continue;
    }

    // Normal HTML page
    const doc$ = cleanBasicHtml(raw, { keepScripts:true });

    // Convert "javascript:parent.*" hrefs to normal links
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

    const dispTitle = displayTitle(doc$, path.basename(rel));
    doc$("title").first().text(dispTitle);
    await fs.writeFile(outAbs, doc$.html() ?? "", "utf8");

    const strict = headTitleStrict(doc$);
    if (includeInFlatNav(rel, strict)) {
      const norm = normalizeTextForCompare(doc$);
      const toks = tokenize(norm);
      candidates.push({
        path: rel,
        strictTitle: strict,
        dispTitle,
        textLen: norm.length,
        simhash: simhash64(toks),
      });
    }
  }

  // -------------------- Deduplicate by strict title --------------------
  const byTitle = new Map(); // strictTitle -> array of candidates
  for (const c of candidates) {
    if (!byTitle.has(c.strictTitle)) byTitle.set(c.strictTitle, []);
    byTitle.get(c.strictTitle).push(c);
  }

  // Include BOTH canonical and duplicates; mark duplicates so UI can dim/hide them.
  const navItems = []; // { title, path, dup: boolean }
  const dedupeReport = [];

  for (const [title, arr] of byTitle.entries()) {
    if (arr.length === 1) {
      if (isMeaningfulTitle(title)) navItems.push({ title, path: arr[0].path, dup: false });
      continue;
    }

    // Choose canonical = longest text
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
        // Fallback: compute Jaccard over tokens (read from already written outDir pages)
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

    for (const k of keep) if (isMeaningfulTitle(title)) navItems.push({ title, path: k.path, dup: false });
    for (const d of dupes) if (isMeaningfulTitle(title)) navItems.push({ title, path: d.path, dup: true });

    if (dupes.length) {
      dedupeReport.push({
        title,
        kept: keep.map(k=>k.path),
        duplicates: dupes.map(d=>d.path),
        reason: `HAMMING<=${HAMMING_MAX} or JACCARD>=${JACCARD_MIN}`
      });
    }
  }

  // Sort by title for stable nav
  navItems.sort((a,b)=> a.title.localeCompare(b.title, undefined, { sensitivity:"base" }));

  // Write report (use the actual outDir, not the default)
  await fs.writeFile(
    path.join(outDir, "_dedupe-report.json"),
    JSON.stringify({ thresholds: { HAMMING_MAX, JACCARD_MIN }, groups: dedupeReport }, null, 2),
    "utf8"
  );

  // Final guard: drop any items with non-meaningful titles (just in case)
  const filteredNavItems = navItems.filter(it => isMeaningfulTitle(it.title));

  // Build index with Hide Duplicates checkbox
  await writeIndexFlat(outDir, filteredNavItems);
  console.log(`✅ Done. Open: ${path.join(outDir, "index.html")}`);
  console.log(`ℹ️  Dedupe report: ${path.join(outDir, "_dedupe-report.json")}`);
}

// -------------------- index.html (flat) --------------------
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
    :root { --bg:#0b0c0f; --panel:#111319; --muted:#262a33; --muted-2:#1d2230; --text:#f4f6fb; --sub:#aab2c5; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; height:100vh; display:grid; grid-template-columns: 360px 1fr; }
    aside { border-right:1px solid var(--muted); background:var(--panel); height:100vh; overflow:auto; }
    main { height:100vh; }
    header { padding:12px; border-bottom:1px solid var(--muted); }
    .brand { font-weight:600; }
    .toolbar { display:flex; align-items:center; gap:12px; padding:10px 12px 0; }
    .toolbar label { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--sub); user-select:none; cursor:pointer; }
    .search { padding:10px 12px 12px; }
    .search input { width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--muted); background:#0e1117; color:var(--text); }
    nav { padding: 0 8px 16px; }
    nav ul { list-style:none; padding-left:0; margin:6px 0; }
    nav li.page a { display:block; padding:6px 8px; border-radius:8px; color:var(--text); text-decoration:none; }
    nav li.page a:hover { background: var(--muted); }
    nav li.page.dup a { color: var(--sub); background: var(--muted-2); } /* dim duplicates */
    nav .count { color: var(--sub); font-size: 12px; padding: 0 12px 8px; }
    iframe { width:100%; height:100%; border:0; background:#fff; }
    .hint { color: var(--sub); padding: 8px 12px; font-size:12px; }
  </style>
</head>
<body>
  <aside>
    <header>
      <div class="brand">Honda Accord 7 – service manual</div>
      <div class="count" id="count"></div>
    </header>

    <div class="toolbar">
      <label>
        <input type="checkbox" id="toggleHideDup" checked>
        Hide duplicates
      </label>
    </div>

    <div class="search">
      <input id="search" placeholder="Search titles (⌘/Ctrl+K)" autocomplete="off">
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

  <script type="module">
    const navItems = ${JSON.stringify(navItems, null, 2)};
    const nav = document.getElementById('nav');
    const listEl = document.getElementById('flat-list');
    const frame = document.getElementById('content');
    const search = document.getElementById('search');
    const resume = document.getElementById('resume');
    const count = document.getElementById('count');
    const toggleHideDup = document.getElementById('toggleHideDup');

    // Persist user preference for "Hide duplicates"
    const prefKey = 'accord:hideDup';
    const savedPref = localStorage.getItem(prefKey);
    if (savedPref !== null) {
      toggleHideDup.checked = savedPref === '1';
    } else {
      toggleHideDup.checked = true; // default ON
    }

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

    resume.addEventListener('click', (e) => {
      e.preventDefault();
      const last = localStorage.getItem('accord:last');
      openPath(last || (navItems[0] && navItems[0].path));
    });

    // ----- FAST FILTERING: title index + 150ms debounce + rAF chunking -----
    const items = (() => {
      const arr = [];
      const anchors = listEl.querySelectorAll('li.page a');
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        arr.push({
          title: (a.textContent || '').toLowerCase(),
          el: a.parentElement,                 // <li>
          isDup: a.getAttribute('data-dup') === '1'
        });
      }
      return arr;
    })();

    let searchTimer = null;
    let searchSeq = 0;

    function applyFiltersNow() {
      const mySeq = ++searchSeq;
      const q = (search.value || '').trim().toLowerCase();
      const hideDup = !!toggleHideDup.checked;

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
        }
        if (i < items.length) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    function requestFilter() {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(applyFiltersNow, 150);
    }

    // Re-apply when search changes
    search.addEventListener('input', requestFilter);

    // Re-apply when "Hide duplicates" toggled
    toggleHideDup.addEventListener('change', () => {
      localStorage.setItem(prefKey, toggleHideDup.checked ? '1' : '0');
      requestFilter();
    });

    // Keyboard focus shortcut
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); search.focus(); search.select();
      }
    });

    // Initial render
    applyFiltersNow();
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
