(() => {
  'use strict';

  const copyButton = document.getElementById('copyOutputButton');
  const outputPreview = document.getElementById('outputPreview');
  const actions = document.querySelector('.workflow-queue-actions');
  const exportButton = actions?.querySelector('.export');
  const parking = document.querySelector('.copy-parking');

  const grid = document.querySelector('.editor-control-grid');
  const seek = document.getElementById('seekBar');
  const backButton = document.getElementById('backButton');
  const forwardButton = document.getElementById('forwardButton');
  const startButton = document.getElementById('startMarkButton');
  const endButton = document.getElementById('endMarkButton');
  const input = document.getElementById('oszInput');
  const diff = document.getElementById('difficultySelect');

  if (copyButton && actions && exportButton) {
    copyButton.textContent = 'Copy';
    actions.insertBefore(copyButton, exportButton);
    parking?.remove();
  }

  let normalizing = false;
  function normalizedText() {
    if (!outputPreview) return '';
    return (outputPreview.textContent || '').replace(/(^|\n)用途：/g, '$1Type：');
  }

  function normalizePreview() {
    if (!outputPreview || normalizing) return;
    const next = normalizedText();
    if (next === outputPreview.textContent) return;
    normalizing = true;
    outputPreview.textContent = next;
    normalizing = false;
  }

  if (outputPreview) {
    normalizePreview();
    new MutationObserver(normalizePreview).observe(outputPreview, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.readOnly = true;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('copy failed');
  }

  copyButton?.addEventListener('click', async event => {
    if (copyButton.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      await copyText(normalizedText());
      copyButton.textContent = 'Copied';
      setTimeout(() => { copyButton.textContent = 'Copy'; }, 700);
    } catch {
      copyButton.textContent = 'Copy';
    }
  }, true);

  // Route all auxiliary jumps through the existing seek input/change path.
  function seekThroughCore(targetSec) {
    if (!seek || seek.disabled || !Number.isFinite(targetSec)) return;
    const max = Number(seek.max);
    const target = Math.max(0, Number.isFinite(max) && max > 0 ? Math.min(targetSec, max) : targetSec);
    seek.value = String(target);
    seek.dispatchEvent(new Event('input', { bubbles: true }));
    seek.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Keep the established ±5 second transport while using the same core seek path.
  if (backButton) backButton.textContent = '−5s';
  if (forwardButton) forwardButton.textContent = '+5s';

  backButton?.addEventListener('click', event => {
    if (backButton.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    seekThroughCore((Number(seek?.value) || 0) - 5);
  }, true);

  forwardButton?.addEventListener('click', event => {
    if (forwardButton.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    seekThroughCore((Number(seek?.value) || 0) + 5);
  }, true);

  let v1Sec = null;
  let v2Sec = null;

  const jumps = document.createElement('div');
  jumps.className = 'mark-jumps';
  jumps.setAttribute('aria-label', 'V1 V2へ移動');
  jumps.innerHTML = `
    <button type="button" class="mark-jump-button v1" aria-label="V1へ移動" disabled>←</button>
    <button type="button" class="mark-jump-button v2" aria-label="V2へ移動" disabled>→</button>`;
  grid?.appendChild(jumps);

  const jumpV1 = jumps.querySelector('.v1');
  const jumpV2 = jumps.querySelector('.v2');

  function updateJumpButtons() {
    jumpV1.disabled = !Number.isFinite(v1Sec) || !startButton?.classList.contains('marked');
    jumpV2.disabled = !Number.isFinite(v2Sec) || !endButton?.classList.contains('marked');
  }

  function recordMark(which) {
    const button = which === 'v1' ? startButton : endButton;
    if (!button?.classList.contains('marked')) {
      if (which === 'v1') v1Sec = null;
      else v2Sec = null;
      updateJumpButtons();
      return;
    }
    const value = Number(seek?.value);
    if (Number.isFinite(value)) {
      if (which === 'v1') v1Sec = value;
      else v2Sec = value;
    }
    updateJumpButtons();
  }

  // app-v4 registered its click handlers first, so these run after mark state is updated.
  startButton?.addEventListener('click', () => recordMark('v1'));
  endButton?.addEventListener('click', () => recordMark('v2'));

  jumpV1.addEventListener('click', () => seekThroughCore(v1Sec));
  jumpV2.addEventListener('click', () => seekThroughCore(v2Sec));

  const resetStoredMarks = () => {
    v1Sec = null;
    v2Sec = null;
    updateJumpButtons();
  };
  input?.addEventListener('change', () => setTimeout(resetStoredMarks, 0));
  diff?.addEventListener('change', () => setTimeout(resetStoredMarks, 0));

  [startButton, endButton].forEach(button => {
    if (!button) return;
    new MutationObserver(() => {
      if (button === startButton && !button.classList.contains('marked')) v1Sec = null;
      if (button === endButton && !button.classList.contains('marked')) v2Sec = null;
      updateJumpButtons();
    }).observe(button, { attributes: true, attributeFilter: ['class'] });
  });

  updateJumpButtons();
})();
