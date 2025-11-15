# README

## Task

- Find out whether images in the content/galleries galleries have changed.
- Updates the lastmod property in the front matter of the respective index.md.

In detail

- Scan the image files for each galleries/gallery-1 (bundle directory).
- For each bundle:
  - Compare image inventory with last run (cache)
  - Count changes: + added, ~ changed, − deleted
  - Determine max. mtime of all images
  - Update lastmod in index.md if max. mtime > current lastmod
- Output:
  - Per bundle: Status + image diffs
  - Global: Total number of bundles and image changes
  - Writes a `.hugo-update-lastmod.cache.json` file in your projekt root folder.

Important features:

- No Git necessary – everything is based on the file system (mtime, size).
- Cache is always updated (even with --dry-run).
- lastmod decision depends only on mtime vs. lastmod,
  not on +/~/- (these are for information only).

## Install

```bash
npm i -D hugo-update-lastmod
# or
npm install --save-dev hugo-update-lastmod
# or
yarn add --dev hugo-update-lastmod
# or
pnpm add -D hugo-update-lastmod
```

## Setup

Create a `hugo-update-lastmod.config.json` in the root folder of your project:
  
```json
{
  "targetDirs": [
    "content/galleries/*/",
    "content/stories/*/"
  ],
  "extensions": ["jpg", "jpeg", "png", "webp", "avif"],
  "maxDepth": 1,
  "frontmatterDelim": "---",
  "gitAdd": true
}
```

Add `hugo-update-lastmod` skript in your workflow:

```json
"scripts": {
  "predev": "hugo-update-lastmod",
  "dev": "hugo server --disableFastRender --noHTTPCache",

  "prebuild": "hugo-update-lastmod",
  "build": "hugo --minify --gc",

  "clean": "find . -type f -name .DS_Store -delete && rm -rf public",
  "cleanbuild": "npm run clean && npm run build",
}
```

Enjoy :-)

The file hugo-update-lastmod.mjs is pure JavaScript, not TypeScript. Node.js can execute it directly as long as "type": "module" is in package.json  or the file has the extension .mjs.

## Links

- <https://github.com/cnichte/hugo-update-lastmod>
- <https://www.npmjs.com/package/hugo-update-lastmod>
