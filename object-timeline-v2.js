(() => {
  'use strict';

  const input = document.getElementById('oszInput');
  const diff = document.getElementById('difficultySelect');
  const viewport = document.getElementById('timelineViewport');
  const zoomLabel = document.getElementById('zoomLabel');
  const seek = document.getElementById('seekBar');
  if (!input || !diff || !viewport || !zoomLabel || !seek || !window.JSZip) return;

  const oldOverlay = document.getElementById('objectHitLaneCanvas');
  if (oldOverlay) oldOverlay.style.visibility = 'hidden';

  const canvas = document.createElement('canvas');
  canvas.id = 'objectTimelineV2Canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = [
    'position:absolute',
    'inset:0',
    'display:block',
    'width:100%',
    'height:100%',
    'pointer-events:none',
    'z-index:7',
    'background:transparent'
  ].join(';');
  viewport.appendChild(canvas);

  const POST_HIT_FADE_MS = 110;
  const DON = 'rgb(235,69,44)';
  const KA = 'rgb(68,141,171)';
  const LANE = '#121214';
  let maps = [];
  let generation = 0;

  function parseMap(text) {
    const map = { mode: -1, hits: [], timing: [], redTiming: [] };
    let section = '';
    text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((raw, order) => {
      const line = raw.trim();
      if (!line || line.startsWith('//')) return;
      if (line[0] === '[' && line.endsWith(']')) { section = line; return; }

      if (section === '[General]' && line.startsWith('Mode:')) {
        map.mode = Number.parseInt(line.slice(5).trim(), 10);
        return;
      }

      if (section === '[TimingPoints]') {
        const f = line.split(',');
        if (f.length < 8) return;
        const time = Number(f[0]);
        const beat = Number(f[1]);
        const meter = Number.parseInt(f[2], 10) || 4;
        const uninherited = Number.parseInt(f[6], 10) || 0;
        const effects = Number.parseInt(f[7], 10) || 0;
        if (!Number.isFinite(time)) return;
        const point = { time, beat, meter, uninherited, effects, order };
        map.timing.push(point);
        if (uninherited === 1 && beat > 0 && Number.isFinite(beat)) map.redTiming.push(point);
        return;
      }

      if (section === '[HitObjects]') {
        const f = line.split(',');
        if (f.length < 5) return;
        const time = Number.parseInt(f[2], 10);
        const type = Number.parseInt(f[3], 10) || 0;
        const sound = Number.parseInt(f[4], 10) || 0;
        if (!Number.isFinite(time) || (type & 1) === 0) return;
        map.hits.push({
          time,
          kind: (sound & (2 | 8)) !== 0 ? 'ka' : 'don',
          big: (sound & 4) !== 0
        });
      }
    });
    map.hits.sort((a, b) => a.time - b.time);
    map.timing.sort((a, b) => a.time - b.time || a.order - b.order);
    map.redTiming.sort((a, b) => a.time - b.time || a.order - b.order);
    return map;
  }

  async function readOsz(file) {
    const localGeneration = ++generation;
    try {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const entries = Object.values(zip.files).filter(entry => !entry.dir && /\.osu$/i.test(entry.name));
      const parsed = [];
      for (const entry of entries) parsed.push(parseMap(await entry.async('string')));
      if (localGeneration !== generation) return;
      maps = parsed.filter(map => map.mode === 1);
    } catch {
      if (localGeneration !== generation) return;
      maps = [];
    }
  }

  input.addEventListener('change', event => {
    const file = event.target.files && event.target.files[0];
    if (file && /\.osz$/i.test(file.name || '')) readOsz(file);
  });

  function activeMap() {
    return maps[Number(diff.value) || 0] || null;
  }

  function zoomSpanMs() {
    const text = zoomLabel.textContent || '±0.5s';
    if (text.includes('0.3')) return 600;
    if (text.includes('0.4')) return 800;
    return 1000;
  }

  function sizeCanvas(rect) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function kiaiIntervals(map, durationMs) {
    const out = [];
    let on = false;
    let start = null;
    for (const tp of map.timing) {
      const next = (tp.effects & 1) !== 0;
      if (next === on) continue;
      if (on && start !== null && tp.time > start) out.push({ start, end: tp.time });
      on = next;
      start = next ? tp.time : null;
    }
    if (on && start !== null) out.push({ start, end: durationMs });
    return out;
  }

  function drawBeatLines(ctx, map, leftTime, rightTime, xForTime, laneTop, laneBottom) {
    let safety = 0;
    const red = map.redTiming;
    for (let r = 0; r < red.length; r++) {
      const tp = red[r];
      const sectionEnd = r + 1 < red.length ? red[r + 1].time : rightTime;
      const a = Math.max(leftTime, tp.time);
      const b = Math.min(rightTime, sectionEnd);
      if (b < a || !(tp.beat > 0)) continue;
      let n = Math.ceil((a - tp.time) / tp.beat);
      if (!Number.isFinite(n)) continue;
      for (let time = tp.time + n * tp.beat; time <= b + 0.01; time += tp.beat, n++) {
        if (++safety > 2500) return;
        const meter = Math.max(1, tp.meter || 4);
        const measure = ((n % meter) + meter) % meter === 0;
        const x = Math.round(xForTime(time)) + 0.5;
        ctx.strokeStyle = measure ? 'rgba(255,255,255,.25)' : 'rgba(255,255,255,.14)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, laneTop);
        ctx.lineTo(x, laneBottom);
        ctx.stroke();
      }
    }
  }

  function render() {
    const rect = viewport.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const ctx = sizeCanvas(rect);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const map = activeMap();
    const durationMs = Number(seek.max) > 0 ? Number(seek.max) * 1000 : 0;
    if (!map || !map.hits.length || !(durationMs > 0)) return;

    const nowMs = Number(seek.value) * 1000;
    const span = zoomSpanMs();
    const hitX = Math.max(50, Math.min(76, rect.width * 0.16));
    const pxPerMs = rect.width / span;
    const xForTime = time => hitX + (time - nowMs) * pxPerMs;
    const leftTime = nowMs - hitX / pxPerMs;
    const rightTime = nowMs + (rect.width - hitX) / pxPerMs;

    const laneTop = Math.max(22, rect.height * 0.20);
    const laneBottom = Math.min(rect.height - 22, rect.height * 0.79);
    const laneHeight = Math.max(54, laneBottom - laneTop);
    const noteY = laneTop + laneHeight * 0.50;
    const normalRadius = 19;
    const bigRadius = 22.5;

    // Hide the legacy bottom ticks, then restore Kiai only in the lower band.
    const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#0f1014';
    ctx.fillStyle = surface;
    ctx.fillRect(0, laneBottom + 1, rect.width, rect.height - laneBottom - 1);
    for (const range of kiaiIntervals(map, durationMs)) {
      const x1 = Math.max(0, xForTime(range.start));
      const x2 = Math.min(rect.width, xForTime(range.end));
      if (x2 > x1) {
        ctx.fillStyle = 'rgba(244,220,125,.15)';
        ctx.fillRect(x1, laneBottom + 1, x2 - x1, rect.height - laneBottom - 1);
      }
    }

    // Back: lane.
    ctx.fillStyle = LANE;
    ctx.fillRect(0, laneTop, rect.width, laneHeight);

    // Lane borders: 1px white lines edge-to-edge.
    ctx.strokeStyle = 'rgba(255,255,255,.48)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(laneTop) + 0.5);
    ctx.lineTo(rect.width, Math.round(laneTop) + 0.5);
    ctx.moveTo(0, Math.round(laneBottom) + 0.5);
    ctx.lineTo(rect.width, Math.round(laneBottom) + 0.5);
    ctx.stroke();

    // Behind notes: beat / measure lines, 1px wide and full lane height.
    drawBeatLines(ctx, map, leftTime, rightTime, xForTime, laneTop, laneBottom);

    // Notes.
    const visibleLeftTime = nowMs - POST_HIT_FADE_MS;
    const visibleRightTime = rightTime + 50;
    for (const hit of map.hits) {
      if (hit.time < visibleLeftTime) continue;
      if (hit.time > visibleRightTime) break;

      const ageMs = nowMs - hit.time;
      const postHit = ageMs > 0;
      const progress = postHit ? Math.min(1, ageMs / POST_HIT_FADE_MS) : 0;
      if (postHit && progress >= 1) continue;

      const baseRadius = hit.big ? bigRadius : normalRadius;
      const scale = postHit ? 1 - 0.65 * progress : 1;
      const alpha = postHit ? 1 - progress : 1;
      const x = postHit ? hitX - 12 * progress : xForTime(hit.time);
      const y = postHit ? noteY - 12 * progress : noteY;
      const radius = baseRadius * scale;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = hit.kind === 'ka' ? KA : DON;
      ctx.strokeStyle = 'rgba(255,255,255,.96)';
      ctx.lineWidth = hit.big ? 3.0 : 2.4;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (hit.big) {
        ctx.strokeStyle = 'rgba(255,255,255,.28)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(x, y, radius + 3.2 * scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Front: hit target, approximately the same outer diameter as resized Big note.
    const targetRadius = 24.5;
    ctx.strokeStyle = 'rgba(235,235,238,.82)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hitX, noteY, targetRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(235,235,238,.30)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(hitX, noteY, targetRadius - 4, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,.40)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(hitX) + 0.5, laneTop);
    ctx.lineTo(Math.round(hitX) + 0.5, laneBottom);
    ctx.stroke();
  }

  diff.addEventListener('change', () => setTimeout(render, 0));
  window.addEventListener('resize', render);
  window.addEventListener('orientationchange', render);

  function frame() {
    render();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
