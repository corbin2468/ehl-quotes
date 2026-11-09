# Motion graphics (code-rendered)

For the faceless account's packaging: series title cards, "previously on" recaps, end cards.
Every frame is painted by a web page, captured in Chrome and stitched with ffmpeg, so it costs $0.

- `engine/studio.js`: beat grid, closed-form springs, scenes, a synthesizer (music made in code)
- `engine/render.cjs`: `node faceless/motion/engine/render.cjs <composition-folder> [--keep --from s --to s]`
- `engine/critique.py`: watches every frame, flags dead frames and off-beat cuts, bans basic CSS motion,
  grades each scene out of 10; re-render until every scene passes
- `fonts/`: Instrument Serif and Manrope (SIL Open Font License)

A composition is a folder with `index.html` (layout and type) and `main.js` (scenes and soundtrack).
Same rules as the episodes: no cussing, never the Lord's name in vain, 1080x1920, text in TikTok's safe zone.
