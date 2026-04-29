/* ============================================================
   D&D Hirelings - Application logic
   Vanilla JS, no dependencies. State persists in localStorage.
   ============================================================ */

/* ---------- Config ---------- */
// Defaults; overridden by config.json if reachable (HTTP only).
const DEFAULT_CONFIG = {
  colors: {
    bg: '#000000',
    fg: '#ffffff',
    border: '#ffffff',
    dim: '#555555',
    dimmer: '#1a1a1a',
    accent: '#ffffff',
    selected: '#66d9ef'
  },
  defaults: {
    agentName: 'NEW HIRELING',
    rate: 1,
    rateUnit: 'GP/DAY',
    taskName: 'NEW TASK',
    timeStep: '10s',
    sessionId: '001'
  }
};

let config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

/* ---------- State ---------- */
// Single source of truth, serialized to localStorage on every mutation.
let state = {
  session: { id: '001', clock: 0, timeStep: '10s' },
  agents: [],   // { id, name, icon, rate, rateUnit, description, attributes[], activities[], createdAt, lastAssigned }
  tasks: [],    // { id, name, description, requirements[], isComplete, createdAt }
};

// Ephemeral UI state (not persisted).
const ui = {
  selectedTaskId: null,
  expandedTasks: new Set(),
};

const STORAGE_KEY = 'dnd-hirelings-state-v1';

function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state = Object.assign(state, parsed);
    // Backfill missing fields on older saves.
    state.agents.forEach(a => {
      a.attributes ||= []; a.activities ||= [];
      a.description ??= ''; a.icon ??= '';
      a.createdAt ||= Date.now(); a.lastAssigned ||= 0;
    });
    state.tasks.forEach(t => {
      t.requirements ||= []; t.description ??= '';
      t.isComplete ??= false; t.createdAt ||= Date.now();
    });
  } catch (e) { console.warn('Failed to load state:', e); }
}

async function loadConfig() {
  // config.json is optional. fetch will fail under file:// — that's fine.
  try {
    const res = await fetch('config.json');
    if (!res.ok) return;
    const cfg = await res.json();
    config = {
      colors: Object.assign({}, DEFAULT_CONFIG.colors, cfg.colors || {}),
      defaults: Object.assign({}, DEFAULT_CONFIG.defaults, cfg.defaults || {}),
    };
  } catch (_) { /* keep defaults */ }
  applyConfig();
}

function applyConfig() {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(config.colors)) {
    root.style.setProperty(`--${k}`, v);
  }
}

/* ---------- Utilities ---------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const now = () => Date.now();

// Tag format: #type:content. Returns { type, content }.
function parseTag(s) {
  const stripped = s.startsWith('#') ? s.slice(1) : s;
  const idx = stripped.indexOf(':');
  if (idx < 0) return { type: 'tag', content: stripped };
  return { type: stripped.slice(0, idx), content: stripped.slice(idx + 1) };
}

function normalizeTag(s) {
  s = (s || '').trim();
  if (!s) return null;
  if (!s.startsWith('#')) s = '#' + s;
  if (!s.includes(':')) s = s + ':';
  return s;
}

// Tiny DOM helper. props: {class, text, html, on<Event>, contenteditable, style, data: {key:val}}
function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style') Object.assign(e.style, v);
    else if (k === 'data') for (const [dk, dv] of Object.entries(v)) e.dataset[dk] = dv;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

// click-to-edit span. Commits on blur or Enter; reverts on Escape.
function editable(text, oncommit, opts = {}) {
  const span = el('span', {
    contenteditable: 'true',
    spellcheck: 'false',
    text: text || '',
    class: opts.class || ''
  });
  let original = text || '';
  span.addEventListener('focus', () => { original = span.textContent; });
  span.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); span.blur(); }
    if (e.key === 'Escape') { span.textContent = original; span.blur(); }
  });
  span.addEventListener('blur', () => {
    const v = span.textContent.trim();
    if (v !== original) oncommit(v);
  });
  span.addEventListener('click', e => e.stopPropagation());
  return span;
}

/* ---------- Domain operations ---------- */
function createAgent() {
  state.agents.push({
    id: uid(),
    name: config.defaults.agentName,
    icon: '',
    rate: config.defaults.rate,
    rateUnit: config.defaults.rateUnit,
    description: '',
    attributes: [],
    activities: [],
    createdAt: now(),
    lastAssigned: 0,
  });
  save(); render();
}

function createTask() {
  state.tasks.push({
    id: uid(),
    name: config.defaults.taskName,
    description: '',
    requirements: [],
    isComplete: false,
    createdAt: now(),
  });
  save(); render();
}

