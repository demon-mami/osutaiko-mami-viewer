(() => {
  'use strict';

  const VIEW_SPAN_MS = 12000;
  const HITSOUND_LOOKAHEAD_SEC = 0.18;
  const HITSOUND_TICK_MS = 25;
  const HITSOUND_FILES = {
    'normal:hitnormal': './hitsounds/taiko-normal-hitnormal.wav',
    'normal:hitclap': './hitsounds/taiko-normal-hitclap.wav',
    'normal:hitfinish': './hitsounds/taiko-normal-hitfinish.wav',
    'normal:hitwhistle': './hitsounds/taiko-normal-hitwhistle.wav',
    'soft:hitnormal': './hitsounds/taiko-soft-hitnormal.wav',
    'soft:hitclap': './hitsounds/taiko-soft-hitclap.wav',
    'soft:hitfinish': './hitsounds/taiko-soft-hitfinish.wav',
    'soft:hitwhistle': './hitsounds/taiko-soft-hitwhistle.wav',
  };

  const el = {
    oszInput: document.getElementById('oszInput'),
    fileName: document.getElementById('fileName'),
    statusBadge: document.getElementById('statusBadge'),
    difficultySelect: document.getElementById('difficultySelect'),
    songTitle: document.getElementById('songTitle'),
    songMeta: document.getElementById('songMeta'),
    timeDisplay: document.getElementById('timeDisplay'),
    durationDisplay: document.getElementById('durationDisplay'),
    copyTimeButton: document.getElementById('copyTimeButton'),
    backButton: document.getElementById('backButton'),
    playButton: document.getElementById('playButton'),
    forwardButton: document.getElementById('forwardButton'),
    hitsoundToggle: document.getElementById('hitsoundToggle'),
    hitsoundStatus: document.getElementById('hitsoundStatus'),
    seekBar: document.getElementById('seekBar'),
    audio: document.getElementById('audio'),
    timelineCanvas: document.getElementById('timelineCanvas'),
    overviewCanvas: document.getElementById('overviewCanvas'),
    kiaiBadge: document.getElementById('kiaiBadge'),
    donCount: document.getElementById('donCount'),
    kaCount: document.getElementById('kaCount'),
    bigCount: document.getElementById('bigCount'),
    kiaiCount: document.getElementById('kiaiCount'),
    errorCard: document.getElementById('errorCard'),
    errorMessage: document.getElementById('errorMessage'),
    rangeStateBadge: document.getElementById('rangeStateBadge'),
    startPointCard: document.getElementById('startPointCard'),
    endPointCard: document.getElementById('endPointCard'),
    startTime: document.getElementById('startTime'),
    endTime: document.getElementById('endTime'),
    startMeta: document.getElementById('startMeta'),
    endMeta: document.getElementById('endMeta'),
    startNowButton: document.getElementById('startNowButton'),
    startHitButton: document.getElementById('startHitButton'),
    startJumpButton: document.getElementById('startJumpButton'),
    endNowButton: document.getElementById('endNowButton'),
    endHitButton: document.getElementById('endHitButton'),
    endJumpButton: document.getElementById('endJumpButton'),
    rangeText: document.getElementById('rangeText'),
    rangeLength: document.getElementById('rangeLength'),
    rangeHitCount: document.getElementById('rangeHitCount'),
    rangeWarning: document.getElementById('rangeWarning'),
    copyRangeButton: document.getElementById('copyRangeButton'),
    copyRangeDetailsButton: document.getElementById('copyRangeDetailsButton'),
    clearRangeButton: document.getElementById('clearRangeButton'),
  };

  let zip = null;
  let maps = [];
  let activeMap = null;
  let audioObjectUrl = null;
  let loadedAudioName = '';
  let isSeeking = false;
  let rafId = 0;
  let rangeStart = null;
  let rangeEnd = null;

  let audioCtx = null;
  let mediaSourceNode = null;
  let hitsoundBuffers = new Map();
  let hitsoundLoadPromise = null;
  let hitsoundEnabled = true;
  let hitsoundTimer = null;
  let nextHitIndex = 0;
  let lastSchedulerMediaTime = null;
  const scheduledHitNodes = new Set();

  function setStatus(text) {
    el.statusBadge.textContent = text;
  }

  function showError(message) {
    el.errorMessage.textContent = message;
    el.errorCard.hidden = false;
    setStatus('エラー');
  }

  function clearError() {
    el.errorCard.hidden = true;
    el.errorMessage.textContent = '';
  }

  function formatTime(ms) {
    if (!Number.isFinite(ms) || ms < 0) ms = 0;
    const total = Math.floor(ms);
    const minutes = Math.floor(total / 60000);
    const seconds = Math.floor((total % 60000) / 1000);
    const millis = total % 1000;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(millis).padStart(3, '0')}`;
  }

  function hitKindLabel(hit) {
    if (!hit) return '';
    if (hit.kind === 'ka') return hit.isBig ? '大Ka' : 'Ka';
    return hit.isBig ? '大Don' : 'Don';
  }

  function nearestHitSelection(ms) {
    if (!activeMap || !activeMap.hits.length) return null;
    const i = lowerBoundHits(activeMap.hits, ms);
    const candidates = [];
    if (i < activeMap.hits.length) candidates.push(i);
    if (i > 0) candidates.push(i - 1);
    if (!candidates.length) return null;
    let best = candidates[0];
    for (const idx of candidates.slice(1)) {
      if (Math.abs(activeMap.hits[idx].time - ms) < Math.abs(activeMap.hits[best].time - ms)) best = idx;
    }
    const hit = activeMap.hits[best];
    return { time: hit.time, hitIndex: best, source: 'hit' };
  }

  function currentSelection() {
    return { time: Math.max(0, Math.round((el.audio.currentTime || 0) * 1000)), hitIndex: null, source: 'current' };
  }

  function selectionMeta(selection) {
    if (!selection || !activeMap) return '現在位置または最寄りHitを登録';
    const kiai = isKiaiAt(selection.time) ? 'KIAI ON' : 'KIAI OFF';
    if (selection.hitIndex !== null && activeMap.hits[selection.hitIndex]) {
      const hit = activeMap.hits[selection.hitIndex];
      return `Hit #${selection.hitIndex + 1} / ${hitKindLabel(hit)} / ${kiai}`;
    }
    return `任意位置 / ${kiai}`;
  }

  function countHitsInRange(startMs, endMs) {
    if (!activeMap || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0;
    const a = lowerBoundHits(activeMap.hits, startMs);
    const b = lowerBoundHits(activeMap.hits, endMs + 0.0001);
    return Math.max(0, b - a);
  }

  function validRange() {
    return !!(rangeStart && rangeEnd && rangeEnd.time >= rangeStart.time);
  }

  function rangePlainText() {
    if (!validRange()) return '';
    return `${formatTime(rangeStart.time)}～${formatTime(rangeEnd.time)}`;
  }

  function rangeDetailsText() {
    if (!validRange()) return '';
    const len = rangeEnd.time - rangeStart.time;
    const hitCount = countHitsInRange(rangeStart.time, rangeEnd.time);
    return [
      `開始：${formatTime(rangeStart.time)}${rangeStart.hitIndex !== null ? ` (${selectionMeta(rangeStart).replace(/ \/ KIAI (?:ON|OFF)$/, '')})` : ''}`,
      `終了：${formatTime(rangeEnd.time)}${rangeEnd.hitIndex !== null ? ` (${selectionMeta(rangeEnd).replace(/ \/ KIAI (?:ON|OFF)$/, '')})` : ''}`,
      `区間：${rangePlainText()}`,
      `区間長：${formatTime(len)}`,
      `区間内Hit：${hitCount}`,
    ].join('\n');
  }

  function updateRangeUi() {
    const startSelected = !!rangeStart;
    const endSelected = !!rangeEnd;
    const ready = validRange();
    const invalidOrder = !!(rangeStart && rangeEnd && rangeEnd.time < rangeStart.time);

    el.startPointCard.classList.toggle('selected', startSelected);
    el.endPointCard.classList.toggle('selected', endSelected);
    el.startTime.textContent = startSelected ? formatTime(rangeStart.time) : '未選択';
    el.endTime.textContent = endSelected ? formatTime(rangeEnd.time) : '未選択';
    el.startMeta.textContent = selectionMeta(rangeStart);
    el.endMeta.textContent = selectionMeta(rangeEnd);
    el.startJumpButton.disabled = !startSelected;
    el.endJumpButton.disabled = !endSelected;
    el.clearRangeButton.disabled = !(startSelected || endSelected);

    if (ready) {
      el.rangeStateBadge.textContent = '区間確定';
      el.rangeStateBadge.classList.add('ready');
      el.rangeText.textContent = rangePlainText();
      el.rangeLength.textContent = formatTime(rangeEnd.time - rangeStart.time);
      el.rangeHitCount.textContent = String(countHitsInRange(rangeStart.time, rangeEnd.time));
      el.copyRangeButton.disabled = false;
      el.copyRangeDetailsButton.disabled = false;
    } else {
      el.rangeStateBadge.textContent = startSelected || endSelected ? '1点選択' : '未選択';
      el.rangeStateBadge.classList.remove('ready');
      el.rangeText.textContent = invalidOrder
        ? `${formatTime(rangeStart.time)} → ${formatTime(rangeEnd.time)}`
        : '—';
      el.rangeLength.textContent = '—';
      el.rangeHitCount.textContent = '—';
      el.copyRangeButton.disabled = true;
      el.copyRangeDetailsButton.disabled = true;
    }
    el.rangeWarning.hidden = !invalidOrder;
    drawAll();
  }

  function resetRange() {
    rangeStart = null;
    rangeEnd = null;
    updateRangeUi();
  }

  function setRangePoint(which, useNearestHit) {
    if (!activeMap || !Number.isFinite(el.audio.duration)) return;
    const nowMs = Math.max(0, Math.round((el.audio.currentTime || 0) * 1000));
    const selection = useNearestHit ? nearestHitSelection(nowMs) : currentSelection();
    if (!selection) return;
    if (which === 'start') rangeStart = selection;
    else rangeEnd = selection;
    updateRangeUi();
  }

  function jumpToSelection(selection) {
    if (!selection || !Number.isFinite(el.audio.duration)) return;
    el.audio.currentTime = clampSeek(selection.time / 1000);
  }

  async function copyText(text, button) {
    if (!text) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (!ok) throw new Error('copy failed');
      }
      if (button) {
        const original = button.textContent;
        button.textContent = 'コピー済み';
        setTimeout(() => { button.textContent = original; }, 900);
      }
    } catch {
      showError(`コピーできませんでした。\n${text}`);
    }
  }

  function parseKeyValue(line) {
    const i = line.indexOf(':');
    if (i < 0) return null;
    return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
  }

  function parseHitSample(raw) {
    const f = String(raw || '').split(':');
    return {
      normalSet: Number.parseInt(f[0] || '0', 10) || 0,
      additionSet: Number.parseInt(f[1] || '0', 10) || 0,
      index: Number.parseInt(f[2] || '0', 10) || 0,
      volume: Number.parseInt(f[3] || '0', 10) || 0,
      filename: f.slice(4).join(':') || '',
    };
  }

  function generalSampleSetNumber(value) {
    const s = String(value || '').trim().toLowerCase();
    if (s === 'soft') return 2;
    if (s === 'drum') return 3;
    return 1;
  }

  function timingPointAt(timingPoints, time) {
    let lo = 0;
    let hi = timingPoints.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (timingPoints[mid].time <= time) lo = mid + 1;
      else hi = mid;
    }
    return lo > 0 ? timingPoints[lo - 1] : null;
  }

  function enrichHitPlaybackData(map) {
    const generalSet = generalSampleSetNumber(map.general.SampleSet);
    for (const hit of map.hits) {
      const tp = timingPointAt(map.timingPoints, hit.time);
      const timingSet = tp && tp.sampleSet ? tp.sampleSet : generalSet;
      const hs = hit.hitSample;
      const usesAdditionSet = hit.sampleName !== 'hitnormal';
      const objectSet = usesAdditionSet ? hs.additionSet : hs.normalSet;
      const resolvedSet = objectSet || timingSet || generalSet;

      // v3.2 has Normal / Soft variants. Drum/unknown falls back to Normal.
      hit.sampleFamily = resolvedSet === 2 ? 'soft' : 'normal';
      hit.volume = Math.max(0, Math.min(100, hs.volume || (tp ? tp.volume : 100) || 100));
    }
  }

  function parseOsu(text, fileName) {
    const map = {
      fileName,
      general: {},
      metadata: {},
      difficulty: {},
      timingPoints: [],
      hits: [],
      mode: null,
    };

    let section = '';
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);

    lines.forEach((raw, order) => {
      const line = raw.trim();
      if (!line || line.startsWith('//')) return;

      if (line.startsWith('[') && line.endsWith(']')) {
        section = line;
        return;
      }

      if (section === '[General]' || section === '[Metadata]' || section === '[Difficulty]') {
        const kv = parseKeyValue(line);
        if (!kv) return;
        const [key, value] = kv;
        if (section === '[General]') map.general[key] = value;
        if (section === '[Metadata]') map.metadata[key] = value;
        if (section === '[Difficulty]') map.difficulty[key] = value;
        return;
      }

      if (section === '[TimingPoints]') {
        const f = line.split(',');
        if (f.length < 8) return;
        const time = Number(f[0]);
        const sampleSet = Number.parseInt(f[3], 10) || 0;
        const sampleIndex = Number.parseInt(f[4], 10) || 0;
        const volume = Number.parseInt(f[5], 10);
        const uninherited = Number.parseInt(f[6], 10) || 0;
        const effects = Number.parseInt(f[7], 10) || 0;
        if (Number.isFinite(time)) {
          map.timingPoints.push({
            time,
            sampleSet,
            sampleIndex,
            volume: Number.isFinite(volume) ? volume : 100,
            uninherited,
            effects,
            order,
          });
        }
        return;
      }

      if (section === '[HitObjects]') {
        const f = line.split(',');
        if (f.length < 5) return;
        const time = Number.parseInt(f[2], 10);
        const type = Number.parseInt(f[3], 10) || 0;
        const hitSound = Number.parseInt(f[4], 10) || 0;
        const hitSample = parseHitSample(f[5] || '');

        // Taikoの単打（hit circle）のみを「ヒットポイント」として表示・再生。
        if (!Number.isFinite(time) || (type & 1) === 0) return;

        // Whistle(2) / Clap(8) が rim = Ka、Finish(4) が大音符。
        const isKa = (hitSound & (2 | 8)) !== 0;
        const isBig = (hitSound & 4) !== 0;

        // 前回の確認WAVと同じ1打=1ファイル割当。
        // 小Don=hitnormal / 小Ka=hitclap / 大Don=hitfinish / 大Ka=hitwhistle
        let sampleName = 'hitnormal';
        if (isKa && isBig) sampleName = 'hitwhistle';
        else if (isKa) sampleName = 'hitclap';
        else if (isBig) sampleName = 'hitfinish';

        map.hits.push({
          time,
          kind: isKa ? 'ka' : 'don',
          isBig,
          hitSound,
          hitSample,
          sampleName,
          sampleFamily: 'normal',
          volume: 100,
        });
      }
    });

    map.mode = Number.parseInt(map.general.Mode ?? '-1', 10);
    map.timingPoints.sort((a, b) => (a.time - b.time) || (a.order - b.order));
    map.hits.sort((a, b) => a.time - b.time);
    enrichHitPlaybackData(map);
    return map;
  }

  function buildKiaiIntervals(timingPoints, durationMs = Infinity) {
    const intervals = [];
    let active = false;
    let start = null;

    for (const tp of timingPoints) {
      const on = (tp.effects & 1) !== 0;
      if (on === active) continue;

      if (active && start !== null && tp.time > start) {
        intervals.push({ start, end: tp.time });
      }
      active = on;
      start = on ? tp.time : null;
    }

    if (active && start !== null) {
      intervals.push({ start, end: durationMs });
    }
    return intervals;
  }

  function currentDurationMs() {
    return Number.isFinite(el.audio.duration) ? el.audio.duration * 1000 : Infinity;
  }

  function currentKiaiIntervals() {
    if (!activeMap) return [];
    return buildKiaiIntervals(activeMap.timingPoints, currentDurationMs());
  }

  function isKiaiAt(ms) {
    return currentKiaiIntervals().some(x => ms >= x.start && ms < x.end);
  }

  function normalizePath(name) {
    return String(name || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  }

  function findZipEntry(name) {
    if (!zip || !name) return null;
    const exact = zip.file(name);
    if (exact) return exact;
    const target = normalizePath(name);
    return Object.values(zip.files).find(entry => !entry.dir && normalizePath(entry.name) === target) || null;
  }

  function mimeFor(name) {
    const ext = String(name).split('.').pop().toLowerCase();
    if (ext === 'mp3') return 'audio/mpeg';
    if (ext === 'ogg' || ext === 'oga') return 'audio/ogg';
    if (ext === 'wav') return 'audio/wav';
    if (ext === 'm4a') return 'audio/mp4';
    return 'application/octet-stream';
  }

  function updateHitsoundUi() {
    el.hitsoundToggle.textContent = hitsoundEnabled ? 'HS ON' : 'HS OFF';
    el.hitsoundToggle.classList.toggle('on', hitsoundEnabled);
    el.hitsoundStatus.textContent = hitsoundEnabled
      ? 'v3.2を譜面時刻へ自動同期'
      : 'ヒットサウンド停止中';
  }

  async function ensureAudioEngine() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) throw new Error('このブラウザはWeb Audio APIに対応していません。');

    if (!audioCtx) {
      audioCtx = new AudioContextCtor({ latencyHint: 'interactive' });
      mediaSourceNode = audioCtx.createMediaElementSource(el.audio);
      mediaSourceNode.connect(audioCtx.destination);
    }

    if (audioCtx.state === 'suspended') await audioCtx.resume();

    if (!hitsoundLoadPromise) {
      hitsoundLoadPromise = (async () => {
        const entries = await Promise.all(Object.entries(HITSOUND_FILES).map(async ([key, url]) => {
          const response = await fetch(url, { cache: 'force-cache' });
          if (!response.ok) throw new Error(`v3.2ヒットサウンドを読み込めません: ${url}`);
          const arrayBuffer = await response.arrayBuffer();
          const buffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
          return [key, buffer];
        }));
        hitsoundBuffers = new Map(entries);
      })();
    }

    await hitsoundLoadPromise;
  }

  function cancelScheduledHits() {
    for (const node of scheduledHitNodes) {
      try { node.stop(); } catch {}
    }
    scheduledHitNodes.clear();
  }

  function resetHitSchedulerPosition() {
    if (!activeMap) {
      nextHitIndex = 0;
      return;
    }
    const nowMs = (el.audio.currentTime || 0) * 1000;
    nextHitIndex = lowerBoundHits(activeMap.hits, nowMs - 8);
    lastSchedulerMediaTime = el.audio.currentTime || 0;
  }

  function scheduleHit(hit, when) {
    if (!audioCtx || !hitsoundEnabled) return;
    const key = `${hit.sampleFamily}:${hit.sampleName}`;
    const buffer = hitsoundBuffers.get(key) || hitsoundBuffers.get(`normal:${hit.sampleName}`);
    if (!buffer) return;

    const source = audioCtx.createBufferSource();
    const gain = audioCtx.createGain();
    source.buffer = buffer;
    gain.gain.value = Math.max(0, Math.min(1, hit.volume / 100));
    source.connect(gain);
    gain.connect(audioCtx.destination);
    scheduledHitNodes.add(source);
    source.onended = () => scheduledHitNodes.delete(source);
    source.start(when);
  }

  function hitsoundSchedulerTick() {
    if (!activeMap || !hitsoundEnabled || !audioCtx || el.audio.paused || !hitsoundBuffers.size) return;

    const mediaNow = el.audio.currentTime || 0;
    if (lastSchedulerMediaTime !== null && Math.abs(mediaNow - lastSchedulerMediaTime) > 0.35) {
      cancelScheduledHits();
      resetHitSchedulerPosition();
    }

    const horizon = mediaNow + HITSOUND_LOOKAHEAD_SEC;
    while (nextHitIndex < activeMap.hits.length) {
      const hit = activeMap.hits[nextHitIndex];
      const hitSec = hit.time / 1000;
      if (hitSec > horizon) break;

      if (hitSec >= mediaNow - 0.008) {
        const delay = Math.max(0.004, hitSec - mediaNow);
        scheduleHit(hit, audioCtx.currentTime + delay);
      }
      nextHitIndex += 1;
    }

    lastSchedulerMediaTime = mediaNow;
  }

  function startHitScheduler() {
    if (!hitsoundEnabled) return;
    if (hitsoundTimer) clearInterval(hitsoundTimer);
    cancelScheduledHits();
    resetHitSchedulerPosition();
    hitsoundSchedulerTick();
    hitsoundTimer = setInterval(hitsoundSchedulerTick, HITSOUND_TICK_MS);
  }

  function stopHitScheduler() {
    if (hitsoundTimer) {
      clearInterval(hitsoundTimer);
      hitsoundTimer = null;
    }
    cancelScheduledHits();
    lastSchedulerMediaTime = null;
  }

  async function loadAudioForMap(map) {
    const audioName = map.general.AudioFilename;
    if (!audioName) throw new Error('選択した .osu に AudioFilename がありません。');

    if (loadedAudioName === normalizePath(audioName) && el.audio.src) {
      el.audio.currentTime = 0;
      return;
    }

    const entry = findZipEntry(audioName);
    if (!entry) throw new Error(`OSZ内で音源を見つけられません: ${audioName}`);

    el.audio.pause();
    if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);

    const rawBlob = await entry.async('blob');
    const blob = new Blob([rawBlob], { type: mimeFor(audioName) });
    audioObjectUrl = URL.createObjectURL(blob);
    loadedAudioName = normalizePath(audioName);
    el.audio.src = audioObjectUrl;
    el.audio.load();

    await new Promise((resolve, reject) => {
      const ok = () => { cleanup(); resolve(); };
      const ng = () => { cleanup(); reject(new Error('音源をブラウザで読み込めませんでした。')); };
      const cleanup = () => {
        el.audio.removeEventListener('loadedmetadata', ok);
        el.audio.removeEventListener('error', ng);
      };
      el.audio.addEventListener('loadedmetadata', ok, { once: true });
      el.audio.addEventListener('error', ng, { once: true });
    });
  }

  async function applyMap(index) {
    clearError();
    stopHitScheduler();
    const map = maps[index];
    if (!map) return;

    activeMap = map;
    resetRange();
    setStatus('音源読込中');
    setControlsEnabled(false);

    try {
      await loadAudioForMap(map);
      const title = map.metadata.TitleUnicode || map.metadata.Title || 'Untitled';
      const artist = map.metadata.ArtistUnicode || map.metadata.Artist || 'Unknown artist';
      const version = map.metadata.Version || 'Unknown difficulty';
      const creator = map.metadata.Creator || 'Unknown mapper';

      el.songTitle.textContent = `${artist} - ${title}`;
      el.songMeta.textContent = `${version} / mapped by ${creator}`;

      const don = map.hits.filter(h => h.kind === 'don').length;
      const ka = map.hits.filter(h => h.kind === 'ka').length;
      const big = map.hits.filter(h => h.isBig).length;
      const kiai = currentKiaiIntervals().length;
      el.donCount.textContent = don;
      el.kaCount.textContent = ka;
      el.bigCount.textContent = big;
      el.kiaiCount.textContent = kiai;

      const duration = Number.isFinite(el.audio.duration) ? el.audio.duration : 0;
      el.seekBar.max = String(duration);
      el.seekBar.value = '0';
      el.durationDisplay.textContent = formatTime(duration * 1000);
      el.timeDisplay.textContent = '00:00:000';
      setControlsEnabled(true);
      setStatus('準備完了');
      drawAll();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  function setControlsEnabled(enabled) {
    el.playButton.disabled = !enabled;
    el.backButton.disabled = !enabled;
    el.forwardButton.disabled = !enabled;
    el.seekBar.disabled = !enabled;
    el.copyTimeButton.disabled = !enabled;
    el.startNowButton.disabled = !enabled;
    el.startHitButton.disabled = !enabled;
    el.endNowButton.disabled = !enabled;
    el.endHitButton.disabled = !enabled;
    if (!enabled) {
      el.startJumpButton.disabled = true;
      el.endJumpButton.disabled = true;
    } else {
      updateRangeUi();
    }
  }

  async function handleOsz(file) {
    clearError();
    if (!window.JSZip) {
      showError('JSZipの読み込みに失敗しました。配布ファイル一式を確認してください。');
      return;
    }

    stopHitScheduler();
    el.audio.pause();
    activeMap = null;
    resetRange();
    setStatus('OSZ解析中');
    setControlsEnabled(false);
    el.difficultySelect.disabled = true;
    el.fileName.textContent = file.name;

    try {
      zip = await JSZip.loadAsync(file);
      const osuEntries = Object.values(zip.files).filter(entry => !entry.dir && /\.osu$/i.test(entry.name));
      if (!osuEntries.length) throw new Error('OSZ内に .osu ファイルがありません。');

      const parsed = [];
      for (const entry of osuEntries) {
        const text = await entry.async('string');
        parsed.push(parseOsu(text, entry.name));
      }

      const taikoMaps = parsed.filter(m => m.mode === 1);
      maps = taikoMaps.length ? taikoMaps : parsed;
      if (!maps.length) throw new Error('表示できる譜面がありません。');

      el.difficultySelect.innerHTML = '';
      maps.forEach((map, i) => {
        const option = document.createElement('option');
        const version = map.metadata.Version || map.fileName;
        option.value = String(i);
        option.textContent = `${version} (${map.hits.length} hits)`;
        el.difficultySelect.appendChild(option);
      });
      el.difficultySelect.disabled = false;
      await applyMap(0);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  function canvasContext(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: rect.width, height: rect.height };
  }

  function lowerBoundHits(hits, time) {
    let lo = 0, hi = hits.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (hits[mid].time < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function cssVar(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function drawTimeline() {
    const { ctx, width, height } = canvasContext(el.timelineCanvas);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0f1216';
    ctx.fillRect(0, 0, width, height);

    if (!activeMap) return;
    const now = (el.audio.currentTime || 0) * 1000;
    const left = now - VIEW_SPAN_MS / 2;
    const right = now + VIEW_SPAN_MS / 2;
    const xFor = t => ((t - left) / VIEW_SPAN_MS) * width;

    // Kiai background.
    ctx.fillStyle = 'rgba(135, 103, 215, 0.20)';
    for (const interval of currentKiaiIntervals()) {
      const a = Math.max(left, interval.start);
      const b = Math.min(right, interval.end);
      if (b <= a) continue;
      ctx.fillRect(xFor(a), 0, xFor(b) - xFor(a), height);
    }

    // 1-second grid.
    const firstTick = Math.ceil(left / 1000) * 1000;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    for (let t = firstTick; t <= right; t += 1000) {
      const x = xFor(t);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      if (t >= 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillText(formatTime(t).slice(0, 5), x, height - 5);
      }
    }

    // Hit objects in visible window.
    const startIndex = lowerBoundHits(activeMap.hits, left);
    const donColor = cssVar('--don', '#ef6b62');
    const kaColor = cssVar('--ka', '#68b8d7');
    const y = Math.round(height * 0.48);

    for (let i = startIndex; i < activeMap.hits.length; i++) {
      const hit = activeMap.hits[i];
      if (hit.time > right) break;
      const x = xFor(hit.time);
      const r = hit.isBig ? 8 : 5.5;

      ctx.strokeStyle = hit.kind === 'ka' ? kaColor : donColor;
      ctx.fillStyle = hit.kind === 'ka' ? kaColor : donColor;
      ctx.lineWidth = hit.isBig ? 3 : 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (hit.isBig) {
        ctx.globalAlpha = 0.28;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
      } else {
        ctx.fill();
      }
    }

    // Selected START / END markers.
    const drawSelectionMarker = (selection, label, color) => {
      if (!selection || selection.time < left || selection.time > right) return;
      const x = xFor(selection.time);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = '700 10px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(label, Math.min(width - 36, x + 4), 6);
      ctx.restore();
    };
    drawSelectionMarker(rangeStart, 'START', cssVar('--range-start', '#70d6a0'));
    drawSelectionMarker(rangeEnd, 'END', cssVar('--range-end', '#f0c36a'));

    // Playhead fixed at center.
    const px = width / 2;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(px - 6, 0);
    ctx.lineTo(px + 6, 0);
    ctx.lineTo(px, 8);
    ctx.closePath();
    ctx.fill();
  }

  function drawOverview() {
    const { ctx, width, height } = canvasContext(el.overviewCanvas);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0f1216';
    ctx.fillRect(0, 0, width, height);

    if (!activeMap || !Number.isFinite(el.audio.duration) || el.audio.duration <= 0) return;
    const durationMs = el.audio.duration * 1000;
    const xFor = t => (t / durationMs) * width;

    ctx.fillStyle = 'rgba(135, 103, 215, 0.30)';
    for (const interval of currentKiaiIntervals()) {
      const end = Number.isFinite(interval.end) ? interval.end : durationMs;
      ctx.fillRect(xFor(interval.start), 0, Math.max(1, xFor(end) - xFor(interval.start)), height);
    }

    // Hit density marks.
    const donColor = cssVar('--don', '#ef6b62');
    const kaColor = cssVar('--ka', '#68b8d7');
    ctx.globalAlpha = 0.42;
    for (const hit of activeMap.hits) {
      const x = xFor(hit.time);
      ctx.strokeStyle = hit.kind === 'ka' ? kaColor : donColor;
      ctx.lineWidth = hit.isBig ? 1.8 : 1;
      ctx.beginPath();
      ctx.moveTo(x, height * 0.25);
      ctx.lineTo(x, height * 0.75);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Selected range and endpoint markers.
    if (validRange()) {
      const sx = xFor(rangeStart.time);
      const ex = xFor(rangeEnd.time);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(sx, 0, Math.max(1, ex - sx), height);
    }
    const overviewMarker = (selection, color) => {
      if (!selection) return;
      const x = xFor(selection.time);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    };
    overviewMarker(rangeStart, cssVar('--range-start', '#70d6a0'));
    overviewMarker(rangeEnd, cssVar('--range-end', '#f0c36a'));

    const nowX = xFor((el.audio.currentTime || 0) * 1000);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(nowX, 0);
    ctx.lineTo(nowX, height);
    ctx.stroke();
  }

  function drawAll() {
    drawTimeline();
    drawOverview();
  }

  function updateUiFrame() {
    const ms = (el.audio.currentTime || 0) * 1000;
    el.timeDisplay.textContent = formatTime(ms);
    if (!isSeeking && Number.isFinite(el.audio.duration)) {
      el.seekBar.value = String(el.audio.currentTime || 0);
    }

    const on = activeMap ? isKiaiAt(ms) : false;
    el.kiaiBadge.textContent = on ? 'KIAI ON' : 'KIAI OFF';
    el.kiaiBadge.classList.toggle('on', on);
    drawAll();
    rafId = requestAnimationFrame(updateUiFrame);
  }

  function clampSeek(seconds) {
    if (!Number.isFinite(el.audio.duration)) return 0;
    return Math.min(Math.max(seconds, 0), el.audio.duration);
  }

  el.oszInput.addEventListener('change', event => {
    const file = event.target.files && event.target.files[0];
    if (file) handleOsz(file);
  });

  el.difficultySelect.addEventListener('change', () => {
    el.audio.pause();
    el.playButton.textContent = '▶';
    applyMap(Number(el.difficultySelect.value));
  });

  el.playButton.addEventListener('click', async () => {
    try {
      if (el.audio.paused) {
        if (hitsoundEnabled || audioCtx) await ensureAudioEngine();
        await el.audio.play();
      } else {
        el.audio.pause();
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : '再生を開始できませんでした。');
    }
  });

  el.audio.addEventListener('play', () => {
    el.playButton.textContent = '❚❚';
    if (hitsoundEnabled && hitsoundBuffers.size) startHitScheduler();
  });
  el.audio.addEventListener('pause', () => {
    el.playButton.textContent = '▶';
    stopHitScheduler();
  });
  el.audio.addEventListener('ended', () => {
    el.playButton.textContent = '▶';
    stopHitScheduler();
  });
  el.audio.addEventListener('seeking', stopHitScheduler);
  el.audio.addEventListener('seeked', () => {
    if (!el.audio.paused && hitsoundEnabled && hitsoundBuffers.size) startHitScheduler();
  });

  el.hitsoundToggle.addEventListener('click', async () => {
    hitsoundEnabled = !hitsoundEnabled;
    updateHitsoundUi();

    if (!hitsoundEnabled) {
      stopHitScheduler();
      return;
    }

    try {
      if (!el.audio.paused) {
        await ensureAudioEngine();
        startHitScheduler();
      }
    } catch (err) {
      hitsoundEnabled = false;
      updateHitsoundUi();
      showError(err instanceof Error ? err.message : String(err));
    }
  });

  el.backButton.addEventListener('click', () => {
    el.audio.currentTime = clampSeek(el.audio.currentTime - 5);
  });

  el.forwardButton.addEventListener('click', () => {
    el.audio.currentTime = clampSeek(el.audio.currentTime + 5);
  });

  el.seekBar.addEventListener('pointerdown', () => { isSeeking = true; });
  el.seekBar.addEventListener('pointerup', () => { isSeeking = false; });
  el.seekBar.addEventListener('input', () => {
    const v = Number(el.seekBar.value);
    if (Number.isFinite(v)) el.audio.currentTime = clampSeek(v);
  });

  el.copyTimeButton.addEventListener('click', async () => {
    const text = formatTime((el.audio.currentTime || 0) * 1000);
    await copyText(text, el.copyTimeButton);
  });

  el.startNowButton.addEventListener('click', () => setRangePoint('start', false));
  el.startHitButton.addEventListener('click', () => setRangePoint('start', true));
  el.endNowButton.addEventListener('click', () => setRangePoint('end', false));
  el.endHitButton.addEventListener('click', () => setRangePoint('end', true));
  el.startJumpButton.addEventListener('click', () => jumpToSelection(rangeStart));
  el.endJumpButton.addEventListener('click', () => jumpToSelection(rangeEnd));
  el.clearRangeButton.addEventListener('click', resetRange);
  el.copyRangeButton.addEventListener('click', async () => {
    await copyText(rangePlainText(), el.copyRangeButton);
  });
  el.copyRangeDetailsButton.addEventListener('click', async () => {
    await copyText(rangeDetailsText(), el.copyRangeDetailsButton);
  });

  el.timelineCanvas.addEventListener('pointerdown', event => {
    if (!activeMap || !Number.isFinite(el.audio.duration)) return;
    const rect = el.timelineCanvas.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const deltaMs = (ratio - 0.5) * VIEW_SPAN_MS;
    el.audio.currentTime = clampSeek(el.audio.currentTime + deltaMs / 1000);
  });

  el.overviewCanvas.addEventListener('pointerdown', event => {
    if (!activeMap || !Number.isFinite(el.audio.duration)) return;
    const rect = el.overviewCanvas.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    el.audio.currentTime = clampSeek(el.audio.duration * ratio);
  });

  window.addEventListener('resize', drawAll);
  window.addEventListener('orientationchange', drawAll);

  updateHitsoundUi();
  updateRangeUi();
  rafId = requestAnimationFrame(updateUiFrame);
  window.addEventListener('beforeunload', () => {
    cancelAnimationFrame(rafId);
    stopHitScheduler();
    if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
    if (audioCtx) audioCtx.close().catch(() => {});
  });
})();
