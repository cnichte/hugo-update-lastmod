#!/usr/bin/env node
/**
 ** hugo-update-lastmod.mjs
 *
 * @author Carsten Nichte, 2025
 *
 * Task:
 *   - Scan the image files for each galleries/gallery-1 (bundle directory).
 *   - For each bundle:
 *       - Compare image inventory with last run (cache)
 *       - Count changes: + added, ~ changed, − deleted
 *       - Determine max. mtime of all images
 *      - Update lastmod in index.md if max. mtime > current lastmod
 *   - Output:
 *       * Per bundle: Status + image diffs
 *       * Global: Total number of bundles and image changes
 *
 * Important features:
 *   - No Git necessary – everything is based on the file system (mtime, size).
 *   - Cache is always updated (even with --dry-run).
 *   - lastmod decision depends only on mtime vs. lastmod,
 *     not on +/~/- (these are for information only).
 *
 * @author Carsten Nichte, 2025
 */

// bin/hugo-update-lastmod.mjs
import { promises as fs, existsSync, statSync } from "fs";
import path from "path";
import pc from "picocolors";
import { glob } from "glob";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

// ---------------------------------------------------------
// CLI-Argumente / Flags
// ---------------------------------------------------------

const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes("--dry-run") || ARGS.includes("-d");

// ---------------------------------------------------------
// Config laden
// Sucht zuerst hugo-update-lastmod.config.json, dann lastmod.config.json
// ---------------------------------------------------------

const CONFIG_CANDIDATES = [
  "hugo-update-lastmod.config.json",
  "lastmod.config.json",
];

let CONFIG_PATH = null;
for (const candidate of CONFIG_CANDIDATES) {
  const p = path.resolve(candidate);
  if (existsSync(p)) {
    CONFIG_PATH = p;
    break;
  }
}

// Default-Konfiguration
let CONFIG = {
  targetDirs: ["content/galleries/*/", "content/stories/*/"],
  extensions: ["jpg", "jpeg", "png", "webp", "avif"],
  maxDepth: 1,
  frontmatterDelim: "---",
  gitAdd: true, // bleibt drin, falls du später Git wieder nutzen willst
};

try {
  if (CONFIG_PATH) {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    CONFIG = {
      ...CONFIG,
      ...parsed,
    };
  } else {
    console.log(
      pc.yellow(
        "⚠️  Keine Config-Datei gefunden (hugo-update-lastmod.config.json / lastmod.config.json) – verwende Default-Konfiguration."
      )
    );
  }
} catch (e) {
  console.error(pc.red("❌ Fehler beim Lesen der Config-Datei:"), e.message);
  process.exit(1);
}

const TARGET_DIRS = CONFIG.targetDirs;
const EXTENSIONS = CONFIG.extensions.map((e) => e.toLowerCase());
const MAXDEPTH = Number(CONFIG.maxDepth ?? 1);
const FRONTMATTER_DELIM = CONFIG.frontmatterDelim || "---";
const GIT_ADD_ENABLED = !!CONFIG.gitAdd;

// ---------------------------------------------------------
// Cache
// ---------------------------------------------------------
//
// Struktur:
// {
//   version: 1,
//   bundles: {
//     "content/galleries/wreckfest": {
//       images: {
//         "content/galleries/wreckfest/img1.jpg": { mtimeMs: 123, size: 456 },
//         ...
//       }
//     },
//     ...
//   }
// }

const CACHE_PATH = path.resolve(".hugo-update-lastmod.cache.json");

const CACHE_VERSION = 2;

let cache = {
  version: CACHE_VERSION,
  bundles: {},
};

try {
  if (existsSync(CACHE_PATH)) {
    const raw = await fs.readFile(CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw);

    if (parsed.version === CACHE_VERSION && parsed.bundles) {
      // Nur übernehmen, wenn Version passt
      cache.bundles = parsed.bundles;
    } else {
      info(
        "Cache-Version inkompatibel oder fehlt – starte mit leerem Cache (einmaliger Reset)."
      );
    }
  }
} catch (e) {
  console.error(pc.red("❌ Fehler beim Lesen des Cache:"), e.message);
  // Kein harter Abbruch – wir starten dann einfach „frisch“
}

