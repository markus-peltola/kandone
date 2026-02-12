const COLUMNS = [
  { id: 'backlog', title: 'Backlog', color: 'var(--col-backlog)' },
  { id: 'today', title: 'Today', color: 'var(--col-progress)' },
  { id: 'in-progress', title: 'In Progress', color: 'var(--col-review)' },
  { id: 'done', title: 'Done', color: 'var(--col-done)' }
];

const PRIORITIES = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };
const EFFORTS = { 0.5: 0, 1: 1, 2: 2, 4: 3, 8: 4 };
const SORT_FIELDS = [
  { id: 'due', label: 'Due Date' },
  { id: 'priority', label: 'Priority' },
  { id: 'effort', label: 'Effort (smallest first)' },
  { id: 'created', label: 'Date Created' },
  { id: 'title', label: 'Title (A-Z)' }
];

let data = {
  tasks: [],
  sortRules: [
    { field: 'due', dir: 'asc' },
    { field: 'priority', dir: 'asc' }
  ]
};

let fileHandle = null;
let dirty = false;
let editingId = null;
let showAllDone = false;
const DONE_DAYS = 30;
let columnTagFilters = {}; // { columnId: ['tag1', 'tag2'] }

// ── File System Access API ──

function hasFileAPI() {
  return 'showOpenFilePicker' in window;
}

async function openFile() {
  if (!hasFileAPI()) {
    // Fallback: standard file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        loadJSON(text);
        fileHandle = null;
        updateFileStatus(file.name + ' (read-only, use Save As)');
      } catch (err) {
        alert('Failed to read file: ' + err.message);
      }
    };
    input.click();
    return;
  }

  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
    });
    fileHandle = handle;
    storeHandle(handle);
    const file = await handle.getFile();
    const text = await file.text();
    loadJSON(text);
    autoSave();
    updateFileStatus(file.name);
  } catch (err) {
    if (err.name !== 'AbortError') alert('Open failed: ' + err.message);
  }
}

async function saveFile() {
  if (!fileHandle) return saveFileAs();

  try {
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
    dirty = false;
    updateFileStatus((await fileHandle.getFile()).name);
  } catch (err) {
    alert('Save failed: ' + err.message);
  }
}

async function saveFileAs() {
  if (!hasFileAPI()) {
    // Fallback: download
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'kanban-data.json';
    a.click();
    URL.revokeObjectURL(a.href);
    dirty = false;
    updateFileStatus('kanban-data.json (downloaded)');
    return;
  }

  try {
    fileHandle = await window.showSaveFilePicker({
      suggestedName: 'data.json',
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
    });
    storeHandle(fileHandle);
    await saveFile();
  } catch (err) {
    if (err.name !== 'AbortError') alert('Save failed: ' + err.message);
  }
}

// ── Auto-save (localStorage + debounced file write) ──

const STORAGE_KEY = 'kandone-data';
let saveTimer = null;

function autoSave() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  if (fileHandle) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveFile(), 500);
  }
}

// ── IndexedDB handle persistence ──

function storeHandle(handle) {
  const req = indexedDB.open('kandone', 1);
  req.onupgradeneeded = (e) => e.target.result.createObjectStore('handles');
  req.onsuccess = (e) => {
    const db = e.target.result;
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'file');
  };
}

