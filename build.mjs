// build.mjs
// Node 18+
//
// Käyttö: node build.mjs [srcDir=manual] [outDir=fixed]
//
// Tekee:
// - Skannaa srcDir:n
// - Kopioi binäärit ja tekstitiedostot sellaisenaan (UTF-8 teks­teihin)
// - Prosessoi HTML-tiedostot:
//   * framesetit -> yhdistää PR1/PR2 sisällöt yhdeksi normaaliksi sivuksi
//   * poistaa IE/frameset-roippeet, on*-attribuutit
//   * korjaa javascript:parent.Prt/Cts/Jmp -linkit tavallisiksi href-linkeiksi
// - Kirjoittaa kaiken outDir:iin samaan hakemistorakenteeseen
// - Luo juureen index.html:in navigaatiolla ja haulla
//   * Haku: 150 ms debounce, lukee aina ajantasaisen input-arvon,
//           ja chunkkaa filtteröinnin rAF:illa ettei UI töki isoilla listoilla.

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_SRC = "manual";
const DEFAULT_OUT = "fixed";

const HTML_EXTS = new Set([".html", ".htm"]);
const TEXT_EXTS = new Set([".css", ".js", ".json", ".txt", ".xml", ".csv"]);
const BINARY_EXTS = new Set([
  ".png",".jpg",".jpeg",".gif",".webp",".bmp",".ico",".svg",
  ".woff",".woff2",".ttf",".otf",".eot",
  ".mp3",".wav",".ogg",".mp4",".webm",".avi",".mov",".m4v",
  ".pdf",".zip",".rar",".7z",".db",".exe",".inf"
]);

const EXCLUDE_FROM_NAV = [
  /^_COM\//i,
  /\/ESMBLANK\.HTML$/i
];

const SUSPICIOUS_SCRIPT = /activex|hhctrl|classid|createobject|ActiveXObject|mshta/i;
const EVENT_ATTR_RE = /^on[a-z]+$/i;

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

async function readUtf8(abs) {
  return await fs.readFile(abs, "utf8");
}

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

function extractBodyInnerHtml(doc$) {
  const body = doc$("body");
  return body.length ? body.html() ?? "" : doc$.root().html() ?? "";
}

function looksLikeFrameset($) {
  return $("frameset").length > 0 && $("frame").length > 0;
}

function titleOf($, fallback="") {
  let t = ($("title").first().text() || "").trim();
  if (!t) {
    const h1 = $("h1").first().text().trim();
    t = h1 || fallback;
  }
  return t || fallback;
}

function shouldHideFromNav(relPath) {
  return EXCLUDE_FROM_NAV.some(rx => rx.test(relPath));
}

function* candidateTargets(id) {
  yield `${id}.html`;
  yield `${id}_PR.html`;
  yield `${id}_PR1.html`;
  yield `${id}_PR2.html`;
}

async function main() {
  const srcDir = path.resolve(process.argv[2] || DEFAULT_SRC);
  const outDir = path.resolve(process.argv[3] || DEFAULT_OUT);
  await ensureDir(outDir);

  const allPaths = new Set();
  for await (const abs of walk(srcDir)) {
    allPaths.add(toPosix(path.relative(srcDir, abs)));
  }

  const manifest = [];

  // Pass 1: kopioi ei-HTML
  for (const rel of allPaths) {
    if (isHtml(rel)) continue;
    const srcAbs = path.join(srcDir, rel);
    const destAbs = path.join(outDir, rel);
    await ensureDir(path.dirname(destAbs));

    if (isBinary(rel)) {
      const buf = await fs.readFile(srcAbs);
      await fs.writeFile(destAbs, buf);
    } else if (isText(rel)) {
      const txt = await readUtf8(srcAbs);
      await fs.writeFile(destAbs, txt, "utf8");
    } else {
      const buf = await fs.readFile(srcAbs);
      await fs.writeFile(destAbs, buf);
    }
  }

  function resolveRelative(fromRel, hrefRel) {
    const baseDir = path.posix.dirname(fromRel);
    const joined = toPosix(path.posix.normalize(path.posix.join(baseDir, hrefRel)));
    return joined;
  }

  // Pass 2: HTML
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
        const title = titleOf($, path.basename(rel));

        const merged = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
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
        if (!shouldHideFromNav(rel)) manifest.push({ title, path: rel });
        continue;
      }

      const title = titleOf($, path.basename(rel));
      const list = frames.map(f => {
        const href = f.src || "";
        const label = f.name || href || "frame";
        return `<li><a href="${href}">${label}</a></li>`;
      }).join("\n");
      const fallback = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body>
