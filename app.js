/* ============================================================
   D&D Hirelings - Application logic
   Vanilla JS, no dependencies. State persists in localStorage.
   ============================================================ */

/* ---------- Palettes ---------- */
// Each palette sets all CSS color tokens. highlight is the accent color shown
// on active tags, selected cards, and the picker button for that palette.
const PALETTES = {
  dark: {
    label: 'DARK',
    bg:           '#111114',
    fg:           '#dddde0',
    border:       '#2e2e36',
    dim:          '#5c5c68',
    dimmer:       '#1a1a1f',
    highlight:    '#7eb5f5',
    highlightBg:  'rgba(126,181,245,0.09)',
  },
  light: {
    label: 'LIGHT',
    bg:           '#f4f4f1',
    fg:           '#1e1e22',
    border:       '#c0c0bc',
    dim:          '#888884',
    dimmer:       '#eaeae8',
    highlight:    '#2060d0',
    highlightBg:  'rgba(32,96,208,0.07)',
  },
  vale: {
    label: 'VALE',
    bg:           '#0c1410',
    fg:           '#c5dbbf',
    border:       '#243422',
    dim:          '#4a6248',
    dimmer:       '#131c14',
    highlight:    '#72c87e',
    highlightBg:  'rgba(114,200,126,0.09)',
  },
  ember: {
    label: 'EMBER',
    bg:           '#130f0b',
    fg:           '#e8d5bc',
    border:       '#352218',
    dim:          '#624e3a',
    dimmer:       '#1c1510',
    highlight:    '#e8893c',
    highlightBg:  'rgba(232,137,60,0.09)',
  },
  arcane: {
    label: 'ARCANE',
    bg:           '#0d0b14',
    fg:           '#d2cce8',
    border:       '#28203e',
    dim:          '#504865',
    dimmer:       '#141020',
    highlight:    '#9a7ae8',
    highlightBg:  'rgba(154,122,232,0.09)',
  },
};

const PALETTE_KEY = 'dnd-hirelings-palette';
let currentPalette = localStorage.getItem(PALETTE_KEY) || 'dark';

function applyPalette(name) {
  const p = PALETTES[name] || PALETTES.dark;
  const root = document.documentElement;
  root.style.setProperty('--bg',           p.bg);
  root.style.setProperty('--fg',           p.fg);
  root.style.setProperty('--border',       p.border);
  root.style.setProperty('--dim',          p.dim);
  root.style.setProperty('--dimmer',       p.dimmer);
  root.style.setProperty('--highlight',    p.highlight);
  root.style.setProperty('--highlight-bg', p.highlightBg);
  currentPalette = name;
  localStorage.setItem(PALETTE_KEY, name);
}

function renderPalettePicker() {
  const picker = document.getElementById('palette-picker');
  picker.innerHTML = '';
  for (const [name, p] of Object.entries(PALETTES)) {
    const btn = el('button', {
      class: 'palette-btn' + (currentPalette === name ? ' active' : ''),
      title: p.label,
      onclick: (e) => { e.stopPropagation(); applyPalette(name); renderPalettePicker(); }
    }, [
      el('span', { class: 'palette-dot', style: { background: p.highlight } }),
      p.label,
    ]);
    picker.appendChild(btn);
  }
}

/* ---------- Config ---------- */
// config.json (HTTP only) supplies defaults (agentName, rate, etc.) but not colors.
const DEFAULT_CONFIG = {
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
  session: { id: '001', clock: 0, timeStep: '60', bank: 100 },
  agents: [],   // { id, name, icon, rate, rateUnit, description, attributes[], activities[], createdAt, lastAssigned }
  tasks: [],    // { id, name, description, requirements[], effortProgress{}, isComplete, createdAt }
};

// Ephemeral UI state (not persisted).
const ui = {
  selectedTaskId: null,
  expandedTasks: new Set(),
  playing: false,
  playInterval: null,
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
    state.session.bank ??= 100;
    state.session.timeStep ??= '60';
    state.tasks.forEach(t => {
      t.requirements ||= []; t.description ??= '';
      t.isComplete ??= false; t.createdAt ||= Date.now();
      t.effortProgress ??= {};
    });
  } catch (e) { console.warn('Failed to load state:', e); }
}

