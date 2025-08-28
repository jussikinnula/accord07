// build.mjs
// Node 18+
//
// Käyttö: node build.mjs [srcDir=manual] [outDir=fixed]
//
// Tekee:
// - Skannaa srcDir:n
// - Kopioi binäärit ja tekstitiedostot sellaisenaan (UTF-8-dekoodaus teks­teihin)
// - Prosessoi HTML-tiedostot:
//   * framesetit -> yhdistää PR1/PR2 sisällöt yhdeksi normaaliksi sivuksi
//   * poistaa IE/ActiveX/frameset-roippeet, on*-attribuutit
//   * korjaa javascript:parent.Prt/Cts/Jmp -linkit tavallisiksi href-linkeiksi
// - Kirjoittaa kaiken outDir:iin samaan hakemistorakenteeseen
// - Luo juureen index.html:in navigaatiolla ja haulla

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- asetukset ----------
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
  /^_COM\//i, // Honda ESM sisäiset yleissivut
  /\/ESMBLANK\.HTML$/i
];

const SUSPICIOUS_SCRIPT = /activex|hhctrl|classid|createobject|ActiveXObject|mshta/i;
const EVENT_ATTR_RE = /^on[a-z]+$/i;

// ---------- utilit ----------
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
  // Manuaali on raportin mukaan UTF-8:aa → luetaan suoraan
  return await fs.readFile(abs, "utf8");
}

function cleanBasicHtml(html, { keepScripts=false } = {}) {
  const $ = cheerio.load(html, { decodeEntities:false });

  // Poista framesetit kokonaan tässä peruspolussa (framesetit käsitellään erikseen)
  $("frameset, frame").remove();

  // Poista ActiveX/IE-epäilyttävät scriptit
  if (!keepScripts) {
    $("script").each((_, el)=>{
      const src = $(el).attr("src") || "";
      const code = $(el).html() || "";
      if (SUSPICIOUS_SCRIPT.test(src) || SUSPICIOUS_SCRIPT.test(code)) $(el).remove();
    });
  }

  // Poista on*-attribuutit
  $("*").each((_, el)=>{
    for (const [k] of Object.entries(el.attribs || {})) {
      if (EVENT_ATTR_RE.test(k)) $(el).removeAttr(k);
    }
  });

  // Varmista UTF-8 & title
  if ($("meta[charset]").length === 0) $("head").prepend('<meta charset="utf-8">');
  if ($("title").length === 0) $("head").append("<title></title>");

  return $;
}

