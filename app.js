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
    warn:         '#e84040',
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
    warn:         '#d42020',
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
    warn:         '#e87040',
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
    warn:         '#ffcc00',
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
    warn:         '#ff6090',
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
  root.style.setProperty('--warn',         p.warn || '#e84040');
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
    sessionId: '001',

    defaultMessages: {
      activeAgentEmpty: '',
      idleAgentEmpty: '',
      taskEmpty: '',
    }
  }
};

let config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

/* ---------- State ---------- */
// Single source of truth, serialized to localStorage on every mutation.
let state = {
  session: { id: '001', clock: 0, timeStep: '60', playbackRate: '1', bank: 100, rateMultiplier: 1, workRate: 1, skillBonus: 1 },
  agents: [],     // { id, name, icon, rate, rateUnit, description, attributes[], activities[], createdAt, lastAssigned }
  tasks: [],      // { id, name, description, requirements[], workProgress{}, isComplete, createdAt }
  inventory: [],  // { id, name, qty }
};

// Ephemeral UI state (not persisted).
const ui = {
  selectedTaskId: null,
  expandedTasks: new Set(),
  playing: false,
  playInterval: null,
  animationFrameId: null,
  lastTickWallTime: 0,   // Date.now() when advanceTime last ran — used for clock interpolation
  tickIntervalMs: 1000,  // mirrors the setInterval delay — used for interpolation denominator
};