async function loadConfig() {
  // config.json is optional and only supplies defaults (not colors).
  // fetch will fail under file:// — that's fine.
  try {
    const res = await fetch('config.json');
    if (!res.ok) return;
    const cfg = await res.json();
    config = {
      defaults: Object.assign({}, DEFAULT_CONFIG.defaults, cfg.defaults || {}),
    };
  } catch (_) { /* keep defaults */ }
}

/* ---------- Utilities ---------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const now = () => Date.now();

// Total minutes → "D1 08:30"
function formatClock(totalMinutes) {
  const m = Math.max(0, Math.floor(totalMinutes || 0));
  const day = Math.floor(m / 1440) + 1;
  const rem = m % 1440;
  const h = Math.floor(rem / 60);
  const min = rem % 60;
  return `D${day} ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// Tag format: #type:name  or  #type:name=value
// Returns { type, name, value } where value is a number or null.
function parseTag(s) {
  const stripped = s.startsWith('#') ? s.slice(1) : s;
  const colonIdx = stripped.indexOf(':');
  if (colonIdx < 0) return { type: 'tag', name: stripped, value: null };
  const type = stripped.slice(0, colonIdx);
  const rest = stripped.slice(colonIdx + 1);
  const eqIdx = rest.indexOf('=');
  if (eqIdx < 0) return { type, name: rest, value: null };
  const v = parseFloat(rest.slice(eqIdx + 1));
  return { type, name: rest.slice(0, eqIdx), value: isNaN(v) ? null : v };
}

// Build a canonical tag string from parts.
function buildTag(type, name, value) {
  const t = (type || 'tag').trim().toLowerCase();
  const n = (name || '').trim().toLowerCase();
  if (!n) return null;
  const v = (value !== null && value !== undefined && String(value).trim() !== '')
    ? `=${Number(value)}` : '';
  return `#${t}:${n}${v}`;
}

function normalizeTag(s) {
  s = (s || '').trim();
  if (!s) return null;
  if (!s.startsWith('#')) s = '#' + s;
  if (!s.includes(':')) s += ':';
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
    effortProgress: {},
    isComplete: false,
    createdAt: now(),
  });
  save(); render();
}

function deleteAgent(id) {
  state.agents = state.agents.filter(a => a.id !== id);
  save(); render();
}

// Remove all #task:<taskId> tags from every agent's activities.
function pruneTaskFromAgents(taskId) {
  const tag = `#task:${taskId}`;
  for (const a of state.agents) {
    a.activities = a.activities.filter(act => act !== tag);
  }
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  pruneTaskFromAgents(id);
  if (ui.selectedTaskId === id) ui.selectedTaskId = null;
  ui.expandedTasks.delete(id);
  save(); render();
}

// First non-complete task in agent's activity queue (sequential work order).
function getCurrentTask(agent) {
  for (const tag of agent.activities) {
    const p = parseTag(tag);
    if (p.type !== 'task') continue;
    const task = state.tasks.find(t => t.id === p.name);
    if (task && !task.isComplete) return task;
  }
  return null;
}

function hasEffortRequirements(task) {
  return task.requirements.some(r => { const p = parseTag(r); return p.type === 'effort' && p.name && p.value; });
}

// Returns true when every effort requirement on the task is fully accumulated.
function checkTaskComplete(task) {
  return task.requirements.every(req => {
    const p = parseTag(req);
    if (p.type !== 'effort' || !p.name || !p.value) return true;
    return (task.effortProgress?.[p.name] ?? 0) >= p.value;
  });
}

// Returns true if the agent satisfies all task requirements.
// For scalar requirements (value present), agent attribute value must be >=.
// For presence-only requirements (no value), agent must have the tag at all.
function validateAssignment(agent, task) {
  for (const req of task.requirements) {
    const reqP = parseTag(req);
    if (!reqP.name) continue; // skip blank/incomplete rows
    const match = agent.attributes.find(attr => {
      const p = parseTag(attr);
      return p.type === reqP.type && p.name.toLowerCase() === reqP.name.toLowerCase();
    });
    if (!match) return false;
    if (reqP.value !== null) {
      const agentVal = parseTag(match).value ?? 0;
      if (agentVal < reqP.value) return false;
    }
  }
  return true;
}

// Brief red flash on the card with agentId, without triggering a full render.
function flashError(agentId) {
  const card = document.querySelector(`.agent-card[data-id="${agentId}"]`);
  if (!card) return;
  card.classList.remove('flash-error');
  void card.offsetWidth; // force reflow so the animation restarts
  card.classList.add('flash-error');
  card.addEventListener('animationend', () => card.classList.remove('flash-error'), { once: true });
}

function assignSelectedTaskTo(agent) {
  if (!ui.selectedTaskId) return;
  const task = state.tasks.find(t => t.id === ui.selectedTaskId);
  if (!task) return;

  if (!validateAssignment(agent, task)) {
    flashError(agent.id);
    return;
  }

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
    const task = state.tasks.find(t => t.id === p.name);
    return !!(task && !task.isComplete);
  }
  return true;
}

function isAttributeActive(attrTag, agent) {
  const attrP = parseTag(attrTag);
  for (const act of agent.activities) {
    const actP = parseTag(act);
    if (actP.type !== 'task') continue;
    const task = state.tasks.find(t => t.id === actP.name);
    if (!task || task.isComplete) continue;
    for (const req of task.requirements) {
      const reqP = parseTag(req);
      if (!reqP.name || !attrP.name) continue;
      if (reqP.type === attrP.type && reqP.name.toLowerCase() === attrP.name.toLowerCase()) return true;
    }
  }
  return false;
}

function activeTaskCount(agent) {
  return agent.activities.filter(a => {
    const p = parseTag(a);
    if (p.type !== 'task') return false;
    const t = state.tasks.find(x => x.id === p.name);
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
  let label = `#${p.type}:${p.name}`;
  if (p.type === 'task') {
    const task = state.tasks.find(t => t.id === p.name);
    label = task ? `#${task.name}` : label;
  }
  const children = [label];
  if (p.value !== null && p.type !== 'task') {
    children.push(el('span', { class: 'tag-value', text: `≥${p.value}` }));
  }
  children.push(el('span', {
    class: 'x',
    text: '×',
    title: 'Remove',
    onclick: (e) => { e.stopPropagation(); onRemove(); }
  }));
  return el('span', { class: 'tag' + (active ? ' active' : '') }, children);
}

function promptForTag(defaultPrefix) {
  const v = prompt('Tag in #type:name format (optional =value)', defaultPrefix || '#');
  return normalizeTag(v);
}

/* ---------- Requirements editor ----------
   Each requirement is a structured row: [type][name][value][×]
   The three inputs share a blur/focus debounce so tabbing between fields
   in the same row doesn't trigger a spurious render mid-edit.
   ------------------------------------------ */
