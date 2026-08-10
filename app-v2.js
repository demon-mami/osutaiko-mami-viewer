(() => {
  'use strict';

  const SPANS_MS = [1500, 1000, 500];
  const ZOOM_LABELS = ['±0.75s', '±0.5s', '±0.25s'];
  const START_DELAY_SEC = 0.10;
  const EFFECT_GAIN = 0.85;
  const CURSOR_MIN_FRACTION = 0.10;
  const CURSOR_MAX_FRACTION = 0.90;
  const CURSOR_RESET_FRACTION = 0.22;

  const HS_FILES = {
    'normal:hitnormal': './hitsounds/taiko-normal-hitnormal.wav',
    'normal:hitclap': './hitsounds/taiko-normal-hitclap.wav',
    'normal:hitfinish': './hitsounds/taiko-normal-hitfinish.wav',
    'normal:hitwhistle': './hitsounds/taiko-normal-hitwhistle.wav',
    'soft:hitnormal': './hitsounds/taiko-soft-hitnormal.wav',
    'soft:hitclap': './hitsounds/taiko-soft-hitclap.wav',
    'soft:hitfinish': './hitsounds/taiko-soft-hitfinish.wav',
    'soft:hitwhistle': './hitsounds/taiko-soft-hitwhistle.wav',
  };

  const $ = id => document.getElementById(id);
  const el = {
    oszInput: $('oszInput'), fileName: $('fileName'), status: $('statusBadge'),
    diff: $('difficultySelect'), songTitle: $('songTitle'), songMeta: $('songMeta'),
    time: $('timeDisplay'), copyTime: $('copyTimeButton'),
    start: $('startMarkButton'), end: $('endMarkButton'), length: $('rangeLength'),
    back: $('backButton'), play: $('playButton'), fwd: $('forwardButton'), seek: $('seekBar'),
    zoomOut: $('zoomOutButton'), zoomIn: $('zoomInButton'), zoomLabel: $('zoomLabel'),
    timelineViewport: $('timelineViewport'), timelineStatic: $('timelineStaticCanvas'), timelineCursor: $('timelineCursorCanvas'),
    overviewViewport: $('overviewViewport'), overviewStatic: $('overviewStaticCanvas'), overviewCursor: $('overviewCursorCanvas'),
    purpose: $('purposeSelect'), fade: $('fadeSelect'), preview: $('outputPreview'), copyOut: $('copyOutputButton'),
    errorCard: $('errorCard'), error: $('errorMessage'),
  };

  let zip = null;
  let maps = [];
  let map = null;
  let startMark = null;
  let endMark = null;
  let zoom = 0;
  let ready = false;
  let raf = 0;

  let ac = null;
  let musicBuffer = null;
  let effectBuffer = null;
  let musicName = '';
  let hsBuffers = new Map();
  let hsLoadPromise = null;
  let musicGain = null;
  let effectGain = null;
  let masterGain = null;
  let musicSource = null;
  let effectSource = null;
  let playing = false;
  let transportStartCtx = 0;
  let transportOffset = 0;
  let pausedOffset = 0;
  let sourceGeneration = 0;

  let seekScrub = null;
  let timelineScrub = null;
  let overviewScrub = null;
  let objectWindowStartMs = 0;
  let objectWindowEndMs = SPANS_MS[0];

  const setStatus = text => { if (el.status) el.status.textContent = text; };
  const clearError = () => {
    if (el.errorCard) el.errorCard.hidden = true;
    if (el.error) el.error.textContent = '';
  };
  const fail = message => {
    if (el.error) el.error.textContent = message;
    if (el.errorCard) el.errorCard.hidden = false;
    setStatus('エラー');
  };

  const durationSec = () => musicBuffer ? musicBuffer.duration : 0;
  const durationMs = () => durationSec() * 1000;
  const spanMs = () => SPANS_MS[zoom];
  const validRange = () => !!(startMark && endMark && endMark.time >= startMark.time);
  const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const clampSec = value => {
    const d = durationSec();
    const v = Number.isFinite(value) ? value : 0;
    return d > 0 ? Math.min(Math.max(v, 0), d) : Math.max(v, 0);
  };

  function fmt(ms) {
    ms = Math.max(0, Math.floor(Number.isFinite(ms) ? ms : 0));
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const z = ms % 1000;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(z).padStart(3, '0')}`;
  }

  function fmtOut(ms) {
    const q = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
    const h = Math.floor(q / 3600);
    const m = Math.floor((q % 3600) / 60);
    const s = q % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function fmtTimeline(ms) {
    const q = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
    const m = Math.floor(q / 60);
    const s = q % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  const fmtLen = ms => Number.isFinite(ms) && ms >= 0 ? `${(ms / 1000).toFixed(3)} s` : '—';

  function outputText() {
    if (!map) return '**曲名：—**\n用途：—\n難易度：**—**\n区間：—（Fade-in/out：含まない）';
    const title = map.metadata.TitleUnicode || map.metadata.Title || 'Untitled';
    const diff = map.metadata.Version || 'Unknown';
    const purpose = el.purpose?.value || '未選択';
    const fade = el.fade?.value || '含まない';
    const range = validRange()
      ? `${fmtOut(startMark.time)}～${fmtOut(endMark.time)}`
      : (startMark && endMark ? 'ENDがSTARTより前です' : '未選択');
    return `**曲名：${title}**\n用途：${purpose}\n難易度：**${diff}**\n区間：${range}（Fade-in/out：${fade}）`;
  }

  function updateOutput() {
    if (el.preview) el.preview.textContent = outputText();
    if (el.copyOut) el.copyOut.disabled = !(map && el.purpose?.value && validRange());
  }

  function updateRange() {
    if (el.start) {
      el.start.classList.toggle('marked', !!startMark);
      el.start.textContent = startMark ? 'START ✓' : 'START';
    }
    if (el.end) {
      el.end.classList.toggle('marked', !!endMark);
      el.end.textContent = endMark ? 'END ✓' : 'END';
    }
    if (el.length) el.length.textContent = validRange() ? fmtLen(endMark.time - startMark.time) : '—';
    updateOutput();
    if (map && musicBuffer) {
      renderObjectStatic();
      renderSongStatic();
      drawDynamic(audiblePosition());
    }
  }

  function resetRange() {
    startMark = null;
    endMark = null;
    updateRange();
  }

  function toggleMark(which) {
    if (!map || !musicBuffer) return;
    const point = { time: Math.round(audiblePosition() * 1000) };
    if (which === 'start') startMark = startMark ? null : point;
    else endMark = endMark ? null : point;
    updateRange();
  }

  async function copy(text, button) {
    if (!text) return;
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.readOnly = true;
        ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.appendChild(ta);
        ta.select();
        if (!document.execCommand('copy')) throw new Error('copy failed');
        ta.remove();
      }
      if (button) {
        const old = button.textContent;
        button.textContent = 'COPIED';
        setTimeout(() => { button.textContent = old; }, 700);
      }
    } catch {
      fail(`コピーできませんでした。\n${text}`);
    }
  }

  function kv(line) {
    const i = line.indexOf(':');
    return i < 0 ? null : [line.slice(0, i).trim(), line.slice(i + 1).trim()];
  }

  function hitSampleData(raw) {
    const f = String(raw || '').split(':');
    return {
      normalSet: Number.parseInt(f[0] || '0', 10) || 0,
      additionSet: Number.parseInt(f[1] || '0', 10) || 0,
      volume: Number.parseInt(f[3] || '0', 10) || 0,
    };
  }

  function generalSetNumber(value) {
    const v = String(value || '').toLowerCase();
    if (v === 'soft') return 2;
    if (v === 'drum') return 3;
    return 1;
  }

  function timingAt(points, time) {
    let lo = 0, hi = points.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].time <= time) lo = mid + 1;
      else hi = mid;
    }
    return lo > 0 ? points[lo - 1] : null;
  }

  function enrichHits(m) {
    const generalSet = generalSetNumber(m.general.SampleSet);
    for (const hit of m.hits) {
      const tp = timingAt(m.timing, hit.time);
      const timingSet = tp && tp.sampleSet ? tp.sampleSet : generalSet;
      const sample = hit.sample;
      const objectSet = hit.sampleName === 'hitnormal' ? sample.normalSet : sample.additionSet;
      const resolved = objectSet || timingSet || generalSet;
      hit.family = resolved === 2 ? 'soft' : 'normal';
      hit.volume = Math.max(0, Math.min(100, sample.volume || (tp ? tp.volume : 100) || 100));
    }
  }

  function parseOsu(text, fileName) {
    const m = { fileName, general: {}, metadata: {}, difficulty: {}, timing: [], hits: [], mode: -1 };
    let section = '';
    text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((raw, order) => {
      const line = raw.trim();
      if (!line || line.startsWith('//')) return;
      if (line[0] === '[' && line.endsWith(']')) { section = line; return; }

      if (section === '[General]' || section === '[Metadata]' || section === '[Difficulty]') {
        const p = kv(line);
        if (!p) return;
        const [key, value] = p;
        (section === '[General]' ? m.general : section === '[Metadata]' ? m.metadata : m.difficulty)[key] = value;
        return;
      }

      if (section === '[TimingPoints]') {
        const f = line.split(',');
        if (f.length < 8) return;
        const time = Number(f[0]), beat = Number(f[1]);
        const meter = Number.parseInt(f[2], 10) || 4;
        const sampleSet = Number.parseInt(f[3], 10) || 0;
        const volume = Number.parseInt(f[5], 10);
        const uninherited = Number.parseInt(f[6], 10) || 0;
        const effects = Number.parseInt(f[7], 10) || 0;
        if (Number.isFinite(time)) m.timing.push({ time, beat: Number.isFinite(beat) ? beat : 0, meter, sampleSet, volume: Number.isFinite(volume) ? volume : 100, uninherited, effects, order });
        return;
      }

      if (section === '[HitObjects]') {
        const f = line.split(',');
        if (f.length < 5) return;
        const time = Number.parseInt(f[2], 10), type = Number.parseInt(f[3], 10) || 0, sound = Number.parseInt(f[4], 10) || 0;
        if (!Number.isFinite(time) || (type & 1) === 0) return;
        const ka = (sound & (2 | 8)) !== 0, big = (sound & 4) !== 0;
        let sampleName = 'hitnormal';
        if (ka && big) sampleName = 'hitwhistle';
        else if (ka) sampleName = 'hitclap';
        else if (big) sampleName = 'hitfinish';
        m.hits.push({ time, kind: ka ? 'ka' : 'don', big, sampleName, sample: hitSampleData(f[5] || ''), family: 'normal', volume: 100 });
      }
    });
    m.mode = Number.parseInt(m.general.Mode ?? '-1', 10);
    m.timing.sort((a, b) => a.time - b.time || a.order - b.order);
    m.hits.sort((a, b) => a.time - b.time);
    enrichHits(m);
    return m;
  }

  function kiaiIntervals() {
    if (!map) return [];
    const out = [];
    let on = false, start = null;
    for (const tp of map.timing) {
      const next = (tp.effects & 1) !== 0;
      if (next === on) continue;
      if (on && start !== null && tp.time > start) out.push({ start, end: tp.time });
      on = next;
      start = next ? tp.time : null;
    }
    if (on && start !== null) out.push({ start, end: durationMs() || Infinity });
    return out;
  }

  function bpmChanges() {
    if (!map) return [];
    const rows = map.timing.filter(tp => tp.uninherited === 1 && tp.beat > 0 && Number.isFinite(tp.beat));
    const out = [];
    let last = null;
    for (const tp of rows) {
      const bpm = 60000 / tp.beat;
      if (!Number.isFinite(bpm) || bpm <= 0) continue;
      if (last === null || Math.abs(bpm - last) >= 0.01) {
        out.push({ time: tp.time, bpm });
        last = bpm;
      }
    }
    return out;
  }

  const norm = name => String(name || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  function zipFile(name) {
    if (!zip || !name) return null;
    return zip.file(name) || Object.values(zip.files).find(entry => !entry.dir && norm(entry.name) === norm(name)) || null;
  }

  async function ensureContext(resume = false) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error('Web Audio APIに対応していません。');
    if (!ac) {
      ac = new Context({ latencyHint: 'interactive' });
      musicGain = ac.createGain();
      effectGain = ac.createGain();
      masterGain = ac.createGain();
      musicGain.gain.value = 1;
      effectGain.gain.value = EFFECT_GAIN;
      masterGain.gain.value = 1;
      musicGain.connect(masterGain);
      effectGain.connect(masterGain);
      masterGain.connect(ac.destination);
    } else if (effectGain) {
      effectGain.gain.value = EFFECT_GAIN;
    }
    if (resume && ac.state === 'suspended') await ac.resume();
    return ac;
  }

  async function loadHitsounds() {
    await ensureContext(false);
    if (!hsLoadPromise) {
      hsLoadPromise = (async () => {
        const rows = await Promise.all(Object.entries(HS_FILES).map(async ([key, url]) => {
          const response = await fetch(url, { cache: 'force-cache' });
          if (!response.ok) throw new Error(`ヒットサウンドを読み込めません: ${url}`);
          const bytes = await response.arrayBuffer();
          return [key, await ac.decodeAudioData(bytes.slice(0))];
        }));
        hsBuffers = new Map(rows);
      })();
    }
    await hsLoadPromise;
  }

  async function buildEffectBuffer(activeMap, music, buffers, audioContext) {
    const sr = audioContext.sampleRate;
    const channels = music.numberOfChannels;
    const effect = audioContext.createBuffer(channels, music.length, sr);
    let hitIndex = 0;
    for (const hit of activeMap.hits) {
      const hs = buffers.get(`${hit.family}:${hit.sampleName}`) || buffers.get(`normal:${hit.sampleName}`);
      if (hs) {
        const nominalStart = Math.round(hit.time / 1000 * sr);
        if (nominalStart < effect.length) {
          const gain = hit.volume / 100;
          const srcOffset = nominalStart < 0 ? -nominalStart : 0;
          const startFrame = Math.max(0, nominalStart);
          for (let ch = 0; ch < channels; ch++) {
            const dst = effect.getChannelData(ch);
            const srcData = hs.getChannelData(Math.min(ch, hs.numberOfChannels - 1));
            const maxFrames = Math.min(srcData.length - srcOffset, dst.length - startFrame);
            for (let i = 0; i < maxFrames; i++) dst[startFrame + i] += srcData[srcOffset + i] * gain;
          }
        }
      }
      if ((++hitIndex & 63) === 0) await new Promise(resolve => requestAnimationFrame(resolve));
    }
    return effect;
  }

  function enginePosition() {
    if (!playing || !ac) return clampSec(pausedOffset);
    return clampSec(transportOffset + Math.max(0, ac.currentTime - transportStartCtx));
  }

  function audiblePosition() {
    if (!playing || !ac) return clampSec(pausedOffset);
    let outputContextTime = NaN;
    try {
      if (typeof ac.getOutputTimestamp === 'function') {
        const ts = ac.getOutputTimestamp();
        if (ts && Number.isFinite(ts.contextTime) && ts.contextTime > 0) outputContextTime = ts.contextTime;
      }
    } catch {}
    if (!Number.isFinite(outputContextTime)) {
      const latency = Number.isFinite(ac.outputLatency) ? ac.outputLatency : 0;
      outputContextTime = ac.currentTime - latency;
    }
    return clampSec(transportOffset + Math.max(0, outputContextTime - transportStartCtx));
  }

  function stopSources() {
    sourceGeneration++;
    const sources = [musicSource, effectSource];
    musicSource = null;
    effectSource = null;
    for (const source of sources) {
      if (!source) continue;
      try { source.onended = null; } catch {}
      try { source.stop(); } catch {}
      try { source.disconnect(); } catch {}
    }
    playing = false;
    if (el.play) el.play.textContent = '▶';
  }

  async function startPlayback(offset) {
    if (!musicBuffer || !effectBuffer || !map) return;
    await ensureContext(true);
    const startAt = clampSec(offset);
    pausedOffset = startAt >= durationSec() - 0.001 ? 0 : startAt;
    stopSources();
    const when = ac.currentTime + START_DELAY_SEC;
    const music = ac.createBufferSource();
    const effect = ac.createBufferSource();
    music.buffer = musicBuffer;
    effect.buffer = effectBuffer;
    music.connect(musicGain);
    effect.connect(effectGain);
    transportStartCtx = when;
    transportOffset = clampSec(pausedOffset);
    pausedOffset = transportOffset;
    const generation = ++sourceGeneration;
    musicSource = music;
    effectSource = effect;
    playing = true;
    el.play.textContent = '❚❚';
    music.onended = () => {
      if (generation !== sourceGeneration || music !== musicSource) return;
      const reachedEnd = enginePosition() >= durationSec() - 0.03;
      musicSource = null;
      if (effectSource) {
        try { effectSource.stop(); } catch {}
        try { effectSource.disconnect(); } catch {}
        effectSource = null;
      }
      playing = false;
      if (reachedEnd) pausedOffset = durationSec();
      el.play.textContent = '▶';
    };
    music.start(when, transportOffset);
    effect.start(when, transportOffset);
  }

  function pausePlayback() {
    if (!playing) return;
    pausedOffset = enginePosition();
    stopSources();
  }

  async function seekTo(target) {
    const next = clampSec(target);
    const wasPlaying = playing;
    if (wasPlaying) pausedOffset = enginePosition();
    stopSources();
    pausedOffset = next;
    if (wasPlaying) await startPlayback(next);
    ensureObjectWindow(audiblePosition() * 1000, true);
    syncVisualToPosition();
  }

  async function loadMusic(activeMap) {
    const name = activeMap.general.AudioFilename;
    if (!name) throw new Error('AudioFilenameがありません。');
    await ensureContext(false);
    if (musicBuffer && musicName === norm(name)) {
      stopSources();
      pausedOffset = 0;
      return;
    }
    const entry = zipFile(name);
    if (!entry) throw new Error(`OSZ内で音源を見つけられません: ${name}`);
    stopSources();
    musicBuffer = null;
    effectBuffer = null;
    musicName = '';
    pausedOffset = 0;
    const raw = await entry.async('arraybuffer');
    musicBuffer = await ac.decodeAudioData(raw.slice(0));
    musicName = norm(name);
  }

  async function buildMapEffect() {
    if (!map || !musicBuffer) return;
    setStatus('Hitsound生成中');
    await loadHitsounds();
    effectBuffer = await buildEffectBuffer(map, musicBuffer, hsBuffers, ac);
  }

  function setControls(enabled) {
    ready = enabled;
    [el.play, el.back, el.fwd, el.seek, el.copyTime, el.start, el.end].forEach(node => {
      if (node) node.disabled = !enabled;
    });
    updateZoom();
    updateOutput();
  }

  async function useMap(index) {
    clearError();
    stopSources();
    map = maps[index];
    if (!map) return;
    resetRange();
    setControls(false);
    setStatus('音源解析中');
    try {
      await loadMusic(map);
      await buildMapEffect();
      const title = map.metadata.TitleUnicode || map.metadata.Title || 'Untitled';
      const artist = map.metadata.ArtistUnicode || map.metadata.Artist || 'Unknown artist';
      el.songTitle.textContent = `${artist} - ${title}`;
      el.songMeta.textContent = `${map.hits.length} hits`;
      el.seek.max = String(durationSec());
      el.seek.value = '0';
      el.time.textContent = '00:00:000';
      pausedOffset = 0;
      setControls(true);
      setStatus('準備完了');
      setObjectWindow(0, CURSOR_RESET_FRACTION);
      renderSongStatic();
      drawDynamic(0);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadOsz(file) {
    clearError();
    if (!file || !/\.osz$/i.test(file.name || '')) {
      fail('.osz / .OSZ ファイルを選択してください。');
      return;
    }
    if (!window.JSZip) {
      fail('JSZipを読み込めません。');
      return;
    }
    if (el.fileName) el.fileName.textContent = file.name;
    setStatus('OSZ解析中');
    if (el.purpose) el.purpose.value = '';
    if (el.fade) el.fade.value = '含まない';
    zoom = 0;
    stopSources();
    musicBuffer = null;
    effectBuffer = null;
    musicName = '';
    map = null;
    maps = [];
    startMark = null;
    endMark = null;
    updateRange();
    setControls(false);
    el.diff.disabled = true;
    el.diff.innerHTML = '<option>OSZ解析中…</option>';
    try {
      const bytes = await file.arrayBuffer();
      zip = await JSZip.loadAsync(bytes);
      const entries = Object.values(zip.files).filter(entry => !entry.dir && /\.osu$/i.test(entry.name));
      if (!entries.length) throw new Error('OSZ内に .osu がありません。');
      const parsed = [];
      for (const entry of entries) parsed.push(parseOsu(await entry.async('string'), entry.name));
      const taiko = parsed.filter(item => item.mode === 1);
      maps = taiko.length ? taiko : parsed;
      if (!maps.length) throw new Error('表示できる譜面がありません。');
      el.diff.innerHTML = '';
      maps.forEach((item, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `${item.metadata.Version || item.fileName} — ${item.hits.length} hits`;
        el.diff.appendChild(option);
      });
      el.diff.disabled = false;
      await useMap(0);
    } catch (error) {
      el.diff.innerHTML = '<option>読み込み失敗</option>';
      fail(error instanceof Error ? error.message : String(error));
    }
  }

  function updateZoom() {
    if (el.zoomLabel) el.zoomLabel.textContent = ZOOM_LABELS[zoom] || ZOOM_LABELS[0];
    if (el.zoomIn) el.zoomIn.disabled = !ready || zoom >= SPANS_MS.length - 1;
    if (el.zoomOut) el.zoomOut.disabled = !ready || zoom <= 0;
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

  function lowerHit(timeMs) {
    let lo = 0, hi = map ? map.hits.length : 0;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (map.hits[mid].time < timeMs) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function setObjectWindow(positionMs, fraction = CURSOR_RESET_FRACTION) {
    const span = spanMs();
    const d = durationMs();
    let start = positionMs - span * fraction;
    if (d > 0) start = Math.min(Math.max(start, 0), Math.max(0, d - span));
    else start = Math.max(0, start);
    objectWindowStartMs = start;
    objectWindowEndMs = start + span;
    renderObjectStatic();
  }

  function ensureObjectWindow(positionMs, force = false) {
    const span = spanMs();
    if (force || objectWindowEndMs - objectWindowStartMs !== span) {
      setObjectWindow(positionMs, CURSOR_RESET_FRACTION);
      return;
    }
    const fraction = (positionMs - objectWindowStartMs) / span;
    if (fraction < CURSOR_MIN_FRACTION || fraction > CURSOR_MAX_FRACTION) {
      setObjectWindow(positionMs, CURSOR_RESET_FRACTION);
    }
  }

  function drawObjectTicks(ctx, left, right, xForTime, width, height) {
    if (!map) return;
    const red = map.timing.filter(tp => tp.uninherited === 1 && tp.beat > 0);
    const baseline = height - 14;
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, baseline + .5);
    ctx.lineTo(width, baseline + .5);
    ctx.stroke();
    let safety = 0;
    for (let r = 0; r < red.length; r++) {
      const tp = red[r];
      const sectionEnd = r + 1 < red.length ? red[r + 1].time : right;
      const a = Math.max(left, tp.time);
      const b = Math.min(right, sectionEnd);
      if (b < a) continue;
      let n = Math.ceil((a - tp.time) / tp.beat);
      if (!Number.isFinite(n)) continue;
      for (let time = tp.time + n * tp.beat; time <= b + .01; time += tp.beat, n++) {
        if (++safety > 4000) return;
        const x = xForTime(time);
        const meter = Math.max(1, tp.meter);
        const measure = ((n % meter) + meter) % meter === 0;
        const tick = measure ? 20 : 8;
        ctx.strokeStyle = measure ? 'rgba(255,255,255,.54)' : 'rgba(255,255,255,.24)';
        ctx.lineWidth = measure ? 1.4 : 1;
        ctx.beginPath();
        ctx.moveTo(x, baseline - tick);
        ctx.lineTo(x, baseline);
        ctx.stroke();
      }
    }
  }

  function renderObjectStatic() {
    if (!map || !musicBuffer || !el.timelineViewport || !el.timelineStatic) return;
    const rect = el.timelineViewport.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const ctx = sizeCanvas(el.timelineStatic, rect.width, rect.height);
    const left = objectWindowStartMs;
    const right = objectWindowEndMs;
    const span = right - left;
    const xForTime = time => (time - left) / span * rect.width;
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = css('--surface', '#101015');
    ctx.fillRect(0, 0, rect.width, rect.height);

    ctx.fillStyle = 'rgba(244,220,125,.15)';
    for (const range of kiaiIntervals()) {
      const a = Math.max(left, range.start);
      const b = Math.min(right, range.end);
      if (b > a) ctx.fillRect(xForTime(a), 0, xForTime(b) - xForTime(a), rect.height);
    }
    drawObjectTicks(ctx, left, right, xForTime, rect.width, rect.height);

    const noteY = Math.max(36, Math.min(rect.height - 44, rect.height * .48));
    const normalRadius = Math.max(17, Math.min(22, rect.height * .15));
    const bigRadius = normalRadius * 1.35;
    const don = css('--don', '#ef6862');
    const ka = css('--ka', '#69bde0');
    const first = lowerHit(left);
    for (let i = first; i < map.hits.length; i++) {
      const hit = map.hits[i];
      if (hit.time > right) break;
      const x = xForTime(hit.time);
      const radius = hit.big ? bigRadius : normalRadius;
      ctx.fillStyle = hit.kind === 'ka' ? ka : don;
      ctx.strokeStyle = 'rgba(255,255,255,.78)';
      ctx.lineWidth = hit.big ? 3 : 2;
      ctx.beginPath();
      ctx.arc(x, noteY, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (hit.big) {
        ctx.strokeStyle = 'rgba(255,255,255,.28)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, noteY, radius + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (validRange()) {
      const a = Math.max(left, startMark.time);
      const b = Math.min(right, endMark.time);
      if (b > a) {
        ctx.fillStyle = 'rgba(104,211,154,.055)';
        ctx.fillRect(xForTime(a), 0, xForTime(b) - xForTime(a), rect.height);
      }
    }

    const drawMark = (mark, label, color) => {
      if (!mark || mark.time < left || mark.time > right) return;
      const x = xForTime(mark.time);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 4);
      ctx.lineTo(x, rect.height - 14);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = '800 9px -apple-system,BlinkMacSystemFont,sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(label, x + 3, 4);
    };
    drawMark(startMark, 'START', css('--range-start', '#68d39a'));
    drawMark(endMark, 'END', css('--range-end', '#f3b55d'));
  }

  function drawObjectCursor(positionSec) {
    if (!el.timelineViewport || !el.timelineCursor) return;
    const rect = el.timelineViewport.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const ctx = sizeCanvas(el.timelineCursor, rect.width, rect.height);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const positionMs = positionSec * 1000;
    const span = objectWindowEndMs - objectWindowStartMs;
    const q = span > 0 ? (positionMs - objectWindowStartMs) / span : 0;
    const x = Math.max(0, Math.min(rect.width, q * rect.width));
    ctx.strokeStyle = 'rgba(255,255,255,.78)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, 3);
    ctx.lineTo(x, rect.height - 14);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(x - 4, 3);
    ctx.lineTo(x + 4, 3);
    ctx.lineTo(x, 9);
    ctx.closePath();
    ctx.fill();
  }

  function chooseMajorTickSeconds(durationSeconds) {
    const target = durationSeconds / 6;
    const choices = [5, 10, 15, 20, 30, 60, 90, 120, 180, 300, 600];
    return choices.find(v => v >= target) || choices[choices.length - 1];
  }

  function renderSongStatic() {
    if (!el.overviewViewport || !el.overviewStatic) return;
    const rect = el.overviewViewport.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const ctx = sizeCanvas(el.overviewStatic, rect.width, rect.height);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = css('--surface', '#101015');
    ctx.fillRect(0, 0, rect.width, rect.height);
    if (!map || !musicBuffer || durationSec() <= 0) return;
    const d = durationMs();
    const xForTime = time => Math.max(0, Math.min(rect.width, time / d * rect.width));

    ctx.fillStyle = 'rgba(244,220,125,.18)';
    for (const range of kiaiIntervals()) {
      const finish = Number.isFinite(range.end) ? range.end : d;
      ctx.fillRect(xForTime(range.start), 0, Math.max(1, xForTime(finish) - xForTime(range.start)), rect.height);
    }
    if (validRange()) {
      ctx.fillStyle = 'rgba(104,211,154,.065)';
      ctx.fillRect(xForTime(startMark.time), 0, Math.max(1, xForTime(endMark.time) - xForTime(startMark.time)), rect.height);
    }

    const baseline = rect.height - 14;
    ctx.strokeStyle = 'rgba(255,255,255,.32)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, baseline + .5);
    ctx.lineTo(rect.width, baseline + .5);
    ctx.stroke();
    const majorSec = chooseMajorTickSeconds(durationSec());
    const minorSec = majorSec / 4;
    for (let sec = 0; sec <= durationSec() + .001; sec += minorSec) {
      const major = Math.abs(sec / majorSec - Math.round(sec / majorSec)) < 1e-6;
      const x = xForTime(sec * 1000);
      const tick = major ? 12 : 5;
      ctx.strokeStyle = major ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.22)';
      ctx.lineWidth = major ? 1.3 : 1;
      ctx.beginPath();
      ctx.moveTo(x, baseline - tick);
      ctx.lineTo(x, baseline);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = 'rgba(255,255,255,.52)';
        ctx.font = '8px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
        ctx.textAlign = x < 20 ? 'left' : (x > rect.width - 20 ? 'right' : 'center');
        ctx.textBaseline = 'bottom';
        ctx.fillText(fmtTimeline(sec * 1000), x, baseline - 13);
      }
    }

    let lastLabelX = -Infinity;
    for (const change of bpmChanges()) {
      if (change.time < 0 || change.time > d) continue;
      const x = xForTime(change.time);
      ctx.strokeStyle = 'rgba(255,255,255,.38)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 2);
      ctx.lineTo(x, 17);
      ctx.stroke();
      if (x - lastLabelX >= 60) {
        const label = `${Math.round(change.bpm * 100) / 100}bpm`;
        ctx.fillStyle = 'rgba(255,255,255,.76)';
        ctx.font = '800 8px -apple-system,BlinkMacSystemFont,sans-serif';
        ctx.textAlign = x < rect.width - 55 ? 'left' : 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(label, x < rect.width - 55 ? x + 3 : x - 3, 2);
        lastLabelX = x;
      }
    }

    const mark = (point, color) => {
      if (!point) return;
      const x = xForTime(point.time);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rect.height);
      ctx.stroke();
    };
    mark(startMark, css('--range-start', '#68d39a'));
    mark(endMark, css('--range-end', '#f3b55d'));
  }

  function drawSongCursor(positionSec) {
    if (!el.overviewViewport || !el.overviewCursor) return;
    const rect = el.overviewViewport.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const ctx = sizeCanvas(el.overviewCursor, rect.width, rect.height);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!musicBuffer || durationSec() <= 0) return;
    const x = clampSec(positionSec) / durationSec() * rect.width;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, rect.height);
    ctx.stroke();
  }

  function drawDynamic(positionSec = audiblePosition()) {
    ensureObjectWindow(positionSec * 1000, false);
    drawObjectCursor(positionSec);
    drawSongCursor(positionSec);
  }

  function syncVisualToPosition() {
    const p = audiblePosition();
    if (el.time) el.time.textContent = fmt(p * 1000);
    if (!seekScrub && el.seek) el.seek.value = String(p);
    drawDynamic(p);
  }

  function frame() {
    const p = audiblePosition();
    if (el.time) el.time.textContent = fmt(p * 1000);
    if (!seekScrub && !timelineScrub && !overviewScrub && el.seek) el.seek.value = String(p);
    drawDynamic(p);
    raf = requestAnimationFrame(frame);
  }

  function beginScrub(kind) {
    if (!ready) return null;
    const state = { kind, wasPlaying: playing };
    if (playing) {
      pausedOffset = enginePosition();
      stopSources();
    } else {
      pausedOffset = audiblePosition();
    }
    return state;
  }

  function scrubTo(targetSec) {
    pausedOffset = clampSec(targetSec);
    if (el.time) el.time.textContent = fmt(pausedOffset * 1000);
    if (el.seek) el.seek.value = String(pausedOffset);
    ensureObjectWindow(pausedOffset * 1000, false);
    drawObjectCursor(pausedOffset);
    drawSongCursor(pausedOffset);
  }

  async function endScrub(state) {
    if (state?.wasPlaying) await startPlayback(pausedOffset);
  }

  function timelineTargetFromEvent(event) {
    const rect = el.timelineViewport.getBoundingClientRect();
    const q = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    return clampSec((objectWindowStartMs + q * (objectWindowEndMs - objectWindowStartMs)) / 1000);
  }

  function overviewTargetFromEvent(event) {
    const rect = el.overviewViewport.getBoundingClientRect();
    const q = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    return clampSec(durationSec() * q);
  }

  el.oszInput?.addEventListener('change', async event => {
    const file = event.target.files && event.target.files[0];
    if (file) await loadOsz(file);
  });
  el.diff?.addEventListener('change', () => useMap(Number(el.diff.value)));
  el.play?.addEventListener('click', async () => {
    try {
      if (playing) pausePlayback();
      else await startPlayback(pausedOffset);
    } catch (error) {
      fail(error instanceof Error ? error.message : '再生できませんでした。');
    }
  });
  el.back?.addEventListener('click', () => seekTo(audiblePosition() - 5));
  el.fwd?.addEventListener('click', () => seekTo(audiblePosition() + 5));
  el.copyTime?.addEventListener('click', event => {
    event.stopPropagation();
    copy(fmt(audiblePosition() * 1000), el.copyTime);
  });
  el.start?.addEventListener('click', () => toggleMark('start'));
  el.end?.addEventListener('click', () => toggleMark('end'));
  el.purpose?.addEventListener('change', updateOutput);
  el.fade?.addEventListener('change', updateOutput);
  el.copyOut?.addEventListener('click', () => {
    if (!el.copyOut.disabled) copy(outputText(), el.copyOut);
  });

  el.zoomIn?.addEventListener('click', () => {
    if (zoom < SPANS_MS.length - 1) {
      zoom++;
      updateZoom();
      setObjectWindow(audiblePosition() * 1000, CURSOR_RESET_FRACTION);
      drawObjectCursor(audiblePosition());
    }
  });
  el.zoomOut?.addEventListener('click', () => {
    if (zoom > 0) {
      zoom--;
      updateZoom();
      setObjectWindow(audiblePosition() * 1000, CURSOR_RESET_FRACTION);
      drawObjectCursor(audiblePosition());
    }
  });

  el.seek?.addEventListener('pointerdown', () => {
    seekScrub = beginScrub('seek');
  });
  el.seek?.addEventListener('input', () => {
    if (!seekScrub) seekScrub = beginScrub('seek');
    const value = Number(el.seek.value);
    if (Number.isFinite(value)) scrubTo(value);
  });
  const finishSeek = async () => {
    const state = seekScrub;
    seekScrub = null;
    await endScrub(state);
  };
  el.seek?.addEventListener('pointerup', finishSeek);
  el.seek?.addEventListener('change', finishSeek);

  el.timelineViewport?.addEventListener('pointerdown', event => {
    if (!ready) return;
    event.preventDefault();
    el.timelineViewport.setPointerCapture?.(event.pointerId);
    timelineScrub = beginScrub('timeline');
    scrubTo(timelineTargetFromEvent(event));
  });
  el.timelineViewport?.addEventListener('pointermove', event => {
    if (!timelineScrub) return;
    event.preventDefault();
    scrubTo(timelineTargetFromEvent(event));
  });
  el.timelineViewport?.addEventListener('pointerup', async event => {
    if (!timelineScrub) return;
    el.timelineViewport.releasePointerCapture?.(event.pointerId);
    const state = timelineScrub;
    timelineScrub = null;
    await endScrub(state);
  });
  el.timelineViewport?.addEventListener('pointercancel', async () => {
    const state = timelineScrub;
    timelineScrub = null;
    await endScrub(state);
  });

  el.overviewViewport?.addEventListener('pointerdown', event => {
    if (!ready || event.target === el.copyTime || el.copyTime?.contains(event.target)) return;
    event.preventDefault();
    el.overviewViewport.setPointerCapture?.(event.pointerId);
    overviewScrub = beginScrub('overview');
    scrubTo(overviewTargetFromEvent(event));
  });
  el.overviewViewport?.addEventListener('pointermove', event => {
    if (!overviewScrub) return;
    event.preventDefault();
    scrubTo(overviewTargetFromEvent(event));
  });
  el.overviewViewport?.addEventListener('pointerup', async event => {
    if (!overviewScrub) return;
    el.overviewViewport.releasePointerCapture?.(event.pointerId);
    const state = overviewScrub;
    overviewScrub = null;
    await endScrub(state);
  });
  el.overviewViewport?.addEventListener('pointercancel', async () => {
    const state = overviewScrub;
    overviewScrub = null;
    await endScrub(state);
  });

  const redraw = () => {
    if (!map || !musicBuffer) return;
    setObjectWindow(audiblePosition() * 1000, CURSOR_RESET_FRACTION);
    renderSongStatic();
    drawDynamic(audiblePosition());
  };
  window.addEventListener('resize', redraw);
  window.addEventListener('orientationchange', redraw);
  window.addEventListener('beforeunload', () => {
    cancelAnimationFrame(raf);
    stopSources();
    if (ac) ac.close().catch(() => {});
  });

  updateRange();
  updateZoom();
  raf = requestAnimationFrame(frame);
})();
