#!/usr/bin/env node
/**
 ** hugo-update-lastmod.mjs
 * 
 * @author Carsten Nichte, 2025
 * 
 * Aufgabe:
 * 
 * Find out whether images in the content/galleries galleries have changed.
 * Updates the lastmod property in the front matter of the respective index.md.
 * 
 * For this to take effect, the changed images must be committed to git.
 * 
 * The hugo-update-lastmod.mjs file is pure JavaScript, not TypeScript.
 * Node.js can execute it directly as long as "type": "module" is in package.json 
 * or the file has the extension .mjs.
 * 
 * @author Carsten Nichte, 2025
 */

// bin/hugo-update-lastmod.mjs
import { promises as fs, existsSync, statSync } from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { glob } from "glob";
import pc from "picocolors";

// ---------------------------------------------------------
// Config laden
// Sucht zuerst hugo-update-lastmod.config.json, dann lastmod.config.json
// ---------------------------------------------------------

const CONFIG_CANDIDATES = [
  "hugo-update-lastmod.config.json",
  "lastmod.config.json"
];

let CONFIG_PATH = null;
for (const candidate of CONFIG_CANDIDATES) {
  const p = path.resolve(candidate);
  if (existsSync(p)) {
    CONFIG_PATH = p;
    break;
  }
}

let CONFIG = {
  targetDirs: ["content/galleries/*/", "content/stories/*/"],
  extensions: ["jpg", "jpeg", "png", "webp", "avif"],
  maxDepth: 1,
  frontmatterDelim: "---",
  gitAdd: true
};

try {
  if (CONFIG_PATH) {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    CONFIG = {
      ...CONFIG,
      ...parsed
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
// Logging-Helpers
// ---------------------------------------------------------

function header() {
  console.log("\n" + "-".repeat(65));
  console.log(pc.bold("🏃  hugo-update-lastmod"));
  if (CONFIG_PATH) {
    console.log(`   Config:      ${pc.cyan(path.relative(process.cwd(), CONFIG_PATH))}`);
  } else {
    console.log(`   Config:      ${pc.yellow("Default (keine Datei gefunden)")}`);
  }
  console.log(
    `   Directories: ${pc.cyan(TARGET_DIRS.join(", "))}\n` +
    `   MaxDepth:    ${pc.cyan(String(MAXDEPTH))}\n` +
    `   Extensions:  ${pc.cyan(EXTENSIONS.join(", "))}\n` +
    `   git add:     ${pc.cyan(GIT_ADD_ENABLED ? "yes" : "no")}\n`
  );
}

function footer() {
  console.log(pc.bold(pc.green("✅ Fertig: lastmod ggf. aktualisiert.")));
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

async function getImageFiles(dir, maxDepth) {
  const files = [];

  async function walk(current, depth) {
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const full = path.join(current, entry.name);

      if (entry.isFile()) {
        const low = entry.name.toLowerCase();
        if (EXTENSIONS.some((ext) => low.endsWith("." + ext))) {
          files.push(full);
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

function getLastGitCommitDate(dir, files) {
  const args = ["log", "-1", "--format=%cI", "--", dir];

  // Optional: zusätzlich die aktuellen Bild-Dateien mitgeben (schadet nicht)
  if (files && files.length) {
    args.push(...files);
  }

  const res = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });

  if (res.status !== 0) return null;

  const out = res.stdout.trim();
  return out || null;
}

async function processBundle(dir) {
  const indexFile = path.join(dir, "index.md");
  if (!existsSync(indexFile)) return;

  const files = await getImageFiles(dir, MAXDEPTH);
  if (files.length === 0) {
    // Nur Hinweis – aber wir verwenden trotzdem die Git-Historie des Bundles
    warn(`Keine Bilder in ${dir} – verwende Git-Historie des Bundles.`);
  }

  // WICHTIG: jetzt das Verzeichnis an git log übergeben
  const lastmod = getLastGitCommitDate(dir, files);
  if (!lastmod) {
    warn(`Keine Commit-Infos zu ${dir} – überspringe`);
    return;
  }

  const raw = await fs.readFile(indexFile, "utf8");
  const lines = raw.split("\n");

  const fmIdx = lines
    .map((line, i) => (line.trim() === FRONTMATTER_DELIM ? i : -1))
    .filter((i) => i !== -1);

  if (fmIdx.length < 2 || fmIdx[1] <= fmIdx[0]) {
    err(`Kein gültiges Frontmatter in ${indexFile} – überspringe`);
    return;
  }

  const fmStart = fmIdx[0];
  const fmEnd = fmIdx[1];

  const fmLines = lines.slice(fmStart + 1, fmEnd);
  const bodyLines = lines.slice(fmEnd + 1);

  let current = "";
  for (const line of fmLines) {
    if (line.startsWith("lastmod:")) {
      current = line.replace(/^lastmod:\s*/, "").replace(/"/g, "").trim();
      break;
    }
  }

  if (current === lastmod) {
    ok(`${indexFile} ist aktuell: ${lastmod}`);
    return;
  }

  note(
    `${indexFile} → Aktualisiere lastmod: ${current || "<leer>"} → ${lastmod}`
  );

  const newFm = [];
  let replaced = false;

  for (const line of fmLines) {
    if (!replaced && line.startsWith("lastmod:")) {
      newFm.push(`lastmod: "${lastmod}"`);
      replaced = true;
    } else {
      newFm.push(line);
    }
  }

  if (!replaced) {
    newFm.push(`lastmod: "${lastmod}"`);
  }

  const newContent =
    `${FRONTMATTER_DELIM}\n` +
    newFm.join("\n") +
    `\n${FRONTMATTER_DELIM}\n` +
    bodyLines.join("\n");

  await fs.writeFile(indexFile, newContent, "utf8");

  if (GIT_ADD_ENABLED) {
    spawnSync("git", ["add", indexFile], { stdio: "ignore" });
  }
}

// ---------------------------------------------------------
// main()
// ---------------------------------------------------------

async function main() {
  header();

  let anyFound = false;

  for (const pattern of TARGET_DIRS) {
    const dirs = await glob(pattern, { nodir: false });

    for (const dir of dirs) {
      let stats;
      try {
        stats = statSync(dir);
      } catch {
        continue;
      }
      if (!stats.isDirectory()) continue;

      anyFound = true;

      const clean = dir.endsWith(path.sep) ? dir.slice(0, -1) : dir;

      await processBundle(clean);
    }
  }

  if (!anyFound) {
    info(
      "Keine passenden Verzeichnisse gefunden. (targetDirs in Config prüfen)"
    );
  }

  footer();
}

main().catch((e) => {
  console.error(pc.red("❌ Unerwarteter Fehler in hugo-update-lastmod:"), e);
  process.exit(1);
});