const REQ_TYPE_SUGGESTIONS = ['skill', 'tool', 'trait', 'class', 'level', 'resource', 'guild', 'race'];

function renderRequirementsEditor(task) {
  const wrap = el('div', { class: 'req-editor' });
  wrap.appendChild(el('div', { class: 'tag-label', text: 'REQUIREMENTS' }));

  // Column headers
  const headers = el('div', { class: 'req-row req-header' }, [
    el('span', { class: 'req-col-label', text: 'TYPE' }),
    el('span', { class: 'req-col-label', text: 'NAME' }),
    el('span', { class: 'req-col-label', text: 'MIN' }),
  ]);
  wrap.appendChild(headers);

  task.requirements.forEach((reqStr, i) => {
    wrap.appendChild(renderReqRow(task, i, reqStr));
  });

  wrap.appendChild(el('button', {
    class: 'tag-add',
    text: '+ REQ',
    onclick: (e) => { e.stopPropagation(); task.requirements.push('#skill:'); save(); render(); }
  }));

  return wrap;
}

function renderReqRow(task, i, reqStr) {
  const { type, name, value } = parseTag(reqStr);

  const typeInput = el('input', {
    class: 'req-field req-type',
    list: 'req-types',
    value: type || 'skill',
    placeholder: 'type',
    spellcheck: 'false',
  });
  const nameInput = el('input', {
    class: 'req-field req-name',
    value: name || '',
    placeholder: 'name',
    spellcheck: 'false',
  });
  const valueInput = el('input', {
    class: 'req-field req-value',
    type: 'number',
    value: value !== null ? String(value) : '',
    placeholder: '—',
    min: '0',
  });

  // Commit all three fields as one tag; called on blur of each input.
  // The 60ms delay lets focus move to a sibling input without triggering render.
  let blurTimer;
  function scheduleCommit() {
    blurTimer = setTimeout(() => {
      const tag = buildTag(
        typeInput.value,
        nameInput.value,
        valueInput.value !== '' ? valueInput.value : null
      );
      if (tag) { task.requirements[i] = tag; save(); }
      render();
    }, 60);
  }
  function cancelCommit() { clearTimeout(blurTimer); }

  [typeInput, nameInput, valueInput].forEach(inp => {
    inp.addEventListener('blur',  scheduleCommit);
    inp.addEventListener('focus', cancelCommit);
    inp.addEventListener('click', e => e.stopPropagation());
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') inp.blur();
      if (e.key === 'Escape') { inp.value = inp.defaultValue; inp.blur(); }
    });
  });

  return el('div', { class: 'req-row' }, [
    typeInput,
    nameInput,
    valueInput,
    el('span', {
      class: 'x req-remove',
      text: '×',
      onclick: (e) => { e.stopPropagation(); task.requirements.splice(i, 1); save(); render(); }
    }),
  ]);
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

  // Activities: read-only. Populated via task-assignment; × unassigns.
  // First non-complete task is highlighted (current); rest are queued (dim).
  const actSect = el('div', { class: 'tag-section' });
  actSect.appendChild(el('div', { class: 'tag-label', text: 'ACTIVITIES' }));
  const actList = el('div', { class: 'tag-list' });
  let foundCurrent = false;
  agent.activities.forEach(actTag => {
    const p = parseTag(actTag);
    if (p.type !== 'task') return;
    const task = state.tasks.find(t => t.id === p.name);
    if (!task) return; // stale — will be pruned on next save
    const isCurrent = !task.isComplete && !foundCurrent;
    if (isCurrent) foundCurrent = true;
    actList.appendChild(renderTag(actTag, isCurrent, () => {
      agent.activities = agent.activities.filter(t => t !== actTag);
      save(); render();
    }));
  });
  if (!actList.childElementCount) {
    actList.appendChild(el('span', { class: 'empty-inline', text: '—' }));
  }
  actSect.appendChild(actList);
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