<h1>${title}</h1>
<p>This page used frames. Choose a pane to open:</p>
<ul>${list}</ul>
</body></html>`;
      await fs.writeFile(outAbs, fallback, "utf8");
      if (!shouldHideFromNav(rel)) manifest.push({ title, path: rel });
      continue;
    }

    const doc$ = cleanBasicHtml(raw, { keepScripts:true });

    // Korvaa javascript:parent.* linkit
    doc$("a[href^='javascript:parent.']").each((_, el)=>{
      const js = doc$(el).attr("href") || "";
      let replaced = false;
      let m = js.match(/parent\.Prt\(\s*'([^']+)'\s*(?:,\s*'?\d'?)?\s*\)/i);
      if (m) {
        const id = m[1];
        for (const cand of candidateTargets(id)) {
          const candidateRel = resolveRelative(rel, cand);
          if (allPaths.has(candidateRel)) {
            doc$(el).attr("href", cand);
            replaced = true; break;
          }
        }
      }
      if (!replaced) {
        m = js.match(/parent\.Cts\(\s*'([^']+)'/i);
        if (m) {
          const id = m[1];
          for (const cand of candidateTargets(id)) {
            const candidateRel = resolveRelative(rel, cand);
            if (allPaths.has(candidateRel)) {
              doc$(el).attr("href", cand);
              replaced = true; break;
            }
          }
        }
      }
      if (!replaced) {
        m = js.match(/parent\.Jmp\(\s*'([^']+)'\s*\)/i);
        if (m) { doc$(el).attr("href", "#"); replaced = true; }
      }
      if (!replaced) doc$(el).attr("href", "#");
    });

    const title = titleOf(doc$, path.basename(rel));
    await fs.writeFile(outAbs, doc$.html() ?? "", "utf8");
    if (!shouldHideFromNav(rel) && !/_PR[12]\.html?$/i.test(rel)) {
      manifest.push({ title, path: rel });
    }
  }

  manifest.sort((a,b)=> a.title.localeCompare(b.title, undefined, { sensitivity:"base" }));
  await writeIndex(outDir, manifest);
  console.log(`✅ Valmis! Avaa: ${path.join(outDir, "index.html")}`);
}

function buildTree(manifest) {
  const root = { name: "", children: new Map(), pages: [] };
  for (const item of manifest) {
    const parts = item.path.split("/").filter(Boolean);
    let node = root;
    for (let i=0;i<parts.length-1;i++){
      const seg = parts[i];
      if (!node.children.has(seg)) node.children.set(seg, { name: seg, children: new Map(), pages: [] });
      node = node.children.get(seg);
    }
    node.pages.push(item);
  }
  return root;
}

function treeToHtml(node, level=0) {
  const indent = "  ".repeat(level);
  let html = `${indent}<ul>\n`;
  const dirs = Array.from(node.children.values()).sort((a,b)=>a.name.localeCompare(b.name));
  for (const dir of dirs) {
    html += `${indent}  <li class="dir"><span>${dir.name}</span>\n`;
    html += treeToHtml(dir, level+2);
    html += `${indent}  </li>\n`;
  }
  const pages = node.pages.slice().sort((a,b)=>a.title.localeCompare(b.title));
  for (const p of pages) {
    html += `${indent}  <li class="page"><a href="#${encodeURIComponent(p.path)}" data-path="${p.path}">${p.title}</a></li>\n`;
  }
  html += `${indent}</ul>\n`;
  return html;
}

async function writeIndex(outDir, manifest) {
  const tree = buildTree(manifest);
  const navHtml = treeToHtml(tree);

  const html = `<!doctype html>