const STORAGE_KEY = 'dnd-hirelings-state-v2';

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
      a.createdAt ??= Date.now(); a.lastAssigned ??= null;
    });
    state.session.bank ??= 100;
    state.session.timeStep ??= '60';
    state.session.playbackRate ??= '1';
    state.session.rateMultiplier ??= 1;
    state.session.workRate   ??= 1;
    state.session.skillBonus ??= 1;
    state.inventory ??= [];
    state.inventory.forEach(item => { item.id ??= uid(); item.name ??= 'ITEM'; item.qty ??= 1; });
    state.tasks.forEach(t => {
      t.requirements ??= []; t.description ??= '';
      t.isComplete ??= false; t.createdAt ??= Date.now();
      t.workProgress ??= {};
      t.requirements = t.requirements.filter(r => !!r);
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

// Tag formats:
//   #type:name             or  #type:name=value
//   #type=value             (nameless scalar)
//   #req:type:name[=value]  or  #req:type[=value]    (requirement marker)
// Returns { type, name, value, isReq }. name and value may be null.
function parseTag(s) {
  let stripped = s.startsWith('#') ? s.slice(1) : s;
  let isReq = false;
  if (stripped.startsWith('req:')) { isReq = true; stripped = stripped.slice(4); }
  const colonIdx = stripped.indexOf(':');
  const eqIdx    = stripped.indexOf('=');
  if (eqIdx >= 0 && (colonIdx < 0 || eqIdx < colonIdx)) {
    const type = stripped.slice(0, eqIdx);
    const v = parseFloat(stripped.slice(eqIdx + 1));
    return { type, name: null, value: isNaN(v) ? null : v, isReq };
  }
  if (colonIdx < 0) return { type: 'tag', name: stripped, value: null, isReq };
  const type = stripped.slice(0, colonIdx);
  const rest = stripped.slice(colonIdx + 1);
  const restEq = rest.indexOf('=');
  if (restEq < 0) return { type, name: rest, value: null, isReq };
  const v = parseFloat(rest.slice(restEq + 1));
  return { type, name: rest.slice(0, restEq), value: isNaN(v) ? null : v, isReq };
}

// Build a canonical tag string from parts.
// Emits #req:... when isReq is true. Emits #type=value (nameless) when name is empty.
function buildTag(type, name, value, isReq = false) {
  const t = (type || 'tag').trim().toLowerCase();
  const n = (name || '').trim().toLowerCase();
  const hasVal = value !== null && value !== undefined && String(value).trim() !== '';
  const head = isReq ? '#req:' : '#';
  if (!n && hasVal) return `${head}${t}=${Number(value)}`;
  if (!n) return null;
  const v = hasVal ? `=${Number(value)}` : '';
  return `${head}${t}:${n}${v}`;
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
  span.addEventListener('focus', () => {
    original = span.textContent;
    const range = document.createRange();
    range.selectNodeContents(span);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
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
function agentDefaults(cfg) {
  return {
    name: cfg.defaults.agentName,
    icon: '',
    rate: cfg.defaults.rate,
    rateUnit: cfg.defaults.rateUnit,
    description: '',
    attributes: [],
  };
}

function createAgent() {
  state.agents.push({
    id: uid(),
    ...agentDefaults(config),
    activities: [],
    createdAt: now(),
    lastAssigned: null,
  });
  save(); render();
}

function createTask() {
  state.tasks.push({
    id: uid(),
    name: config.defaults.taskName,
    description: '',
    requirements: [],
    workProgress: {},
    isComplete: false,
    createdAt: now(),
  });
  save(); render();
}

function deleteAgent(id) {
  state.agents = state.agents.filter(a => a.id !== id);
  save(); render();
}

function duplicateAgent(id) {
  const orig = state.agents.find(a => a.id === id);
  if (!orig) return;
  const copy = JSON.parse(JSON.stringify(orig));
  copy.id = uid();
  copy.activities = [];
  copy.createdAt = now();
  copy.lastAssigned = null;
  state.agents.push(copy);
  save(); render();
}

function duplicateTask(id) {
  const orig = state.tasks.find(t => t.id === id);
  if (!orig) return;
  const copy = JSON.parse(JSON.stringify(orig));
  copy.id = uid();
  copy.workProgress = {};
  copy.isComplete = false;
  copy.createdAt = now();
  state.tasks.push(copy);
  save(); render();
}

// Remove all #task:<taskId> tags from every agent's activities.
function pruneTaskFromAgents(taskId) {
  const tag = `#task:${taskId}`;
  for (const a of state.agents) {
    a.activities = a.activities.filter(act => act !== tag);
  }
}

// Execute task rewards when a task is completed.
// Rewards are tags with type "reward": #reward:name=value
// Currently supported: reward:gold=amount
function executeTaskRewards(task) {
  if (!task.isComplete) return;
  for (const req of task.requirements) {
    const p = parseTag(req);
    const fn = tagFn(p);
    if (fn === 'reward-gold' && p.value > 0) {
      state.session.bank = (state.session.bank ?? 0) + p.value;
    }
    // Add new reward cases here: if (fn === 'reward-experience') { ... }
  }
}

function completeTask(task) {
  task.isComplete = true;
  pruneTaskFromAgents(task.id);
  consumeTaskItems(task);
  executeTaskRewards(task);
}

// Returns a Set of task IDs whose item/consumable requirements cannot be met.
// Sorts tasks oldest-first so earlier tasks get reservation priority on shared consumables.
function getItemBlockedTasks(activeTasks) {
  // Mutable pool tracks remaining consumable quantities available for reservation.
  const pool = {};
  for (const item of state.inventory) pool[item.name.toLowerCase()] = item.qty;

  const blocked = new Set();

  for (const task of [...activeTasks].sort((a, b) => a.createdAt - b.createdAt)) {
    let pass = true;
    for (const req of task.requirements) {
      const p = parseTag(req);
      const fn = tagFn(p);
      if (!p.name) continue;
      if (fn === 'block') {
        const inv = state.inventory.find(i => i.name.toLowerCase() === p.name.toLowerCase());
        if (!inv || inv.qty < (p.value ?? 1)) { pass = false; break; }
      } else if (fn === 'consume') {
        if ((pool[p.name.toLowerCase()] ?? 0) < (p.value ?? 1)) { pass = false; break; }
      }
    }
    if (!pass) { blocked.add(task.id); continue; }
    for (const req of task.requirements) {
      const p = parseTag(req);
      if (tagFn(p) !== 'consume' || !p.name) continue;
      const key = p.name.toLowerCase();
      pool[key] = (pool[key] ?? 0) - (p.value ?? 1);
    }
  }
  return blocked;
}

// Deduct consumable requirements from inventory when a task completes.
function consumeTaskItems(task) {
  for (const req of task.requirements) {
    const p = parseTag(req);
    if (tagFn(p) !== 'consume' || !p.name) continue;
    const item = state.inventory.find(i => i.name.toLowerCase() === p.name.toLowerCase());
    if (!item) continue;
    item.qty = Math.max(0, item.qty - (p.value ?? 1));
  }
  state.inventory = state.inventory.filter(i => i.qty > 0);
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

// Find all work tags on a task (#work=N or #work:skill=N). Multiple allowed; they sum.
// Returns a synthetic default of 1 unit when none are present (all tasks auto-complete).
// Progress is keyed by skill name for named tags, '' for nameless/default.
function getWorkReqs(task) {
  const all = task.requirements
    .map(r => parseTag(r))
    .filter(p => p.type === 'work' && !p.isReq && p.value !== null && p.value > 0);
  return all.length > 0 ? all : [{ type: 'work', name: null, value: 1, isReq: false }];
}

function checkTaskComplete(task) {
  const reqs = getWorkReqs(task);
  const totalRequired = reqs.reduce((sum, e) => sum + e.value, 0);
  const totalProgress = reqs.reduce((sum, e) => sum + (task.workProgress?.[e.name || ''] ?? 0), 0);
  return totalProgress >= totalRequired;
}

// Returns true if the agent satisfies all req: requirements on the task.
// Agent attributes don't carry req:; we strip it from the task side and match on type+name.
function validateAssignment(agent, task) {
  // Task requirements → agent attributes
  for (const req of task.requirements) {
    const reqP = parseTag(req);
    if (!reqP.isReq) continue;
    const fn = tagFn(reqP);
    if (fn === 'block' || fn === 'consume') continue; // inventory reqs handled separately
    if (!reqP.name) continue;
    const match = agent.attributes.find(attr => {
      const p = parseTag(attr);
      return p.type === reqP.type && p.name && p.name.toLowerCase() === reqP.name.toLowerCase();
    });
    if (!match) return false;
    if (reqP.value !== null) {
      if ((parseTag(match).value ?? 0) < reqP.value) return false;
    }
  }
  // Agent requirements → task tags (non-req; task req tags describe conditions on agents, not task properties)
  for (const attr of agent.attributes) {
    const reqP = parseTag(attr);
    if (!reqP.isReq) continue;
    const match = task.requirements.find(t => {
      const p = parseTag(t);
      if (p.isReq) return false;
      return p.type === reqP.type && (
        reqP.name === null || (p.name && p.name.toLowerCase() === reqP.name.toLowerCase())
      );
    });
    if (!match) return false;
    if (reqP.value !== null) {
      if ((parseTag(match).value ?? 0) < reqP.value) return false;
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

    if (attrP.isReq) {
      // Agent req attribute: active when the task satisfies it
      const match = task.requirements.find(t => {
        const p = parseTag(t);
        if (p.isReq) return false;
        return p.type === attrP.type && (
          attrP.name === null || (p.name && p.name.toLowerCase() === attrP.name.toLowerCase())
        );
      });
      if (match && (attrP.value === null || (parseTag(match).value ?? 0) >= attrP.value)) return true;
    } else {
      // Agent attribute: active when required by the task
      for (const req of task.requirements) {
        const reqP = parseTag(req);
        if (!reqP.isReq) continue;
        const fn = tagFn(reqP);
        if (fn === 'block' || fn === 'consume') continue;
        if (!reqP.name || !attrP.name) continue;
        if (reqP.type === attrP.type && reqP.name.toLowerCase() === attrP.name.toLowerCase()) return true;
      }
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

function agentMatchesTask(agent, task) {
  return validateAssignment(agent, task);
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
  let label;
  if (p.type === 'task') {
    const task = state.tasks.find(t => t.id === p.name);
    label = task ? `#${task.name}` : `#${p.type}:${p.name}`;
  } else if (p.name === null) {
    label = `#${p.type}`;
  } else {
    label = `#${p.type}:${p.name}`;
  }
  const children = [label];
  if (p.value !== null && p.type !== 'task') {
    children.push(el('span', { class: 'tag-value', text: `=${p.value}` }));
  }
  children.push(el('span', {
    class: 'x',
    text: '×',
    title: 'Remove',
    onclick: (e) => { e.stopPropagation(); onRemove(); }
  }));
  return el('span', { class: 'tag' + (active ? ' active' : '') }, children);
}

// Tag builder modal with structured fields for type, name, value.
// Intelligently shows/hides fields based on tag type and context.
// Unified tag builder for both agent attributes and task tags.
// context: 'attribute' shows attribute schema entries flat.
//          'task'      shows all non-attribute entries grouped by context (optgroups).
// Selecting a recognized pattern auto-configures name/value fields.
// The last option ("Custom") exposes a free-form type input for unrecognized tags.
function showTagBuilder({ context = 'attribute', initialPreset = undefined, onSave = () => {}, onCancel = () => {} } = {}) {
  const isTask = context === 'task';
  const title = isTask ? 'ADD TAG' : 'NEW ATTRIBUTE';

  const overlay = el('div', {
    class: 'tag-builder-overlay',
    onclick: (e) => { if (e.target === overlay) { onCancel(); overlay.remove(); } }
  });
  const card = el('div', { class: 'tag-builder-card' });
  card.appendChild(el('div', { class: 'tag-builder-title', text: title }));
  const fieldsWrapper = el('div', { class: 'tag-builder-fields' });

  // ── PRESET selector — schema entries as convenience presets ───────────────
  const presetSelect = el('select', { class: 'tag-builder-field' });
  presetSelect.appendChild(el('option', { text: '— custom —', value: '' }));

  if (isTask) {
    const groups = [...new Set(
      Object.values(TAG_SCHEMA)
        .filter(e => e.context !== 'attribute')
        .map(e => e.context)
    )];
    groups.forEach(ctx => {
      const grp = document.createElement('optgroup');
      grp.label = ctx.toUpperCase();
      getSchemaByContext(ctx).forEach(([key, entry]) => {
        grp.appendChild(el('option', { text: entry.label, value: key }));
      });
      presetSelect.appendChild(grp);
    });
  } else {
    const grp = document.createElement('optgroup');
    grp.label = 'ATTRIBUTE';
    getSchemaByContext('attribute').forEach(([key, entry]) => {
      grp.appendChild(el('option', { text: entry.label, value: key }));
    });
    presetSelect.appendChild(grp);
  }

  fieldsWrapper.appendChild(el('div', { class: 'tag-builder-row' }, [
    el('label', { class: 'tag-builder-label', text: 'PRESET' }),
    presetSelect
  ]));

  // ── TYPE row: REQ toggle + type text input ────────────────────────────────
  let reqActive = false;
  const reqBtn = el('button', {
    class: 'ctrl tag-builder-req-btn',
    text: 'REQ',
    title: 'Prepend req: prefix'
  });
  reqBtn.addEventListener('click', (e) => {
    e.preventDefault();
    reqActive = !reqActive;
    reqBtn.classList.toggle('active', reqActive);
    updatePreview();
  });

  const typeInput = el('input', { class: 'tag-builder-field', placeholder: 'type', spellcheck: 'false' });

  fieldsWrapper.appendChild(el('div', { class: 'tag-builder-row' }, [
    el('label', { class: 'tag-builder-label', text: 'TYPE' }),
    reqBtn,
    typeInput
  ]));

  // ── NAME field ────────────────────────────────────────────────────────────
  const nameLabelEl = el('label', { class: 'tag-builder-label', text: 'NAME' });
  const nameInput   = el('input', { class: 'tag-builder-field', placeholder: 'optional', spellcheck: 'false' });
  fieldsWrapper.appendChild(el('div', { class: 'tag-builder-row' }, [nameLabelEl, nameInput]));

  // ── VALUE field ───────────────────────────────────────────────────────────
  const valueLabelEl = el('label', { class: 'tag-builder-label', text: 'VALUE' });
  const valueInput   = el('input', { class: 'tag-builder-field', type: 'number', placeholder: 'optional', step: 'any' });
  fieldsWrapper.appendChild(el('div', { class: 'tag-builder-row' }, [valueLabelEl, valueInput]));

  // ── Live tag preview ──────────────────────────────────────────────────────
  const previewEl = el('div', { class: 'tag-builder-preview', text: '—' });
  fieldsWrapper.appendChild(el('div', { class: 'tag-builder-row' }, [
    el('label', { class: 'tag-builder-label', text: 'TAG' }),
    previewEl
  ]));

  // ── Apply preset — loads schema entry into fields, never hides them ───────
  function applyPreset() {
    const key   = presetSelect.value;
    const entry = key ? TAG_SCHEMA[key] : null;
    if (entry) {
      typeInput.value          = entry.type;
      reqActive                = entry.isReq;
      nameLabelEl.textContent  = entry.nameLabel  ?? 'NAME';
      valueLabelEl.textContent = entry.valueLabel ?? 'VALUE';
      nameInput.value          = entry.nameFixed  ?? '';
      nameInput.placeholder    = entry.hasName    ? 'name'   : 'optional';
      valueInput.placeholder   = entry.hasValue   ? 'amount' : 'optional';
    } else {
      typeInput.value          = '';
      reqActive                = false;
      nameLabelEl.textContent  = 'NAME';
      valueLabelEl.textContent = 'VALUE';
      nameInput.value          = '';
      nameInput.placeholder    = 'optional';
      valueInput.placeholder   = 'optional';
    }
    reqBtn.classList.toggle('active', reqActive);
    updatePreview();
  }

  function updatePreview() {
    const type = typeInput.value.trim();
    const name = nameInput.value.trim() || null;
    const val  = valueInput.value.trim() ? parseFloat(valueInput.value) : null;
    previewEl.textContent = type
      ? (buildTag(type, name, val, reqActive) ?? `#${reqActive ? 'req:' : ''}${type}`)
      : '—';
  }

  presetSelect.addEventListener('change', applyPreset);
  [typeInput, nameInput, valueInput].forEach(inp => inp.addEventListener('input', updatePreview));

  // Auto-select initial preset: explicit override, else first schema entry for context
  const startKey = initialPreset !== undefined ? initialPreset : (isTask
    ? Object.keys(TAG_SCHEMA).find(k => TAG_SCHEMA[k].context !== 'attribute')
    : Object.keys(TAG_SCHEMA).find(k => TAG_SCHEMA[k].context === 'attribute'));
  if (startKey != null) presetSelect.value = startKey;
  applyPreset();

  card.appendChild(fieldsWrapper);

  // ── Save ──────────────────────────────────────────────────────────────────
  function saveTag() {
    const type = typeInput.value.trim();
    if (!type) { typeInput.classList.add('error'); return; }
    const name = nameInput.value.trim() || null;
    const val  = valueInput.value.trim() ? parseFloat(valueInput.value) : null;
    const tag  = buildTag(type, name, val, reqActive) ?? `#${reqActive ? 'req:' : ''}${type}`;
    onSave(tag);
    overlay.remove();
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────
  [presetSelect, typeInput, nameInput, valueInput].forEach(inp => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); saveTag(); }
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); overlay.remove(); }
    });
  });

  card.appendChild(el('div', { class: 'tag-builder-buttons' }, [
    el('button', { class: 'ctrl', text: 'SAVE',   onclick: (e) => { e.stopPropagation(); saveTag(); } }),
    el('button', { class: 'ctrl', text: 'CANCEL', onclick: (e) => { e.stopPropagation(); onCancel(); overlay.remove(); } })
  ]));

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  presetSelect.focus();
}

// Flat map of every recognized tag pattern. Each entry fully describes structure and behavior.
// Keys are canonical pattern IDs. Adding a new entry is all that's needed to expand the system.
//
// context  — where the tag lives: 'attribute' (on agents) | 'requirement'|'work'|'reward' (on tasks)
// type     — raw type string written by buildTag()
// isReq    — prepend #req: when true
// hasName  — user provides a name field
// hasValue — user provides a value field
// nameFixed — name is baked into the pattern (not user-input)
// fn       — behavior key used by tagFn(); drives logic dispatch
const TAG_SCHEMA = {
  // ── Attribute tags (on agents): #type:name[=value] ──────────────────────
  skill:            { label: 'Skill',      context: 'attribute',   type: 'skill',      isReq: false, hasName: true,  hasValue: true,  nameLabel: 'Name', valueLabel: 'Level'     },
  tool:             { label: 'Tool',       context: 'attribute',   type: 'tool',       isReq: false, hasName: true,  hasValue: false, nameLabel: 'Name'                           },
  trait:            { label: 'Trait',      context: 'attribute',   type: 'trait',      isReq: false, hasName: true,  hasValue: false, nameLabel: 'Name'                           },
  class:            { label: 'Class',      context: 'attribute',   type: 'class',      isReq: false, hasName: true,  hasValue: false, nameLabel: 'Name'                           },
  race:             { label: 'Race',       context: 'attribute',   type: 'race',       isReq: false, hasName: true,  hasValue: false, nameLabel: 'Name'                           },
  level:            { label: 'Level',      context: 'attribute',   type: 'level',      isReq: false, hasName: true,  hasValue: true,  nameLabel: 'Name', valueLabel: 'Value'     },
  // ── Task requirement tags: #req:type:name[=value] ────────────────────────
  'req:skill':      { label: 'Skill',      context: 'requirement', type: 'skill',      isReq: true,  hasName: true,  hasValue: true,  nameLabel: 'Name', valueLabel: 'Min Level', fn: 'require'      },
  'req:tool':       { label: 'Tool',       context: 'requirement', type: 'tool',       isReq: true,  hasName: true,  hasValue: false, nameLabel: 'Name',                           fn: 'require'      },
  'req:trait':      { label: 'Trait',      context: 'requirement', type: 'trait',      isReq: true,  hasName: true,  hasValue: false, nameLabel: 'Name',                           fn: 'require'      },
  'req:class':      { label: 'Class',      context: 'requirement', type: 'class',      isReq: true,  hasName: true,  hasValue: false, nameLabel: 'Name',                           fn: 'require'      },
  'req:race':       { label: 'Race',       context: 'requirement', type: 'race',       isReq: true,  hasName: true,  hasValue: false, nameLabel: 'Name',                           fn: 'require'      },
  'req:item':       { label: 'Item',       context: 'requirement', type: 'item',       isReq: true,  hasName: true,  hasValue: true,  nameLabel: 'Name', valueLabel: 'Qty',         fn: 'block'        },
  'req:consumable': { label: 'Consumable', context: 'requirement', type: 'consumable', isReq: true,  hasName: true,  hasValue: true,  nameLabel: 'Name', valueLabel: 'Qty',         fn: 'consume'      },
  // ── Task work tags: #work=N or #work:skill=N ─────────────────────────────
  work:             { label: 'General',    context: 'work',        type: 'work',       isReq: false, hasName: false, hasValue: true,  valueLabel: 'Target',                        fn: 'work'         },
  'work:skill':     { label: 'Skill',      context: 'work',        type: 'work',       isReq: false, hasName: true,  hasValue: true,  nameLabel: 'Skill', valueLabel: 'Target',    fn: 'work-skill'   },
  // ── Task reward tags: #reward:name=value ─────────────────────────────────
  'reward:gold':    { label: 'Gold',       context: 'reward',      type: 'reward',     isReq: false, hasName: false, hasValue: true,  nameFixed: 'gold', valueLabel: 'Amount',     fn: 'reward-gold'  },
};

// Resolve a parsed tag to its schema entry, or null for unrecognized/custom tags.
function getSchemaEntry(parsed) {
  if (!parsed.isReq && parsed.name) {
    const fixed = Object.values(TAG_SCHEMA).find(e => e.type === parsed.type && e.nameFixed === parsed.name);
    if (fixed) return fixed;
  }
  if (!parsed.isReq && parsed.type === 'work' && parsed.name) return TAG_SCHEMA['work:skill'];
  return TAG_SCHEMA[(parsed.isReq ? 'req:' : '') + parsed.type] ?? null;
}

// Return the fn key for a parsed tag, or null for unrecognized tags.
function tagFn(parsed) {
  return getSchemaEntry(parsed)?.fn ?? null;
}

// Schema entries filtered to one or more contexts, as [key, entry] pairs.
function getSchemaByContext(...contexts) {
  return Object.entries(TAG_SCHEMA).filter(([, e]) => contexts.includes(e.context));
}

/* ---------- Task body sections (work / require / reward / tag) ---------- */
function renderWorkSection(task) {
  const wrap = el('div', { class: 'task-section' });
  wrap.appendChild(el('div', { class: 'tag-label', text: 'WORK' }));

  const progMap = task.workProgress ?? {};
  const list = el('div', { class: 'work-list' });

  const workEntries = [];
  task.requirements.forEach((tagStr, idx) => {
    const p = parseTag(tagStr);
    if (p.type === 'work' && !p.isReq) workEntries.push({ p, idx });
  });

  if (workEntries.length === 0) {
    const progress = progMap[''] ?? 0;
    list.appendChild(buildWorkRow('GENERAL', 1, progress, null, null));
  } else {
    workEntries.forEach(({ p, idx }) => {
      const key = p.name || '';
      const target = p.value ?? 1;
      const progress = progMap[key] ?? 0;
      list.appendChild(buildWorkRow(p.name ? p.name.toUpperCase() : 'GENERAL', target, progress, task, idx));
    });
  }

  wrap.appendChild(list);
  wrap.appendChild(el('button', {
    class: 'tag-add',
    text: '+ WORK',
    onclick: (e) => {
      e.stopPropagation();
      showTagBuilder({
        context: 'task', initialPreset: 'work',
        onSave: (tag) => { task.requirements.push(tag); save(); render(); },
      });
    }
  }));
  return wrap;
}

function buildWorkRow(label, target, progress, task, reqIdx) {
  const done = progress >= target;
  const pct = target > 0 ? Math.min(100, (progress / target) * 100) : 0;
  const item = el('div', { class: 'work-item' + (done ? ' done' : '') });
  item.appendChild(el('span', { class: 'work-item-skill', text: label }));
  const bar = el('div', { class: 'work-item-bar' });
  bar.appendChild(el('div', { class: 'work-item-bar-fill', style: { width: `${pct.toFixed(1)}%` } }));
  item.appendChild(bar);
  item.appendChild(el('span', { class: 'work-item-value', text: `${Math.floor(progress)} / ${target}` }));
  if (task && reqIdx !== null) {
    item.appendChild(el('span', {
      class: 'x', text: '×',
      onclick: (e) => { e.stopPropagation(); task.requirements.splice(reqIdx, 1); save(); render(); }
    }));
  }
  return item;
}

function renderTagSection(task, label, filterFn, builderPreset) {
  const wrap = el('div', { class: 'task-section' });
  wrap.appendChild(el('div', { class: 'tag-label', text: label }));

  const tagList = el('div', { class: 'task-tag-list' });
  let count = 0;
  task.requirements.forEach((tagStr, i) => {
    if (!filterFn(parseTag(tagStr))) return;
    count++;
    tagList.appendChild(el('div', { class: 'tag-list-item' }, [
      el('span', { class: 'tag-content', text: formatTagDisplay(tagStr) }),
      el('span', {
        class: 'x', text: '×',
        onclick: (e) => { e.stopPropagation(); task.requirements.splice(i, 1); save(); render(); }
      })
    ]));
  });
  if (!count) tagList.appendChild(el('div', { class: 'empty-state', text: '—' }));

  wrap.appendChild(tagList);
  wrap.appendChild(el('button', {
    class: 'tag-add',
    text: `+ ${label}`,
    onclick: (e) => {
      e.stopPropagation();
      showTagBuilder({
        context: 'task', initialPreset: builderPreset,
        onSave: (tag) => { task.requirements.push(tag); save(); render(); },
      });
    }
  }));
  return wrap;
}

// Format tag for display with proper symbols
function formatTagDisplay(tagStr) {
  const p = parseTag(tagStr);
  let display = `#${p.type}`;
  if (p.name) display += `:${p.name}`;
  if (p.value !== null) display += `=${p.value}`;
  return display;
}

/* ---------- Agent card ---------- */
function renderAgentCard(agent) {
  const card = el('div', {
    class: 'agent-card' + (() => {
      if (!ui.selectedTaskId) return '';
      const t = state.tasks.find(t => t.id === ui.selectedTaskId);
      return t ? (agentMatchesTask(agent, t) ? ' assignable' : ' not-assignable') : '';
    })(),
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
        showTagBuilder({
          context: 'attribute',
          onSave: (tag) => {
            const incoming = parseTag(tag);
            agent.attributes = agent.attributes.filter(t => {
              const p = parseTag(t);
              return !(p.type === incoming.type && p.name === incoming.name);
            });
            agent.attributes.push(tag);
            save(); render();
          },
          onCancel: () => {}
        });
      },
      onRemove: (i) => { agent.attributes.splice(i, 1); save(); render(); }
    }
  ));
  card.appendChild(attrSect);

  // Tasks: read-only. Populated via task-assignment; × unassigns.
  // Only incomplete tasks are shown. First is highlighted (current); rest are queued (dim).
  const actSect = el('div', { class: 'tag-section' });
  actSect.appendChild(el('div', { class: 'tag-label', text: 'TASKS' }));
  const actList = el('div', { class: 'tag-list' });
  let foundCurrent = false;
  agent.activities.forEach(actTag => {
    const p = parseTag(actTag);
    if (p.type !== 'task') return;
    const task = state.tasks.find(t => t.id === p.name);
    if (!task || task.isComplete) return;
    const isCurrent = !foundCurrent;
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

  // Action row: duplicate + delete
  const delRow = el('div', { class: 'tag-section action-row' });
  delRow.appendChild(el('button', {
    class: 'delete-btn',
    text: '⎘ COPY',
    title: 'Duplicate hireling',
    onclick: (e) => { e.stopPropagation(); duplicateAgent(agent.id); }
  }));
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

// Header progress bar (2px line in highlight color, % filled).
// Visible whether collapsed or expanded. Shows overall progress toward total effort.
function renderTaskProgressBar(task) {
  const reqs = getWorkReqs(task);
  const totalRequired = reqs.reduce((sum, e) => sum + e.value, 0);
  let totalProgress = 0;
  if (task.isComplete) {
    totalProgress = totalRequired;
  } else {
    totalProgress = reqs.reduce((sum, e) => sum + (task.workProgress?.[e.name || ''] ?? 0), 0);
  }

  const pct = totalRequired > 0 ? Math.min(100, (totalProgress / totalRequired) * 100) : 0;

  const wrap = el('div', { class: 'task-progress' });
  wrap.appendChild(el('div', { class: 'task-progress-fill', data: { taskId: task.id }, style: { width: `${pct.toFixed(1)}%` } }));
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

  // Always-visible single progress bar (full when complete).
  const progressBar = renderTaskProgressBar(task);
  if (progressBar) card.appendChild(progressBar);

  // Body (visible when expanded)
  const body = el('div', { class: 'task-body' });

  body.appendChild(el('div', { class: 'tag-label', text: 'DESCRIPTION' }));
  const desc = editable(task.description, (v) => { task.description = v; save(); render(); });
  desc.classList.add('task-desc');
  body.appendChild(desc);

  body.appendChild(renderWorkSection(task));
  body.appendChild(renderTagSection(task, 'REQUIRE', p => p.isReq, 'req:skill'));
  body.appendChild(renderTagSection(task, 'REWARD',  p => !p.isReq && p.type === 'reward', 'reward:gold'));
  // Catch-all for custom / unrecognized tags
  const hasCustom = task.requirements.some(r => {
    const p = parseTag(r); return !p.isReq && p.type !== 'work' && p.type !== 'reward';
  });
  if (hasCustom) body.appendChild(renderTagSection(task, 'TAG',
    p => !p.isReq && p.type !== 'work' && p.type !== 'reward', ''));

  // Assigned-to summary line
  const assigned = agentsAssignedTo(task.id);
  if (assigned.length) {
    body.appendChild(el('div', {
      class: 'assigned-list',
      text: 'ASSIGNED: ' + assigned.map(a => a.name).join(', ')
    }));
  }

  // Status row: complete toggle + duplicate + delete
  const statusRow = el('div', { class: 'task-status-row action-row' });
  statusRow.appendChild(el('button', {
    class: 'tag-add',
    text: task.isComplete ? '↻' : '✓',
    title: task.isComplete ? 'Mark incomplete' : 'Mark complete',
    onclick: (e) => {
      e.stopPropagation();
      task.isComplete = !task.isComplete;
      if (task.isComplete) completeTask(task);
      save(); render();
    }
  }));
  statusRow.appendChild(el('span', { text: task.isComplete ? 'COMPLETE' : 'INCOMPLETE' }));
  statusRow.appendChild(el('button', {
    class: 'delete-btn',
    text: '⎘ COPY',
    title: 'Duplicate task',
    onclick: (e) => { e.stopPropagation(); duplicateTask(task.id); }
  }));
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
  const { activeAgentEmpty, idleAgentEmpty, taskEmpty } = config.defaults.defaultMessages;
  // Menu values
  const sessIdEl = document.getElementById('session-id');
  if (document.activeElement !== sessIdEl) sessIdEl.textContent = state.session.id;
  document.getElementById('clock').textContent = formatClock(state.session.clock);
  const rateEl = document.getElementById('playback-rate');
  if (rateEl && document.activeElement !== rateEl) rateEl.textContent = state.session.playbackRate;
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
    (b.lastAssigned ?? b.createdAt) - (a.lastAssigned ?? a.createdAt)
  );
  idle.sort((a, b) =>
    (b.lastAssigned ?? b.createdAt) - (a.lastAssigned ?? a.createdAt)
  );

  const activeEl = document.getElementById('active-agents');
  const idleEl = document.getElementById('idle-agents');
  activeEl.innerHTML = '';
  idleEl.innerHTML = '';

  // Active agents: show all with their tasks. Idle agents: show all with "no active tasks" message.
  if (!active.length) activeEl.appendChild(el('div', { class: 'empty', text: activeAgentEmpty }));
  else active.forEach(a => activeEl.appendChild(renderAgentCard(a)));

  // Add buttons: always visible at the end of each list.
  if (!idle.length) idleEl.appendChild(el('div', { class: 'empty', text: idleAgentEmpty }));
  else idle.forEach(a => idleEl.appendChild(renderAgentCard(a)));
  idleEl.appendChild(el('button', {
    class: 'add-inline',
    text: '+ AGENT',
    onclick: (e) => { e.stopPropagation(); createAgent(); }
  }));

  // Tasks: incomplete first, then most recently created.
  const taskList = document.getElementById('task-list');
  taskList.innerHTML = '';
  if (!state.tasks.length) {
    taskList.appendChild(el('div', { class: 'empty', text: taskEmpty }));
  } else {
    [...state.tasks]
      .sort((a, b) => (a.isComplete - b.isComplete) || (b.createdAt - a.createdAt))
      .forEach(t => taskList.appendChild(renderTaskCard(t)));
  }
  taskList.appendChild(el('button', {
    class: 'add-inline',
    text: '+ TASK',
    onclick: (e) => { e.stopPropagation(); createTask(); }
  }));
}

/* ---------- Time management ---------- */
function getStepMinutes() {
  const m = String(state.session.timeStep).match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 60;
}

function advanceTime() {
  ui.lastTickWallTime = Date.now();
  ui.taskWorkPerTick = {}; // reset per-tick rates for progress interpolation
  const stepMins = getStepMinutes();
  const stepDays = stepMins / 1440;

  // Agents whose first non-complete task exists (they're working this step).
  const working = state.agents.filter(a => getCurrentTask(a) !== null);

  if (working.length) {
    // Split working agents into eligible (item/consumable reqs satisfied) and blocked.
    const activeTasks = [...new Set(working.map(a => getCurrentTask(a)).filter(Boolean))];
    const blockedIds  = getItemBlockedTasks(activeTasks);
    const eligible    = working.filter(a => !blockedIds.has(getCurrentTask(a)?.id));
    working.filter(a => blockedIds.has(getCurrentTask(a)?.id)).forEach(a => flashError(a.id));

    if (eligible.length) {
      const totalCost = eligible.reduce((sum, a) => sum + (parseFloat(a.rate) || 0) * stepDays, 0);

      if (totalCost > (state.session.bank ?? 0)) {
        // Can't pay everyone: flash all eligible agents, no work advances.
        eligible.forEach(a => flashError(a.id));
      } else {
        state.session.bank = Math.round(((state.session.bank ?? 0) - totalCost) * 100) / 100;

        const tasksWithWork = new Set();

        const workRate   = state.session.workRate   ?? 1;
        const skillBonus = state.session.skillBonus ?? 1;

        for (const agent of eligible) {
          const task = getCurrentTask(agent);
          if (!task) continue;

          let agentContributed = false;

          for (const req of getWorkReqs(task)) {
            const key = req.name || '';
            // Base: workRate per step. Named skill: (workRate + skillVal × skillBonus) per step.
            let rate = workRate * stepDays;
            if (req.name) {
              const skillTag = agent.attributes.find(attr => {
                const ap = parseTag(attr);
                return ap.type === 'skill' && ap.name.toLowerCase() === req.name.toLowerCase();
              });
              const skillVal = skillTag ? (parseTag(skillTag).value ?? 0) : 0;
              if (skillVal > 0) rate = (workRate + skillVal * skillBonus) * stepDays;
            }
            task.workProgress[key] = (task.workProgress[key] ?? 0) + rate;
            ui.taskWorkPerTick[task.id] = (ui.taskWorkPerTick[task.id] ?? 0) + rate;
            agentContributed = true;
            tasksWithWork.add(task.id);
          }

          if (!agentContributed) flashError(agent.id);
        }

        // Flash agents whose task got zero work this step (no one has the required skills).
        for (const agent of eligible) {
          const task = getCurrentTask(agent);
          if (!task) continue;
          if (!tasksWithWork.has(task.id)) flashError(agent.id);
        }

        // Auto-complete tasks whose effort requirements are now satisfied.
        let anyCompleted = false;
        for (const task of state.tasks) {
          if (!task.isComplete && checkTaskComplete(task)) {
            completeTask(task);
            anyCompleted = true;
          }
        }
        if (anyCompleted) {
          state.session.clock = (parseFloat(state.session.clock) || 0) + stepMins;
          save();
          render();
          return;
        }
      }
    }
  }

  state.session.clock = (parseFloat(state.session.clock) || 0) + stepMins;
  save();
  updateTickDisplay();
}

// Lightweight tick update: patches only fields that change every advanceTime() call
// without requiring a full DOM rebuild. Called when no structural changes occurred.
function updateTickDisplay() {
  const bankEl = document.getElementById('bank');
  if (bankEl && document.activeElement !== bankEl)
    bankEl.textContent = (state.session.bank ?? 0).toFixed(1);
}

// Continuous clock display: interpolates position within the current tick interval
// so the clock advances smoothly instead of jumping on each advanceTime() call.
function updateClockDisplay() {
  if (!ui.playing) return;
  const elapsed = Date.now() - ui.lastTickWallTime;
  const frac = Math.min(1, elapsed / ui.tickIntervalMs);

  const clockEl = document.getElementById('clock');
  if (clockEl) {
    const stepMins = getStepMinutes();
    clockEl.textContent = formatClock(state.session.clock + frac * stepMins);
  }

  const rates = ui.taskWorkPerTick || {};
  for (const task of state.tasks) {
    if (task.isComplete) continue;
    const workPerTick = rates[task.id] ?? 0;
    if (!workPerTick) continue;
    const reqs = getWorkReqs(task);
    const totalRequired = reqs.reduce((sum, e) => sum + e.value, 0);
    if (!totalRequired) continue;
    const stored = reqs.reduce((sum, e) => sum + (task.workProgress?.[e.name || ''] ?? 0), 0);
    const pct = Math.min(100, ((stored + frac * workPerTick) / totalRequired) * 100);
    const fill = document.querySelector(`.task-progress-fill[data-task-id="${task.id}"]`);
    if (fill) fill.style.width = `${pct.toFixed(1)}%`;
  }

  ui.animationFrameId = requestAnimationFrame(updateClockDisplay);
}

function getPlayIntervalMs() {
  // rate = game-minutes per real second; step = game-minutes per tick
  // → interval = step / rate seconds = step * 1000 / rate ms
  const rate = state.session.rateMultiplier || 1;
  const step = getStepMinutes();
  return Math.max(16, (step * 1000) / rate);
}

function startPlay() {
  if (ui.playing) return;
  ui.playing = true;
  const interval = getPlayIntervalMs();
  ui.tickIntervalMs = interval;
  ui.lastTickWallTime = Date.now();
  ui.playInterval = setInterval(advanceTime, interval);
  updateClockDisplay();
  updatePlayButtons();
}

function stopPlay() {
  if (!ui.playing) return;
  ui.playing = false;
  clearInterval(ui.playInterval);
  ui.playInterval = null;
  if (ui.animationFrameId) {
    cancelAnimationFrame(ui.animationFrameId);
    ui.animationFrameId = null;
  }
  render();
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

/* ---------- Config panel ---------- */
function showConfigPanel() {
  const existing = document.getElementById('config-overlay');
  if (existing) { existing.remove(); return; }

  const overlay = el('div', {
    class: 'config-overlay',
    id: 'config-overlay',
    onclick: (e) => { if (e.target === overlay) overlay.remove(); }
  });

  const panel = el('div', { class: 'config-panel' });
  panel.appendChild(el('h2', { text: 'SETTINGS' }));

  // Time rate multiplier
  const rateRow = el('div', { class: 'config-row' });
  rateRow.appendChild(el('label', { text: 'TIME RATE' }));
  const rateInput = el('input', {
    type: 'number', min: '0.1', step: '0.1',
    value: String(state.session.rateMultiplier ?? 1),
  });
  rateInput.addEventListener('change', () => {
    const v = parseFloat(rateInput.value);
    state.session.rateMultiplier = isNaN(v) || v <= 0 ? 1 : v;
    save();
    if (ui.playing) { stopPlay(); startPlay(); }
  });
  rateRow.appendChild(rateInput);
  panel.appendChild(rateRow);

  // Work rate
  const workRateRow = el('div', { class: 'config-row' });
  workRateRow.appendChild(el('label', { text: 'WORK RATE' }));
  const workRateInput = el('input', {
    type: 'number', min: '0', step: '0.1',
    value: String(state.session.workRate ?? 1),
  });
  workRateInput.addEventListener('change', () => {
    const v = parseFloat(workRateInput.value);
    state.session.workRate = isNaN(v) || v < 0 ? 1 : v;
    save();
  });
  workRateRow.appendChild(workRateInput);
  panel.appendChild(workRateRow);

  // Skill bonus
  const skillBonusRow = el('div', { class: 'config-row' });
  skillBonusRow.appendChild(el('label', { text: 'SKILL BONUS' }));
  const skillBonusInput = el('input', {
    type: 'number', min: '0', step: '0.1',
    value: String(state.session.skillBonus ?? 1),
  });
  skillBonusInput.addEventListener('change', () => {
    const v = parseFloat(skillBonusInput.value);
    state.session.skillBonus = isNaN(v) || v < 0 ? 1 : v;
    save();
  });
  skillBonusRow.appendChild(skillBonusInput);
  panel.appendChild(skillBonusRow);

  // Close button
  panel.appendChild(el('button', {
    class: 'ctrl',
    text: 'CLOSE',
    onclick: () => overlay.remove(),
    style: { alignSelf: 'flex-end', marginTop: '8px' }
  }));

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

/* ---------- Inventory panel ---------- */
function showInventoryPanel() {
  const existing = document.getElementById('inventory-overlay');
  if (existing) { existing.remove(); return; }

  const overlay = el('div', {
    class: 'config-overlay',
    id: 'inventory-overlay',
    onclick: (e) => { if (e.target === overlay) overlay.remove(); }
  });

  function renderPanel() {
    overlay.innerHTML = '';

    const panel = el('div', { class: 'config-panel inventory-panel' });
    panel.appendChild(el('h2', { text: 'INVENTORY' }));

    const list = el('div', { class: 'inventory-list' });

    if (!state.inventory.length) {
      list.appendChild(el('div', { class: 'empty-state', text: 'No items' }));
    } else {
      state.inventory.forEach((item, i) => {
        const row = el('div', { class: 'inventory-row' });

        const nameSpan = editable(item.name, (v) => {
          item.name = v || 'ITEM';
          save();
        });
        nameSpan.classList.add('inventory-name');

        const sep = el('span', { class: 'inventory-sep', text: '|' });

        const qtySpan = editable(String(item.qty), (v) => {
          const n = parseFloat(v);
          if (isNaN(n) || n <= 0) {
            state.inventory.splice(i, 1);
            save();
            renderPanel();
          } else {
            item.qty = n;
            save();
          }
        });
        qtySpan.classList.add('inventory-qty');

        row.appendChild(nameSpan);
        row.appendChild(sep);
        row.appendChild(qtySpan);
        row.appendChild(el('span', {
          class: 'x',
          text: '×',
          title: 'Remove',
          onclick: (e) => { e.stopPropagation(); state.inventory.splice(i, 1); save(); renderPanel(); }
        }));

        list.appendChild(row);
      });
    }

    panel.appendChild(list);

    panel.appendChild(el('button', {
      class: 'add-inline',
      text: '+ ITEM',
      onclick: (e) => {
        e.stopPropagation();
        state.inventory.push({ id: uid(), name: 'NEW ITEM', qty: 1 });
        save();
        renderPanel();
      }
    }));

    panel.appendChild(el('button', {
      class: 'ctrl',
      text: 'CLOSE',
      onclick: () => overlay.remove(),
      style: { alignSelf: 'flex-end', marginTop: '4px' }
    }));

    overlay.appendChild(panel);
  }

  renderPanel();
  document.body.appendChild(overlay);
}

/* ---------- Reset ---------- */
function resetAll() {
  if (!confirm('Reset everything to defaults? All agents, tasks, and inventory will be lost.')) return;
  if (ui.playing) stopPlay();
  localStorage.removeItem(STORAGE_KEY);
  state = {
    session: { id: '001', clock: 0, timeStep: '60', playbackRate: '1', bank: 100, rateMultiplier: 1, workRate: 1, skillBonus: 1 },
    agents: [],
    tasks: [],
    inventory: [],
  };
  ui.selectedTaskId = null;
  ui.expandedTasks.clear();
  ui.taskWorkPerTick = {};
  save();
  render();
}

/* ---------- Wiring ---------- */
function wireMenu() {
  document.getElementById('add-agent').onclick = createAgent;
  document.getElementById('add-task').onclick  = createTask;
  document.getElementById('clear-active').onclick = () => {
    state.agents.forEach(a => { a.activities = a.activities.filter(t => !t.startsWith('#task:')); });
    save(); render();
  };
  document.getElementById('advance-time').onclick = advanceTime;
  document.getElementById('play-btn').onclick  = startPlay;
  document.getElementById('pause-btn').onclick = stopPlay;
  document.getElementById('inventory-btn').onclick = showInventoryPanel;
  document.getElementById('config-btn').onclick = showConfigPanel;
  document.getElementById('reset-btn').onclick = resetAll;

  // Editable session fields
  const sessId = document.getElementById('session-id');
  sessId.addEventListener('blur', () => { state.session.id = sessId.textContent.trim() || '001'; save(); render(); });
  sessId.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sessId.blur(); } });

  const ts = document.getElementById('time-step');
  ts.addEventListener('blur', () => {
    state.session.timeStep = ts.textContent.trim() || '60';
    save(); render();
    if (ui.playing) { stopPlay(); startPlay(); }  // restart so interval reflects new step
  });
  ts.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ts.blur(); } });

  const rateEl = document.getElementById('playback-rate');
  if (rateEl) {
    rateEl.addEventListener('blur', () => {
      const rawText = rateEl.textContent.trim() || '1';

      // Parse multiplier from input (accept "1x", "2x", "0.5x", or bare number)
      const m = rawText.match(/[\d.]+/);
      const mult = m ? parseFloat(m[0]) : 1;
      state.session.rateMultiplier = mult > 0 ? mult : 1;

      // Store and display as bare number (no suffix)
      state.session.playbackRate = String(state.session.rateMultiplier);
      rateEl.textContent = state.session.playbackRate;

      save();
      if (ui.playing) { stopPlay(); startPlay(); }
    });
    rateEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); rateEl.blur(); }
      if (e.key === 'Escape') { rateEl.textContent = state.session.playbackRate; }
    });
    rateEl.addEventListener('click', e => e.stopPropagation());
  }

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

  // Pause the play interval while any editable field is focused so render()
  // doesn't overwrite content mid-edit. Resume when focus leaves all editables.
  let resumeTimer = null;
  document.addEventListener('focusin', (e) => {
    if (!e.target.matches('[contenteditable], .req-field')) return;
    clearTimeout(resumeTimer);
    if (ui.playing && ui.playInterval) {
      clearInterval(ui.playInterval);
      ui.playInterval = null;
    }
  });
  document.addEventListener('focusout', (e) => {
    if (!e.target.matches('[contenteditable], .req-field')) return;
    resumeTimer = setTimeout(() => {
      if (ui.playing && !ui.playInterval) {
        const interval = getPlayIntervalMs();
        ui.tickIntervalMs = interval;
        ui.lastTickWallTime = Date.now();
        ui.playInterval = setInterval(advanceTime, interval);
      }
    }, 100);
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
