import { PALETTES } from '../palettes.js';
import { state, ui, save, DEFAULT_CONFIG } from './state.js';
import { formatClockParts } from './time.js';
import { parseTag, getSchemaEntry } from './tags.js';
import {
  createAgent, deleteAgent, duplicateAgent,
  activeTaskCount, isAttributeActive, isActivityActive,
  tryAssignTask, agentsAssignedTo, validateAssignment,
} from './agents.js';
import { createTask, deleteTask, duplicateTask, completeTask, getWorkReqs } from './tasks.js';
import { el, editable, renderTagList, renderTag, showTagBuilder, flashError, updatePlayButtons } from './ui.js';

/* ---------- Palette ---------- */

const PALETTE_KEY = 'dnd-hirelings-palette';
export let currentPalette = localStorage.getItem(PALETTE_KEY) || 'dark';

export function applyPalette(name) {
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
  if (p.backgroundImage) {
    const img = new Image();
    img.onload  = () => root.style.setProperty('--bg-image', `url('${p.backgroundImage}')`);
    img.onerror = () => root.style.setProperty('--bg-image', 'none');
    img.src = p.backgroundImage;
  } else {
    root.style.setProperty('--bg-image', 'none');
  }
  currentPalette = name;
  localStorage.setItem(PALETTE_KEY, name);
}

export function renderPalettePicker() {
  const picker = document.getElementById('palette-picker');
  picker.innerHTML = '';
  for (const [name, p] of Object.entries(PALETTES)) {
    picker.appendChild(el('button', {
      class: 'palette-btn' + (currentPalette === name ? ' active' : ''),
      title: p.label,
      onclick: (e) => { e.stopPropagation(); applyPalette(name); renderPalettePicker(); },
    }, [el('span', { class: 'palette-dot', style: { background: p.highlight } }), p.label]));
  }
}

/* ---------- Task body sections ---------- */

function buildWorkRow(schemaLabel, tagName, target, progress, task, reqIdx) {
  const label = tagName ? `${schemaLabel.toUpperCase()}: ${tagName.toUpperCase()}` : schemaLabel.toUpperCase();
  const done = progress >= target;
  const pct  = target > 0 ? Math.min(100, (progress / target) * 100) : 0;
  const workKey = tagName ?? '';
  const taskId  = task?.id ?? '';
  const item = el('div', { class: 'work-item' + (done ? ' done' : '') });
  item.appendChild(el('span', { class: 'work-item-skill', text: label }));
  const bottom = el('div', { class: 'work-item-bottom' });
  const bar = el('div', { class: 'work-item-bar' });
  bar.appendChild(el('div', { class: 'work-item-bar-fill', data: { taskId, workKey }, style: { width: `${pct.toFixed(1)}%` } }));
  bottom.appendChild(bar);
  bottom.appendChild(el('span', { class: 'work-item-value', data: { taskId, workKey }, text: `${Math.floor(progress)} / ${target}` }));
  if (task && reqIdx !== null) {
    bottom.appendChild(el('span', { class: 'x', text: '×', onclick: (e) => { e.stopPropagation(); task.requirements.splice(reqIdx, 1); save(); render(); } }));
  }
  item.appendChild(bottom);
  return item;
}

function renderProgressSection(task) {
  const wrap = el('div', { class: 'task-section' });
  wrap.appendChild(el('div', { class: 'tag-label', text: 'PROGRESS' }));
  const progMap = task.workProgress ?? {};
  const list    = el('div', { class: 'work-list' });
  const workEntries = [];
  task.requirements.forEach((tagStr, idx) => {
    const p = parseTag(tagStr);
    if (p.type === 'work' && !p.isReq) workEntries.push({ p, idx });
  });
  if (workEntries.length === 0) {
    list.appendChild(buildWorkRow('General', null, 1, progMap[''] ?? 0, task, null));
  } else {
    workEntries.forEach(({ p, idx }) => {
      const entry = getSchemaEntry(p);
      list.appendChild(buildWorkRow(entry ? entry.label : 'Work', p.name || null, p.value ?? 1, progMap[p.name || ''] ?? 0, task, idx));
    });
  }
  wrap.appendChild(list);
  return wrap;
}