<html lang="fi">
<head>
  <meta charset="utf-8">
  <title>Honda Accord - käyttöohje (kiinteä versio)</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { --bg:#0b0c0f; --panel:#111319; --muted:#262a33; --text:#f4f6fb; --sub:#aab2c5; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; height:100vh; display:grid; grid-template-columns: 320px 1fr; }
    aside { border-right:1px solid var(--muted); background:var(--panel); height:100vh; overflow:auto; }
    main { height:100vh; }
    header { padding:12px; border-bottom:1px solid var(--muted); }
    .brand { font-weight:600; }
    .search { padding:12px; }
    .search input { width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--muted); background:#0e1117; color:var(--text); }
    nav { padding: 0 8px 16px; }
    nav ul { list-style:none; padding-left:14px; margin:6px 0; }
    nav li.dir > span { color: var(--sub); font-weight:600; display:block; margin-top:8px; }
    nav li.page a { display:block; padding:6px 6px; border-radius:8px; color:var(--text); text-decoration:none; }
    nav li.page a:hover { background: var(--muted); }
    iframe { width:100%; height:100%; border:0; background:#fff; }
    .hint { color: var(--sub); padding: 8px 12px; font-size:12px; }
  </style>
</head>
<body>
  <aside>
    <header><div class="brand">Honda Accord – käyttöohje</div></header>
    <div class="search"><input id="search" placeholder="Hae otsikosta (⌘/Ctrl+K)" autocomplete="off"></div>
    <nav id="nav">
${navHtml.trim()}
    </nav>
    <div class="hint">Vinkki: Avaa viimeisin sivu: <a id="resume" href="#">jatka lukemista</a></div>
  </aside>
  <main>
    <iframe id="content" src="about:blank" referrerpolicy="no-referrer"></iframe>
  </main>
  <script type="module">
    const manifest = ${JSON.stringify(manifest, null, 2)};
    const nav = document.getElementById('nav');
    const frame = document.getElementById('content');
    const search = document.getElementById('search');
    const resume = document.getElementById('resume');

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
      else if (manifest.length) openPath(manifest[0].path);
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
      openPath(last || (manifest[0] && manifest[0].path));
    });

    // --- NOPEA HAKU: 150 ms debounce + rAF-chunkkaus ---
    // Esilaskettu indeksi: ei DOM-kyselyitä jokaisella painalluksella
    const items = (() => {
      const arr = [];
      const anchors = nav.querySelectorAll('li.page a');
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        arr.push({ title: (a.textContent || '').toLowerCase(), el: a.parentElement });
      }
      return arr;
    })();

    let searchTimer = null;
    let searchSeq = 0; // kasvaa aina kun uusi haku käynnistetään → peruu vanhat chunkit

    function runSearchNow() {
      const mySeq = ++searchSeq; // leimaa tämä haku
      const q = (search.value || '').trim().toLowerCase();

      // Tyhjä haku: näytä kaikki kevyesti chunkattuna
      let i = 0;
      const CHUNK = 1500; // kuinka monta itemiä per frame (säätövaraa)
      function step() {
        if (mySeq !== searchSeq) return; // uudempi haku alkoi → keskeytä
        const end = Math.min(i + CHUNK, items.length);
        for (; i < end; i++) {
          const { title, el } = items[i];
          el.style.display = q ? (title.includes(q) ? '' : 'none') : '';
        }
        if (i < items.length) {
          requestAnimationFrame(step);
        }
      }
      requestAnimationFrame(step);
    }

    // Debounce: kirjoitus käynnistää 150 ms timerin; uusi painallus resetoi
    search.addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearchNow, 150);
    });

    // ⌘/Ctrl+K fokus
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); search.focus(); search.select();
      }
    });

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
