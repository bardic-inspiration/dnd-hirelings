import { state, ui } from './state.js';
import { TAG_SCHEMA, parseTag, buildTag, getSchemaByContext, getSchemaEntry } from './tags.js';

// Tiny DOM builder. props keys: class, text, html, style (obj), data (obj), on<Event>, any attr.
export function el(tag, props = {}, children = []) {
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
export function editable(text, oncommit, opts = {}) {
  const span = el('span', { contenteditable: 'true', spellcheck: 'false', text: text || '', class: opts.class || '' });
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

// Brief red flash on an agent card without triggering a full render.
export function flashError(agentId) {
  const card = document.querySelector(`.agent-card[data-id="${agentId}"]`);
  if (!card) return;
  card.classList.remove('flash-error');
  void card.offsetWidth; // force reflow so animation restarts
  card.classList.add('flash-error');
  card.addEventListener('animationend', () => card.classList.remove('flash-error'), { once: true });
}

// Sync play/pause button active states with ui.playing.
export function updatePlayButtons() {
  const playBtn  = document.getElementById('play-btn');
  const pauseBtn = document.getElementById('pause-btn');
  if (playBtn)  playBtn.classList.toggle('active-ctrl',  ui.playing);
  if (pauseBtn) pauseBtn.classList.toggle('active-ctrl', !ui.playing);
}

// Render a tag chip with label, optional value, and × remove button.
export function renderTag(tagStr, active, onRemove) {
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
  children.push(el('span', { class: 'x', text: '×', title: 'Remove', onclick: (e) => { e.stopPropagation(); onRemove(); } }));
  return el('span', { class: 'tag' + (active ? ' active' : '') }, children);
}

// Render a list of tag chips with a + add button.
export function renderTagList(tags, isActive, opts) {
  const list = el('div', { class: 'tag-list' });
  tags.forEach((t, i) => list.appendChild(renderTag(t, isActive(t), () => opts.onRemove(i))));
  list.appendChild(el('button', { class: 'tag-add', text: '+', title: opts.addTitle || 'Add tag', onclick: (e) => { e.stopPropagation(); opts.onAdd(); } }));
  return list;
}

// Modal tag builder for both agent attributes and task tags.
// context: 'attribute' | 'task'. Calls onSave(tagString) or onCancel().
export function showTagBuilder({ context = 'attribute', initialPreset = undefined, onSave = () => {}, onCancel = () => {} } = {}) {
  const isTask = context === 'task';

  const overlay = el('div', { class: 'tag-builder-overlay', onclick: (e) => { if (e.target === overlay) { onCancel(); overlay.remove(); } } });
  const card = el('div', { class: 'tag-builder-card' });
  card.appendChild(el('div', { class: 'tag-builder-title', text: isTask ? 'ADD TAG' : 'NEW ATTRIBUTE' }));
  const fieldsWrapper = el('div', { class: 'tag-builder-fields' });

  // Preset selector
  const presetSelect = el('select', { class: 'tag-builder-field' });
  presetSelect.appendChild(el('option', { text: '— custom —', value: '' }));
  if (isTask) {
    const groups = [...new Set(Object.values(TAG_SCHEMA).filter(e => e.context !== 'attribute').map(e => e.context))];
    groups.forEach(ctx => {
      const grp = document.createElement('optgroup');
      grp.label = ctx.toUpperCase();
      getSchemaByContext(ctx).forEach(([key, entry]) => grp.appendChild(el('option', { text: entry.label, value: key })));
      presetSelect.appendChild(grp);
    });
  } else {
    const grp = document.createElement('optgroup');
    grp.label = 'ATTRIBUTE';
    getSchemaByContext('attribute').forEach(([key, entry]) => grp.appendChild(el('option', { text: entry.label, value: key })));
    presetSelect.appendChild(grp);
  }
  fieldsWrapper.appendChild(el('div', { class: 'tag-builder-row' }, [el('label', { class: 'tag-builder-label', text: 'PRESET' }), presetSelect]));

  // REQ toggle + type input
  let reqActive = false;
  const reqBtn = el('button', { class: 'ctrl tag-builder-req-btn', text: 'REQ', title: 'Prepend req: prefix' });
  reqBtn.addEventListener('click', (e) => { e.preventDefault(); reqActive = !reqActive; reqBtn.classList.toggle('active', reqActive); updatePreview(); });
  const typeInput = el('input', { class: 'tag-builder-field', placeholder: 'type', spellcheck: 'false' });
  fieldsWrapper.appendChild(el('div', { class: 'tag-builder-row' }, [el('label', { class: 'tag-builder-label', text: 'TYPE' }), reqBtn, typeInput]));

  // Name + value fields
  const nameLabelEl  = el('label', { class: 'tag-builder-label', text: 'NAME' });
  const nameInput    = el('input', { class: 'tag-builder-field', placeholder: 'optional', spellcheck: 'false' });
  const valueLabelEl = el('label', { class: 'tag-builder-label', text: 'VALUE' });
  const valueInput   = el('input', { class: 'tag-builder-field', type: 'number', placeholder: 'optional', step: 'any' });
  fieldsWrapper.appendChild(el('div', { class: 'tag-builder-row' }, [nameLabelEl, nameInput]));
  fieldsWrapper.appendChild(el('div', { class: 'tag-builder-row' }, [valueLabelEl, valueInput]));

  // Live preview
  const previewEl = el('div', { class: 'tag-builder-preview', text: '—' });
  fieldsWrapper.appendChild(el('div', { class: 'tag-builder-row' }, [el('label', { class: 'tag-builder-label', text: 'TAG' }), previewEl]));

  function applyPreset() {
    const key = presetSelect.value;
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
      typeInput.value = ''; reqActive = false;
      nameLabelEl.textContent = 'NAME'; valueLabelEl.textContent = 'VALUE';
      nameInput.value = ''; nameInput.placeholder = 'optional'; valueInput.placeholder = 'optional';
    }
    reqBtn.classList.toggle('active', reqActive);
    updatePreview();
  }

  function updatePreview() {
    const type = typeInput.value.trim();
    const name = nameInput.value.trim() || null;
    const val  = valueInput.value.trim() ? parseFloat(valueInput.value) : null;
    previewEl.textContent = type ? (buildTag(type, name, val, reqActive) ?? `#${reqActive ? 'req:' : ''}${type}`) : '—';
  }

  presetSelect.addEventListener('change', applyPreset);
  [typeInput, nameInput, valueInput].forEach(inp => inp.addEventListener('input', updatePreview));

  const startKey = initialPreset !== undefined ? initialPreset : (isTask
    ? Object.keys(TAG_SCHEMA).find(k => TAG_SCHEMA[k].context !== 'attribute')
    : Object.keys(TAG_SCHEMA).find(k => TAG_SCHEMA[k].context === 'attribute'));
  if (startKey != null) presetSelect.value = startKey;
  applyPreset();

  card.appendChild(fieldsWrapper);

  function saveTag() {
    const type = typeInput.value.trim();
    if (!type) { typeInput.classList.add('error'); return; }
    const name = nameInput.value.trim() || null;
    const val  = valueInput.value.trim() ? parseFloat(valueInput.value) : null;
    onSave(buildTag(type, name, val, reqActive) ?? `#${reqActive ? 'req:' : ''}${type}`);
    overlay.remove();
  }

  [presetSelect, typeInput, nameInput, valueInput].forEach(inp => inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); saveTag(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); overlay.remove(); }
  }));

  card.appendChild(el('div', { class: 'tag-builder-buttons' }, [
    el('button', { class: 'ctrl', text: 'SAVE',   onclick: (e) => { e.stopPropagation(); saveTag(); } }),
    el('button', { class: 'ctrl', text: 'CANCEL', onclick: (e) => { e.stopPropagation(); onCancel(); overlay.remove(); } }),
  ]));

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  presetSelect.focus();
}
