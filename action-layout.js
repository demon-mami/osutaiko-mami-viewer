(() => {
  'use strict';

  const copyButton = document.getElementById('copyOutputButton');
  const outputPreview = document.getElementById('outputPreview');
  const actions = document.querySelector('.workflow-queue-actions');
  const exportButton = actions?.querySelector('.export');
  const parking = document.querySelector('.copy-parking');

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
})();