function deleteAgent(id) {
  state.agents = state.agents.filter(a => a.id !== id);
  save(); render();
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  // Drop the assignment from any agent that referenced this task.
  for (const a of state.agents) {
    a.activities = a.activities.filter(t => parseTag(t).content !== id);
  }
  if (ui.selectedTaskId === id) ui.selectedTaskId = null;
  ui.expandedTasks.delete(id);
  save(); render();
}

function assignSelectedTaskTo(agent) {
  if (!ui.selectedTaskId) return;
  const task = state.tasks.find(t => t.id === ui.selectedTaskId);
  if (!task) return;
  const tag = `#task:${task.id}`;
  if (!agent.activities.includes(tag)) {
    agent.activities.push(tag);
    agent.lastAssigned = now();
    save(); render();
  }
}

/* ---------- Active-tag rules ----------
   A task-typed activity is "active" when the referenced task exists and is
   incomplete. An attribute is "active" when its content matches any
   requirement of any active assigned task on that agent.
   ----------------------------------------- */
function isActivityActive(activityTag) {
  const p = parseTag(activityTag);
  if (p.type === 'task') {
    const task = state.tasks.find(t => t.id === p.content);
    return !!(task && !task.isComplete);
  }
  return true; // non-task activity tags treated as always-on
}

function isAttributeActive(attrTag, agent) {
  const attrP = parseTag(attrTag);
  for (const act of agent.activities) {
    const actP = parseTag(act);
    if (actP.type !== 'task') continue;
    const task = state.tasks.find(t => t.id === actP.content);
    if (!task || task.isComplete) continue;
    for (const req of task.requirements) {
      const reqP = parseTag(req);
      if (reqP.content && attrP.content &&
          reqP.content.toLowerCase() === attrP.content.toLowerCase()) return true;
    }
  }
  return false;
}

function activeTaskCount(agent) {
  return agent.activities.filter(a => {
    const p = parseTag(a);
    if (p.type !== 'task') return false;
    const t = state.tasks.find(x => x.id === p.content);
    return t && !t.isComplete;
  }).length;
}

function agentsAssignedTo(taskId) {
  const tag = `#task:${taskId}`;
  return state.agents.filter(a => a.activities.includes(tag));
}

/* ---------- Tag rendering ---------- */
// Render a list of tags with × remove buttons + a "+" add button.
function renderTagList(tags, isActive, opts) {
  const list = el('div', { class: 'tag-list' });
  tags.forEach((t, i) => list.appendChild(renderTag(t, isActive(t), () => opts.onRemove(i))));
  list.appendChild(el('button', {
    class: 'tag-add',
    text: '+',
    title: opts.addTitle || 'Add tag',
    onclick: (e) => { e.stopPropagation(); opts.onAdd(); }
  }));
  return list;
}

function renderTag(tagStr, active, onRemove) {
  const p = parseTag(tagStr);
  // For task-typed tags, prefer the task's name as the visible label.
  let label = `#${p.type}:${p.content}`;
  if (p.type === 'task') {
    const task = state.tasks.find(t => t.id === p.content);
    if (task) label = `#${task.name}`;
  }
  return el('span', { class: 'tag' + (active ? ' active' : '') }, [
    label,
    el('span', {
      class: 'x',
      text: '×',
      title: 'Remove',
      onclick: (e) => { e.stopPropagation(); onRemove(); }
    })
  ]);
}

function promptForTag(defaultPrefix) {
  const v = prompt('Tag in #type:content format', defaultPrefix || '#');
  return normalizeTag(v);
}

