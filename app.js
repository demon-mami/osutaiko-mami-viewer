(() => {
  'use strict';

  const VIEW_MS = 6000;
  const LOOKAHEAD_SEC = 0.18;
  const TICK_MS = 25;
  const HS = {
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
    oszInput: $('oszInput'), fileName: $('fileName'), statusBadge: $('statusBadge'),
    difficultySelect: $('difficultySelect'), songTitle: $('songTitle'), songMeta: $('songMeta'),
    timeDisplay: $('timeDisplay'), durationDisplay: $('durationDisplay'), copyTimeButton: $('copyTimeButton'),
    startMarkButton: $('startMarkButton'), endMarkButton: $('endMarkButton'), clearRangeButton: $('clearRangeButton'),
    backButton: $('backButton'), playButton: $('playButton'), forwardButton: $('forwardButton'), seekBar: $('seekBar'),
    audio: $('audio'), timelineCanvas: $('timelineCanvas'), overviewCanvas: $('overviewCanvas'), kiaiBadge: $('kiaiBadge'),
    purposeSelect: $('purposeSelect'), fadeSelect: $('fadeSelect'), outputPreview: $('outputPreview'), copyOutputButton: $('copyOutputButton'),
    errorCard: $('errorCard'), errorMessage: $('errorMessage'),
  };

  let zip = null;
  let maps = [];
  let activeMap = null;
  let audioUrl = null;
  let rangeStart = null;
  let rangeEnd = null;
  let isSeeking = false;
  let raf = 0;

  let audioCtx = null;
  let hsBuffers = new Map();
  let hsPromise = null;
  let hsTimer = null;
  let nextHit = 0;
  let lastMediaMs = null;
  const scheduled = new Set();

  const setStatus = text => { el.statusBadge.textContent = text; };
  function error(message) {
    el.errorMessage.textContent = message;
    el.errorCard.hidden = false;
    setStatus('エラー');
  }
  function clearError() {
    el.errorCard.hidden = true;
    el.errorMessage.textContent = '';
  }

  function fmt(ms) {
    ms = Math.max(0, Math.floor(Number.isFinite(ms) ? ms : 0));
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const z = ms % 1000;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}:${String(z).padStart(3,'0')}`;
  }
  function fmtOut(ms) {
    const sec = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  const validRange = () => !!(rangeStart && rangeEnd && rangeEnd.time >= rangeStart.time);

  function outputText() {
    if (!activeMap) return '**曲名：—**\n用途：—\n難易度：**—**\n区間：—（Fade-in/out：含まない）';
    const title = activeMap.metadata.TitleUnicode || activeMap.metadata.Title || 'Untitled';
    const diff = activeMap.metadata.Version || 'Unknown';
    const purpose = el.purposeSelect.value || '未選択';
    const fade = el.fadeSelect.value || '含まない';
    let range = '未選択';
    if (rangeStart && rangeEnd) range = validRange() ? `${fmtOut(rangeStart.time)}～${fmtOut(rangeEnd.time)}` : 'ENDがSTARTより前です';
    return `**曲名：${title}**\n用途：${purpose}\n難易度：**${diff}**\n区間：${range}（Fade-in/out：${fade}）`;
  }
  function updateOutput() {
    el.outputPreview.textContent = outputText();
    el.copyOutputButton.disabled = !(activeMap && el.purposeSelect.value && validRange());
  }
  function updateRange() {
    const s = !!rangeStart, e = !!rangeEnd;
    el.startMarkButton.classList.toggle('marked', s);
    el.endMarkButton.classList.toggle('marked', e);
    el.startMarkButton.textContent = s ? 'START ✓' : 'START';
    el.endMarkButton.textContent = e ? 'END ✓' : 'END';
    el.clearRangeButton.disabled = !(s || e);
    updateOutput();
    drawAll();
  }
  function resetRange() { rangeStart = rangeEnd = null; updateRange(); }
  function mark(which) {
    if (!activeMap || !Number.isFinite(el.audio.duration)) return;
    const p = { time: Math.round((el.audio.currentTime || 0) * 1000) };
    if (which === 'start') rangeStart = p; else rangeEnd = p;
    updateRange();
  }

  async function copy(text, button) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const t = document.createElement('textarea');
        t.value = text; t.readOnly = true; t.style.position = 'fixed'; t.style.opacity = '0';
        document.body.appendChild(t); t.select();
        if (!document.execCommand('copy')) throw new Error('copy');
        t.remove();
      }
      const old = button.textContent; button.textContent = 'コピー済み';
      setTimeout(() => { button.textContent = old; }, 850);
    } catch { error(`コピーできませんでした。\n${text}`); }
  }

  function parseKV(line) {
    const i = line.indexOf(':');
    return i < 0 ? null : [line.slice(0,i).trim(), line.slice(i+1).trim()];
  }
  function hitSample(raw) {
    const f = String(raw || '').split(':');
    return {
      normalSet: parseInt(f[0] || '0',10) || 0,
      additionSet: parseInt(f[1] || '0',10) || 0,
      volume: parseInt(f[3] || '0',10) || 0,
    };
  }
  function generalSet(v) {
    v = String(v || '').toLowerCase();
    if (v === 'soft') return 2;
    if (v === 'drum') return 3;
    return 1;
  }
  function timingAt(points, time) {
    let lo = 0, hi = points.length;
    while (lo < hi) { const m = (lo+hi)>>1; if (points[m].time <= time) lo = m+1; else hi = m; }
    return lo ? points[lo-1] : null;
  }

  function parseOsu(text, fileName) {
    const map = { fileName, general:{}, metadata:{}, timing:[], hits:[], kiai:[], mode:null };
    let sec = '';
    text.replace(/^\uFEFF/,'').split(/\r?\n/).forEach((raw, order) => {
      const line = raw.trim();
      if (!line || line.startsWith('//')) return;
      if (line[0] === '[' && line.endsWith(']')) { sec = line; return; }
      if (sec === '[General]' || sec === '[Metadata]') {
        const kv = parseKV(line); if (!kv) return;
        (sec === '[General]' ? map.general : map.metadata)[kv[0]] = kv[1];
        return;
      }
      if (sec === '[TimingPoints]') {
        const f = line.split(','); if (f.length < 8) return;
        const time = Number(f[0]); if (!Number.isFinite(time)) return;
        map.timing.push({ time, sampleSet:parseInt(f[3],10)||0, volume:parseInt(f[5],10)||100, effects:parseInt(f[7],10)||0, order });
        return;
      }
      if (sec === '[HitObjects]') {
        const f = line.split(','); if (f.length < 5) return;
        const time = parseInt(f[2],10), type = parseInt(f[3],10)||0, sound = parseInt(f[4],10)||0;
        if (!Number.isFinite(time) || !(type & 1)) return;
        const ka = !!(sound & 2) || !!(sound & 8);
        const big = !!(sound & 4);
        const sampleName = ka ? (big ? 'hitwhistle' : 'hitclap') : (big ? 'hitfinish' : 'hitnormal');
        map.hits.push({ time, kind:ka?'ka':'don', big, sampleName, hs:hitSample(f[5] || '') });
      }
    });
    map.mode = parseInt(map.general.Mode || '0',10);
    map.timing.sort((a,b) => a.time-b.time || a.order-b.order);
    map.hits.sort((a,b) => a.time-b.time);

    const g = generalSet(map.general.SampleSet);
    map.hits.forEach(h => {
      const tp = timingAt(map.timing, h.time);
      const baseSet = (tp && tp.sampleSet) || g;
      const chosen = (h.sampleName === 'hitnormal' ? h.hs.normalSet : h.hs.additionSet) || baseSet;
      h.family = chosen === 2 ? 'soft' : 'normal';
      h.volume = Math.max(0, Math.min(100, h.hs.volume || (tp && tp.volume) || 100));
    });

    let on = false, start = 0;
    map.timing.forEach(tp => {
      const n = !!(tp.effects & 1);
      if (n !== on) {
        if (n) start = tp.time; else map.kiai.push({start, end:tp.time});
        on = n;
      }
    });
    if (on) map.kiai.push({start, end:Infinity});
    return map;
  }

  function findZipFile(name) {
    if (!zip || !name) return null;
    const want = name.replace(/\\/g,'/').toLowerCase();
    const base = want.split('/').pop();
    let fallback = null;
    for (const key of Object.keys(zip.files)) {
      if (zip.files[key].dir) continue;
      const norm = key.replace(/\\/g,'/').toLowerCase();
      if (norm === want) return zip.files[key];
      if (!fallback && norm.split('/').pop() === base) fallback = zip.files[key];
    }
    return fallback;
  }

  async function loadMap(index) {
    const map = maps[index]; if (!map) return;
    activeMap = map; resetRange(); clearError();
    stopScheduler(); el.audio.pause(); el.playButton.textContent = '▶';
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
    const audioEntry = findZipFile(map.general.AudioFilename);
    if (!audioEntry) { error(`音源が見つかりません: ${map.general.AudioFilename || '(未指定)'}`); return; }
    setStatus('音源読込中');
    try {
      const blob = await audioEntry.async('blob');
      audioUrl = URL.createObjectURL(blob);
      el.audio.src = audioUrl;
      el.audio.load();
      el.songTitle.textContent = map.metadata.TitleUnicode || map.metadata.Title || 'Untitled';
      el.songMeta.textContent = `${map.hits.length} hits`;
      el.startMarkButton.disabled = el.endMarkButton.disabled = false;
      el.copyTimeButton.disabled = false;
      el.backButton.disabled = el.playButton.disabled = el.forwardButton.disabled = false;
      el.seekBar.disabled = false;
      updateOutput(); drawAll(); setStatus('準備完了');
    } catch (e) { error(e instanceof Error ? e.message : '音源を読み込めませんでした。'); }
  }

  async function handleOsz(file) {
    clearError();
    if (!/\.osz$/i.test(file.name)) { error('.osz / .OSZ ファイルを選択してください。'); return; }
    setStatus('解析中'); el.fileName.textContent = file.name;
    try {
      zip = await JSZip.loadAsync(await file.arrayBuffer());
      const entries = Object.values(zip.files).filter(f => !f.dir && /\.osu$/i.test(f.name));
      const parsed = await Promise.all(entries.map(async f => parseOsu(await f.async('string'), f.name)));
      maps = parsed.filter(m => m.mode === 1);
      if (!maps.length) throw new Error('osu!taiko (Mode:1) の難易度がありません。');
      maps.sort((a,b) => String(a.metadata.Version||'').localeCompare(String(b.metadata.Version||''),'ja'));
      el.difficultySelect.innerHTML = '';
      maps.forEach((m,i) => {
        const o = document.createElement('option'); o.value = String(i);
        o.textContent = `${m.metadata.Version || 'Unknown'} — ${m.hits.length} hits`;
        el.difficultySelect.appendChild(o);
      });
      el.difficultySelect.disabled = false;
      el.purposeSelect.value = ''; el.fadeSelect.value = '含まない';
      await loadMap(0);
    } catch (e) { maps=[]; activeMap=null; error(e instanceof Error ? e.message : 'OSZを解析できませんでした。'); }
  }

  async function ensureHs() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    if (!hsPromise) hsPromise = Promise.all(Object.entries(HS).map(async ([key,url]) => {
      const r = await fetch(url); if (!r.ok) throw new Error(`Hitsound読込失敗: ${url}`);
      return [key, await audioCtx.decodeAudioData(await r.arrayBuffer())];
    })).then(a => { hsBuffers = new Map(a); });
    await hsPromise;
  }
  function lowerHits(time) {
    const a = activeMap ? activeMap.hits : []; let lo=0, hi=a.length;
    while (lo<hi) { const m=(lo+hi)>>1; if (a[m].time<time) lo=m+1; else hi=m; }
    return lo;
  }
  function stopNodes() {
    scheduled.forEach(n => { try { n.stop(); } catch {} }); scheduled.clear();
  }
  function stopScheduler() {
    if (hsTimer) clearInterval(hsTimer); hsTimer = null; lastMediaMs = null; stopNodes();
  }
  function scheduleHit(hit, delay) {
    const buf = hsBuffers.get(`${hit.family}:${hit.sampleName}`) || hsBuffers.get(`normal:${hit.sampleName}`);
    if (!buf) return;
    const src = audioCtx.createBufferSource(), gain = audioCtx.createGain();
    src.buffer = buf; gain.gain.value = hit.volume / 100;
    src.connect(gain).connect(audioCtx.destination);
    src.onended = () => scheduled.delete(src); scheduled.add(src);
    src.start(audioCtx.currentTime + Math.max(0,delay));
  }
  function tickHs() {
    if (!activeMap || !audioCtx || el.audio.paused || !hsBuffers.size) return;
    const now = el.audio.currentTime * 1000;
    if (lastMediaMs === null || Math.abs(now-lastMediaMs) > 250) { stopNodes(); nextHit = lowerHits(now-10); }
    const horizon = now + LOOKAHEAD_SEC*1000;
    while (nextHit < activeMap.hits.length && activeMap.hits[nextHit].time <= horizon) {
      const h = activeMap.hits[nextHit++];
      if (h.time >= now-15) scheduleHit(h, (h.time-now)/1000);
    }
    lastMediaMs = now;
  }
  function startScheduler() {
    stopScheduler();
    nextHit = lowerHits(el.audio.currentTime*1000 - 10); tickHs(); hsTimer = setInterval(tickHs,TICK_MS);
  }

  function canvas(c) {
    const r=c.getBoundingClientRect(), d=Math.max(1,window.devicePixelRatio||1);
    const w=Math.max(1,Math.round(r.width*d)), h=Math.max(1,Math.round(r.height*d));
    if(c.width!==w||c.height!==h){c.width=w;c.height=h;}
    const x=c.getContext('2d'); x.setTransform(d,0,0,d,0,0); return {x,w:r.width,h:r.height};
  }
  const css = (n,d) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d;
  function kiaiAt(ms) { return !!(activeMap && activeMap.kiai.some(k => ms>=k.start && ms<k.end)); }

  function drawTimeline() {
    const {x,w,h}=canvas(el.timelineCanvas); x.clearRect(0,0,w,h); x.fillStyle='#0f1216'; x.fillRect(0,0,w,h);
    if(!activeMap) return;
    const now=(el.audio.currentTime||0)*1000, left=now-VIEW_MS/2, right=now+VIEW_MS/2, xp=t=>(t-left)/VIEW_MS*w;
    x.fillStyle='rgba(244,220,125,.20)';
    activeMap.kiai.forEach(k=>{const a=Math.max(left,k.start),b=Math.min(right,k.end);if(b>a)x.fillRect(xp(a),0,xp(b)-xp(a),h);});
    const first=Math.ceil(left/1000)*1000;
    x.font='9px -apple-system,BlinkMacSystemFont,sans-serif';x.textAlign='center';x.textBaseline='bottom';
    for(let t=first;t<=right;t+=1000){const px=xp(t);x.strokeStyle='rgba(255,255,255,.07)';x.beginPath();x.moveTo(px,0);x.lineTo(px,h);x.stroke();if(t>=0){x.fillStyle='rgba(255,255,255,.38)';x.fillText(fmt(t).slice(0,5),px,h-3);}}
    const y=Math.round(h*.42), start=lowerHits(left), don=css('--don','#ef6b62'), ka=css('--ka','#68b8d7');
    for(let i=start;i<activeMap.hits.length;i++){const q=activeMap.hits[i];if(q.time>right)break;const px=xp(q.time),r=q.big?6.5:4.5;x.fillStyle=q.kind==='ka'?ka:don;x.strokeStyle=x.fillStyle;x.lineWidth=q.big?2.5:1;x.beginPath();x.arc(px,y,r,0,Math.PI*2);if(q.big){x.globalAlpha=.3;x.fill();x.globalAlpha=1;x.stroke();}else x.fill();}
    const marker=(p,label,color)=>{if(!p||p.time<left||p.time>right)return;const px=xp(p.time);x.strokeStyle=color;x.lineWidth=2;x.setLineDash([4,3]);x.beginPath();x.moveTo(px,0);x.lineTo(px,h);x.stroke();x.setLineDash([]);x.fillStyle=color;x.font='700 9px sans-serif';x.textAlign='left';x.textBaseline='top';x.fillText(label,Math.min(w-34,px+3),3);};
    marker(rangeStart,'START',css('--range-start','#70d6a0')); marker(rangeEnd,'END',css('--range-end','#f0c36a'));
    x.strokeStyle='#fff';x.lineWidth=2;x.beginPath();x.moveTo(w/2,0);x.lineTo(w/2,h);x.stroke();
  }
  function drawOverview() {
    const {x,w,h}=canvas(el.overviewCanvas);x.clearRect(0,0,w,h);x.fillStyle='#0f1216';x.fillRect(0,0,w,h);
    if(!activeMap||!Number.isFinite(el.audio.duration)||el.audio.duration<=0)return;
    const dur=el.audio.duration*1000,xp=t=>Math.max(0,Math.min(w,t/dur*w));
    x.fillStyle='rgba(244,220,125,.36)';activeMap.kiai.forEach(k=>{const e=Number.isFinite(k.end)?k.end:dur;x.fillRect(xp(k.start),0,Math.max(1,xp(e)-xp(k.start)),h);});
    const mk=(p,c)=>{if(!p)return;const px=xp(p.time);x.strokeStyle=c;x.lineWidth=2;x.beginPath();x.moveTo(px,0);x.lineTo(px,h);x.stroke();};
    mk(rangeStart,css('--range-start','#70d6a0'));mk(rangeEnd,css('--range-end','#f0c36a'));
    x.strokeStyle='#fff';x.lineWidth=2;const n=xp((el.audio.currentTime||0)*1000);x.beginPath();x.moveTo(n,0);x.lineTo(n,h);x.stroke();
  }
  function drawAll(){drawTimeline();drawOverview();}
  function frame(){
    const ms=(el.audio.currentTime||0)*1000; el.timeDisplay.textContent=fmt(ms);
    if(!isSeeking&&Number.isFinite(el.audio.duration))el.seekBar.value=String(el.audio.currentTime||0);
    const on=kiaiAt(ms);el.kiaiBadge.textContent=on?'KIAI ON':'KIAI OFF';el.kiaiBadge.classList.toggle('on',on);drawAll();raf=requestAnimationFrame(frame);
  }
  function clamp(v){return Number.isFinite(el.audio.duration)?Math.min(Math.max(v,0),el.audio.duration):0;}

  el.oszInput.addEventListener('change',async e=>{const f=e.target.files&&e.target.files[0];if(f)await handleOsz(f);e.target.value='';});
  el.difficultySelect.addEventListener('change',()=>loadMap(Number(el.difficultySelect.value)));
  el.playButton.addEventListener('click',async()=>{try{if(el.audio.paused){await ensureHs();await el.audio.play();}else el.audio.pause();}catch(e){error(e instanceof Error?e.message:'再生できませんでした。');}});
  el.audio.addEventListener('loadedmetadata',()=>{el.seekBar.max=String(el.audio.duration);el.durationDisplay.textContent=fmt(el.audio.duration*1000);drawAll();});
  el.audio.addEventListener('play',()=>{el.playButton.textContent='❚❚';if(hsBuffers.size)startScheduler();});
  el.audio.addEventListener('pause',()=>{el.playButton.textContent='▶';stopScheduler();});
  el.audio.addEventListener('ended',()=>{el.playButton.textContent='▶';stopScheduler();});
  el.audio.addEventListener('seeking',stopScheduler);
  el.audio.addEventListener('seeked',()=>{if(!el.audio.paused&&hsBuffers.size)startScheduler();});
  el.backButton.addEventListener('click',()=>{el.audio.currentTime=clamp(el.audio.currentTime-5);});
  el.forwardButton.addEventListener('click',()=>{el.audio.currentTime=clamp(el.audio.currentTime+5);});
  el.seekBar.addEventListener('pointerdown',()=>{isSeeking=true;});
  el.seekBar.addEventListener('pointerup',()=>{isSeeking=false;});
  el.seekBar.addEventListener('input',()=>{const v=Number(el.seekBar.value);if(Number.isFinite(v))el.audio.currentTime=clamp(v);});
  el.copyTimeButton.addEventListener('click',()=>copy(fmt((el.audio.currentTime||0)*1000),el.copyTimeButton));
  el.startMarkButton.addEventListener('click',()=>mark('start'));el.endMarkButton.addEventListener('click',()=>mark('end'));el.clearRangeButton.addEventListener('click',resetRange);
  el.purposeSelect.addEventListener('change',updateOutput);el.fadeSelect.addEventListener('change',updateOutput);
  el.copyOutputButton.addEventListener('click',()=>{if(!el.copyOutputButton.disabled)copy(outputText(),el.copyOutputButton);});
  el.timelineCanvas.addEventListener('pointerdown',e=>{if(!activeMap||!Number.isFinite(el.audio.duration))return;const r=el.timelineCanvas.getBoundingClientRect(),q=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width));el.audio.currentTime=clamp(el.audio.currentTime+(q-.5)*VIEW_MS/1000);});
  el.overviewCanvas.addEventListener('pointerdown',e=>{if(!activeMap||!Number.isFinite(el.audio.duration))return;const r=el.overviewCanvas.getBoundingClientRect(),q=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width));el.audio.currentTime=clamp(el.audio.duration*q);});
  window.addEventListener('resize',drawAll);window.addEventListener('orientationchange',drawAll);
  updateRange(); raf=requestAnimationFrame(frame);
  window.addEventListener('beforeunload',()=>{cancelAnimationFrame(raf);stopScheduler();if(audioUrl)URL.revokeObjectURL(audioUrl);if(audioCtx)audioCtx.close().catch(()=>{});});
})();