async function restoreHandle() {
  return new Promise((resolve) => {
    const req = indexedDB.open('kandone', 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore('handles');
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('handles', 'readonly');
      const get = tx.objectStore('handles').get('file');
      get.onsuccess = () => resolve(get.result || null);
      get.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
}

// ── Data loading ──

function loadJSON(text) {
  try {
    const parsed = JSON.parse(text);
    // Support both old format (plain array) and new format (object with tasks)
    if (Array.isArray(parsed)) {
      data = { tasks: parsed, sortRules: data.sortRules };
    } else {
      data = { tasks: parsed.tasks || [], sortRules: parsed.sortRules || data.sortRules };
    }
    dirty = false;
    render();
    renderSortRules();
  } catch {
    alert('Invalid JSON file.');
  }
}

function updateFileStatus(name) {
  const el = document.getElementById('fileStatus');
  if (!name) {
    el.textContent = '✓ Auto-saved';
    el.className = 'file-status linked';
  } else if (dirty) {
    el.textContent = '● ' + name + ' (syncing)';
    el.className = 'file-status unsaved';
  } else {
    el.textContent = '✓ ' + name;
    el.className = 'file-status linked';
  }
}

function markDirty() {
  dirty = true;
  updateFileStatus(fileHandle ? fileHandle.name : null);
  autoSave();
}

// ── Sorting ──

function sortBacklog(tasks) {
  const rules = data.sortRules || [];
  if (!rules.length) return tasks;

  return [...tasks].sort((a, b) => {
    for (const rule of rules) {
      let cmp = 0;
      const dir = rule.dir === 'desc' ? -1 : 1;

      switch (rule.field) {
        case 'priority':
          cmp = (PRIORITIES[a.priority || 'none'] ?? 4) - (PRIORITIES[b.priority || 'none'] ?? 4);
          break;
        case 'due':
          const da = a.due || '9999-12-31',
            db = b.due || '9999-12-31';
          cmp = da.localeCompare(db);
          break;
        case 'effort':
          cmp = (EFFORTS[a.effort] ?? 99) - (EFFORTS[b.effort] ?? 99);
          break;
        case 'created':
          cmp = (a.created || 0) - (b.created || 0);
          break;
        case 'title':
          cmp = (a.title || '').localeCompare(b.title || '');
          break;
      }
      if (cmp !== 0) return cmp * dir;
    }
    return 0;
  });
}

function renderSortRules() {
  const container = document.getElementById('sortRules');
  container.innerHTML = '';
  (data.sortRules || []).forEach((rule, i) => {
    const div = document.createElement('div');
    div.className = 'sort-rule';
    div.innerHTML = `
      <select onchange="updateSortField(${i}, this.value)">
        ${SORT_FIELDS.map((f) => `<option value="${f.id}" ${f.id === rule.field ? 'selected' : ''}>${f.label}</option>`).join('')}
      </select>
      <select onchange="updateSortDir(${i}, this.value)">
        <option value="asc" ${rule.dir === 'asc' ? 'selected' : ''}>Asc</option>
        <option value="desc" ${rule.dir === 'desc' ? 'selected' : ''}>Desc</option>
      </select>
      <button class="sort-remove" onclick="removeSortRule(${i})">✕</button>
    `;
    container.appendChild(div);
  });
}

function addSortRule() {
  data.sortRules.push({ field: 'priority', dir: 'asc' });
  renderSortRules();
  markDirty();
  render();
}

function removeSortRule(i) {
  data.sortRules.splice(i, 1);
  renderSortRules();
  markDirty();
  render();
}

function updateSortField(i, val) {
  data.sortRules[i].field = val;
  markDirty();
  render();
}

function updateSortDir(i, val) {
  data.sortRules[i].dir = val;
  markDirty();
  render();
}

function toggleSettings() {
  document.getElementById('settingsPanel').classList.toggle('hidden');
}

// ── Tag filtering ──

function getAllTags() {
  const tags = new Set();
  data.tasks.forEach((t) => (t.tags || []).forEach((tag) => tags.add(tag)));
  return [...tags].sort((a, b) => a.localeCompare(b));
}

function toggleTagFilter(colId, tag) {
  if (!columnTagFilters[colId]) columnTagFilters[colId] = [];
  const idx = columnTagFilters[colId].indexOf(tag);
  if (idx >= 0) columnTagFilters[colId].splice(idx, 1);
  else columnTagFilters[colId].push(tag);
  render();
}

function clearTagFilters(colId) {
  delete columnTagFilters[colId];
  render();
}

// ── Rendering ──

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

DOMPurify.addHook('afterSanitizeAttributes', function (node) {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

function renderMarkdown(text) {
  if (!text) return '';
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') return esc(text);
  const rawHtml = marked.parse(text, { breaks: true });
  return DOMPurify.sanitize(rawHtml);
}

function formatDate(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

function dueBadge(due) {
  if (!due) return '';
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(due + 'T00:00:00');
  const diff = Math.floor((d - now) / 86400000);
  let cls = '';
  if (diff < 0) cls = 'overdue';
  else if (diff <= 3) cls = 'soon';

  const dayOfWeek = now.getDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;

  let label;
  if (diff < 0) label = `${-diff}d overdue`;
  else if (diff === 0) label = 'Today';
  else if (diff === 1) label = 'Tomorrow';
  else if (diff <= daysUntilSunday) label = 'This week';
  else if (diff <= daysUntilSunday + 7) label = 'Next week';
  else label = formatDate(due);

  const tooltip = diff >= 0 && diff > 1 ? ` title="${formatDate(due)}"` : '';
  return `<span class="due-badge ${cls}"${tooltip}>📅 ${label}</span>`;
}

function priBadge(pri) {
  if (!pri || pri === 'none') return '';
  const colors = { critical: 'var(--pri-critical)', high: 'var(--pri-high)', medium: 'var(--pri-medium)', low: 'var(--pri-low)' };
  return `<span class="priority-badge" style="background:${colors[pri]}22;color:${colors[pri]}">${pri}</span>`;
}

function render() {
  const board = document.getElementById('board');
  board.innerHTML = '';

  COLUMNS.forEach((col) => {
    let colTasks = data.tasks.filter((t) => t.status === col.id);

    // Auto-sort backlog, manual order for others
    if (col.id === 'backlog') {
      colTasks = sortBacklog(colTasks);
    } else {
      colTasks.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }

    // Filter by active tag filters
    const activeFilters = columnTagFilters[col.id] || [];
    if (activeFilters.length > 0) {
      colTasks = colTasks.filter((t) => activeFilters.every((tag) => (t.tags || []).includes(tag)));
    }

    // Filter Done column to recent tasks
    let hiddenDoneCount = 0;
    if (col.id === 'done' && !showAllDone) {
      const cutoff = Date.now() - DONE_DAYS * 86400000;
      const allDone = colTasks;
      colTasks = allDone.filter((t) => (t.completedAt || t.created || 0) >= cutoff);
      hiddenDoneCount = allDone.length - colTasks.length;
    }

    const colEl = document.createElement('div');
    colEl.className = 'column';
    const effortSum = col.id === 'today' ? colTasks.reduce((sum, t) => sum + (parseFloat(t.effort) || 0), 0) : null;
    const totalCount = col.id === 'done' && hiddenDoneCount > 0 ? `${colTasks.length}/${colTasks.length + hiddenDoneCount}` : `${colTasks.length}`;

    colEl.innerHTML = `
      <div class="column-header">
        <span class="column-title">
          <span class="column-dot" style="background:${col.color}"></span>
          ${col.title}
        </span>
        <span class="column-header-right">
          ${effortSum !== null ? `<span class="column-effort-sum">${effortSum}</span>` : ''}
          <span class="column-count">${totalCount}</span>
        </span>
      </div>
      ${
        col.id === 'backlog' && data.sortRules.length
          ? `<div class="sort-info">Sorted by: ${data.sortRules.map((r) => SORT_FIELDS.find((f) => f.id === r.field)?.label).join(' → ')}</div>`
          : ''
      }
      ${
        activeFilters.length
          ? `<div class="tag-filter-bar">
              ${activeFilters.map((tag) => `<span class="tag-filter-badge" data-col="${col.id}" data-tag="${esc(tag)}">${esc(tag)} <button class="tag-filter-remove">✕</button></span>`).join('')}
              <button class="tag-filter-clear" data-col="${col.id}">Clear all</button>
            </div>`
          : ''
      }
    `;

    const body = document.createElement('div');
    body.className = 'column-body';
    body.dataset.column = col.id;

    body.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      body.classList.add('drag-over');
    });
    body.addEventListener('dragleave', () => body.classList.remove('drag-over'));
    body.addEventListener('drop', (e) => {
      e.preventDefault();
      body.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const task = data.tasks.find((t) => t.id === id);
      if (!task) return;
      const prevStatus = task.status;
      task.status = col.id;
      if (col.id === 'done' && prevStatus !== 'done') task.completedAt = Date.now();
      if (col.id !== 'done') delete task.completedAt;
      if (col.id !== 'backlog') {
        const colItems = data.tasks.filter((t) => t.status === col.id && t.id !== id);
        task.order = colItems.length;
      }
      markDirty();
      render();
    });

    colTasks.forEach((task) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.draggable = true;
      card.dataset.id = task.id;
      card.dataset.priority = task.priority || 'none';

      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', task.id);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('click', (e) => {
        if (e.target.closest('.card-actions')) return;
        if (e.target.closest('a')) return;
        const tagEl = e.target.closest('.tag-clickable');
        if (tagEl) {
          e.stopPropagation();
          toggleTagFilter(tagEl.dataset.col, tagEl.dataset.tag);
          return;
        }
        viewTask(task.id);
      });

      const tagsHtml = (task.tags || []).map((t) => `<span class="tag tag-clickable" data-tag="${esc(t)}" data-col="${col.id}">${esc(t)}</span>`).join('');
      const effortHtml = task.effort ? `<span class="effort-badge">${task.effort}</span>` : '';

      card.innerHTML = `
        <div class="card-actions">
          <button class="card-btn" onclick="editTask('${task.id}')" title="Edit">✎</button>
          <button class="card-btn del" onclick="deleteTask('${task.id}')" title="Delete">✕</button>
        </div>
        <div class="card-title">${esc(task.title)}</div>
        ${task.desc ? `<div class="card-desc">${renderMarkdown(task.desc)}</div>` : ''}
        <div class="card-meta">
          ${priBadge(task.priority)}
          ${dueBadge(task.due)}
          ${effortHtml}
          ${tagsHtml}
        </div>
      `;
      body.appendChild(card);
    });

    // Tag filter bar click handlers
    colEl.querySelectorAll('.tag-filter-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const badge = btn.closest('.tag-filter-badge');
        toggleTagFilter(badge.dataset.col, badge.dataset.tag);
      });
    });
    colEl.querySelectorAll('.tag-filter-clear').forEach((btn) => {
      btn.addEventListener('click', () => clearTagFilters(btn.dataset.col));
    });

    colEl.appendChild(body);

    if (col.id === 'done' && hiddenDoneCount > 0) {
      const btn = document.createElement('button');
      btn.className = 'btn show-older-btn';
      btn.textContent = `Show ${hiddenDoneCount} older`;
      btn.onclick = () => { showAllDone = true; render(); };
      colEl.appendChild(btn);
    } else if (col.id === 'done' && showAllDone && data.tasks.filter((t) => t.status === 'done').length > 0) {
      const btn = document.createElement('button');
      btn.className = 'btn show-older-btn';
      btn.textContent = 'Show recent only';
      btn.onclick = () => { showAllDone = false; render(); };
      colEl.appendChild(btn);
    }

    board.appendChild(colEl);
  });
}