function extractBodyInnerHtml(doc$) {
  // Palauta body:n sisä-HTML (ilman <body>-tagia)
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

// Yritä päätellä linkkikohde id:stä (esim. 'ZOOM000000000015226' → ZOOM…_PR.html ensisijaisesti)
function* candidateTargets(id) {
  // Päätä järjestys:
  // 1) id + ".html"
  // 2) id + "_PR.html"
  // 3) id + "_PR1.html"
  // 4) id + "_PR2.html"
  // (monissa tapauksissa id on jo "…_PR")
  yield `${id}.html`;
  yield `${id}_PR.html`;
  yield `${id}_PR1.html`;
  yield `${id}_PR2.html`;
}

// ---------- pääprosessi ----------
async function main() {
  const srcDir = path.resolve(process.argv[2] || DEFAULT_SRC);
  const outDir = path.resolve(process.argv[3] || DEFAULT_OUT);

  await ensureDir(outDir);

  // Kerää kaikki polut settiin nopeaa exists-tarkastusta varten
  const allPaths = new Set();
  for await (const abs of walk(srcDir)) {
    allPaths.add(toPosix(path.relative(srcDir, abs)));
  }

  async function existsRel(rel) {
    const p = path.join(srcDir, rel);
    try { await fs.access(p); return true; } catch { return false; }
  }

  // Manifest navigointia varten
  const manifest = [];

  // Ensimmäinen pass: kopioi kaikki ei-HTML:t sellaisenaan (tekstit UTF-8:na)
  for (const rel of allPaths) {
    if (isHtml(rel)) continue; // html hoidetaan toisessa passissa
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
      // tuntematon – kopioi binäärinä
      const buf = await fs.readFile(srcAbs);
      await fs.writeFile(destAbs, buf);
    }
  }

  // Auttaa linkkien korjaamisessa: nopea resolveri suhteellisille poluille
  function resolveRelative(fromRel, hrefRel) {
    const baseDir = path.posix.dirname(fromRel);
    const joined = toPosix(path.posix.normalize(path.posix.join(baseDir, hrefRel)));
    return joined;
  }

  // HTML-pass: prosessoi & kirjoita
  for (const rel of [...allPaths].filter(isHtml)) {
    const srcAbs = path.join(srcDir, rel);
    const outAbs = path.join(outDir, rel);
    await ensureDir(path.dirname(outAbs));

    const raw = await readUtf8(srcAbs);
    const $ = cheerio.load(raw, { decodeEntities:false });

    // 1) Framesetit → yhdistä PR-sivut
    if (looksLikeFrameset($)) {
      // Etsi framejen src:t
      const frames = [];
      $("frame").each((_, el)=>{
        const name = $(el).attr("name") || "";
        const src = $(el).attr("src") || "";
        if (src) frames.push({ name, src });
      });

      // Erikoistapaus: 2-framen PR-sivut (vasen/ylempi + oikea/ale mpi)
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
  :root { --bg:#0b0c0f; --panel:#111319; --muted:#262a33; --text:#f4f6fb; }
  body { margin:0; background:#fff; color:#111; font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
  .grid { display:grid; grid-template-columns: 360px 1fr; gap: 0; min-height: 100vh; }
  .pane { padding: 12px 16px; border-right:1px solid #eceff1; }
  .pane:last-child { border-right:0; }
  .pane img { max-width: 100%; height: auto; }
  .pane table { border-collapse: collapse; }
  .pane table td, .pane table th { border: 1px solid #ddd; padding: 4px 6px; }
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
        // lisää navigaatioon (mutta piilota jos kuuluu exclude-listaan)
        if (!shouldHideFromNav(rel)) manifest.push({ title, path: rel });
        continue;
      }

      // 3+ framea → tee yksinkertainen fallback-linkkilista
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

    // 2) Tavallinen HTML → siivoa + korjaa javascript:parent.* linkit
    const doc$ = cleanBasicHtml(raw, { keepScripts:true });

    // Korvaa <a href="javascript:parent.…"> linkeiksi
    doc$("a[href^='javascript:parent.']").each((_, el)=>{
      const js = doc$(el).attr("href") || "";
      let replaced = false;

      // Prt('ID','1')
      let m = js.match(/parent\.Prt\(\s*'([^']+)'\s*(?:,\s*'?\d'?)?\s*\)/i);
      if (m) {
        const id = m[1];
        // Kokeile ehdokkaita samassa kansiossa
        for (const cand of candidateTargets(id)) {
          const candidateRel = resolveRelative(rel, cand);
          if (allPaths.has(candidateRel)) {
            doc$(el).attr("href", cand);
            replaced = true;
            break;
          }
        }
      }

      // Cts('ID','i000')
      if (!replaced) {
        m = js.match(/parent\.Cts\(\s*'([^']+)'/i);
        if (m) {
          const id = m[1];
          for (const cand of candidateTargets(id)) {
            const candidateRel = resolveRelative(rel, cand);
            if (allPaths.has(candidateRel)) {
              doc$(el).attr("href", cand);
              replaced = true;
              break;
            }
          }
        }
      }

      // Jmp('i220') → ei tiedetä dokkaria → tee ankkuri tai # (parempi kuin rikkinäinen)
      if (!replaced) {
        m = js.match(/parent\.Jmp\(\s*'([^']+)'\s*\)/i);
        if (m) {
          doc$(el).attr("href", "#");
          replaced = true;
        }
      }

      if (!replaced) {
        // yleinen fallback
        doc$(el).attr("href", "#");
      }
    });

    const title = titleOf(doc$, path.basename(rel));
    await fs.writeFile(outAbs, doc$.html() ?? "", "utf8");
    if (!shouldHideFromNav(rel)) {
      // Älä lisää välisivuja, kuten PR1/PR2
      if (!/_PR[12]\.html?$/i.test(rel)) {
        manifest.push({ title, path: rel });
      }
    }
  }

  // Lajittele manifest otsikon mukaan
  manifest.sort((a,b)=> a.title.localeCompare(b.title, undefined, { sensitivity:"base" }));

  // Luo index.html
  await writeIndex(outDir, manifest);

  console.log(`✅ Valmis! Avaa: ${path.join(outDir, "index.html")}`);
}

// ---------- index.html generaattori ----------
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

    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      const items = nav.querySelectorAll('li.page a');
      items.forEach(a => {
        const show = a.textContent.toLowerCase().includes(q);
        a.parentElement.style.display = show ? '' : 'none';
      });
    });

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

// ---
main().catch(err => {
  console.error(err);
  process.exit(1);
});