/* ---------- Effort progress bar ---------- */
function renderEffortProgress(task) {
  const effortReqs = task.requirements.filter(r => { const p = parseTag(r); return p.type === 'effort' && p.name && p.value; });
  if (!effortReqs.length) return null;

  const wrap = el('div', { class: 'effort-progress' });
  wrap.appendChild(el('div', { class: 'tag-label', text: 'PROGRESS' }));

  effortReqs.forEach(req => {
    const p = parseTag(req);
    const done  = task.effortProgress?.[p.name] ?? 0;
    const total = p.value;
    const pct   = Math.min(100, (done / total) * 100);

    const row = el('div', { class: 'effort-row' });
    row.appendChild(el('span', { class: 'effort-label', text: p.name }));
    const track = el('div', { class: 'effort-track' });
    track.appendChild(el('div', { class: 'effort-fill', style: { width: `${pct.toFixed(1)}%` } }));
    row.appendChild(track);
    row.appendChild(el('span', { class: 'effort-frac', text: `${Math.floor(done)}/${total}` }));
    wrap.appendChild(row);
  });
  return wrap;
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

  body.appendChild(renderRequirementsEditor(task));

  const effortSection = renderEffortProgress(task);
  if (effortSection) body.appendChild(effortSection);

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
    onclick: (e) => {
      e.stopPropagation();
      task.isComplete = !task.isComplete;
      if (task.isComplete) pruneTaskFromAgents(task.id);
      save(); render();
    }
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
  document.getElementById('clock').textContent = formatClock(state.session.clock);
  const tsEl = document.getElementById('time-step');
  if (document.activeElement !== tsEl) tsEl.textContent = state.session.timeStep;
  const bankEl = document.getElementById('bank');
  if (bankEl && document.activeElement !== bankEl) {
    bankEl.textContent = (state.session.bank ?? 0).toFixed(1);
  }
  updatePlayButtons();

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

/* ---------- Time management ---------- */
function getStepMinutes() {
  const m = String(state.session.timeStep).match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 60;
}

function advanceTime() {
  const stepMins = getStepMinutes();
  const stepDays = stepMins / 1440;

  // Agents whose first non-complete task exists (they're working this step).
  const working = state.agents.filter(a => getCurrentTask(a) !== null);

  if (working.length) {
    const totalCost = working.reduce((sum, a) => sum + (parseFloat(a.rate) || 0) * stepDays, 0);

    if (totalCost > (state.session.bank ?? 0)) {
      // Can't pay everyone: flash all active agents, no effort advances.
      working.forEach(a => flashError(a.id));
    } else {
      state.session.bank = Math.round(((state.session.bank ?? 0) - totalCost) * 100) / 100;

      const tasksWithEffort = new Set(); // tasks that received ≥1 skill-effort contribution

      for (const agent of working) {
        const task = getCurrentTask(agent);
        if (!task) continue;

        task.effortProgress = task.effortProgress || {};
        let agentContributed = false;

        for (const req of task.requirements) {
          const p = parseTag(req);
          if (p.type !== 'effort' || !p.name || !p.value) continue;

          // Agent must have a matching skill attribute with a positive value.
          const skillTag = agent.attributes.find(attr => {
            const ap = parseTag(attr);
            return ap.type === 'skill' && ap.name.toLowerCase() === p.name.toLowerCase();
          });
          if (!skillTag) continue;
          const skillVal = parseTag(skillTag).value ?? 0;
          if (skillVal <= 0) continue;

          task.effortProgress[p.name] = (task.effortProgress[p.name] ?? 0) + skillVal * stepDays;
          agentContributed = true;
          tasksWithEffort.add(task.id);
        }

        // Agent is active on a skill-based task but has no matching skills → flash idle.
        if (!agentContributed && hasEffortRequirements(task)) flashError(agent.id);
      }

      // Flash agents whose task got zero total effort this step (no one has the skills).
      for (const agent of working) {
        const task = getCurrentTask(agent);
        if (!task || !hasEffortRequirements(task)) continue;
        if (!tasksWithEffort.has(task.id)) flashError(agent.id);
      }

      // Auto-complete tasks whose effort requirements are now satisfied.
      for (const task of state.tasks) {
        if (!task.isComplete && hasEffortRequirements(task) && checkTaskComplete(task)) {
          task.isComplete = true;
          pruneTaskFromAgents(task.id);
        }
      }
    }
  }

  state.session.clock = (parseFloat(state.session.clock) || 0) + stepMins;
  save();
  render();
}

function startPlay() {
  if (ui.playing) return;
  ui.playing = true;
  ui.playInterval = setInterval(advanceTime, 1000);
  updatePlayButtons();
}

function stopPlay() {
  ui.playing = false;
  clearInterval(ui.playInterval);
  ui.playInterval = null;
  updatePlayButtons();
}

function updatePlayButtons() {
  const playBtn  = document.getElementById('play-btn');
  const pauseBtn = document.getElementById('pause-btn');
  if (playBtn)  playBtn.classList.toggle('active-ctrl',  ui.playing);
  if (pauseBtn) pauseBtn.classList.toggle('active-ctrl', !ui.playing);
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
  document.getElementById('play-btn').onclick  = startPlay;
  document.getElementById('pause-btn').onclick = stopPlay;

  // Editable session fields
  const sessId = document.getElementById('session-id');
  sessId.addEventListener('blur', () => { state.session.id = sessId.textContent.trim() || '001'; save(); render(); });
  sessId.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sessId.blur(); } });

  const ts = document.getElementById('time-step');
  ts.addEventListener('blur', () => { state.session.timeStep = ts.textContent.trim() || '60'; save(); render(); });
  ts.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ts.blur(); } });

  const bankEl = document.getElementById('bank');
  bankEl.addEventListener('blur', () => {
    const v = parseFloat(bankEl.textContent);
    state.session.bank = isNaN(v) ? 0 : Math.round(v * 100) / 100;
    save(); render();
  });
  bankEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); bankEl.blur(); } });

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
  applyPalette(currentPalette);   // apply saved palette before first paint
  await loadConfig();
  load();
  wireMenu();
  renderPalettePicker();
  render();
}

boot();