// ── View Modal ──

function viewTask(id) {
  const t = data.tasks.find((x) => x.id === id);
  if (!t) return;

  document.getElementById('viewTitle').textContent = t.title;

  const descEl = document.getElementById('viewDesc');
  descEl.innerHTML = t.desc ? renderMarkdown(t.desc) : '';
  descEl.style.display = t.desc ? '' : 'none';

  const detailsEl = document.getElementById('viewDetails');
  const colLabel = COLUMNS.find((c) => c.id === t.status)?.title || t.status;
  const fields = [];
  if (t.priority && t.priority !== 'none') fields.push({ label: 'Priority', html: priBadge(t.priority) });
  if (t.effort) fields.push({ label: 'Effort', html: `<span class="effort-badge">${esc(t.effort)}</span>` });
  if (t.due) fields.push({ label: 'Due', html: dueBadge(t.due) });
  fields.push({ label: 'Column', html: esc(colLabel) });

  detailsEl.innerHTML = fields
    .map(
      (f) => `<div class="view-field"><span class="view-field-label">${f.label}</span><span class="view-field-value">${f.html}</span></div>`
    )
    .join('');

  const tagsEl = document.getElementById('viewTags');
  tagsEl.innerHTML = (t.tags || []).map((tag) => `<span class="tag">${esc(tag)}</span>`).join('');
  tagsEl.style.display = t.tags && t.tags.length ? '' : 'none';

  const editBtn = document.getElementById('viewEditBtn');
  editBtn.onclick = () => {
    closeViewModal();
    editTask(id);
  };

  document.getElementById('viewModal').classList.remove('hidden');
}

