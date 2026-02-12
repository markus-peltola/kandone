const COLUMNS = [
  { id: 'backlog', title: 'Backlog', color: 'var(--col-backlog)' },
  { id: 'in-progress', title: 'In Progress', color: 'var(--col-progress)' },
  { id: 'review', title: 'Review', color: 'var(--col-review)' },
  { id: 'done', title: 'Done', color: 'var(--col-done)' },
];

const PRIORITIES = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };
const EFFORTS = { XS: 0, S: 1, M: 2, L: 3, XL: 4 };
const SORT_FIELDS = [
  { id: 'priority', label: 'Priority' },
  { id: 'due', label: 'Due Date' },
  { id: 'effort', label: 'Effort (smallest first)' },
  { id: 'created', label: 'Date Created' },
  { id: 'title', label: 'Title (A-Z)' },
];

let data = {
  tasks: [],
  sortRules: [
    { field: 'priority', dir: 'asc' },
    { field: 'due', dir: 'asc' },
  ],
};

let fileHandle = null;
let dirty = false;
let editingId = null;

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
    input.onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        loadJSON(text);
        fileHandle = null;
        updateFileStatus(file.name + ' (read-only, use Save As)');
      } catch (err) { alert('Failed to read file: ' + err.message); }
    };
    input.click();
    return;
  }

  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
    });
    fileHandle = handle;
    const file = await handle.getFile();
    const text = await file.text();
    loadJSON(text);
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
      suggestedName: 'kanban-data.json',
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
    });
    await saveFile();
  } catch (err) {
    if (err.name !== 'AbortError') alert('Save failed: ' + err.message);
  }
}

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
  } catch { alert('Invalid JSON file.'); }
}

function updateFileStatus(name) {
  const el = document.getElementById('fileStatus');
  if (!name) {
    el.textContent = 'No file linked';
    el.className = 'file-status';
  } else if (dirty) {
    el.textContent = '● ' + name + ' (unsaved)';
    el.className = 'file-status unsaved';
  } else {
    el.textContent = '✓ ' + name;
    el.className = 'file-status linked';
  }
}

function markDirty() {
  dirty = true;
  updateFileStatus(fileHandle ? fileHandle.name : null);
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
          const da = a.due || '9999-12-31', db = b.due || '9999-12-31';
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
        ${SORT_FIELDS.map(f => `<option value="${f.id}" ${f.id === rule.field ? 'selected' : ''}>${f.label}</option>`).join('')}
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

// ── Rendering ──

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function dueBadge(due) {
  if (!due) return '';
  const now = new Date(); now.setHours(0,0,0,0);
  const d = new Date(due + 'T00:00:00');
  const diff = Math.floor((d - now) / 86400000);
  let cls = '';
  if (diff < 0) cls = 'overdue';
  else if (diff <= 3) cls = 'soon';
  const label = diff < 0 ? `${-diff}d overdue` : diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : due;
  return `<span class="due-badge ${cls}">📅 ${label}</span>`;
}

function priBadge(pri) {
  if (!pri || pri === 'none') return '';
  const colors = { critical: 'var(--pri-critical)', high: 'var(--pri-high)', medium: 'var(--pri-medium)', low: 'var(--pri-low)' };
  return `<span class="priority-badge" style="background:${colors[pri]}22;color:${colors[pri]}">${pri}</span>`;
}

function render() {
  const board = document.getElementById('board');
  board.innerHTML = '';

  COLUMNS.forEach(col => {
    let colTasks = data.tasks.filter(t => t.status === col.id);

    // Auto-sort backlog, manual order for others
    if (col.id === 'backlog') {
      colTasks = sortBacklog(colTasks);
    } else {
      colTasks.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }

    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.innerHTML = `
      <div class="column-header">
        <span class="column-title">
          <span class="column-dot" style="background:${col.color}"></span>
          ${col.title}
        </span>
        <span class="column-count">${colTasks.length}</span>
      </div>
      ${col.id === 'backlog' && data.sortRules.length
        ? `<div class="sort-info">Sorted by: ${data.sortRules.map(r => SORT_FIELDS.find(f=>f.id===r.field)?.label).join(' → ')}</div>`
        : ''}
    `;

    const body = document.createElement('div');
    body.className = 'column-body';
    body.dataset.column = col.id;

    body.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      body.classList.add('drag-over');
    });
    body.addEventListener('dragleave', () => body.classList.remove('drag-over'));
    body.addEventListener('drop', e => {
      e.preventDefault();
      body.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const task = data.tasks.find(t => t.id === id);
      if (!task) return;
      task.status = col.id;
      if (col.id !== 'backlog') {
        const colItems = data.tasks.filter(t => t.status === col.id && t.id !== id);
        task.order = colItems.length;
      }
      markDirty();
      render();
    });

    colTasks.forEach(task => {
      const card = document.createElement('div');
      card.className = 'card';
      card.draggable = true;
      card.dataset.id = task.id;
      card.dataset.priority = task.priority || 'none';

      card.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', task.id);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('click', e => {
        if (e.target.closest('.card-actions')) return;
        viewTask(task.id);
      });

      const tagsHtml = (task.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('');
      const effortHtml = task.effort ? `<span class="effort-badge">${task.effort}</span>` : '';

      card.innerHTML = `
        <div class="card-actions">
          <button class="card-btn" onclick="editTask('${task.id}')" title="Edit">✎</button>
          <button class="card-btn del" onclick="deleteTask('${task.id}')" title="Delete">✕</button>
        </div>
        <div class="card-title">${esc(task.title)}</div>
        ${task.desc ? `<div class="card-desc">${esc(task.desc)}</div>` : ''}
        <div class="card-meta">
          ${priBadge(task.priority)}
          ${dueBadge(task.due)}
          ${effortHtml}
          ${tagsHtml}
        </div>
      `;
      body.appendChild(card);
    });

    colEl.appendChild(body);
    board.appendChild(colEl);
  });
}

