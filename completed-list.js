(() => {
  'use strict';

  const sourcePanel = document.querySelector('.source-panel');
  const songLine = document.querySelector('.song-line');
  const outputPreview = document.getElementById('outputPreview');

  if (!sourcePanel || !songLine || !outputPreview) return;

  const box = document.createElement('section');
  box.className = 'workflow-completed';
  box.hidden = true;
  box.innerHTML = `
    <div class="workflow-completed-head">
      <span>COMPLETED</span>
      <strong>0</strong>
    </div>
    <div class="workflow-completed-list" role="list"></div>`;
  songLine.insertAdjacentElement('afterend', box);

  const count = box.querySelector('.workflow-completed-head strong');
  const list = box.querySelector('.workflow-completed-list');
  let observedQueueCount = 0;

  function parseCurrent() {
    const text = outputPreview.textContent || '';
    const title = text.match(/\*\*曲名：(.+?)\*\*/)?.[1]?.trim() || 'Untitled';
    const difficulty = text.match(/難易度：\*\*(.+?)\*\*/)?.[1]?.trim() || 'Unknown';
    return { title, difficulty };
  }

  function addCompleted() {
    const { title, difficulty } = parseCurrent();
    const item = document.createElement('div');
    item.className = 'workflow-completed-item';
    item.setAttribute('role', 'listitem');

    const mark = document.createElement('span');
    mark.className = 'workflow-completed-check';
    mark.textContent = '✓';

    const text = document.createElement('span');
    text.className = 'workflow-completed-text';

    const titleNode = document.createElement('strong');
    titleNode.textContent = title;
    const diffNode = document.createElement('small');
    diffNode.textContent = difficulty;

    text.append(titleNode, diffNode);
    item.append(mark, text);
    list.appendChild(item);

    box.hidden = false;
    count.textContent = String(list.children.length);
    list.scrollTop = list.scrollHeight;
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('.workflow-queue-button.decide');
    if (!button || button.disabled) return;

    const before = Number(document.querySelector('.workflow-queue-count')?.textContent.match(/\d+/)?.[0] || observedQueueCount);
    setTimeout(() => {
      const after = Number(document.querySelector('.workflow-queue-count')?.textContent.match(/\d+/)?.[0] || before);
      if (after > Math.max(before, observedQueueCount)) addCompleted();
      observedQueueCount = Math.max(observedQueueCount, after);
    }, 0);
  });
})();