function closeViewModal() {
  document.getElementById('viewModal').classList.add('hidden');
}

// ── Edit Modal ──

function openModal(status, id) {
  editingId = id || null;
  const modal = document.getElementById('modal');
  const sel = document.getElementById('taskStatus');
  sel.innerHTML = COLUMNS.map((c) => `<option value="${c.id}" ${c.id === status ? 'selected' : ''}>${c.title}</option>`).join('');

  if (id) {
    const t = data.tasks.find((x) => x.id === id);
    document.getElementById('modalTitle').textContent = 'Edit Task';
    document.getElementById('modalSave').textContent = 'Save';
    document.getElementById('taskTitle').value = t.title;
    document.getElementById('taskDesc').value = t.desc || '';
    document.getElementById('taskPriority').value = t.priority || 'none';
    document.getElementById('taskEffort').value = t.effort || '';
    document.getElementById('taskDue').value = t.due || '';
    document.getElementById('taskTags').value = (t.tags || []).join(', ');
    sel.value = t.status;
  } else {
    document.getElementById('modalTitle').textContent = 'Add Task';
    document.getElementById('modalSave').textContent = 'Add';
    document.getElementById('taskTitle').value = '';
    document.getElementById('taskDesc').value = '';
    document.getElementById('taskPriority').value = 'medium';
    document.getElementById('taskEffort').value = '1';
    document.getElementById('taskDue').value = '';
    document.getElementById('taskTags').value = '';
  }

  modal.classList.remove('hidden');
  setupTagAutocomplete();
  setTimeout(() => document.getElementById('taskTitle').focus(), 50);
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  editingId = null;
}