// ── View Modal ──

function viewTask(id) {
  const t = data.tasks.find(x => x.id === id);
  if (!t) return;

  document.getElementById('viewTitle').textContent = t.title;

  const descEl = document.getElementById('viewDesc');
  descEl.textContent = t.desc || '';
  descEl.style.display = t.desc ? '' : 'none';

  const detailsEl = document.getElementById('viewDetails');
  const colLabel = COLUMNS.find(c => c.id === t.status)?.title || t.status;
  const fields = [];
  if (t.priority && t.priority !== 'none') fields.push({ label: 'Priority', html: priBadge(t.priority) });
  if (t.effort) fields.push({ label: 'Effort', html: `<span class="effort-badge">${esc(t.effort)}</span>` });
  if (t.due) fields.push({ label: 'Due', html: dueBadge(t.due) });
  fields.push({ label: 'Column', html: esc(colLabel) });

  detailsEl.innerHTML = fields.map(f =>
    `<div class="view-field"><span class="view-field-label">${f.label}</span><span class="view-field-value">${f.html}</span></div>`
  ).join('');

  const tagsEl = document.getElementById('viewTags');
  tagsEl.innerHTML = (t.tags || []).map(tag => `<span class="tag">${esc(tag)}</span>`).join('');
  tagsEl.style.display = (t.tags && t.tags.length) ? '' : 'none';

  const editBtn = document.getElementById('viewEditBtn');
  editBtn.onclick = () => { closeViewModal(); editTask(id); };

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
  sel.innerHTML = COLUMNS.map(c =>
    `<option value="${c.id}" ${c.id === status ? 'selected' : ''}>${c.title}</option>`
  ).join('');

  if (id) {
    const t = data.tasks.find(x => x.id === id);
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
    document.getElementById('taskEffort').value = 'M';
    document.getElementById('taskDue').value = '';
    document.getElementById('taskTags').value = '';
  }

  modal.classList.remove('hidden');
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
    tags: document.getElementById('taskTags').value.split(',').map(t => t.trim()).filter(Boolean),
  };

  if (editingId) {
    const t = data.tasks.find(x => x.id === editingId);
    Object.assign(t, fields);
  } else {
    const colItems = data.tasks.filter(t => t.status === fields.status);
    data.tasks.push({ id: uid(), ...fields, order: colItems.length, created: Date.now() });
  }

  markDirty();
  render();
  closeModal();
}

function editTask(id) {
  const t = data.tasks.find(x => x.id === id);
  if (t) openModal(t.status, id);
}

function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  data.tasks = data.tasks.filter(t => t.id !== id);
  markDirty();
  render();
}

// ── Keyboard shortcuts ──

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    closeViewModal();
    document.getElementById('settingsPanel').classList.add('hidden');
  }
  if (e.key === 'Enter' && !document.getElementById('modal').classList.contains('hidden')) {
    if (e.target.tagName !== 'TEXTAREA') saveTask();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveFile();
  }
});

// Close settings when clicking outside
document.addEventListener('click', e => {
  const panel = document.getElementById('settingsPanel');
  if (!panel.classList.contains('hidden') && !panel.contains(e.target) && !e.target.closest('[onclick*="toggleSettings"]')) {
    panel.classList.add('hidden');
  }
});

// ── Init ──
renderSortRules();
render();