// ---------------------------------------------------------
// Logging-Helpers
// ---------------------------------------------------------

function header() {
  console.log("\n" + "-".repeat(65));
  console.log(pc.bold(`🏃  hugo-update-lastmod  v${pkg.version} DEVELOP`));
  if (CONFIG_PATH) {
    console.log(
      `   Config:      ${pc.cyan(path.relative(process.cwd(), CONFIG_PATH))}`
    );
  } else {
    console.log(
      `   Config:      ${pc.yellow("Default (keine Datei gefunden)")}`
    );
  }
  console.log(
    `   Directories: ${pc.cyan(TARGET_DIRS.join(", "))}\n` +
      `   MaxDepth:    ${pc.cyan(String(MAXDEPTH))}\n` +
      `   Extensions:  ${pc.cyan(EXTENSIONS.join(", "))}\n` +
      `   git add:     ${pc.cyan(GIT_ADD_ENABLED ? "yes" : "no")}\n`
  );
  if (DRY_RUN) {
    console.log(`   Mode:        ${pc.yellow("DRY-RUN (keine Änderungen)")}\n`);
  }
}

function footer(stats) {
  const {
    totalBundles,
    updatedBundles,
    unchangedBundles,
    noImageBundles,
    totalAdded,
    totalChanged,
    totalDeleted,
  } = stats;

  console.log(pc.bold(pc.green("✅ Fertig: lastmod ggf. aktualisiert.")));
  console.log(
    `   Bundles:     ${totalBundles} (aktualisiert: ${updatedBundles}, unverändert: ${unchangedBundles}, ohne Bilder: ${noImageBundles})`
  );
  console.log(
    `   Bild-Änderungen (seit letztem Lauf): ${totalAdded} hinzugefügt, ${totalChanged} geändert, ${totalDeleted} gelöscht`
  );
  console.log("-".repeat(65) + "\n");
}

function info(msg) {
  console.log(pc.cyan("ℹ️ "), msg);
}

function warn(msg) {
  console.log(pc.yellow("⚠️ "), msg);
}

function ok(msg) {
  console.log(pc.green("✔️ "), msg);
}

function note(msg) {
  console.log(pc.magenta("📝 "), msg);
}

function err(msg) {
  console.log(pc.red("❌ "), msg);
}

// ---------------------------------------------------------
// Helper-Funktionen
// ---------------------------------------------------------

/**
 * Liefert alle Bilddateien (relative Pfade) in einem Verzeichnis (rekursiv, mit maxDepth).
 * current: absolutes Verzeichnis
 * maxDepth: maximale Tiefe ab start-Dir
 */
async function getImageFiles(dir, maxDepth) {
  const files = [];

  async function walk(current, depth) {
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const full = path.join(current, entry.name);

      if (entry.isFile()) {
        const low = entry.name.toLowerCase();
        if (EXTENSIONS.some((ext) => low.endsWith("." + ext))) {
          const rel = path.relative(process.cwd(), full);
          files.push(rel);
        }
      } else if (entry.isDirectory()) {
        if (depth + 1 < maxDepth) {
          await walk(full, depth + 1);
        }
      }
    }
  }

  await walk(dir, 0);
  return files;
}

/**
 * Scannt ein Bundle-Verzeichnis und gibt eine Map
 *   { relPath: { mtimeMs, size } }
 * zurück.
 */
async function scanImagesForBundle(absDir, maxDepth) {
  const files = await getImageFiles(absDir, maxDepth);
  const result = {};

  for (const rel of files) {
    try {
      const st = statSync(path.resolve(rel));
      result[rel] = {
        mtimeMs: st.mtimeMs,
        size: st.size,
      };
    } catch {
      // Datei könnte währenddessen verschwunden sein – einfach überspringen
    }
  }

  return result;
}

/**
 * Vergleicht zwei Image-Maps (prev vs current) und liefert:
 *   - added: Anzahl neuer Dateien
 *   - changed: Anzahl geänderter Dateien (mtimeMs oder size unterschiedlich)
 *   - deleted: Anzahl gelöschter Dateien
 */