function saveTask() {
  const title = document.getElementById('taskTitle').value.trim();
  if (!title) return;

  const fields = {
    title,
    desc: document.getElementById('taskDesc').value.trim(),
    priority: document.getElementById('taskPriority').value,
    effort: document.getElementById('taskEffort').value,
    due: document.getElementById('taskDue').value || null,
    status: document.getElementById('taskStatus').value,
    tags: document
      .getElementById('taskTags')
      .value.split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  };

  if (editingId) {
    const t = data.tasks.find((x) => x.id === editingId);
    const prevStatus = t.status;
    Object.assign(t, fields);
    if (fields.status === 'done' && prevStatus !== 'done') t.completedAt = Date.now();
    if (fields.status !== 'done') delete t.completedAt;
  } else {
    const colItems = data.tasks.filter((t) => t.status === fields.status);
    const task = { id: uid(), ...fields, order: colItems.length, created: Date.now() };
    if (fields.status === 'done') task.completedAt = Date.now();
    data.tasks.push(task);
  }

  markDirty();
  render();
  closeModal();
}

function editTask(id) {
  const t = data.tasks.find((x) => x.id === id);
  if (t) openModal(t.status, id);
}

function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  data.tasks = data.tasks.filter((t) => t.id !== id);
  markDirty();
  render();
}

// ── Tag Auto-complete ──