function buildTagRow(tagStr, idx, task) {
  const p = parseTag(tagStr);
  const entry = getSchemaEntry(p);
  const typeLabel = entry ? entry.label.toUpperCase() : p.type.toUpperCase();
  const showName  = p.name && !entry?.nameFixed;
  const label     = showName ? `${typeLabel}: ${p.name.toUpperCase()}` : typeLabel;
  const params    = p.value !== null ? ` =${p.value}` : '';
  const row = el('div', { class: 'tag-list-item' });
  const content = el('span', { class: 'tag-content' });
  content.innerHTML = `<strong>${label}</strong>${params}`;
  row.appendChild(content);
  row.appendChild(el('span', { class: 'x', text: '×', onclick: (e) => { e.stopPropagation(); task.requirements.splice(idx, 1); save(); render(); } }));
  return row;
}

function renderRequirementsSection(task) {
  const wrap = el('div', { class: 'task-section' });
  wrap.appendChild(el('div', { class: 'tag-label', text: 'REQUIREMENTS' }));
  const tagList = el('div', { class: 'task-tag-list' });
  let count = 0;
  task.requirements.forEach((tagStr, i) => {
    if (!parseTag(tagStr).isReq) return;
    count++;
    tagList.appendChild(buildTagRow(tagStr, i, task));
  });
  if (!count) tagList.appendChild(el('div', { class: 'empty-state', text: '—' }));
  wrap.appendChild(tagList);
  return wrap;
}

function renderResultsSection(task) {
  const wrap = el('div', { class: 'task-section' });
  wrap.appendChild(el('div', { class: 'tag-label', text: 'RESULTS' }));
  const tagList = el('div', { class: 'task-tag-list' });
  let count = 0;
  task.requirements.forEach((tagStr, i) => {
    const p = parseTag(tagStr);
    if (p.isReq || p.type !== 'reward') return;
    count++;
    tagList.appendChild(buildTagRow(tagStr, i, task));
  });
  if (!count) tagList.appendChild(el('div', { class: 'empty-state', text: '—' }));
  wrap.appendChild(tagList);
  return wrap;
}

function renderAttributesSection(task) {
  const wrap = el('div', { class: 'task-section' });
  wrap.appendChild(el('div', { class: 'tag-label', text: 'ATTRIBUTES' }));
  const tagList = el('div', { class: 'task-tag-list' });
  let count = 0;
  task.requirements.forEach((tagStr, i) => {
    const p = parseTag(tagStr);
    if (p.isReq || p.type === 'work' || p.type === 'reward') return;
    count++;
    tagList.appendChild(buildTagRow(tagStr, i, task));
  });
  if (!count) tagList.appendChild(el('div', { class: 'empty-state', text: '—' }));
  wrap.appendChild(tagList);
  wrap.appendChild(el('button', {
    class: 'tag-add', text: '+ TAG',
    onclick: (e) => { e.stopPropagation(); showTagBuilder({ context: 'task', onSave: (tag) => { task.requirements.push(tag); save(); render(); } }); },
  }));
  return wrap;
}

/* ---------- Agent card ---------- */