/* ---------- Agent card ---------- */
function renderAgentCard(agent) {
  const card = el('div', {
    class: 'agent-card' + (ui.selectedTaskId ? ' assignable' : ''),
    data: { id: agent.id }
  });

  // Name (editable)
  const name = editable(agent.name, (v) => { agent.name = v || config.defaults.agentName; save(); render(); });
  name.classList.add('agent-name');
  card.appendChild(name);

  // Icon (click to upload an image; data URL stored on the agent)
  const icon = el('div', { class: 'agent-icon', title: 'Click to set image' });
  if (agent.icon) icon.style.backgroundImage = `url("${agent.icon}")`;
  else icon.textContent = 'NO IMAGE';
  icon.addEventListener('click', (e) => {
    e.stopPropagation();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { agent.icon = reader.result; save(); render(); };
      reader.readAsDataURL(file);
    };
    input.click();
  });
  card.appendChild(icon);

  // Rate (number + unit, both editable)
  const rateRow = el('div', { class: 'agent-rate' });
  const rateVal = editable(String(agent.rate), (v) => {
    const n = parseFloat(v);
    agent.rate = isNaN(n) ? 0 : n;
    save(); render();
  }, { class: 'value' });
  const rateUnit = editable(agent.rateUnit, (v) => { agent.rateUnit = v; save(); render(); }, { class: 'unit' });
  rateRow.appendChild(rateVal);
  rateRow.appendChild(rateUnit);
  card.appendChild(rateRow);

  // Description (editable)
  const desc = editable(agent.description, (v) => { agent.description = v; save(); render(); });
  desc.classList.add('agent-desc');
  desc.setAttribute('data-placeholder', 'description');
  card.appendChild(desc);

  // Attribute tags
  const attrSect = el('div', { class: 'tag-section' });
  attrSect.appendChild(el('div', { class: 'tag-label', text: 'ATTRIBUTES' }));
  attrSect.appendChild(renderTagList(
    agent.attributes,
    (t) => isAttributeActive(t, agent),
    {
      addTitle: 'Add attribute',
      onAdd: () => {
        const t = promptForTag('#trait:');
        if (t) { agent.attributes.push(t); save(); render(); }
      },
      onRemove: (i) => { agent.attributes.splice(i, 1); save(); render(); }
    }
  ));
  card.appendChild(attrSect);

  // Activity tags (assigned tasks live here as #task:<id>)
  const actSect = el('div', { class: 'tag-section' });
  actSect.appendChild(el('div', { class: 'tag-label', text: 'ACTIVITIES' }));
  actSect.appendChild(renderTagList(
    agent.activities,
    (t) => isActivityActive(t),
    {
      addTitle: 'Add activity',
      onAdd: () => {
        const t = promptForTag('#activity:');
        if (t) { agent.activities.push(t); save(); render(); }
      },
      onRemove: (i) => { agent.activities.splice(i, 1); save(); render(); }
    }
  ));
  card.appendChild(actSect);

  // Delete
  const delRow = el('div', { class: 'tag-section' });
  delRow.appendChild(el('button', {
    class: 'delete-btn',
    text: '× DELETE',
    onclick: (e) => {
      e.stopPropagation();
      if (confirm(`Delete hireling "${agent.name}"?`)) deleteAgent(agent.id);
    }
  }));
  card.appendChild(delRow);

  // Click-to-assign: if a task is selected in the right pane,
  // clicking this card adds the task as an activity tag.
  card.addEventListener('click', () => assignSelectedTaskTo(agent));

  return card;
}

/* ---------- Task card ---------- */
function renderTaskCard(task) {
  const expanded = ui.expandedTasks.has(task.id);
  const card = el('div', {
    class: 'task-card'
      + (ui.selectedTaskId === task.id ? ' selected' : '')
      + (task.isComplete ? ' complete' : '')
      + (expanded ? ' expanded' : ''),
    data: { id: task.id }
  });

  // Header: name + expand/collapse toggle
  const header = el('div', { class: 'task-header' });
  const name = editable(task.name, (v) => { task.name = v || config.defaults.taskName; save(); render(); });
  name.classList.add('task-name');
  header.appendChild(name);

  header.appendChild(el('span', {
    class: 'task-toggle',
    text: expanded ? '−' : '+',
    title: 'Expand / collapse',
    onclick: (e) => {
      e.stopPropagation();
      if (expanded) ui.expandedTasks.delete(task.id);
      else ui.expandedTasks.add(task.id);
      render();
    }
  }));
  card.appendChild(header);

  // Body (visible when expanded)
  const body = el('div', { class: 'task-body' });

  body.appendChild(el('div', { class: 'tag-label', text: 'DESCRIPTION' }));
  const desc = editable(task.description, (v) => { task.description = v; save(); render(); });
  desc.classList.add('task-desc');
  body.appendChild(desc);

  body.appendChild(el('div', { class: 'tag-label', text: 'REQUIREMENTS' }));
  body.appendChild(renderTagList(
    task.requirements,
    () => true, // requirements always render as active markers
    {
      addTitle: 'Add requirement',
      onAdd: () => {
        const t = promptForTag('#trait:');
        if (t) { task.requirements.push(t); save(); render(); }
      },
      onRemove: (i) => { task.requirements.splice(i, 1); save(); render(); }
    }
  ));

  // Assigned-to summary line
  const assigned = agentsAssignedTo(task.id);
  if (assigned.length) {
    body.appendChild(el('div', {
      class: 'assigned-list',
      text: 'ASSIGNED: ' + assigned.map(a => a.name).join(', ')
    }));
  }

  // Status row: complete toggle + delete
  const statusRow = el('div', { class: 'task-status-row' });
  statusRow.appendChild(el('button', {
    class: 'tag-add',
    text: task.isComplete ? '↻' : '✓',
    title: task.isComplete ? 'Mark incomplete' : 'Mark complete',
    onclick: (e) => { e.stopPropagation(); task.isComplete = !task.isComplete; save(); render(); }
  }));
  statusRow.appendChild(el('span', { text: task.isComplete ? 'COMPLETE' : 'INCOMPLETE' }));
  statusRow.appendChild(el('button', {
    class: 'delete-btn',
    text: '× DELETE',
    onclick: (e) => {
      e.stopPropagation();
      if (confirm(`Delete task "${task.name}"?`)) deleteTask(task.id);
    }
  }));
  body.appendChild(statusRow);

  card.appendChild(body);

  // Click to select/deselect this task. While selected, clicking
  // an agent card on the left assigns the task to that agent.
  card.addEventListener('click', () => {
    ui.selectedTaskId = ui.selectedTaskId === task.id ? null : task.id;
    render();
  });

  return card;
}

