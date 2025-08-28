// analyze.mjs
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";
import iconv from "iconv-lite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HTML_EXTS = new Set([".html", ".htm"]);
const TEXT_EXTS = new Set([".css",".js",".json",".txt",".xml",".csv"]);
const BINARY_EXTS = new Set([
  ".png",".jpg",".jpeg",".gif",".webp",".bmp",".ico",".svg",
  ".woff",".woff2",".ttf",".otf",".eot",".mp3",".wav",".ogg",
  ".mp4",".webm",".avi",".mov",".m4v",".pdf",".zip",".rar",".7z"
]);

function toPosix(p){ return p.split(path.sep).join("/"); }
function isHtml(p){ return HTML_EXTS.has(path.extname(p).toLowerCase()); }
function isBinary(p){ return BINARY_EXTS.has(path.extname(p).toLowerCase()); }

async function* walk(dir) {
  for (const d of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function detectCharsetFromHead(buffer) {
  const head = buffer.slice(0, Math.min(buffer.length, 8192)).toString("latin1");
  const m1 = head.match(/<meta[^>]+charset=["']?([\w-]+)["']?/i);
  if (m1) return m1[1].toLowerCase();
  const m2 = head.match(/content=["'][^"']*charset=([\w-]+)[^"']*["']/i);
  if (m2) return m2[1].toLowerCase();
  return null;
}

function decodeWithGuess(buffer) {
  const cs = detectCharsetFromHead(buffer);
  if (!cs) return buffer.toString("utf8");
  if (cs === "utf-8" || cs === "utf8") return buffer.toString("utf8");
  try { return iconv.decode(buffer, cs); }
  catch { return iconv.decode(buffer, "win1252"); }
}

function isExternalUrl(href) {
  return /^([a-z]+:)?\/\//i.test(href) || href.startsWith("mailto:") || href.startsWith("data:");
}

const suspiciousRe = /activex|hhctrl|classid|createobject|ActiveXObject|mshta/i;
const eventAttrs = ["onload","onclick","onmouseover","onmouseout","onchange","onsubmit","onfocus","onblur","onkeydown","onkeyup","onkeypress"];

async function main() {
  const [,, srcArg, outArg="audit-out"] = process.argv;
  if (!srcArg) {
    console.error("Käyttö: node analyze.mjs <srcDir> [outDir]");
    process.exit(1);
  }
  const srcDir = path.resolve(srcArg);
  const outDir = path.resolve(outArg);
  await fs.mkdir(outDir, { recursive: true });

  const byExt = new Map();
  const htmlFiles = [];
  let totalFiles = 0;

  for await (const abs of walk(srcDir)) {
    totalFiles++;
    const rel = toPosix(path.relative(srcDir, abs));
    const ext = path.extname(rel).toLowerCase();
    byExt.set(ext, (byExt.get(ext) ?? 0) + 1);
    if (isHtml(rel)) htmlFiles.push({ abs, rel });
  }

  const metrics = {
    scannedAt: new Date().toISOString(),
    srcDir,
    totals: {
      totalFiles,
      byExt: Object.fromEntries([...byExt.entries()].sort((a,b)=>a[0].localeCompare(b[0])))
    },
    html: {
      count: htmlFiles.length,
      framesetPages: [],
      counts: {
        frameset: 0, frame: 0, object: 0, embed: 0, applet: 0,
        scriptsSuspicious: 0, metaRefresh: 0
      },
      inlineEventAttrs: Object.fromEntries(eventAttrs.map(k=>[k,0])),
      charsets: {},
      titlesSample: [],
      externalLinksTop: [],
      entryPointGuesses: [],
      brokenLinksSample: [],
    }
  };

  const externalMap = new Map();
  const brokenLinks = [];
  const titlesSampleLimit = 60;

  const existsCache = new Map(); // path -> boolean

  async function fileExists(relPath) {
    if (existsCache.has(relPath)) return existsCache.get(relPath);
    const abs = path.join(srcDir, relPath);
    try { await fs.access(abs); existsCache.set(relPath,true); return true; }
    catch { existsCache.set(relPath,false); return false; }
  }

  for (const { abs, rel } of htmlFiles) {
    const raw = await fs.readFile(abs);
    const decoded = decodeWithGuess(raw);
    const charset = detectCharsetFromHead(raw) || "utf-8*guess";
    metrics.html.charsets[charset] = (metrics.html.charsets[charset] ?? 0) + 1;

    const $ = cheerio.load(decoded, { decodeEntities:false });

    const isFrameset = $("frameset").length > 0;
    const frames = $("frame").length;
    const objects = $("object").length;
    const embeds = $("embed").length;
    const applets = $("applet").length;

    metrics.html.counts.frameset += $("frameset").length;
    metrics.html.counts.frame += frames;
    metrics.html.counts.object += objects;
    metrics.html.counts.embed += embeds;
    metrics.html.counts.applet += applets;
    metrics.html.counts.metaRefresh += $("meta[http-equiv=refresh]").length;

    if (isFrameset) {
      const fspec = [];
      $("frame").each((_, el)=>{
        const name = $(el).attr("name") || "";
        const src = $(el).attr("src") || "";
        fspec.push({ name, src });
      });
      metrics.html.framesetPages.push({ path: rel, frames: fspec });
    }

    $("script").each((_, el)=>{
      const src = $(el).attr("src") || "";
      const code = $(el).html() || "";
      if (suspiciousRe.test(src) || suspiciousRe.test(code)) {
        metrics.html.counts.scriptsSuspicious++;
      }
    });

    // Inline event attributes
    $("*").each((_, el)=>{
      for (const a of Object.keys(el.attribs || {})) {
        const low = a.toLowerCase();
        if (eventAttrs.includes(low)) metrics.html.inlineEventAttrs[low]++;
      }
    });

    // Titles sample
    if (metrics.html.titlesSample.length < titlesSampleLimit) {
      let title = ($("title").first().text() || "").trim();
      if (!title) {
        const h1 = $("h1").first().text().trim();
        title = h1 || path.basename(rel);
      }
      metrics.html.titlesSample.push({ path: rel, title });
    }

    // Collect links (a/link/script/img)
    const linkAttrs = [
      ["a","href"],["link","href"],["script","src"],["img","src"]
    ];
    for (const [tag, attr] of linkAttrs) {
      $(tag).each((_, el)=>{
        const href = ($(el).attr(attr) || "").trim();
        if (!href || href.startsWith("#")) return;

        if (isExternalUrl(href)) {
          externalMap.set(href, (externalMap.get(href) ?? 0) + 1);
        } else {
          // normalize relative path
          const baseDir = path.posix.dirname(rel);
          const joined = toPosix(path.posix.normalize(path.posix.join(baseDir, href)));
          // strip query/fragment
          const clean = joined.split("#")[0].split("?")[0];
          // If link points to a directory, try index.html/htm
          (async()=>{
            let ok = await fileExists(clean);
            if (!ok && !path.extname(clean)) {
              ok = await fileExists(path.posix.join(clean, "index.html"))
                || await fileExists(path.posix.join(clean, "index.htm"));
            }
            if (!ok) {
              if (brokenLinks.length < 200) brokenLinks.push({ from: rel, href });
            }
          })();
        }
      });
    }
  }

  // entry point guesses
  const candidates = ["index.html","index.htm","default.html","default.htm","home.html","start.html", "HONDAESM.HTML"];
  metrics.html.entryPointGuesses = await Promise.all(candidates.filter(async c=>byExt.has(path.extname(c)) || await fileExists(c)));

  // external top
  const externalTop = [...externalMap.entries()]
    .sort((a,b)=>b[1]-a[1]).slice(0,50)
    .map(([href,count])=>({href,count}));
  metrics.html.externalLinksTop = externalTop;

  metrics.html.brokenLinksSample = brokenLinks;

  // Write JSON
  const jsonPath = path.join(outDir, "analysis-report.json");
  await fs.writeFile(jsonPath, JSON.stringify(metrics, null, 2), "utf8");

  // Write Markdown (short)
  const md = [
    `# Honda-manuaalin auditointi`,
    `Päiväys: ${metrics.scannedAt}`,
    ``,
    `## Yhteenveto`,
    `- Tiedostoja yhteensä: **${metrics.totals.totalFiles}**`,
    `- HTML-sivuja: **${metrics.html.count}**`,
    `- Frameset-sivuja: **${metrics.html.framesetPages.length}** (frameset-tageja yhteensä: ${metrics.html.counts.frameset})`,
    `- ActiveX-epäilyttävät skriptit: **${metrics.html.counts.scriptsSuspicious}**`,
    `- OBJECT/EMBED/APPLET: object ${metrics.html.counts.object}, embed ${metrics.html.counts.embed}, applet ${metrics.html.counts.applet}`,
    `- Meta refresh -tageja: ${metrics.html.counts.metaRefresh}`,
    ``,
    `## Charset-jakauma`,
    "```json",
    JSON.stringify(metrics.html.charsets, null, 2),
    "```",
    ``,
    `## Mahdolliset aloitussivut`,
    metrics.html.entryPointGuesses.length ? metrics.html.entryPointGuesses.map(x=>`- ${x}`).join("\n") : "_ei ilmeisiä_",
    ``,
    `## Frameset-sivut (näyte)`,
    "```json",
    JSON.stringify(metrics.html.framesetPages.slice(0,20), null, 2),
    "```",
    ``,
    `## Otsikot (näyte)`,
    "```json",
    JSON.stringify(metrics.html.titlesSample, null, 2),
    "```",
    ``,
    `## Ulkoiset linkit (Top 50)`,
    "```json",
    JSON.stringify(metrics.html.externalLinksTop, null, 2),
    "```",
    ``,
    `## Rikkinäiset linkit (näyte, max 200)`,
    "```json",
    JSON.stringify(metrics.html.brokenLinksSample, null, 2),
    "```",
  ].join("\n");
  const mdPath = path.join(outDir, "analysis-report.md");
  await fs.writeFile(mdPath, md, "utf8");

  console.log("✅ Valmis!");
  console.log("JSON:", jsonPath);
  console.log("MD:  ", mdPath);
}

main().catch(err => { console.error(err); process.exit(1); });
