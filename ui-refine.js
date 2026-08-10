(() => {
  'use strict';

  const input = document.getElementById('oszInput');
  const diffSelect = document.getElementById('difficultySelect');
  const viewport = document.getElementById('overviewViewport');
  const cursorCanvas = document.getElementById('overviewCursorCanvas');
  const samplePolicy = document.getElementById('samplePolicy');

  // This policy remains documented in code/README, but is not part of the normal UI.
  samplePolicy?.remove();

  if (!input || !diffSelect || !viewport || !window.JSZip) return;

  const densityCanvas = document.createElement('canvas');
  densityCanvas.id = 'songDensityCanvas';
  densityCanvas.setAttribute('aria-hidden', 'true');
  densityCanvas.style.cssText = [
    'position:absolute',
    'inset:0',
    'display:block',
    'width:100%',
    'height:100%',
    'pointer-events:none',
    'z-index:1',
    'background:transparent',
  ].join(';');

  if (cursorCanvas) viewport.insertBefore(densityCanvas, cursorCanvas);
  else viewport.appendChild(densityCanvas);

  let taikoMaps = [];
  let loadGeneration = 0;

  function sizeCanvas(canvas, cssWidth, cssHeight) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function parseTaikoMap(text) {
    let section = '';
    let mode = -1;
    const hits = [];

    text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach(raw => {
      const line = raw.trim();
      if (!line || line.startsWith('//')) return;
      if (line[0] === '[' && line.endsWith(']')) {
        section = line;
        return;
      }
      if (section === '[General]' && line.startsWith('Mode:')) {
        mode = Number.parseInt(line.slice(5).trim(), 10);
        return;
      }
      if (section === '[HitObjects]') {
        const f = line.split(',');
        if (f.length < 4) return;
        const time = Number.parseInt(f[2], 10);
        const type = Number.parseInt(f[3], 10) || 0;
        if (Number.isFinite(time) && (type & 1) !== 0) hits.push(time);
      }
    });

    return { mode, hits };
  }

  async function loadDensityData(file) {
    const generation = ++loadGeneration;
    taikoMaps = [];
    drawDensity();

    try {
      const bytes = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(bytes);
      const entries = Object.values(zip.files).filter(entry => !entry.dir && /\.osu$/i.test(entry.name));
      const parsed = [];
      for (const entry of entries) parsed.push(parseTaikoMap(await entry.async('string')));
      if (generation !== loadGeneration) return;
      taikoMaps = parsed.filter(item => item.mode === 1);
      drawDensity();
    } catch {
      if (generation !== loadGeneration) return;
      taikoMaps = [];
      drawDensity();
    }
  }

  function smoothedCounts(counts) {
    return counts.map((value, i) => {
      const a = counts[i - 1] ?? value;
      const b = value;
      const c = counts[i + 1] ?? value;
      return a * 0.2 + b * 0.6 + c * 0.2;
    });
  }

  function drawDensity() {
    const rect = viewport.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const ctx = sizeCanvas(densityCanvas, rect.width, rect.height);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const active = taikoMaps[Number(diffSelect.value) || 0];
    if (!active || !active.hits.length) return;

    const durationMs = Math.max(...active.hits, 1);
    const bins = Math.max(28, Math.min(46, Math.floor(rect.width / 8)));
    const counts = new Array(bins).fill(0);

    for (const time of active.hits) {
      const index = Math.min(bins - 1, Math.max(0, Math.floor(time / durationMs * bins)));
      counts[index]++;
    }

    const smooth = smoothedCounts(counts);
    const nonZero = smooth.filter(v => v > 0).sort((a, b) => a - b);
    if (!nonZero.length) return;
    const p90 = nonZero[Math.min(nonZero.length - 1, Math.floor((nonZero.length - 1) * 0.90))];
    const reference = Math.max(1, p90);

    // Dedicated middle band: BPM labels stay above; time ticks stay below.
    const top = Math.max(21, rect.height * 0.28);
    const bottom = Math.min(rect.height - 25, rect.height * 0.67);
    const bandHeight = Math.max(14, bottom - top);
    const step = rect.width / bins;
    const barWidth = Math.max(2, step * 0.76);

    ctx.fillStyle = 'rgba(255,255,255,.025)';
    ctx.fillRect(0, top, rect.width, bandHeight);

    ctx.strokeStyle = 'rgba(233,101,165,.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, bottom + 0.5);
    ctx.lineTo(rect.width, bottom + 0.5);
    ctx.stroke();

    const tops = [];
    for (let i = 0; i < bins; i++) {
      const ratio = Math.min(1, smooth[i] / reference);
      const h = smooth[i] > 0 ? Math.max(2.5, Math.sqrt(ratio) * bandHeight) : 0;
      const x = i * step + (step - barWidth) / 2;
      const y = bottom - h;
      tops.push([i * step + step / 2, y]);
      if (!h) continue;
      const alpha = 0.30 + ratio * 0.32;
      ctx.fillStyle = `rgba(233,101,165,${alpha.toFixed(3)})`;
      ctx.fillRect(x, y, barWidth, h);
    }

    ctx.strokeStyle = 'rgba(255,170,211,.72)';
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    tops.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,183,216,.82)';
    ctx.font = '800 7px -apple-system,BlinkMacSystemFont,sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('NOTES DENSITY', rect.width - 4, top - 2);
  }

  input.addEventListener('change', event => {
    const file = event.target.files && event.target.files[0];
    if (file && /\.osz$/i.test(file.name || '')) loadDensityData(file);
  });

  diffSelect.addEventListener('change', drawDensity);
  window.addEventListener('resize', drawDensity);
  window.addEventListener('orientationchange', drawDensity);
})();
