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
  session: { id: '001', clock: 0, timeStep: '60', playbackRate: '1', bank: 100, rateMultiplier: 1, effortRate: 1, skillRate: 1 },
  agents: [],     // { id, name, icon, rate, rateUnit, description, attributes[], activities[], createdAt, lastAssigned }
  tasks: [],      // { id, name, description, requirements[], effortProgress{}, isComplete, createdAt }
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
    state.session.playbackRate ??= '1';
    state.session.rateMultiplier ??= 1;
    state.session.effortRate ??= 1;
    state.session.skillRate ??= 1;
    state.inventory ??= [];
    state.inventory.forEach(item => { item.id ??= uid(); item.name ??= 'ITEM'; item.qty ??= 1; });
    state.tasks.forEach(t => {
      t.requirements ||= []; t.description ??= '';
      t.isComplete ??= false; t.createdAt ||= Date.now();
      t.effortProgress ??= {};
      // Migrate legacy requirements (no req: prefix) to req: form.
      // Multiple effort tags are now allowed (they sum together).
      t.requirements = t.requirements
        .filter(r => !!r)
        .map(r => {
          const body = r.startsWith('#') ? r.slice(1) : r;
          if (body.startsWith('req:') || body.startsWith('effort:')) return r;
          return r.startsWith('#') ? '#req:' + r.slice(1) : '#req:' + r;
        });
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

function duplicateAgent(id) {
  const orig = state.agents.find(a => a.id === id);
  if (!orig) return;
  const copy = JSON.parse(JSON.stringify(orig));
  copy.id = uid();
  copy.activities = [];        // don't carry over task assignments
  copy.createdAt = now();
  copy.lastAssigned = 0;
  state.agents.push(copy);
  save(); render();
}

function duplicateTask(id) {
  const orig = state.tasks.find(t => t.id === id);
  if (!orig) return;
  const copy = JSON.parse(JSON.stringify(orig));
  copy.id = uid();
  copy.effortProgress = {};
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
    if (p.type !== 'reward') continue;

    // Gold reward: add to bank
    if (p.name === 'gold' && p.value !== null && p.value > 0) {
      state.session.bank = (state.session.bank ?? 0) + p.value;
    }
    // Future reward types can be added here:
    // if (p.name === 'experience' && p.value !== null) { ... }
  }
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
      if (!p.isReq || !p.name) continue;
      if (p.type !== 'item' && p.type !== 'consumable') continue;
      const key = p.name.toLowerCase();
      const needed = p.value ?? 1;
      if (p.type === 'item') {
        // Item reqs check actual inventory — they don't consume, so reservations don't affect them.
        const inv = state.inventory.find(i => i.name.toLowerCase() === key);
        if (!inv || inv.qty < needed) { pass = false; break; }
      } else {
        // Consumable reqs check the running pool (reduced by prior tasks' reservations).
        if ((pool[key] ?? 0) < needed) { pass = false; break; }
      }
    }
    if (!pass) { blocked.add(task.id); continue; }
    // Task passes — reserve its consumable amounts for this tick.
    for (const req of task.requirements) {
      const p = parseTag(req);
      if (!p.isReq || p.type !== 'consumable' || !p.name) continue;
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
    if (!p.isReq || p.type !== 'consumable' || !p.name) continue;
    const key = p.name.toLowerCase();
    const item = state.inventory.find(i => i.name.toLowerCase() === key);
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

// Find all effort tags on a task (multiple allowed, they sum together).
// - Named  (#effort:skillname=N): agent needs matching skill; contributes skillVal/day.
// - Nameless (#effort=N):         any agent contributes 1/day.
// - No effort tags at all:        returns synthetic default of 1 unit (any agent contributes).
// Progress is keyed by skill name for named reqs, '' for nameless/default.
function getEffortReqs(task) {
  const all = task.requirements
    .map(r => parseTag(r))
    .filter(p => p.type === 'effort' && !p.isReq && p.value !== null && p.value > 0);
  return all.length > 0 ? all : [{ type: 'effort', name: null, value: 1, isReq: false }];
}

function hasEffortRequirements(task) {
  return getEffortReqs(task).length > 0; // always true; kept for semantic clarity
}

// Returns true when total effort progress >= total effort required.
function checkTaskComplete(task) {
  const efforts = getEffortReqs(task);
  const totalRequired = efforts.reduce((sum, e) => sum + e.value, 0);
  const totalProgress = efforts.reduce((sum, e) => sum + (task.effortProgress?.[e.name || ''] ?? 0), 0);
  return totalProgress >= totalRequired;
}

// Returns true if the agent satisfies all req: requirements on the task.
// Agent attributes don't carry req:; we strip it from the task side and match on type+name.
function validateAssignment(agent, task) {
  for (const req of task.requirements) {
    const reqP = parseTag(req);
    if (!reqP.isReq) continue;       // only req: tags gate assignment
    if (!reqP.name) continue;        // nameless reqs are global hints, not per-agent
    if (reqP.type === 'item' || reqP.type === 'consumable') continue; // inventory reqs — runtime check
    const match = agent.attributes.find(attr => {
      const p = parseTag(attr);
      return p.type === reqP.type && p.name && p.name.toLowerCase() === reqP.name.toLowerCase();
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
      if (!reqP.isReq) continue;
      if (reqP.type === 'item' || reqP.type === 'consumable') continue; // inventory reqs, not agent attrs
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

// Returns true if the agent has at least one attribute satisfying a task attribute
// requirement, or if the task has no attribute requirements (effort/item reqs only).
function agentMatchesTask(agent, task) {
  const attrReqs = task.requirements.filter(r => {
    const p = parseTag(r);
    return p.isReq && p.type !== 'item' && p.type !== 'consumable';
  });
  if (!attrReqs.length) return true;
  return attrReqs.some(req => {
    const rp = parseTag(req);
    return agent.attributes.some(attr => {
      const ap = parseTag(attr);
      return ap.type === rp.type && ap.name && rp.name &&
             ap.name.toLowerCase() === rp.name.toLowerCase();
    });
  });
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
function showTagBuilder(opts = {}) {
  const {
    context = 'attribute',  // 'attribute' | 'requirement' | 'effort'
    onSave = () => {},
    onCancel = () => {}
  } = opts;

  const overlay = el('div', {
    class: 'tag-builder-overlay',
    onclick: (e) => {
      if (e.target === overlay) { onCancel(); overlay.remove(); }
    }
  });

  const card = el('div', { class: 'tag-builder-card' });

  // Title
  const title = context === 'requirement' ? 'NEW REQUIREMENT'
              : context === 'effort' ? 'NEW EFFORT'
              : 'NEW ATTRIBUTE';
  card.appendChild(el('div', { class: 'tag-builder-title', text: title }));

  // Type field
  const typeInput = el('input', {
    class: 'tag-builder-field',
    list: context === 'requirement' ? 'req-types' : 'tag-types',
    placeholder: 'type',
    spellcheck: 'false'
  });

  // Name field (hidden for effort, time, duration, days, gold)
  const nameInput = el('input', {
    class: 'tag-builder-field',
    placeholder: 'name',
    spellcheck: 'false'
  });

  // Value field
  const valueInput = el('input', {
    class: 'tag-builder-field',
    type: 'number',
    placeholder: 'value (optional)',
    step: 'any'
  });

  // Keyboard handling
  [typeInput, nameInput, valueInput].forEach(inp => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveTag(); }
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); overlay.remove(); }
    });
  });

  // Build fields
  const fieldsWrapper = el('div', { class: 'tag-builder-fields' });

  const typeRow = el('div', { class: 'tag-builder-row' }, [
    el('label', { class: 'tag-builder-label', text: 'TYPE' }),
    typeInput
  ]);
  fieldsWrapper.appendChild(typeRow);

  const nameRow = el('div', { class: 'tag-builder-row', style: { display: 'flex' } }, [
    el('label', { class: 'tag-builder-label', text: 'NAME' }),
    nameInput
  ]);
  fieldsWrapper.appendChild(nameRow);

  // Show/hide name field based on type (now that it's in the DOM)
  const updateFieldVisibility = () => {
    const type = typeInput.value.trim().toLowerCase();
    const isNameless = context === 'effort' || NAMELESS_TYPES.has(type);
    nameRow.style.display = isNameless ? 'none' : 'flex';
  };
  typeInput.addEventListener('input', updateFieldVisibility);
  updateFieldVisibility();

  const valueRow = el('div', { class: 'tag-builder-row' }, [
    el('label', { class: 'tag-builder-label', text: 'VALUE' }),
    valueInput
  ]);
  fieldsWrapper.appendChild(valueRow);

  card.appendChild(fieldsWrapper);

  // Buttons
  function saveTag() {
    const type = typeInput.value.trim();
    const name = context === 'effort' ? null : nameInput.value.trim();
    const value = valueInput.value.trim() ? parseFloat(valueInput.value) : null;
    const isReq = context === 'requirement';

    if (!type) {
      typeInput.classList.add('error');
      return;
    }

    const tag = buildTag(type, name, value, isReq);
    if (tag) {
      onSave(tag);
      overlay.remove();
    }
  }

  const buttonsRow = el('div', { class: 'tag-builder-buttons' }, [
    el('button', {
      class: 'ctrl',
      text: 'SAVE',
      onclick: (e) => { e.stopPropagation(); saveTag(); }
    }),
    el('button', {
      class: 'ctrl',
      text: 'CANCEL',
      onclick: (e) => { e.stopPropagation(); onCancel(); overlay.remove(); }
    })
  ]);
  card.appendChild(buttonsRow);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  typeInput.focus();
}

/* ---------- Requirements editor ----------
   Each requirement is a structured row: [type][name][value][×]
   The three inputs share a blur/focus debounce so tabbing between fields
   in the same row doesn't trigger a spurious render mid-edit.
   ------------------------------------------ */
// Tag type schema: defines all supported tag patterns and their structure.
// Used for validation, UI generation, and tag builder dropdowns.
const TAG_SCHEMA = {
  'requirement': {
    label: 'Requirement',
    prefix: 'req',
    subtypes: ['skill', 'tool', 'trait', 'class', 'level', 'resource', 'guild', 'race', 'item', 'consumable'],
    hasName: true,
    hasValue: true,
    nameLabel: 'Name',
    valueLabel: 'Min Value',
    description: 'Agent requirement - must match agent attribute'
  },
  'effort': {
    label: 'Effort',
    prefix: 'effort',
    subtypes: ['skill'], // can expand to more effort types in future
    hasName: true,
    hasValue: true,
    nameLabel: 'Skill',
    valueLabel: 'Total Amount',
    description: 'Work required - accumulated from matching agent skills'
  },
  'reward': {
    label: 'Reward',
    prefix: 'reward',
    subtypes: ['gold'], // can expand to experience, items, etc
    hasName: true,
    hasValue: true,
    nameLabel: 'Type',
    valueLabel: 'Amount',
    description: 'Reward given on task completion'
  }
};

// Get all recognized tag categories (keys in TAG_SCHEMA)
function getTagCategories() {
  return Object.keys(TAG_SCHEMA);
}

// Get subtypes for a category
function getTagSubtypes(category) {
  return TAG_SCHEMA[category]?.subtypes || [];
}

// Determine tag category from a parsed tag
function getTagCategory(parsed) {
  if (parsed.isReq) return 'requirement';
  if (parsed.type === 'effort') return 'effort';
  if (parsed.type === 'reward') return 'reward';
  return null;
}

const REQ_TYPE_SUGGESTIONS = ['skill', 'tool', 'trait', 'class', 'level', 'resource', 'guild', 'race'];
const NAMELESS_TYPES = new Set(['time', 'duration', 'days', 'gold']);

/* ---------- Unified tags editor (requirements, effort, rewards) ---------- */
function renderTagsEditor(task) {
  const wrap = el('div', { class: 'tags-editor' });
  wrap.appendChild(el('div', { class: 'tag-label', text: 'TAGS' }));

  // Show all tags as a list
  const tagList = el('div', { class: 'tag-list' });
  task.requirements.forEach((tagStr, i) => {
    const p = parseTag(tagStr);
    const category = getTagCategory(p);
    const categoryLabel = TAG_SCHEMA[category]?.label || 'Tag';

    // Show tag with category badge and remove button
    const tagEl = el('div', { class: 'tag-list-item' }, [
      el('span', { class: 'tag-category-badge', text: categoryLabel }),
      el('span', { class: 'tag-content', text: formatTagDisplay(tagStr) }),
      el('span', {
        class: 'x',
        text: '×',
        title: 'Remove',
        onclick: (e) => { e.stopPropagation(); task.requirements.splice(i, 1); save(); render(); }
      })
    ]);
    tagList.appendChild(tagEl);
  });

  if (task.requirements.length === 0) {
    tagList.appendChild(el('div', { class: 'empty-state', text: 'No tags yet' }));
  }

  wrap.appendChild(tagList);

  // Add button
  wrap.appendChild(el('button', {
    class: 'tag-add',
    text: '+ TAG',
    onclick: (e) => {
      e.stopPropagation();
      showTaskTagBuilder(task);
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

function renderReqRow(task, i, reqStr) {
  const { type, name, value, isReq } = parseTag(reqStr);
  const isNameless = NAMELESS_TYPES.has(type) || name === null;

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
    style: isNameless ? { display: 'none' } : {},
  });
  const valueInput = el('input', {
    class: 'req-field req-value',
    type: 'number',
    value: value !== null ? String(value) : '',
    placeholder: '—',
    min: '0',
  });

  // Commit all three fields as one tag; 60ms lets focus move between sibling inputs.
  let blurTimer;
  function scheduleCommit() {
    blurTimer = setTimeout(() => {
      const useNameless = NAMELESS_TYPES.has(typeInput.value);
      const tag = buildTag(
        typeInput.value,
        useNameless ? null : nameInput.value,
        valueInput.value !== '' ? valueInput.value : null,
        isReq
      );
      if (tag) { task.requirements[i] = tag; save(); }
      render();
    }, 60);
  }
  function cancelCommit() { clearTimeout(blurTimer); }

  [typeInput, nameInput, valueInput].forEach(inp => {
    inp.addEventListener('blur',  scheduleCommit);
    inp.addEventListener('focus', (e) => { cancelCommit(); inp.select(); });
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
          onSave: (tag) => { agent.attributes.push(tag); save(); render(); },
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

// Task-specific tag builder with category selector
function showTaskTagBuilder(task) {
  const overlay = el('div', {
    class: 'tag-builder-overlay',
    onclick: (e) => {
      if (e.target === overlay) { overlay.remove(); }
    }
  });

  const card = el('div', { class: 'tag-builder-card' });
  card.appendChild(el('div', { class: 'tag-builder-title', text: 'ADD TAG' }));

  // Category selector
  const categoryInput = el('select', {
    class: 'tag-builder-field tag-builder-category'
  });
  categoryInput.appendChild(el('option', { text: '— Select category —', value: '' }));
  getTagCategories().forEach(cat => {
    const schema = TAG_SCHEMA[cat];
    categoryInput.appendChild(el('option', { text: schema.label, value: cat }));
  });

  // Type selector (populated based on category)
  const typeInput = el('select', {
    class: 'tag-builder-field'
  });

  // Name and value inputs
  const nameInput = el('input', {
    class: 'tag-builder-field',
    placeholder: 'name',
    spellcheck: 'false'
  });

  const valueInput = el('input', {
    class: 'tag-builder-field',
    type: 'number',
    placeholder: 'value (optional)',
    step: 'any'
  });

  // Update type options when category changes
  categoryInput.addEventListener('change', () => {
    const cat = categoryInput.value;
    const schema = TAG_SCHEMA[cat];
    typeInput.innerHTML = '';

    if (schema) {
      schema.subtypes.forEach(subtype => {
        typeInput.appendChild(el('option', { text: subtype, value: subtype }));
      });
      nameInput.placeholder = schema.nameLabel;
      valueInput.placeholder = schema.valueLabel + ' (optional)';
      nameInput.style.display = schema.hasName ? 'block' : 'none';
      valueInput.style.display = schema.hasValue ? 'block' : 'none';
    }
  });

  // Keyboard shortcuts
  [categoryInput, typeInput, nameInput, valueInput].forEach(inp => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveTag(); }
      if (e.key === 'Escape') { e.preventDefault(); overlay.remove(); }
    });
  });

  // Build form
  const fieldsWrapper = el('div', { class: 'tag-builder-fields' });

  const categoryRow = el('div', { class: 'tag-builder-row' }, [
    el('label', { class: 'tag-builder-label', text: 'CATEGORY' }),
    categoryInput
  ]);
  fieldsWrapper.appendChild(categoryRow);

  const typeRow = el('div', { class: 'tag-builder-row' }, [
    el('label', { class: 'tag-builder-label', text: 'TYPE' }),
    typeInput
  ]);
  fieldsWrapper.appendChild(typeRow);

  const nameRow = el('div', { class: 'tag-builder-row' }, [
    el('label', { class: 'tag-builder-label', text: 'NAME' }),
    nameInput
  ]);
  fieldsWrapper.appendChild(nameRow);

  const valueRow = el('div', { class: 'tag-builder-row' }, [
    el('label', { class: 'tag-builder-label', text: 'VALUE' }),
    valueInput
  ]);
  fieldsWrapper.appendChild(valueRow);

  card.appendChild(fieldsWrapper);

  // Save function
  function saveTag() {
    const category = categoryInput.value;
    const type = typeInput.value;
    const name = nameInput.value.trim();
    const value = valueInput.value.trim() ? parseFloat(valueInput.value) : null;

    if (!category || !type) {
      categoryInput.classList.add('error');
      return;
    }

    const isReq = category === 'requirement';
    // For requirement: buildTag(subtype, name, value, true) → #req:subtype:name[=value]
    // For effort: buildTag('effort', skillname, value, false) → #effort:skillname=value
    // For reward: buildTag('reward', gold, value, false) → #reward:gold=value
    const actualType = isReq ? type : category;
    let actualName;
    if (isReq) {
      actualName = name;  // requirement: use NAME field for requirement name
    } else if (category === 'effort') {
      actualName = name;  // effort: NAME field contains the skill name
    } else if (category === 'reward') {
      actualName = type;  // reward: TYPE field contains reward type (gold, etc)
    }
    const actualValue = value;

    const tag = buildTag(actualType, actualName, actualValue, isReq);
    if (tag) {
      task.requirements.push(tag);
      save(); render();
      overlay.remove();
    }
  }

  // Buttons
  const buttonsRow = el('div', { class: 'tag-builder-buttons' }, [
    el('button', {
      class: 'ctrl',
      text: 'SAVE',
      onclick: (e) => { e.stopPropagation(); saveTag(); }
    }),
    el('button', {
      class: 'ctrl',
      text: 'CANCEL',
      onclick: (e) => { e.stopPropagation(); overlay.remove(); }
    })
  ]);
  card.appendChild(buttonsRow);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  categoryInput.focus();
}

// Header progress bar (2px line in highlight color, % filled).
// Visible whether collapsed or expanded. Shows overall progress toward total effort.
function renderTaskProgressBar(task) {
  const efforts = getEffortReqs(task);
  const totalRequired = efforts.reduce((sum, e) => sum + e.value, 0);
  let totalProgress = 0;
  if (task.isComplete) {
    totalProgress = totalRequired;
  } else {
    totalProgress = efforts.reduce((sum, e) => sum + (task.effortProgress?.[e.name || ''] ?? 0), 0);
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

  body.appendChild(renderTagsEditor(task));

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
      if (task.isComplete) {
        pruneTaskFromAgents(task.id);
        consumeTaskItems(task);
        executeTaskRewards(task);
      }
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
    (b.lastAssigned || b.createdAt) - (a.lastAssigned || a.createdAt)
  );
  idle.sort((a, b) =>
    (b.lastAssigned || b.createdAt) - (a.lastAssigned || a.createdAt)
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
  ui.taskEffortPerTick = {}; // reset per-tick rates for progress interpolation
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
        // Can't pay everyone: flash all eligible agents, no effort advances.
        eligible.forEach(a => flashError(a.id));
      } else {
        state.session.bank = Math.round(((state.session.bank ?? 0) - totalCost) * 100) / 100;

        const tasksWithEffort = new Set(); // tasks that received ≥1 skill-effort contribution

        const effortRate = state.session.effortRate ?? 1;
        const skillRate  = state.session.skillRate  ?? 1;

        for (const agent of eligible) {
          const task = getCurrentTask(agent);
          if (!task) continue;

          task.effortProgress = task.effortProgress || {};
          let agentContributed = false;

          for (const req of getEffortReqs(task)) {
            const key = req.name || '';
            // Base: effortRate per day. Named skill: base + agentSkillValue * skillRate per day.
            let rate = effortRate * stepDays;
            if (req.name) {
              const skillTag = agent.attributes.find(attr => {
                const ap = parseTag(attr);
                return ap.type === 'skill' && ap.name.toLowerCase() === req.name.toLowerCase();
              });
              const skillVal = skillTag ? (parseTag(skillTag).value ?? 0) : 0;
              if (skillVal > 0) rate = (effortRate + skillVal * skillRate) * stepDays;
            }
            task.effortProgress[key] = (task.effortProgress[key] ?? 0) + rate;
            ui.taskEffortPerTick[task.id] = (ui.taskEffortPerTick[task.id] ?? 0) + rate;
            agentContributed = true;
            tasksWithEffort.add(task.id);
          }

          if (!agentContributed) flashError(agent.id);
        }

        // Flash agents whose task got zero total effort this step (no one has the skills).
        for (const agent of eligible) {
          const task = getCurrentTask(agent);
          if (!task || !hasEffortRequirements(task)) continue;
          if (!tasksWithEffort.has(task.id)) flashError(agent.id);
        }

        // Auto-complete tasks whose effort requirements are now satisfied.
        let anyCompleted = false;
        for (const task of state.tasks) {
          if (!task.isComplete && hasEffortRequirements(task) && checkTaskComplete(task)) {
            task.isComplete = true;
            anyCompleted = true;
            pruneTaskFromAgents(task.id);
            consumeTaskItems(task);
            executeTaskRewards(task);
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

  const rates = ui.taskEffortPerTick || {};
  for (const task of state.tasks) {
    if (task.isComplete) continue;
    const effortPerTick = rates[task.id] ?? 0;
    if (!effortPerTick) continue;
    const efforts = getEffortReqs(task);
    const totalRequired = efforts.reduce((sum, e) => sum + e.value, 0);
    if (!totalRequired) continue;
    const stored = efforts.reduce((sum, e) => sum + (task.effortProgress?.[e.name || ''] ?? 0), 0);
    const pct = Math.min(100, ((stored + frac * effortPerTick) / totalRequired) * 100);
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

  // Effort rate
  const effortRateRow = el('div', { class: 'config-row' });
  effortRateRow.appendChild(el('label', { text: 'EFFORT RATE' }));
  const effortRateInput = el('input', {
    type: 'number', min: '0', step: '0.1',
    value: String(state.session.effortRate ?? 1),
  });
  effortRateInput.addEventListener('change', () => {
    const v = parseFloat(effortRateInput.value);
    state.session.effortRate = isNaN(v) || v < 0 ? 1 : v;
    save();
  });
  effortRateRow.appendChild(effortRateInput);
  panel.appendChild(effortRateRow);

  // Skill rate
  const skillRateRow = el('div', { class: 'config-row' });
  skillRateRow.appendChild(el('label', { text: 'SKILL RATE' }));
  const skillRateInput = el('input', {
    type: 'number', min: '0', step: '0.1',
    value: String(state.session.skillRate ?? 1),
  });
  skillRateInput.addEventListener('change', () => {
    const v = parseFloat(skillRateInput.value);
    state.session.skillRate = isNaN(v) || v < 0 ? 1 : v;
    save();
  });
  skillRateRow.appendChild(skillRateInput);
  panel.appendChild(skillRateRow);

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
    session: { id: '001', clock: 0, timeStep: '60', playbackRate: '1', bank: 100, rateMultiplier: 1, effortRate: 1, skillRate: 1 },
    agents: [],
    tasks: [],
    inventory: [],
  };
  ui.selectedTaskId = null;
  ui.expandedTasks.clear();
  ui.taskEffortPerTick = {};
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
