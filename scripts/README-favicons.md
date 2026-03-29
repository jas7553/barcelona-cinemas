# Favicon Workflow

`public/favicon.svg` is the source of truth for the app favicon artwork.

To regenerate the PNG variants after updating the SVG on macOS:

```bash
./scripts/generate-favicons.sh
```

This updates:

- `public/favicon.png`
- `public/favicon-32x32.png`
- `public/favicon-16x16.png`
- `public/apple-touch-icon.png`

The script uses macOS built-ins:

- `qlmanage` to rasterize the SVG
- `sips` to resize PNG outputs

After regenerating the files:

1. Update `public/safari-pinned-tab.svg` if the silhouette changed.
2. Bump the favicon cache-busting query params in `index.html`.
3. Run `npm run build` to confirm the public assets are still emitted correctly.
