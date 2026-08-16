(() => {
  'use strict';

  const donInput = document.getElementById('donHitsoundInput');
  const kaInput = document.getElementById('kaHitsoundInput');
  const donButton = document.getElementById('donHitsoundPreview');
  const kaButton = document.getElementById('kaHitsoundPreview');

  if (!donInput || !kaInput || !donButton || !kaButton) return;

  let ac = null;
  const buffers = new Map();
  let previewSource = null;
  let loadGeneration = { don: 0, ka: 0 };

  async function ensureContext() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error('Web Audio API unavailable');
    if (!ac) ac = new Context({ latencyHint: 'interactive' });
    if (ac.state === 'suspended') await ac.resume();
    return ac;
  }

  function buttonFor(kind) {
    return kind === 'ka' ? kaButton : donButton;
  }

  async function loadPreview(kind, file) {
    const button = buttonFor(kind);
    const generation = ++loadGeneration[kind];
    buffers.delete(kind);
    button.disabled = true;
    if (!file) return;

    try {
      const context = await ensureContext();
      const raw = await file.arrayBuffer();
      const decoded = await context.decodeAudioData(raw.slice(0));
      if (generation !== loadGeneration[kind]) return;
      buffers.set(kind, decoded);
      button.disabled = false;
    } catch {
      if (generation !== loadGeneration[kind]) return;
      buffers.delete(kind);
      button.disabled = true;
    }
  }

  async function playPreview(kind) {
    const buffer = buffers.get(kind);
    if (!buffer) return;

    const context = await ensureContext();
    if (previewSource) {
      try { previewSource.stop(); } catch {}
      try { previewSource.disconnect(); } catch {}
      previewSource = null;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => {
      if (previewSource === source) previewSource = null;
      try { source.disconnect(); } catch {}
    };
    previewSource = source;
    source.start();
  }

  donInput.addEventListener('change', event => {
    loadPreview('don', event.target.files?.[0] || null);
  });

  kaInput.addEventListener('change', event => {
    loadPreview('ka', event.target.files?.[0] || null);
  });

  donButton.addEventListener('click', () => playPreview('don'));
  kaButton.addEventListener('click', () => playPreview('ka'));

  window.addEventListener('beforeunload', () => {
    if (previewSource) {
      try { previewSource.stop(); } catch {}
      try { previewSource.disconnect(); } catch {}
    }
    if (ac) ac.close().catch(() => {});
  });
})();