function setupTagAutocomplete() {
  const input = document.getElementById('taskTags');
  if (input.dataset.acReady) return;
  input.dataset.acReady = '1';

  const dropdown = document.createElement('div');
  dropdown.id = 'tagAutocomplete';
  dropdown.className = 'tag-autocomplete hidden';
  input.parentNode.style.position = 'relative';
  input.parentNode.insertBefore(dropdown, input.nextSibling);

  input.addEventListener('input', () => showTagSuggestions());
  input.addEventListener('keydown', (e) => {
    if (!dropdown.classList.contains('hidden')) {
      const items = dropdown.querySelectorAll('.tag-suggestion');
      const active = dropdown.querySelector('.tag-suggestion.active');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        let idx = [...items].indexOf(active);
        if (active) active.classList.remove('active');
        if (e.key === 'ArrowDown') idx = (idx + 1) % items.length;
        else idx = (idx - 1 + items.length) % items.length;
        items[idx].classList.add('active');
      } else if (e.key === 'Enter' && active) {
        e.preventDefault();
        e.stopPropagation();
        insertTag(active.textContent);
      } else if (e.key === 'Escape') {
        dropdown.classList.add('hidden');
      }
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => dropdown.classList.add('hidden'), 150);
  });
  input.addEventListener('focus', () => showTagSuggestions());
}

function showTagSuggestions() {
  const input = document.getElementById('taskTags');
  const dropdown = document.getElementById('tagAutocomplete');
  if (!dropdown) return;

  const val = input.value;
  const cursorPos = input.selectionStart;
  const beforeCursor = val.slice(0, cursorPos);
  const lastComma = beforeCursor.lastIndexOf(',');
  const currentToken = beforeCursor.slice(lastComma + 1).trim().toLowerCase();

  if (!currentToken) {
    dropdown.classList.add('hidden');
    return;
  }

  const existingTags = val.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  const allTags = getAllTags();
  const matches = allTags.filter(
    (t) => t.toLowerCase().includes(currentToken) && !existingTags.includes(t.toLowerCase())
  );

  if (matches.length === 0) {
    dropdown.classList.add('hidden');
    return;
  }

  dropdown.innerHTML = matches
    .slice(0, 8)
    .map((t) => `<div class="tag-suggestion">${esc(t)}</div>`)
    .join('');
  dropdown.classList.remove('hidden');

  dropdown.querySelectorAll('.tag-suggestion').forEach((el) => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      insertTag(el.textContent);
    });
  });
}

function insertTag(tag) {
  const input = document.getElementById('taskTags');
  const dropdown = document.getElementById('tagAutocomplete');
  const val = input.value;
  const cursorPos = input.selectionStart;
  const beforeCursor = val.slice(0, cursorPos);
  const afterCursor = val.slice(cursorPos);
  const lastComma = beforeCursor.lastIndexOf(',');
  const before = lastComma >= 0 ? beforeCursor.slice(0, lastComma + 1) + ' ' : '';
  const nextComma = afterCursor.indexOf(',');
  const after = nextComma >= 0 ? afterCursor.slice(nextComma) : '';
  input.value = before + tag + (after ? after : ', ');
  input.focus();
  const newPos = (before + tag + ', ').length;
  input.setSelectionRange(newPos, newPos);
  dropdown.classList.add('hidden');
}

// ── Keyboard shortcuts ──

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    closeViewModal();
    document.getElementById('settingsPanel').classList.add('hidden');
  }
  if (e.key === 'Enter' && !document.getElementById('modal').classList.contains('hidden')) {
    const ac = document.getElementById('tagAutocomplete');
    if (e.target.tagName !== 'TEXTAREA' && (!ac || ac.classList.contains('hidden'))) saveTask();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveFile();
  }
});

// Close settings when clicking outside
document.addEventListener('click', (e) => {
  const panel = document.getElementById('settingsPanel');
  if (!panel.classList.contains('hidden') && !panel.contains(e.target) && !e.target.closest('[onclick*="toggleSettings"]')) {
    panel.classList.add('hidden');
  }
});

// ── Init ──

async function init() {
  // Load from localStorage (instant, always available)
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      loadJSON(saved);
    } catch {
      /* corrupted localStorage, start fresh */
    }
  }

  // Try to restore file handle from IndexedDB
  try {
    const handle = await restoreHandle();
    if (handle) {
      const perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        fileHandle = handle;
        updateFileStatus(handle.name);
      }
    }
  } catch {
    /* handle restore failed, localStorage still works */
  }

  renderSortRules();
  render();
}

init();
