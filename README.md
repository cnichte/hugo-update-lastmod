# README

## Task

- Find out whether images in the content/galleries galleries have changed.
- Updates the lastmod property in the front matter of the respective index.md.
- For this to take effect, the changed images must be committed to git.
- Optionally mark as executable: chmod +x update-lastmod.mjs

## Setup

```bash
npm install --save-dev hugo-update-lastmod
```

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