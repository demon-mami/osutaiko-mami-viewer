(() => {
  'use strict';

  // Safari/iOS: getOutputTimestamp().contextTime can advance in coarse steps.
  // Preserve its measured output-latency relationship, but expose a smooth
  // AudioContext.currentTime-based contextTime to the viewer's visual clock.
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    const proto = Context && Context.prototype;
    const nativeGetOutputTimestamp = proto && proto.getOutputTimestamp;
    if (typeof nativeGetOutputTimestamp === 'function') {
      const latencyByContext = new WeakMap();
      Object.defineProperty(proto, 'getOutputTimestamp', {
        configurable: true,
        writable: true,
        value: function smoothOutputTimestamp() {
          let raw = {};
          try { raw = nativeGetOutputTimestamp.call(this) || {}; } catch {}
          const now = Number(this.currentTime) || 0;
          let estimate = latencyByContext.get(this);

          if (Number.isFinite(raw.contextTime) && raw.contextTime >= 0) {
            const sample = Math.max(0, now - raw.contextTime);
            if (sample < 1) {
              estimate = Number.isFinite(estimate)
                ? estimate * 0.94 + sample * 0.06
                : sample;
            }
          }

          if (!Number.isFinite(estimate)) {
            estimate = Number.isFinite(this.outputLatency) ? Math.max(0, this.outputLatency) : 0;
          }

          latencyByContext.set(this, estimate);
          return {
            contextTime: Math.max(0, now - estimate),
            performanceTime: Number.isFinite(raw.performanceTime) ? raw.performanceTime : performance.now(),
          };
        },
      });
    }
  } catch {}

  const objectViewport = document.getElementById('timelineViewport');
  const objectStatic = document.getElementById('timelineStaticCanvas');
  const objectCursor = document.getElementById('timelineCursorCanvas');
  const songViewport = document.getElementById('overviewViewport');
  const songCursorCanvas = document.getElementById('overviewCursorCanvas');
  const seek = document.getElementById('seekBar');
  const timeButton = document.getElementById('copyTimeButton');

  if (!objectViewport || !objectStatic || !objectCursor || !songViewport || !seek) return;

  // The app already draws the song cursor on canvas. Replace that cursor visually
  // with a DOM playhead driven by the seek position so movement remains obvious.
  if (songCursorCanvas) songCursorCanvas.style.opacity = '0';

  const songPlayhead = document.createElement('div');
  songPlayhead.setAttribute('aria-hidden', 'true');
  songPlayhead.style.cssText = [
    'position:absolute',
    'top:0',
    'bottom:0',
    'width:2px',
    'background:rgba(255,255,255,.92)',
    'pointer-events:none',
    'z-index:4',
    'transform:translateX(-1px)',
  ].join(';');
  songViewport.appendChild(songPlayhead);

  const songHead = document.createElement('div');
  songHead.setAttribute('aria-hidden', 'true');
  songHead.style.cssText = [
    'position:absolute',
    'top:0',
    'width:0',
    'height:0',
    'border-left:4px solid transparent',
    'border-right:4px solid transparent',
    'border-top:6px solid rgba(255,255,255,.96)',
    'pointer-events:none',
    'z-index:5',
    'transform:translateX(-4px)',
  ].join(';');
  songViewport.appendChild(songHead);

  let previousObjectCursorX = null;
  let transitionTimer = 0;

  function readObjectCursorX() {
    const rect = objectCursor.getBoundingClientRect();
    if (rect.width <= 0 || objectCursor.width <= 0 || objectCursor.height <= 0) return null;
    const scale = objectCursor.width / rect.width;
    const row = Math.max(0, Math.min(objectCursor.height - 1, Math.round(12 * scale)));
    let data;
    try {
      data = objectCursor.getContext('2d', { willReadFrequently: true })
        .getImageData(0, row, objectCursor.width, 1).data;
    } catch {
      return null;
    }

    let sum = 0;
    let count = 0;
    for (let x = 0; x < objectCursor.width; x++) {
      const a = data[x * 4 + 3];
      if (a > 96) {
        sum += x;
        count++;
      }
    }
    return count ? (sum / count) / scale : null;
  }

  function softenObjectRebase() {
    const rect = objectViewport.getBoundingClientRect();
    const x = readObjectCursorX();
    if (!Number.isFinite(x) || rect.width <= 0) return;

    if (Number.isFinite(previousObjectCursorX)) {
      const delta = previousObjectCursorX - x;
      if (Math.abs(delta) > rect.width * 0.28 && Math.abs(delta) < rect.width * 0.85) {
        clearTimeout(transitionTimer);
        objectStatic.style.transition = 'none';
        objectStatic.style.transform = `translate3d(${delta}px,0,0)`;
        objectStatic.getBoundingClientRect();
        requestAnimationFrame(() => {
          objectStatic.style.transition = 'transform 180ms cubic-bezier(.2,.75,.25,1)';
          objectStatic.style.transform = 'translate3d(0,0,0)';
          transitionTimer = setTimeout(() => {
            objectStatic.style.transition = '';
            objectStatic.style.transform = '';
          }, 210);
        });
      }
    }
    previousObjectCursorX = x;
  }

  function moveSongPlayhead() {
    const duration = Number(seek.max);
    const position = Number(seek.value);
    const rect = songViewport.getBoundingClientRect();
    if (!(duration > 0) || !Number.isFinite(position) || rect.width <= 0) {
      songPlayhead.style.left = '0px';
      songHead.style.left = '0px';
      return;
    }

    const x = Math.max(0, Math.min(rect.width, position / duration * rect.width));
    songPlayhead.style.left = `${x}px`;
    songHead.style.left = `${x}px`;

    if (timeButton) {
      const buttonWidth = Math.max(58, timeButton.offsetWidth || 70);
      const labelX = Math.max(
        buttonWidth / 2 + 3,
        Math.min(rect.width - buttonWidth / 2 - 3, x)
      );
      timeButton.style.left = `${labelX}px`;
      timeButton.style.transform = 'translateX(-50%)';
    }
  }

  function frame() {
    softenObjectRebase();
    moveSongPlayhead();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