/* ---------- Render ---------- */
function render() {
  // Menu values
  document.getElementById('session-id').textContent = state.session.id;
  document.getElementById('clock').textContent = state.session.clock;
  document.getElementById('time-step').textContent = state.session.timeStep;

  // Sort: agents with active tasks (most active first) vs. idle.
  // Within each group, most recently assigned/created first.
  const active = [], idle = [];
  for (const a of state.agents) (activeTaskCount(a) > 0 ? active : idle).push(a);

  active.sort((a, b) =>
    activeTaskCount(b) - activeTaskCount(a) ||
    (b.lastAssigned || b.createdAt) - (a.lastAssigned || a.createdAt)
  );
  idle.sort((a, b) =>
    (b.lastAssigned || b.createdAt) - (a.lastAssigned || a.createdAt)
  );

  const activeEl = document.getElementById('active-agents');
  const idleEl = document.getElementById('idle-agents');
  activeEl.innerHTML = '';
  idleEl.innerHTML = '';

  if (!active.length) activeEl.appendChild(el('div', { class: 'empty', text: 'NO ACTIVE HIRELINGS' }));
  else active.forEach(a => activeEl.appendChild(renderAgentCard(a)));

  if (!idle.length) idleEl.appendChild(el('div', { class: 'empty', text: 'NO IDLE HIRELINGS' }));
  else idle.forEach(a => idleEl.appendChild(renderAgentCard(a)));

  // Tasks: incomplete first, then most recently created.
  const taskList = document.getElementById('task-list');
  taskList.innerHTML = '';
  if (!state.tasks.length) {
    taskList.appendChild(el('div', { class: 'empty', text: 'NO TASKS' }));
  } else {
    [...state.tasks]
      .sort((a, b) => (a.isComplete - b.isComplete) || (b.createdAt - a.createdAt))
      .forEach(t => taskList.appendChild(renderTaskCard(t)));
  }
}

/* ---------- Time / clock ----------
   Clock advances by the integer prefix of the timeStep string.
   "10s" => +10, "2d" => +2, etc. Unit display is purely cosmetic.
   ----------------------------------- */
function advanceTime() {
  const m = String(state.session.timeStep).match(/-?\d+(\.\d+)?/);
  const inc = m ? parseFloat(m[0]) : 1;
  state.session.clock = (parseFloat(state.session.clock) || 0) + inc;
  save(); render();
}

/* ---------- Import / Export ---------- */
function exportJSON() {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hirelings-${state.session.id || 'export'}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

function importJSON(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      if (!data.session || !Array.isArray(data.agents) || !Array.isArray(data.tasks)) {
        alert('File does not contain valid hireling data.');
        return;
      }
      state = data;
      save(); render();
    } catch (e) { alert('Invalid JSON: ' + e.message); }
  };
  r.readAsText(file);
}

/* ---------- Wiring ---------- */
function wireMenu() {
  document.getElementById('add-agent').onclick = createAgent;
  document.getElementById('add-task').onclick = createTask;
  document.getElementById('advance-time').onclick = advanceTime;

  // Editable session id and time step in the menu
  const sessId = document.getElementById('session-id');
  sessId.addEventListener('blur', () => { state.session.id = sessId.textContent.trim() || '001'; save(); render(); });
  sessId.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sessId.blur(); } });

  const ts = document.getElementById('time-step');
  ts.addEventListener('blur', () => { state.session.timeStep = ts.textContent.trim() || '1'; save(); render(); });
  ts.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ts.blur(); } });

  document.getElementById('export-data').onclick = exportJSON;
  document.getElementById('import-data').onclick = () => document.getElementById('import-file').click();
  document.getElementById('import-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importJSON(f);
    e.target.value = ''; // allow re-importing the same file
  });

  // Click anywhere outside an agent/task card to clear task selection.
  document.addEventListener('click', (e) => {
    if (e.target.closest('.task-card') || e.target.closest('.agent-card')) return;
    if (ui.selectedTaskId) { ui.selectedTaskId = null; render(); }
  });
}

/* ---------- Boot ---------- */
async function boot() {
  await loadConfig();
  load();
  wireMenu();
  render();
}

boot();
