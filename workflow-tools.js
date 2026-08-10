(() => {
  'use strict';

  const input = document.getElementById('oszInput');
  const diff = document.getElementById('difficultySelect');
  const timelineViewport = document.getElementById('timelineViewport');
  const zoomLabel = document.getElementById('zoomLabel');
  const seek = document.getElementById('seekBar');
  const outputPanel = document.querySelector('.output-panel');
  const outputPreview = document.getElementById('outputPreview');
  const copyOutput = document.getElementById('copyOutputButton');
  const purpose = document.getElementById('purposeSelect');
  const fade = document.getElementById('fadeSelect');
  const startButton = document.getElementById('startMarkButton');
  const endButton = document.getElementById('endMarkButton');
  const fileName = document.getElementById('fileName');

  if (!input || !diff || !timelineViewport || !seek || !outputPanel || !window.JSZip) return;

  const HASH_PREFIX = 'sha256:';
  const POST_HIT_FADE_MS = 110;
  const loadedExactHashes = new Set();
  const loadedMapFingerprints = new Set();
  const decidedFingerprints = new Set();
  const queue = [];
  let currentFingerprint = null;
  let currentVisualMaps = [];
  let redispatching = false;
  let hashGeneration = 0;

  const overlay = document.createElement('canvas');
  overlay.id = 'objectHitLaneCanvas';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.cssText = [
    'position:absolute',
    'inset:0',
    'display:block',
    'width:100%',
    'height:100%',
    'pointer-events:none',
    'z-index:6',
    'background:transparent'
  ].join(';');
  timelineViewport.appendChild(overlay);

  const queueBar = document.createElement('div');
  queueBar.className = 'workflow-queue-bar';
  queueBar.innerHTML = `
    <span class="workflow-queue-count">確定済み 0件</span>
    <div class="workflow-queue-actions">
      <button type="button" class="workflow-queue-button decide" disabled>決定</button>
      <button type="button" class="workflow-queue-button export" disabled>TXT出力</button>
    </div>`;

  const queueMessage = document.createElement('p');
  queueMessage.className = 'workflow-queue-message';
  queueMessage.textContent = '各OSZの設定後に「決定」、全件終了後に「TXT出力」。';

  outputPanel.appendChild(queueBar);
  outputPanel.appendChild(queueMessage);

  const countNode = queueBar.querySelector('.workflow-queue-count');
  const decideButton = queueBar.querySelector('.decide');
  const exportButton = queueBar.querySelector('.export');

  function setMessage(text, tone = '') {
    queueMessage.textContent = text;
    queueMessage.className = `workflow-queue-message${tone ? ` ${tone}` : ''}`;
  }

  function bytesToHex(bytes) {
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  }

  async function sha256(data) {
    if (!crypto?.subtle) throw new Error('このブラウザでは重複判定用SHA-256を利用できません。');
    const bytes = data instanceof ArrayBuffer ? data : new TextEncoder().encode(String(data));
    return HASH_PREFIX + bytesToHex(await crypto.subtle.digest('SHA-256', bytes));
  }

  function parseVisualMap(text) {
    const map = { mode: -1, hits: [], timing: [] };
    let section = '';
    text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((raw, order) => {
      const line = raw.trim();
      if (!line || line.startsWith('//')) return;
      if (line[0] === '[' && line.endsWith(']')) {
        section = line;
        return;
      }
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
        if (Number.isFinite(time)) map.timing.push({ time, beat, meter, uninherited, effects, order });
        return;
      }
      if (section === '[HitObjects]') {
        const f = line.split(',');
        if (f.length < 5) return;
        const time = Number.parseInt(f[2], 10);
        const type = Number.parseInt(f[3], 10) || 0;
        const sound = Number.parseInt(f[4], 10) || 0;
        if (!Number.isFinite(time) || (type & 1) === 0) return;
        const ka = (sound & (2 | 8)) !== 0;
        const big = (sound & 4) !== 0;
        map.hits.push({ time, kind: ka ? 'ka' : 'don', big });
      }
    });
    map.hits.sort((a, b) => a.time - b.time);
    map.timing.sort((a, b) => a.time - b.time || a.order - b.order);
    return map;
  }

  async function inspectOsz(file) {
    const bytes = await file.arrayBuffer();
    const exactHash = await sha256(bytes);
    const zip = await JSZip.loadAsync(bytes);
    const entries = Object.values(zip.files).filter(entry => !entry.dir && /\.osu$/i.test(entry.name));
    const taikoMaps = [];
    const mapHashes = [];

    for (const entry of entries) {
      const text = await entry.async('string');
      const parsed = parseVisualMap(text);
      if (parsed.mode !== 1) continue;
      taikoMaps.push(parsed);
      const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
      mapHashes.push(await sha256(normalized));
    }

    if (!taikoMaps.length) return { exactHash, mapFingerprint: null, taikoMaps };
    mapHashes.sort();
    const mapFingerprint = await sha256(mapHashes.join('|'));
    return { exactHash, mapFingerprint, taikoMaps };
  }

  input.addEventListener('change', async event => {
    if (redispatching) return;
    const file = event.target.files && event.target.files[0];
    if (!file || !/\.osz$/i.test(file.name || '')) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const generation = ++hashGeneration;
    setMessage('OSZの重複を確認中…');

    try {
      const inspected = await inspectOsz(file);
      if (generation !== hashGeneration) return;

      const duplicateExact = loadedExactHashes.has(inspected.exactHash);
      const duplicateMap = inspected.mapFingerprint && loadedMapFingerprints.has(inspected.mapFingerprint);
      if (duplicateExact || duplicateMap) {
        input.value = '';
        setMessage(`重複OSZを検出したため読み込みませんでした：${file.name}`, 'warn');
        return;
      }

      loadedExactHashes.add(inspected.exactHash);
      if (inspected.mapFingerprint) loadedMapFingerprints.add(inspected.mapFingerprint);
      currentFingerprint = inspected.mapFingerprint || inspected.exactHash;
      currentVisualMaps = inspected.taikoMaps;
      setMessage(`新規OSZ：${file.name}`, 'ok');

      redispatching = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      redispatching = false;
      setTimeout(updateQueueControls, 0);
    } catch (error) {
      input.value = '';
      setMessage(error instanceof Error ? error.message : String(error), 'warn');
    }
  }, true);

  function updateQueueControls() {
    decideButton.disabled = !!copyOutput?.disabled || !currentFingerprint || decidedFingerprints.has(currentFingerprint);
    exportButton.disabled = queue.length === 0;
    countNode.textContent = `確定済み ${queue.length}件`;
  }

  function snapshotCurrent() {
    if (!outputPreview || !currentFingerprint) return;
    const text = outputPreview.textContent.trim();
    if (!text || copyOutput?.disabled) {
      setMessage('用途・START・ENDを確定してから「決定」を押してください。', 'warn');
      return;
    }
    if (decidedFingerprints.has(currentFingerprint)) {
      setMessage('このOSZはすでに確定済みです。', 'warn');
      return;
    }

    queue.push({ fingerprint: currentFingerprint, text });
    decidedFingerprints.add(currentFingerprint);
    updateQueueControls();
    setMessage(`確定しました（${queue.length}件）。次のOSZを選択してください。`, 'ok');
  }

  function exportQueue() {
    if (!queue.length) return;
    const body = '\uFEFF' + queue.map(item => item.text).join('\r\n\r\n') + '\r\n';
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0')
    ].join('');
    a.href = url;
    a.download = `mami-viewer_${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(`${queue.length}件をTXT出力しました。`, 'ok');
  }

  decideButton.addEventListener('click', snapshotCurrent);
  exportButton.addEventListener('click', exportQueue);
  [purpose, fade, startButton, endButton, diff].forEach(node => node?.addEventListener('change', () => setTimeout(updateQueueControls, 0)));
  [startButton, endButton].forEach(node => node?.addEventListener('click', () => setTimeout(updateQueueControls, 0)));
  new MutationObserver(updateQueueControls).observe(copyOutput, { attributes: true, attributeFilter: ['disabled'] });

  function zoomSpanMs() {
    const text = zoomLabel?.textContent || '±0.5s';
    if (text.includes('0.3')) return 600;
    if (text.includes('0.4')) return 800;
    return 1000;
  }

  function activeVisualMap() {
    return currentVisualMaps[Number(diff.value) || 0] || null;
  }

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

  function renderObjectOverlay() {
    const rect = timelineViewport.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const ctx = sizeCanvas(overlay, rect.width, rect.height);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const map = activeVisualMap();
    const duration = Number(seek.max) > 0 ? Number(seek.max) * 1000 : 0;
    if (!map || !map.hits.length || !(duration > 0)) return;

    const nowMs = Number(seek.value) * 1000;
    const span = zoomSpanMs();
    const hitX = Math.max(50, Math.min(76, rect.width * 0.16));
    const pxPerMs = rect.width / span;
    const xForTime = time => hitX + (time - nowMs) * pxPerMs;
    const laneTop = Math.max(22, rect.height * 0.20);
    const laneBottom = Math.min(rect.height - 22, rect.height * 0.79);
    const laneHeight = Math.max(54, laneBottom - laneTop);
    const noteY = laneTop + laneHeight * 0.50;
    const normalRadius = 19;
    const bigRadius = normalRadius * 1.34;

    // Back layer: dark note lane. This intentionally masks all underlying Kiai tint
    // inside the lane, so Kiai remains visible only in the upper/lower bands.
    ctx.fillStyle = '#121214';
    ctx.fillRect(0, laneTop, rect.width, laneHeight);

    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, laneTop + 0.5);
    ctx.lineTo(rect.width, laneTop + 0.5);
    ctx.moveTo(0, laneBottom + 0.5);
    ctx.lineTo(rect.width, laneBottom + 0.5);
    ctx.stroke();

    // Notes layer. A note reaches hitX exactly at its HitObject time. After that
    // moment only, it shrinks and fades up-left for a short, deterministic tail.
    const don = getComputedStyle(document.documentElement).getPropertyValue('--don').trim() || '#eeb9b2';
    const ka = getComputedStyle(document.documentElement).getPropertyValue('--ka').trim() || '#b0ccd7';
    const visibleLeftTime = nowMs - POST_HIT_FADE_MS;
    const visibleRightTime = nowMs + (rect.width - hitX) / pxPerMs + 50;
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
      ctx.fillStyle = hit.kind === 'ka' ? ka : don;
      ctx.strokeStyle = 'rgba(255,255,255,.96)';
      ctx.lineWidth = hit.big ? 3.2 : 2.4;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (hit.big) {
        ctx.strokeStyle = 'rgba(255,255,255,.30)';
        ctx.lineWidth = 2.1;
        ctx.beginPath();
        ctx.arc(x, y, radius + 5 * scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Front layer: fixed hit target / approach-circle style ring.
    const targetRadius = Math.max(31, bigRadius + 5);
    ctx.strokeStyle = 'rgba(235,235,238,.82)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(hitX, noteY, targetRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(235,235,238,.34)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(hitX, noteY, targetRadius - 5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,.40)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(hitX + 0.5, laneTop);
    ctx.lineTo(hitX + 0.5, laneBottom);
    ctx.stroke();
  }

  // Keep timeline scrubbing aligned with the new left-side hit position.
  let timelineDrag = null;
  const scrubTarget = event => {
    const rect = timelineViewport.getBoundingClientRect();
    const span = zoomSpanMs();
    const hitX = Math.max(50, Math.min(76, rect.width * 0.16));
    const pxPerMs = rect.width / span;
    const deltaSec = ((event.clientX - rect.left) - hitX) / pxPerMs / 1000;
    return Math.max(0, Math.min(Number(seek.max) || Infinity, timelineDrag.baseSec + deltaSec));
  };

  const pushSeek = value => {
    seek.value = String(value);
    seek.dispatchEvent(new Event('input', { bubbles: true }));
  };

  timelineViewport.addEventListener('pointerdown', event => {
    if (seek.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    timelineDrag = { baseSec: Number(seek.value) || 0, pointerId: event.pointerId };
    timelineViewport.setPointerCapture?.(event.pointerId);
    seek.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    pushSeek(scrubTarget(event));
  }, true);

  timelineViewport.addEventListener('pointermove', event => {
    if (!timelineDrag) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pushSeek(scrubTarget(event));
  }, true);

  const finishTimelineDrag = event => {
    if (!timelineDrag) return;
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    if (event?.pointerId != null) timelineViewport.releasePointerCapture?.(event.pointerId);
    timelineDrag = null;
    seek.dispatchEvent(new Event('change', { bubbles: true }));
  };
  timelineViewport.addEventListener('pointerup', finishTimelineDrag, true);
  timelineViewport.addEventListener('pointercancel', finishTimelineDrag, true);

  diff.addEventListener('change', () => setTimeout(renderObjectOverlay, 0));
  zoomLabel && new MutationObserver(renderObjectOverlay).observe(zoomLabel, { childList: true, subtree: true, characterData: true });
  window.addEventListener('resize', renderObjectOverlay);
  window.addEventListener('orientationchange', renderObjectOverlay);

  function visualFrame() {
    renderObjectOverlay();
    requestAnimationFrame(visualFrame);
  }

  updateQueueControls();
  requestAnimationFrame(visualFrame);
})();