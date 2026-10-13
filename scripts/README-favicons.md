# Favicon Workflow

Two SVG sources, one mark (an Eixample block with a "B"):

- `public/favicon.svg`: the single amber block. Used for tabs and bookmarks (16, 32 and 256 px).
- `scripts/apple-touch-icon.svg`: the same block among its neighbours, square and opaque. Used for home screens and share previews (180 and 512 px). iOS masks the corners itself and fills transparency with black, so this one has no rounded corners or transparent areas.

The "B" is Playfair Display Bold, outlined to a path so the icons don't depend on the font.

To regenerate the PNGs after editing either SVG:

```bash
npm run favicons
```

This renders each size with Playwright's Chromium and updates:

- `public/favicon-16x16.png`, `public/favicon-32x32.png`, `public/favicon.png` (from `favicon.svg`)
- `public/apple-touch-icon.png`, `public/icon-512.png` (from `apple-touch-icon.svg`)

After regenerating the files:

1. Update `public/safari-pinned-tab.svg` (one colour, "B" knocked out) if the silhouette changed.
2. Bump the `?v=` cache-busting params in `scripts/template.mjs` and `public/site.webmanifest`.
3. Run `npm run build` to confirm the public assets are still emitted correctly.