function renderAgentCard(agent) {
  const selectedTask = ui.selectedTaskId ? state.tasks.find(t => t.id === ui.selectedTaskId) : null;
  const assignClass = selectedTask
    ? (validateAssignment(agent, selectedTask) ? ' assignable' : ' not-assignable')
    : '';

  const card = el('div', { class: 'agent-card' + assignClass, data: { id: agent.id } });

  const name = editable(agent.name, (v) => { agent.name = v || DEFAULT_CONFIG.defaults.agentName; save(); render(); });
  name.classList.add('agent-name');
  card.appendChild(name);

  const icon = el('div', { class: 'agent-icon', title: 'Click to set image' });
  if (agent.icon) icon.style.backgroundImage = `url("${agent.icon}")`;
  else icon.textContent = 'NO IMAGE';
  icon.addEventListener('click', (e) => {
    e.stopPropagation();
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { agent.icon = reader.result; save(); render(); };
      reader.readAsDataURL(file);
    };
    input.click();
  });
  card.appendChild(icon);

  const rateRow = el('div', { class: 'agent-rate' });
  rateRow.appendChild(editable(String(agent.rate), (v) => { const n = parseFloat(v); agent.rate = isNaN(n) ? 0 : n; save(); render(); }, { class: 'value' }));
  rateRow.appendChild(editable(agent.rateUnit, (v) => { agent.rateUnit = v; save(); render(); }, { class: 'unit' }));
  card.appendChild(rateRow);

  const desc = editable(agent.description, (v) => { agent.description = v; save(); render(); });
  desc.classList.add('agent-desc');
  desc.setAttribute('data-placeholder', 'description');
  card.appendChild(desc);

  const attrSect = el('div', { class: 'tag-section' });
  attrSect.appendChild(el('div', { class: 'tag-label', text: 'ATTRIBUTES' }));
  attrSect.appendChild(renderTagList(
    agent.attributes,
    (t) => isAttributeActive(t, agent),
    {
      addTitle: 'Add attribute',
      onAdd: () => showTagBuilder({
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
      }),
      onRemove: (i) => { agent.attributes.splice(i, 1); save(); render(); },
    }
  ));
  card.appendChild(attrSect);

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
    actList.appendChild(renderTag(actTag, isCurrent, () => { agent.activities = agent.activities.filter(t => t !== actTag); save(); render(); }));
  });
  if (!actList.childElementCount) actList.appendChild(el('span', { class: 'empty-inline', text: '—' }));
  actSect.appendChild(actList);
  card.appendChild(actSect);

  const actionRow = el('div', { class: 'tag-section action-row' });
  actionRow.appendChild(el('button', { class: 'delete-btn', text: '⎘ COPY', title: 'Duplicate hireling', onclick: (e) => { e.stopPropagation(); duplicateAgent(agent.id); save(); render(); } }));
  actionRow.appendChild(el('button', { class: 'delete-btn', text: '× DELETE', onclick: (e) => { e.stopPropagation(); if (confirm(`Delete hireling "${agent.name}"?`)) { deleteAgent(agent.id); save(); render(); } } }));
  card.appendChild(actionRow);

  card.addEventListener('click', () => {
    const result = tryAssignTask(agent);
    if (result === null) flashError(agent.id);
    else if (result === true) { save(); render(); }
  });

  return card;
}

/* ---------- Task card ---------- */

function renderTaskProgressBar(task) {
  const reqs = getWorkReqs(task);
  const totalRequired = reqs.reduce((sum, e) => sum + e.value, 0);
  const totalProgress = task.isComplete
    ? totalRequired
    : reqs.reduce((sum, e) => sum + (task.workProgress?.[e.name || ''] ?? 0), 0);
  const pct = totalRequired > 0 ? Math.min(100, (totalProgress / totalRequired) * 100) : 0;
  const wrap = el('div', { class: 'task-progress' });
  wrap.appendChild(el('div', { class: 'task-progress-fill', data: { taskId: task.id }, style: { width: `${pct.toFixed(1)}%` } }));
  return wrap;
}

function renderTaskCard(task) {
  const expanded = ui.expandedTasks.has(task.id);
  const card = el('div', {
    class: 'task-card'
      + (ui.selectedTaskId === task.id ? ' selected' : '')
      + (task.isComplete ? ' complete' : '')
      + (expanded ? ' expanded' : ''),
    data: { id: task.id },
  });

  const header = el('div', { class: 'task-header' });
  const name = editable(task.name, (v) => { task.name = v || DEFAULT_CONFIG.defaults.taskName; save(); render(); });
  name.classList.add('task-name');
  header.appendChild(name);
  header.appendChild(el('span', {
    class: 'task-toggle', text: expanded ? '−' : '+', title: 'Expand / collapse',
    onclick: (e) => { e.stopPropagation(); if (expanded) ui.expandedTasks.delete(task.id); else ui.expandedTasks.add(task.id); render(); },
  }));
  card.appendChild(header);
  card.appendChild(renderTaskProgressBar(task));

  const body = el('div', { class: 'task-body' });
  body.appendChild(el('div', { class: 'tag-label', text: 'DESCRIPTION' }));
  const desc = editable(task.description, (v) => { task.description = v; save(); render(); });
  desc.classList.add('task-desc');
  body.appendChild(desc);
  body.appendChild(renderProgressSection(task));
  body.appendChild(renderRequirementsSection(task));
  body.appendChild(renderResultsSection(task));
  body.appendChild(renderAttributesSection(task));

  const assigned = agentsAssignedTo(task.id);
  if (assigned.length) {
    const assignedRow = el('div', { class: 'assigned-list' });
    assignedRow.innerHTML = 'ASSIGNED: ' + assigned.map(a => `<strong>${a.name}</strong>`).join(' ');
    body.appendChild(assignedRow);
  }

  const statusRow = el('div', { class: 'task-status-row action-row' });
  statusRow.appendChild(el('span', { class: 'tag-label', text: 'STATUS:' }));
  statusRow.appendChild(el('button', {
    class: 'tag-add', text: task.isComplete ? '↻' : '✓',
    title: task.isComplete ? 'Mark incomplete' : 'Mark complete',
    onclick: (e) => {
      e.stopPropagation();
      task.isComplete = !task.isComplete;
      if (task.isComplete) completeTask(task);
      save(); render();
    },
  }));
  statusRow.appendChild(el('span', { text: task.isComplete ? 'COMPLETE' : 'INCOMPLETE' }));
  statusRow.appendChild(el('button', { class: 'delete-btn', text: '⎘ COPY', title: 'Duplicate task', onclick: (e) => { e.stopPropagation(); duplicateTask(task.id); save(); render(); } }));
  statusRow.appendChild(el('button', { class: 'delete-btn', text: '× DELETE', onclick: (e) => { e.stopPropagation(); if (confirm(`Delete task "${task.name}"?`)) { deleteTask(task.id); save(); render(); } } }));
  body.appendChild(statusRow);
  card.appendChild(body);

  card.addEventListener('click', () => { ui.selectedTaskId = ui.selectedTaskId === task.id ? null : task.id; render(); });
  return card;
}