function diffImages(prevImages, currentImages) {
  const prevKeys = new Set(Object.keys(prevImages));
  const currKeys = new Set(Object.keys(currentImages));

  let added = 0;
  let changed = 0;
  let deleted = 0;

  for (const key of currKeys) {
    if (!prevKeys.has(key)) {
      added++;
    } else {
      const prev = prevImages[key];
      const curr = currentImages[key];
      if (prev.mtimeMs !== curr.mtimeMs || prev.size !== curr.size) {
        changed++;
      }
    }
  }

  for (const key of prevKeys) {
    if (!currKeys.has(key)) {
      deleted++;
    }
  }

  return { added, changed, deleted };
}

/**
 * Frontmatter aus index.md parsen und lastmod extrahieren.
 * Rückgabe:
 *   {
 *     currentLastmod: string | "",
 *     fmLines: string[],
 *     bodyLines: string[]
 *   }
 */
function parseFrontmatter(content, indexFile) {
  const lines = content.split("\n");

  const fmIdx = lines
    .map((line, i) => (line.trim() === FRONTMATTER_DELIM ? i : -1))
    .filter((i) => i !== -1);

  if (fmIdx.length < 2 || fmIdx[1] <= fmIdx[0]) {
    err(`Kein gültiges Frontmatter in ${indexFile} – überspringe`);
    return {
      currentLastmod: "",
      fmLines: [],
      bodyLines: lines,
      valid: false,
    };
  }

  const fmStart = fmIdx[0];
  const fmEnd = fmIdx[1];

  const fmLines = lines.slice(fmStart + 1, fmEnd);
  const bodyLines = lines.slice(fmEnd + 1);

  let currentLastmod = "";
  for (const line of fmLines) {
    if (line.startsWith("lastmod:")) {
      currentLastmod = line
        .replace(/^lastmod:\s*/, "")
        .replace(/"/g, "")
        .trim();
      break;
    }
  }

  return { currentLastmod, fmLines, bodyLines, valid: true };
}

/**
 * Baut neuen Dateiinhalt mit aktualisiertem lastmod.
 */
function buildNewContent(fmLines, bodyLines, newLastmod) {
  const newFm = [];
  let replaced = false;

  for (const line of fmLines) {
    if (!replaced && line.startsWith("lastmod:")) {
      newFm.push(`lastmod: "${newLastmod}"`);
      replaced = true;
    } else {
      newFm.push(line);
    }
  }

  if (!replaced) {
    newFm.push(`lastmod: "${newLastmod}"`);
  }

  return (
    `${FRONTMATTER_DELIM}\n` +
    newFm.join("\n") +
    `\n${FRONTMATTER_DELIM}\n` +
    bodyLines.join("\n")
  );
}

/**
 * Formatiert einen Date als ISO-String mit lokaler Zeitzone (wie Git %cI),
 * z.B. 2025-11-15T12:43:41+01:00
 */
function formatLocalISO(date) {
  const pad = (n) => String(n).padStart(2, "0");

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());

  const offsetMinutes = -date.getTimezoneOffset(); // z.B. 60 für +01:00
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const offH = pad(Math.floor(abs / 60));
  const offM = pad(abs % 60);

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${offH}:${offM}`;
}

/**
 * Vergleich zweier ISO-Strings (oder leerer Strings).
 * Gibt true zurück, wenn newVal „später“ ist als currentVal.
 */
function isNewerISO(newVal, currentVal) {
  if (!currentVal) return true;
  // Vergleich als String reicht, weil ISO-8601 lexikographisch sortierbar ist
  return newVal > currentVal;
}

// ---------------------------------------------------------
// Bundle-Verarbeitung
// ---------------------------------------------------------

async function processBundle(absDir, stats) {
  const relDir = path.relative(process.cwd(), absDir);
  const indexFile = path.join(absDir, "index.md");
  const relIndexFile = path.relative(process.cwd(), indexFile);

  if (!existsSync(indexFile)) {
    warn(`Kein index.md in ${relDir} – überspringe`);
    return;
  }

  // 1. Aktuellen Bildbestand einlesen
  const currentImages = await scanImagesForBundle(absDir, MAXDEPTH);
  const currentKeys = Object.keys(currentImages);

  if (currentKeys.length === 0) {
    warn(`Keine Bilder in ${relDir} – überspringe`);
    stats.noImageBundles++;
    // Cache trotzdem aktualisieren (leeres Set)
    cache.bundles[relDir] = { images: {} };
    return;
  }

  // 2. Vorherigen Bildbestand aus Cache
  const prevBundle = cache.bundles[relDir] || { images: {} };
  const prevImages = prevBundle.images || {};

  const { added, changed, deleted } = diffImages(prevImages, currentImages);

  stats.totalAdded += added;
  stats.totalChanged += changed;
  stats.totalDeleted += deleted;

  // 3. max. mtime der aktuellen Bilder bestimmen
  let maxMtimeMs = 0;
  for (const key of currentKeys) {
    const mtimeMs = currentImages[key].mtimeMs;
    if (mtimeMs > maxMtimeMs) {
      maxMtimeMs = mtimeMs;
    }
  }

  const newLastmod = formatLocalISO(new Date(maxMtimeMs));

  // 4. index.md einlesen und lastmod parsen
  const raw = await fs.readFile(indexFile, "utf8");
  const { currentLastmod, fmLines, bodyLines, valid } = parseFrontmatter(
    raw,
    relIndexFile
  );

  if (!valid) {
    // Cache trotzdem aktualisieren
    cache.bundles[relDir] = { images: currentImages };
    return;
  }

  // 5. Entscheidung: lastmod aktualisieren?
  const shouldUpdateLastmod = isNewerISO(newLastmod, currentLastmod);

  const summarySuffix = ` [Bilder: +${added}, ~${changed}, −${deleted}]`;

  if (!shouldUpdateLastmod) {
    // lastmod ist bereits >= max mtime
    ok(
      `${relIndexFile} ist aktuell: ${
        currentLastmod || "<kein lastmod>"
      }${summarySuffix}`
    );
    stats.unchangedBundles++;
  } else {
    stats.updatedBundles++;
    note(
      `${relIndexFile} → Aktualisiere lastmod: ${
        currentLastmod || "<leer>"
      } → ${newLastmod}${summarySuffix}`
    );

    if (DRY_RUN) {
      note(
        `   ↳ dry-run: würde ${relIndexFile} schreiben und ggf. git add ausführen`
      );
    } else {
      const newContent = buildNewContent(fmLines, bodyLines, newLastmod);
      await fs.writeFile(indexFile, newContent, "utf8");

      if (GIT_ADD_ENABLED) {
        // Git optional – falls du es später wieder nutzen willst
        const { spawnSync } = await import("child_process");
        spawnSync("git", ["add", relIndexFile], { stdio: "ignore" });
      }
    }
  }

  // 6. Cache *immer* mit aktuellem Bestand aktualisieren
  cache.bundles[relDir] = { images: currentImages };
}

// ---------------------------------------------------------
// main()
// ---------------------------------------------------------

async function main() {
  header();

  const stats = {
    totalBundles: 0,
    updatedBundles: 0,
    unchangedBundles: 0,
    noImageBundles: 0,
    totalAdded: 0,
    totalChanged: 0,
    totalDeleted: 0,
  };

  let anyFound = false;

  for (const pattern of TARGET_DIRS) {
    const dirs = await glob(pattern, { nodir: false });

    for (const dir of dirs) {
      let statsDir;
      try {
        statsDir = statSync(dir);
      } catch {
        continue;
      }
      if (!statsDir.isDirectory()) continue;

      anyFound = true;
      stats.totalBundles++;

      const clean = dir.endsWith(path.sep) ? dir.slice(0, -1) : dir;
      const absDir = path.resolve(clean);

      await processBundle(absDir, stats);
    }
  }

  if (!anyFound) {
    info(
      "Keine passenden Verzeichnisse gefunden. (targetDirs in Config prüfen)"
    );
  }

  // Cache immer speichern – auch bei DRY_RUN
  await fs.writeFile(
    CACHE_PATH,
    JSON.stringify(
      {
        version: CACHE_VERSION,
        bundles: cache.bundles,
      },
      null,
      2
    ),
    "utf8"
  );

  footer(stats);
}

main().catch((e) => {
  console.error(pc.red("❌ Unerwarteter Fehler in hugo-update-lastmod:"), e);
  process.exit(1);
});
