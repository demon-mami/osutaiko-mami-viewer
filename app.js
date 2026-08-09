(() => {
  'use strict';

  const SPANS = [3000, 6000, 12000, 24000];
  const HS_FILES = {
    'normal:hitnormal':'./hitsounds/taiko-normal-hitnormal.wav',
    'normal:hitclap':'./hitsounds/taiko-normal-hitclap.wav',
    'normal:hitfinish':'./hitsounds/taiko-normal-hitfinish.wav',
    'normal:hitwhistle':'./hitsounds/taiko-normal-hitwhistle.wav',
    'soft:hitnormal':'./hitsounds/taiko-soft-hitnormal.wav',
    'soft:hitclap':'./hitsounds/taiko-soft-hitclap.wav',
    'soft:hitfinish':'./hitsounds/taiko-soft-hitfinish.wav',
    'soft:hitwhistle':'./hitsounds/taiko-soft-hitwhistle.wav'
  };
  const $ = id => document.getElementById(id);
  const el = {
    oszInput:$('oszInput'), fileName:$('fileName'), statusBadge:$('statusBadge'),
    difficultySelect:$('difficultySelect'), songTitle:$('songTitle'), songMeta:$('songMeta'),
    timeDisplay:$('timeDisplay'), durationDisplay:$('durationDisplay'), copyTimeButton:$('copyTimeButton'),
    prevHitButton:$('prevHitButton'), backButton:$('backButton'), playButton:$('playButton'),
    forwardButton:$('forwardButton'), nextHitButton:$('nextHitButton'), seekBar:$('seekBar'), audio:$('audio'),
    startMarkButton:$('startMarkButton'), endMarkButton:$('endMarkButton'), clearRangeButton:$('clearRangeButton'),
    zoomOutButton:$('zoomOutButton'), zoomInButton:$('zoomInButton'), zoomLabel:$('zoomLabel'),
    timelineCanvas:$('timelineCanvas'), overviewCanvas:$('overviewCanvas'), kiaiBadge:$('kiaiBadge'),
    purposeSelect:$('purposeSelect'), fadeSelect:$('fadeSelect'), outputPreview:$('outputPreview'), copyOutputButton:$('copyOutputButton'),
    errorCard:$('errorCard'), errorMessage:$('errorMessage')
  };

  let zip=null, maps=[], map=null, audioUrl=null, loadedAudio='', start=null, end=null;
  let zoom=1, ready=false, seeking=false, raf=0, timelineDrag=null, overviewDrag=null;
  let ac=null, mediaNode=null, hsBuffers=new Map(), hsLoad=null, hsTimer=null, nextHit=0, lastMedia=null;
  const scheduled=new Set();

  const status=t=>{ el.statusBadge.textContent=t; };
  const fail=m=>{ el.errorMessage.textContent=m; el.errorCard.hidden=false; status('エラー'); };
  const clearError=()=>{ el.errorCard.hidden=true; el.errorMessage.textContent=''; };
  const fmt=ms=>{ ms=Math.max(0,Math.floor(Number.isFinite(ms)?ms:0)); const m=Math.floor(ms/60000),s=Math.floor((ms%60000)/1000),z=ms%1000; return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}:${String(z).padStart(3,'0')}`; };
  const fmtOut=ms=>{ const q=Math.max(0,Math.floor((Number.isFinite(ms)?ms:0)/1000)); const h=Math.floor(q/3600),m=Math.floor((q%3600)/60),s=q%60; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; };
  const validRange=()=>!!(start&&end&&end.time>=start.time);
  const span=()=>SPANS[zoom];
  const css=(n,d)=>getComputedStyle(document.documentElement).getPropertyValue(n).trim()||d;

  function updateZoom(){
    const half=span()/2000;
    el.zoomLabel.textContent=`±${Number.isInteger(half)?half.toFixed(0):half.toFixed(1)}s`;
    el.zoomInButton.disabled=!ready||zoom===0;
    el.zoomOutButton.disabled=!ready||zoom===SPANS.length-1;
  }
  function outputText(){
    if(!map) return '**曲名：—**\n用途：—\n難易度：**—**\n区間：—（Fade-in/out：含まない）';
    const title=map.metadata.TitleUnicode||map.metadata.Title||'Untitled';
    const diff=map.metadata.Version||'Unknown';
    const purpose=el.purposeSelect.value||'未選択';
    const fade=el.fadeSelect.value||'含まない';
    const range=validRange()?`${fmtOut(start.time)}～${fmtOut(end.time)}`:(start&&end?'ENDがSTARTより前です':'未選択');
    return `**曲名：${title}**\n用途：${purpose}\n難易度：**${diff}**\n区間：${range}（Fade-in/out：${fade}）`;
  }
  function updateOutput(){
    el.outputPreview.textContent=outputText();
    el.copyOutputButton.disabled=!(map&&el.purposeSelect.value&&validRange());
  }
  function updateRange(){
    el.startMarkButton.classList.toggle('marked',!!start); el.endMarkButton.classList.toggle('marked',!!end);
    el.startMarkButton.textContent=start?'START ✓':'START'; el.endMarkButton.textContent=end?'END ✓':'END';
    el.clearRangeButton.disabled=!(start||end); updateOutput(); drawAll();
  }
  function resetRange(){ start=null; end=null; updateRange(); }
  function mark(which){ if(!map||!Number.isFinite(el.audio.duration)) return; const p={time:Math.max(0,Math.round((el.audio.currentTime||0)*1000))}; if(which==='start')start=p;else end=p; updateRange(); }
  async function copy(text,button){
    if(!text)return;
    try{
      if(navigator.clipboard&&window.isSecureContext) await navigator.clipboard.writeText(text);
      else{ const ta=document.createElement('textarea');ta.value=text;ta.readOnly=true;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();if(!document.execCommand('copy'))throw new Error();ta.remove(); }
      if(button){const old=button.textContent;button.textContent='COPIED';setTimeout(()=>button.textContent=old,800);}
    }catch{fail(`コピーできませんでした。\n${text}`);}
  }

  function kv(line){const i=line.indexOf(':');return i<0?null:[line.slice(0,i).trim(),line.slice(i+1).trim()];}
  function hitSample(raw){const f=String(raw||'').split(':');return{normalSet:+f[0]||0,additionSet:+f[1]||0,volume:+f[3]||0};}
  function generalSet(v){v=String(v||'').toLowerCase();return v==='soft'?2:v==='drum'?3:1;}
  function timingAt(arr,t){let lo=0,hi=arr.length;while(lo<hi){const m=(lo+hi)>>1;if(arr[m].time<=t)lo=m+1;else hi=m;}return lo?arr[lo-1]:null;}
  function enrich(m){
    const gs=generalSet(m.general.SampleSet);
    for(const h of m.hits){const tp=timingAt(m.timingPoints,h.time),ts=tp&&tp.sampleSet?tp.sampleSet:gs,hs=h.hitSample,set=(h.sampleName==='hitnormal'?hs.normalSet:hs.additionSet)||ts||gs;h.family=set===2?'soft':'normal';h.volume=Math.max(0,Math.min(100,hs.volume||(tp?tp.volume:100)||100));}
  }
  function parseOsu(text,fileName){
    const m={fileName,general:{},metadata:{},difficulty:{},timingPoints:[],hits:[],mode:-1};let sec='';
    text.replace(/^\uFEFF/,'').split(/\r?\n/).forEach((raw,order)=>{
      const line=raw.trim();if(!line||line.startsWith('//'))return;
      if(line[0]==='['&&line.endsWith(']')){sec=line;return;}
      if(sec==='[General]'||sec==='[Metadata]'||sec==='[Difficulty]'){const p=kv(line);if(!p)return;const[k,v]=p;(sec==='[General]'?m.general:sec==='[Metadata]'?m.metadata:m.difficulty)[k]=v;return;}
      if(sec==='[TimingPoints]'){
        const f=line.split(',');if(f.length<8)return;const time=+f[0],beatLength=+f[1],meter=parseInt(f[2],10)||4,sampleSet=parseInt(f[3],10)||0,volume=parseInt(f[5],10),uninherited=parseInt(f[6],10)||0,effects=parseInt(f[7],10)||0;
        if(Number.isFinite(time))m.timingPoints.push({time,beatLength:Number.isFinite(beatLength)?beatLength:0,meter,sampleSet,volume:Number.isFinite(volume)?volume:100,uninherited,effects,order});return;
      }
      if(sec==='[HitObjects]'){
        const f=line.split(',');if(f.length<5)return;const time=parseInt(f[2],10),type=parseInt(f[3],10)||0,sound=parseInt(f[4],10)||0;if(!Number.isFinite(time)||(type&1)===0)return;
        const ka=(sound&(2|8))!==0,big=(sound&4)!==0;let sampleName='hitnormal';if(ka&&big)sampleName='hitwhistle';else if(ka)sampleName='hitclap';else if(big)sampleName='hitfinish';
        m.hits.push({time,kind:ka?'ka':'don',big,sampleName,hitSample:hitSample(f[5]||''),family:'normal',volume:100});
      }
    });
    m.mode=parseInt(m.general.Mode??'-1',10);m.timingPoints.sort((a,b)=>a.time-b.time||a.order-b.order);m.hits.sort((a,b)=>a.time-b.time);enrich(m);return m;
  }
  function kiaiIntervals(){
    if(!map)return[];const out=[];let on=false,s=null;
    for(const tp of map.timingPoints){const n=(tp.effects&1)!==0;if(n===on)continue;if(on&&s!==null&&tp.time>s)out.push({start:s,end:tp.time});on=n;s=n?tp.time:null;}
    if(on&&s!==null)out.push({start:s,end:Number.isFinite(el.audio.duration)?el.audio.duration*1000:Infinity});return out;
  }
  const kiaiAt=t=>kiaiIntervals().some(k=>t>=k.start&&t<k.end);
  const norm=n=>String(n||'').replace(/\\/g,'/').replace(/^\.\//,'').toLowerCase();
  function zipFile(name){if(!zip||!name)return null;return zip.file(name)||Object.values(zip.files).find(e=>!e.dir&&norm(e.name)===norm(name))||null;}
  function mime(name){const x=String(name).split('.').pop().toLowerCase();return x==='mp3'?'audio/mpeg':x==='ogg'||x==='oga'?'audio/ogg':x==='wav'?'audio/wav':x==='m4a'?'audio/mp4':'application/octet-stream';}

  async function ensureAudio(){
    const C=window.AudioContext||window.webkitAudioContext;if(!C)throw new Error('Web Audio APIに対応していません。');
    if(!ac){ac=new C({latencyHint:'interactive'});mediaNode=ac.createMediaElementSource(el.audio);mediaNode.connect(ac.destination);}if(ac.state==='suspended')await ac.resume();
    if(!hsLoad)hsLoad=(async()=>{const rows=await Promise.all(Object.entries(HS_FILES).map(async([k,u])=>{const r=await fetch(u,{cache:'force-cache'});if(!r.ok)throw new Error(`ヒットサウンドを読み込めません: ${u}`);return[k,await ac.decodeAudioData((await r.arrayBuffer()).slice(0))];}));hsBuffers=new Map(rows);})();
    await hsLoad;
  }
  function lower(t){let lo=0,hi=map?map.hits.length:0;while(lo<hi){const m=(lo+hi)>>1;if(map.hits[m].time<t)lo=m+1;else hi=m;}return lo;}
  function stopScheduled(){for(const s of scheduled){try{s.stop();}catch{}}scheduled.clear();}
  function resetScheduler(){nextHit=map?lower((el.audio.currentTime||0)*1000-8):0;lastMedia=el.audio.currentTime||0;}
  function schedule(h,when){const b=hsBuffers.get(`${h.family}:${h.sampleName}`)||hsBuffers.get(`normal:${h.sampleName}`);if(!b)return;const s=ac.createBufferSource(),g=ac.createGain();s.buffer=b;g.gain.value=h.volume/100;s.connect(g);g.connect(ac.destination);scheduled.add(s);s.onended=()=>scheduled.delete(s);s.start(when);}
  function tickHs(){
    if(!map||!ac||el.audio.paused||!hsBuffers.size)return;const now=el.audio.currentTime||0;if(lastMedia!==null&&Math.abs(now-lastMedia)>.35){stopScheduled();resetScheduler();}
    const horizon=now+.18;while(nextHit<map.hits.length){const h=map.hits[nextHit],sec=h.time/1000;if(sec>horizon)break;if(sec>=now-.008)schedule(h,ac.currentTime+Math.max(.004,sec-now));nextHit++;}lastMedia=now;
  }
  function startHs(){stopHs();resetScheduler();tickHs();hsTimer=setInterval(tickHs,25);}
  function stopHs(){if(hsTimer){clearInterval(hsTimer);hsTimer=null;}stopScheduled();lastMedia=null;}

  async function loadAudio(m){
    const name=m.general.AudioFilename;if(!name)throw new Error('AudioFilenameがありません。');
    if(loadedAudio===norm(name)&&el.audio.src){el.audio.currentTime=0;return;}
    const entry=zipFile(name);if(!entry)throw new Error(`OSZ内で音源を見つけられません: ${name}`);el.audio.pause();if(audioUrl)URL.revokeObjectURL(audioUrl);
    const raw=await entry.async('blob');audioUrl=URL.createObjectURL(new Blob([raw],{type:mime(name)}));loadedAudio=norm(name);el.audio.src=audioUrl;el.audio.load();
    await new Promise((ok,ng)=>{const a=()=>{clean();ok();},b=()=>{clean();ng(new Error('音源をブラウザで読み込めませんでした。'));},clean=()=>{el.audio.removeEventListener('loadedmetadata',a);el.audio.removeEventListener('error',b);};el.audio.addEventListener('loadedmetadata',a,{once:true});el.audio.addEventListener('error',b,{once:true});});
  }
  function controls(v){
    ready=v;for(const x of [el.playButton,el.backButton,el.forwardButton,el.seekBar,el.copyTimeButton,el.startMarkButton,el.endMarkButton])x.disabled=!v;
    el.prevHitButton.disabled=!v||!map||!map.hits.length;el.nextHitButton.disabled=!v||!map||!map.hits.length;if(!v)el.clearRangeButton.disabled=true;updateZoom();updateOutput();
  }
  async function useMap(i){
    clearError();stopHs();map=maps[i];if(!map)return;resetRange();status('音源読込中');controls(false);
    try{await loadAudio(map);const title=map.metadata.TitleUnicode||map.metadata.Title||'Untitled',artist=map.metadata.ArtistUnicode||map.metadata.Artist||'Unknown artist';el.songTitle.textContent=`${artist} - ${title}`;el.songMeta.textContent=`${map.hits.length} hits`;const d=Number.isFinite(el.audio.duration)?el.audio.duration:0;el.seekBar.max=String(d);el.seekBar.value='0';el.durationDisplay.textContent=fmt(d*1000);el.timeDisplay.textContent='00:00:000';controls(true);status('準備完了');drawAll();}catch(e){fail(e instanceof Error?e.message:String(e));}
  }
  async function loadOsz(file){
    clearError();if(!file||!/\.osz$/i.test(file.name||'')){fail('.osz / .OSZ ファイルを選択してください。');return;}if(!window.JSZip){fail('JSZipを読み込めません。');return;}
    el.purposeSelect.value='';el.fadeSelect.value='含まない';zoom=1;stopHs();el.audio.pause();map=null;resetRange();status('OSZ解析中');controls(false);el.difficultySelect.disabled=true;el.fileName.textContent=file.name;
    try{zip=await JSZip.loadAsync(file);const entries=Object.values(zip.files).filter(e=>!e.dir&&/\.osu$/i.test(e.name));if(!entries.length)throw new Error('OSZ内に .osu がありません。');const parsed=[];for(const e of entries)parsed.push(parseOsu(await e.async('string'),e.name));const taiko=parsed.filter(m=>m.mode===1);maps=taiko.length?taiko:parsed;if(!maps.length)throw new Error('表示できる譜面がありません。');el.difficultySelect.innerHTML='';maps.forEach((m,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=`${m.metadata.Version||m.fileName} — ${m.hits.length} hits`;el.difficultySelect.appendChild(o);});el.difficultySelect.disabled=false;await useMap(0);}catch(e){fail(e instanceof Error?e.message:String(e));}
  }

  function canvas(c){const r=c.getBoundingClientRect(),d=Math.max(1,window.devicePixelRatio||1),w=Math.max(1,Math.round(r.width*d)),h=Math.max(1,Math.round(r.height*d));if(c.width!==w||c.height!==h){c.width=w;c.height=h;}const x=c.getContext('2d');x.setTransform(d,0,0,d,0,0);return{x,w:r.width,h:r.height};}
  function redPoints(){return map?map.timingPoints.filter(t=>t.uninherited===1&&t.beatLength>0):[];}
  function beatGrid(x,left,right,xp,w,h){
    const pts=redPoints();for(let i=0;i<pts.length;i++){const p=pts[i],next=pts[i+1],a=Math.max(left,p.time),b=Math.min(right,next?next.time:right);if(b<=a)continue;const beat=p.beatLength,meter=Math.max(1,p.meter||4),pxBeat=beat/span()*w,step=pxBeat<7?Math.ceil(7/Math.max(1,pxBeat)):1;let n=Math.ceil((a-p.time)/beat),last=Math.floor((b-p.time)/beat);for(;n<=last;n+=step){const t=p.time+n*beat;if(t<left||t>right)continue;const measure=((n%meter)+meter)%meter===0;x.strokeStyle=measure?'rgba(255,255,255,.18)':'rgba(255,255,255,.07)';x.lineWidth=measure?1.2:1;x.beginPath();x.moveTo(xp(t),0);x.lineTo(xp(t),h);x.stroke();}}
  }
  function drawTimeline(){
    const {x,w,h}=canvas(el.timelineCanvas);x.clearRect(0,0,w,h);x.fillStyle='#101015';x.fillRect(0,0,w,h);if(!map)return;
    const now=(el.audio.currentTime||0)*1000,S=span(),left=now-S/2,right=now+S/2,xp=t=>(t-left)/S*w;
    x.fillStyle='rgba(242,209,111,.16)';for(const k of kiaiIntervals()){const a=Math.max(left,k.start),b=Math.min(right,k.end);if(b>a)x.fillRect(xp(a),0,xp(b)-xp(a),h);}
    if(validRange()){const a=Math.max(left,start.time),b=Math.min(right,end.time);if(b>a){x.fillStyle='rgba(233,101,165,.07)';x.fillRect(xp(a),0,xp(b)-xp(a),h);}}
    beatGrid(x,left,right,xp,w,h);
    const y=Math.round(h*.50);x.strokeStyle='rgba(255,255,255,.12)';x.beginPath();x.moveTo(0,y);x.lineTo(w,y);x.stroke();
    const begin=lower(left),don=css('--don','#ef6862'),ka=css('--ka','#69bde0');for(let i=begin;i<map.hits.length;i++){const q=map.hits[i];if(q.time>right)break;const px=xp(q.time),c=q.kind==='ka'?ka:don,r=q.big?7:4.5;x.fillStyle=c;x.strokeStyle=c;x.lineWidth=q.big?2.2:1;x.beginPath();x.arc(px,y,r,0,Math.PI*2);if(q.big){x.globalAlpha=.22;x.fill();x.globalAlpha=1;x.stroke();x.beginPath();x.arc(px,y,3.2,0,Math.PI*2);x.stroke();}else x.fill();}
    const marker=(p,label,c)=>{if(!p||p.time<left||p.time>right)return;const px=xp(p.time);x.save();x.strokeStyle=c;x.fillStyle=c;x.lineWidth=1.5;x.setLineDash([4,3]);x.beginPath();x.moveTo(px,0);x.lineTo(px,h);x.stroke();x.setLineDash([]);x.font='800 8px sans-serif';x.textAlign=px>w-40?'right':'left';x.textBaseline='top';x.fillText(label,px>w-40?px-3:px+3,3);x.restore();};marker(start,'START',css('--range-start','#68d39a'));marker(end,'END',css('--range-end','#f3b55d'));
    const c=w/2;x.strokeStyle='rgba(255,255,255,.96)';x.lineWidth=1.1;[-2,2].forEach(o=>{x.beginPath();x.moveTo(c+o,0);x.lineTo(c+o,h);x.stroke();});x.fillStyle='rgba(255,255,255,.64)';x.font='9px ui-monospace,monospace';x.textAlign='center';x.textBaseline='bottom';x.fillText(fmt(now),c,h-3);
  }
  function drawOverview(){
    const {x,w,h}=canvas(el.overviewCanvas);x.clearRect(0,0,w,h);x.fillStyle='#101015';x.fillRect(0,0,w,h);if(!map||!Number.isFinite(el.audio.duration)||el.audio.duration<=0)return;const dur=el.audio.duration*1000,xp=t=>Math.max(0,Math.min(w,t/dur*w));
    x.fillStyle='rgba(242,209,111,.30)';for(const k of kiaiIntervals())x.fillRect(xp(k.start),0,Math.max(1,xp(Number.isFinite(k.end)?k.end:dur)-xp(k.start)),h);
    if(validRange()){x.fillStyle='rgba(233,101,165,.15)';x.fillRect(xp(start.time),0,Math.max(1,xp(end.time)-xp(start.time)),h);}
    const mk=(p,c)=>{if(!p)return;const q=xp(p.time);x.strokeStyle=c;x.lineWidth=1.5;x.beginPath();x.moveTo(q,0);x.lineTo(q,h);x.stroke();};mk(start,css('--range-start','#68d39a'));mk(end,css('--range-end','#f3b55d'));const now=xp((el.audio.currentTime||0)*1000);x.strokeStyle='#fff';x.lineWidth=1.5;x.beginPath();x.moveTo(now,0);x.lineTo(now,h);x.stroke();
  }
  const drawAll=()=>{drawTimeline();drawOverview();};
  function frame(){const ms=(el.audio.currentTime||0)*1000;el.timeDisplay.textContent=fmt(ms);if(!seeking&&Number.isFinite(el.audio.duration))el.seekBar.value=String(el.audio.currentTime||0);const on=map?kiaiAt(ms):false;el.kiaiBadge.textContent=on?'KIAI ON':'KIAI OFF';el.kiaiBadge.classList.toggle('on',on);drawAll();raf=requestAnimationFrame(frame);}
  const clamp=s=>Number.isFinite(el.audio.duration)?Math.min(Math.max(s,0),el.audio.duration):0;
  function jumpHit(dir){if(!map||!map.hits.length||!Number.isFinite(el.audio.duration))return;const now=(el.audio.currentTime||0)*1000;let i=dir<0?lower(now-1)-1:lower(now+1);i=Math.max(0,Math.min(map.hits.length-1,i));el.audio.currentTime=clamp(map.hits[i].time/1000);}
  function seekTimeline(e,anchor){const r=el.timelineCanvas.getBoundingClientRect(),q=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width));el.audio.currentTime=clamp((anchor+(q-.5)*span())/1000);}
  function seekOverview(e){const r=el.overviewCanvas.getBoundingClientRect(),q=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width));el.audio.currentTime=clamp(el.audio.duration*q);}

  el.oszInput.addEventListener('change',async e=>{const f=e.target.files&&e.target.files[0];if(f)await loadOsz(f);e.target.value='';});
  el.difficultySelect.addEventListener('change',()=>{el.audio.pause();useMap(+el.difficultySelect.value);});
  el.playButton.addEventListener('click',async()=>{try{if(el.audio.paused){await ensureAudio();await el.audio.play();}else el.audio.pause();}catch(e){fail(e instanceof Error?e.message:'再生できませんでした。');}});
  el.audio.addEventListener('play',()=>{el.playButton.textContent='❚❚';if(hsBuffers.size)startHs();});el.audio.addEventListener('pause',()=>{el.playButton.textContent='▶';stopHs();});el.audio.addEventListener('ended',()=>{el.playButton.textContent='▶';stopHs();});el.audio.addEventListener('seeking',stopHs);el.audio.addEventListener('seeked',()=>{if(!el.audio.paused&&hsBuffers.size)startHs();});
  el.backButton.addEventListener('click',()=>el.audio.currentTime=clamp(el.audio.currentTime-5));el.forwardButton.addEventListener('click',()=>el.audio.currentTime=clamp(el.audio.currentTime+5));el.prevHitButton.addEventListener('click',()=>jumpHit(-1));el.nextHitButton.addEventListener('click',()=>jumpHit(1));
  el.zoomOutButton.addEventListener('click',()=>{zoom=Math.min(SPANS.length-1,zoom+1);updateZoom();drawTimeline();});el.zoomInButton.addEventListener('click',()=>{zoom=Math.max(0,zoom-1);updateZoom();drawTimeline();});
  el.seekBar.addEventListener('pointerdown',()=>seeking=true);el.seekBar.addEventListener('pointerup',()=>seeking=false);el.seekBar.addEventListener('input',()=>{const v=+el.seekBar.value;if(Number.isFinite(v))el.audio.currentTime=clamp(v);});
  el.copyTimeButton.addEventListener('click',()=>copy(fmt((el.audio.currentTime||0)*1000)));el.startMarkButton.addEventListener('click',()=>mark('start'));el.endMarkButton.addEventListener('click',()=>mark('end'));el.clearRangeButton.addEventListener('click',resetRange);el.purposeSelect.addEventListener('change',updateOutput);el.fadeSelect.addEventListener('change',updateOutput);el.copyOutputButton.addEventListener('click',()=>copy(outputText(),el.copyOutputButton));
  el.timelineCanvas.addEventListener('pointerdown',e=>{if(!map||!Number.isFinite(el.audio.duration))return;timelineDrag={id:e.pointerId,anchor:(el.audio.currentTime||0)*1000};el.timelineCanvas.setPointerCapture?.(e.pointerId);seekTimeline(e,timelineDrag.anchor);});el.timelineCanvas.addEventListener('pointermove',e=>{if(timelineDrag&&timelineDrag.id===e.pointerId)seekTimeline(e,timelineDrag.anchor);});['pointerup','pointercancel'].forEach(n=>el.timelineCanvas.addEventListener(n,e=>{if(timelineDrag&&timelineDrag.id===e.pointerId)timelineDrag=null;}));
  el.overviewCanvas.addEventListener('pointerdown',e=>{if(!map||!Number.isFinite(el.audio.duration))return;overviewDrag=e.pointerId;el.overviewCanvas.setPointerCapture?.(e.pointerId);seekOverview(e);});el.overviewCanvas.addEventListener('pointermove',e=>{if(overviewDrag===e.pointerId)seekOverview(e);});['pointerup','pointercancel'].forEach(n=>el.overviewCanvas.addEventListener(n,e=>{if(overviewDrag===e.pointerId)overviewDrag=null;}));
  window.addEventListener('resize',drawAll);window.addEventListener('orientationchange',drawAll);updateZoom();updateRange();raf=requestAnimationFrame(frame);window.addEventListener('beforeunload',()=>{cancelAnimationFrame(raf);stopHs();if(audioUrl)URL.revokeObjectURL(audioUrl);if(ac)ac.close().catch(()=>{});});
})();