/* ---------- Main render ---------- */

export function render() {
  const { activeAgentEmpty, idleAgentEmpty, taskEmpty } = DEFAULT_CONFIG.defaults.defaultMessages;

  const sessIdEl = document.getElementById('session-id');
  if (document.activeElement !== sessIdEl) sessIdEl.textContent = state.session.id;

  const { year: cy, week: cw, day: cd } = formatClockParts(state.session.clock);
  const yearEl = document.getElementById('clock-year');
  const weekEl = document.getElementById('clock-week');
  const dayEl  = document.getElementById('clock-day');
  if (document.activeElement !== yearEl) yearEl.textContent = cy;
  if (document.activeElement !== weekEl) weekEl.textContent = cw;
  if (document.activeElement !== dayEl)  dayEl.textContent  = cd;

  const rateEl = document.getElementById('playback-rate');
  if (rateEl && document.activeElement !== rateEl) rateEl.textContent = state.session.playbackRate;
  const tsEl = document.getElementById('time-step');
  if (document.activeElement !== tsEl) tsEl.textContent = state.session.timeStep;
  const bankEl = document.getElementById('bank');
  if (bankEl && document.activeElement !== bankEl) bankEl.textContent = (state.session.bank ?? 0).toFixed(1);

  updatePlayButtons();

  const active = [], idle = [];
  for (const a of state.agents) (activeTaskCount(a) > 0 ? active : idle).push(a);
  active.sort((a, b) => activeTaskCount(b) - activeTaskCount(a) || (b.lastAssigned ?? b.createdAt) - (a.lastAssigned ?? a.createdAt));
  idle.sort((a, b) => (b.lastAssigned ?? b.createdAt) - (a.lastAssigned ?? a.createdAt));

  const activeEl = document.getElementById('active-agents');
  const idleEl   = document.getElementById('idle-agents');
  activeEl.innerHTML = '';
  idleEl.innerHTML   = '';

  if (!active.length) activeEl.appendChild(el('div', { class: 'empty', text: activeAgentEmpty }));
  else active.forEach(a => activeEl.appendChild(renderAgentCard(a)));

  if (!idle.length) idleEl.appendChild(el('div', { class: 'empty', text: idleAgentEmpty }));
  else idle.forEach(a => idleEl.appendChild(renderAgentCard(a)));
  idleEl.appendChild(el('button', { class: 'add-inline', text: '+ AGENT', onclick: (e) => { e.stopPropagation(); createAgent(); save(); render(); } }));

  const taskList = document.getElementById('task-list');
  taskList.innerHTML = '';
  if (!state.tasks.length) {
    taskList.appendChild(el('div', { class: 'empty', text: taskEmpty }));
  } else {
    [...state.tasks]
      .sort((a, b) => (a.isComplete - b.isComplete) || (b.createdAt - a.createdAt))
      .forEach(t => taskList.appendChild(renderTaskCard(t)));
  }
  taskList.appendChild(el('button', { class: 'add-inline', text: '+ TASK', onclick: (e) => { e.stopPropagation(); createTask(); save(); render(); } }));
}
