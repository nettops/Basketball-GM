# Brand

`lets-hoop.png` — the game's wordmark. Used in two places, both wired already:

- the browser tab icon (`<link rel="icon">` in `index.html`)
- the sidebar mark (`.brand-mark`, styled in `style.css`)

## Requirements

Square PNG, transparent background. It is displayed at up to 92px wide in the
sidebar and 16-32px as a favicon, so around 512x512 is plenty.

It is **pixel art**, and `.brand-mark` sets `image-rendering: pixelated` so the
blocks stay square instead of being smoothed into mush at small sizes. Keep any
replacement pixel art, or drop that rule — a smooth logo rendered with
`pixelated` looks worse than either.

## If the file is missing

The `<img>` carries an `onerror` that hides it and reveals a text wordmark
reading "lets hoop!" underneath, so a checkout without this file still shows the
name rather than a broken-image icon. The favicon simply falls back to the
browser default.

That means this file is genuinely optional — but the game is meant to have it.
