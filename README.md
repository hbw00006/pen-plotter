# Pen Plotter — Photo → G-code (static webpage)

This is a single-page static web app that converts a photo to a set of raster pen strokes and produces G-code suitable for pen plotters that use Z moves to raise/lower the pen.

Features
- Upload a photo (client-only — no server)
- Scale image to target width (mm) at a configurable px/mm (resolution)
- Convert to strokes by raster scanning (horizontal lines across a rotated canvas)
- Optionally repeat passes at different angles for cross-hatching
- Preview the resulting strokes and download:
  - A preview PNG
  - A G-code file (.gcode)

How it works (brief)
- The image is scaled to the requested width and drawn to an offscreen canvas.
- For each pass (angle), the scaled image is rotated and raster-scanned every `line spacing` pixels.
- Runs of dark pixels are emitted as straight line segments (start/end) and turned into G-code moves.
- G-code uses:
  - G21 for mm units
  - Z moves for pen up/down (configurable)
  - G0 for travel and G1 for drawing moves
  - Feed speeds configurable

Usage
1. Open `index.html` in a modern browser.
2. Choose an image file.
3. Set desired width (mm) and resolution (px/mm).
4. Tune line spacing (mm) and threshold.
5. Set pen up/down Z values and feed speeds.
6. Click "Process & Preview".
7. If satisfied, download the preview PNG or G-code.

Notes and caveats
- This is a simple raster approach (horizontal line segments). It produces many short segments and is intentionally simple & deterministic.
- For continuous-curve plotting or vector optimization (reducing pen lifts, path optimization, Bézier tracing) you would add a graph-based path optimization / stroke linking step — which is outside this quick static demo.
- Coordinates are currently output with origin at the top-left of the rotated canvas (X right, Y down). If your plotter expects a different origin (e.g., bottom-left), flip Y accordingly or translate coordinates in post-processing.
- Extremely high resolutions or very large images will produce very large G-code files and may be slow in the browser.

Extending
- Merge adjacent segments into longer polylines to reduce pen lifts.
- Implement path optimization (nearest-neighbour linking).
- Add vector tracing (e.g., Potrace / marching squares) to get vector paths rather than raster lines.
- Add presets for common plotters (AxiDraw uses a different command set; convert Z moves to pen up/down API calls if needed).

License: MIT
