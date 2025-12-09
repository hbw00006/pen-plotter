// Pen plotter photo -> G-code (raster strokes)
// Basic approach:
// - User uploads image
// - We scale image to target width (mm) at given px/mm resolution
// - For each pass (angle), we rotate the image to that angle on an offscreen canvas
// - Raster-scan lines at spacing, detect dark pixel runs and convert them to stroke segments
// - Generate G-code using Z moves for pen up/down and X/Y for travel/draw
// - Render a preview canvas of the strokes for visual confirmation

(() => {
  const fileInput = document.getElementById('file');
  const widthMMInput = document.getElementById('widthMM');
  const pxPerMMInput = document.getElementById('pxPerMM');
  const lineSpacingMMInput = document.getElementById('lineSpacingMM');
  const thresholdInput = document.getElementById('threshold');
  const thresholdVal = document.getElementById('thresholdVal');
  const angleInput = document.getElementById('angle');
  const passesInput = document.getElementById('passes');
  const processBtn = document.getElementById('processBtn');
  const downloadPNG = document.getElementById('downloadPNG');
  const downloadGcode = document.getElementById('downloadGcode');
  const previewCanvas = document.getElementById('previewCanvas');
  const penDownZInput = document.getElementById('penDownZ');
  const penUpZInput = document.getElementById('penUpZ');
  const feedTravelInput = document.getElementById('feedTravel');
  const feedDrawInput = document.getElementById('feedDraw');
  const absMovesCheckbox = document.getElementById('absMoves');
  const meta = document.getElementById('meta');

  let img = new Image();
  let lastStrokes = null; // array of strokes for preview and gcode
  let lastCanvasSize = {w:0,h:0,mmPerPx:0};

  thresholdVal.textContent = thresholdInput.value;
  thresholdInput.addEventListener('input', () => thresholdVal.textContent = thresholdInput.value);

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) {
      const reader = new FileReader();
      reader.onload = e => {
        img = new Image();
        img.onload = () => {
          processBtn.disabled = false;
          meta.textContent = `Loaded image ${img.naturalWidth}×${img.naturalHeight}px`;
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(fileInput.files[0]);
    }
  });

  processBtn.addEventListener('click', async () => {
    if (!img || !img.src) return;
    processBtn.disabled = true;
    try {
      const widthMM = parseFloat(widthMMInput.value);
      const pxPerMM = parseFloat(pxPerMMInput.value);
      const lineSpacingMM = parseFloat(lineSpacingMMInput.value);
      const threshold = parseInt(thresholdInput.value, 10);
      const angleDeg = parseFloat(angleInput.value) || 0;
      const passes = Math.max(1, parseInt(passesInput.value, 10) || 1);

      // Convert to pixel dimensions for working canvas
      const targetPxWidth = Math.max(1, Math.round(widthMM * pxPerMM));
      const scale = targetPxWidth / img.naturalWidth;
      const targetPxHeight = Math.round(img.naturalHeight * scale);

      // Process for each pass (angles spread evenly)
      const strokesByPass = [];
      const angles = [];
      for (let p = 0; p < passes; p++) {
        const passAngle = (angleDeg + (p * 180 / passes)) % 360; // spread passes by 180/p for crosshatch
        angles.push(passAngle);
      }

      const mmPerPx = 1 / pxPerMM;
      const lineSpacingPx = Math.max(1, Math.round(lineSpacingMM * pxPerMM));

      // For each angle, rotate and extract strokes
      for (let ai = 0; ai < angles.length; ai++) {
        const ang = angles[ai];
        const strokes = extractStrokesFromImage(img, targetPxWidth, targetPxHeight, ang, lineSpacingPx, threshold);
        strokesByPass.push({angle: ang, strokes});
      }

      // Combine strokes into a single strokes list (ordered by pass)
      const combinedStrokes = [];
      strokesByPass.forEach(pass => {
        // adjust coordinates from rotated canvas direct to mm using mmPerPx mapping
        pass.strokes.forEach(st => {
          combinedStrokes.push(st.map(pt => ({x: pt.x * mmPerPx, y: pt.y * mmPerPx})));
        });
      });

      lastStrokes = combinedStrokes;
      lastCanvasSize = {w: targetPxWidth, h: targetPxHeight, mmPerPx, angles};

      // Render preview
      renderPreview(lastStrokes, targetPxWidth, targetPxHeight, mmPerPx);

      downloadPNG.disabled = false;
      downloadGcode.disabled = false;
      meta.innerHTML = `Processed: width ${widthMM}mm @ ${pxPerMM} px/mm → ${targetPxWidth}×${targetPxHeight}px. Passes: ${passes} angles: ${angles.map(a=>a.toFixed(1)).join(', ')}. Strokes: ${lastStrokes.length}.`;
    } catch (err) {
      console.error(err);
      alert('Error processing image: ' + err.message);
    } finally {
      processBtn.disabled = false;
    }
  });

  downloadPNG.addEventListener('click', () => {
    if (!lastStrokes) return;
    // Export current previewCanvas as PNG
    const a = document.createElement('a');
    a.href = previewCanvas.toDataURL('image/png');
    a.download = 'plot-preview.png';
    a.click();
  });

  downloadGcode.addEventListener('click', () => {
    if (!lastStrokes) return;
    const penDownZ = parseFloat(penDownZInput.value);
    const penUpZ = parseFloat(penUpZInput.value);
    const feedTravel = parseFloat(feedTravelInput.value);
    const feedDraw = parseFloat(feedDrawInput.value);
    const absolute = !!absMovesCheckbox.checked;

    const header = [];
    header.push('; Generated by Pen Plotter Photo → G-code');
    header.push('G21 ; units mm');
    header.push(absolute ? 'G90 ; absolute positioning' : 'G91 ; relative positioning');
    header.push(`G0 Z${penUpZ.toFixed(3)} ; pen up`);
    header.push(`F${feedTravel}`);
    header.push('');

    const lines = [...header];

    // Use a simple strategy: for each stroke array of points:
    // - Rapid move to first point at pen up
    // - Lower pen (G0 Z penDownZ) then G1 lines between successive points with draw feed
    // - Raise pen with G0 Z penUpZ
    lastStrokes.forEach((stroke, idx) => {
      if (!stroke || stroke.length === 0) return;
      const p0 = stroke[0];
      lines.push(`; stroke ${idx + 1}`);
      lines.push(`G0 X${p0.x.toFixed(3)} Y${p0.y.toFixed(3)} ; travel`);
      lines.push(`G0 Z${penDownZ.toFixed(3)} ; pen down`);
      lines.push(`F${feedDraw}`);
      // draw points
      for (let i = 1; i < stroke.length; i++) {
        const p = stroke[i];
        lines.push(`G1 X${p.x.toFixed(3)} Y${p.y.toFixed(3)}`);
      }
      // lift pen
      lines.push(`G0 Z${penUpZ.toFixed(3)} ; pen up`);
      lines.push(`F${feedTravel}`);
    });

    lines.push('');
    lines.push('; EOF');

    const blob = new Blob([lines.join('\n')], {type: 'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plot.gcode';
    a.click();
    URL.revokeObjectURL(url);
  });

  // Extract strokes from image by drawing rotated image on an offscreen canvas and raster scanning
  function extractStrokesFromImage(image, targetW, targetH, angleDeg, lineSpacingPx, threshold) {
    // Create an offscreen canvas large enough to hold rotated image
    const angleRad = angleDeg * Math.PI / 180;
    // Scale image first to targetW x targetH
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = targetW;
    srcCanvas.height = targetH;
    const sctx = srcCanvas.getContext('2d', {willReadFrequently:true});
    sctx.drawImage(image, 0, 0, targetW, targetH);

    // Compute rotated bounding box size
    const cos = Math.abs(Math.cos(angleRad));
    const sin = Math.abs(Math.sin(angleRad));
    const rotW = Math.ceil(targetW * cos + targetH * sin);
    const rotH = Math.ceil(targetW * sin + targetH * cos);

    const rotCanvas = document.createElement('canvas');
    rotCanvas.width = rotW;
    rotCanvas.height = rotH;
    const rctx = rotCanvas.getContext('2d', {willReadFrequently:true});

    // Fill white background then draw rotated image centered
    rctx.fillStyle = 'white';
    rctx.fillRect(0, 0, rotW, rotH);
    rctx.save();
    rctx.translate(rotW/2, rotH/2);
    rctx.rotate(angleRad);
    rctx.drawImage(srcCanvas, -targetW/2, -targetH/2);
    rctx.restore();

    // Get image data (grayscale)
    const imgd = rctx.getImageData(0, 0, rotW, rotH);
    const data = imgd.data;

    // Convert to grayscale array
    function pixelGray(x,y){
      if (x < 0 || x >= rotW || y < 0 || y >= rotH) return 255;
      const idx = (y * rotW + x) * 4;
      const r = data[idx], g = data[idx+1], b = data[idx+2];
      // luminance
      return 0.2126*r + 0.7152*g + 0.0722*b;
    }

    const strokes = [];
    // For each raster row at spacing, scan horizontally and build runs
    for (let y = 0; y < rotH; y += lineSpacingPx) {
      let inRun = false;
      let run = [];
      for (let x = 0; x < rotW; x++) {
        const g = pixelGray(x, y);
        const isDark = g < threshold;
        if (isDark) {
          if (!inRun) {
            // start new run
            inRun = true;
            run = [{x, y}];
          } else {
            run.push({x, y});
          }
        } else {
          if (inRun) {
            // finish current run
            inRun = false;
            if (run.length >= 1) {
              // simplify run: only keep start and end (linear)
              strokes.push([run[0], run[run.length-1]]);
            }
            run = [];
          }
        }
      }
      // close run at end of row
      if (inRun && run.length >= 1) {
        strokes.push([run[0], run[run.length-1]]);
      }
    }

    // Map stroke pixel coordinates in rotated canvas to original rotated canvas coordinate system,
    // but leave them as-is (they are in rotated canvas coordinates). Later we'll scale mm-per-px.
    // For nicer preview, we will scale up coordinates to integer values.
    const simpleStrokes = strokes.map(s => {
      // Expand run to line of two endpoints (can be drawn as single segment)
      return [
        {x: s[0].x + 0.0, y: s[0].y + 0.0},
        {x: s[1].x + 0.0, y: s[1].y + 0.0}
      ];
    });

    // Convert each segment into a polyline (start -> end). For better continuous drawing, you could
    // connect neighboring segments; this simple version emits many short segments.
    return simpleStrokes;
  }

  // Render strokes into preview canvas
  function renderPreview(strokes, pixelWidth, pixelHeight, mmPerPx){
    // We'll create a preview canvas that matches pixelWidth x pixelHeight scaled up for clarity
    const scale = Math.min(1200 / pixelWidth, 800 / pixelHeight, 1.0) || 1.0;
    const width = Math.round(pixelWidth * scale);
    const height = Math.round(pixelHeight * scale);
    previewCanvas.width = width;
    previewCanvas.height = height;
    const ctx = previewCanvas.getContext('2d');

    // Clear and white background
    ctx.fillStyle = 'white';
    ctx.fillRect(0,0,width,height);

    // Draw light grid to show mm ticks (optional)
    // draw strokes: map mm coords * (1/mmPerPx) * scale to px
    ctx.strokeStyle = 'black';
    ctx.lineWidth = Math.max(0.5, 1 * scale);

    // Each stroke is a polyline in mm. Convert back to pixel coords in rotated canvas by dividing by mmPerPx
    strokes.forEach(stroke => {
      if (!stroke || stroke.length < 2) return;
      ctx.beginPath();
      const p0 = stroke[0];
      ctx.moveTo((p0.x / mmPerPx) * scale, (p0.y / mmPerPx) * scale);
      for (let i = 1; i < stroke.length; i++) {
        const p = stroke[i];
        ctx.lineTo((p.x / mmPerPx) * scale, (p.y / mmPerPx) * scale);
      }
      ctx.stroke();
    });
  }

  // Helpful: warn if generated gcode will be very large (many strokes)
  // (left as an exercise — could implement a user warning before enabling download)
})();
