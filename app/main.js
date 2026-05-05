import { state, ui, save, load, replaceState, STORAGE_KEY } from './state.js';
import { formatClockParts, clockMinutesFromParts } from './time.js';
import { render, applyPalette, renderPalettePicker, currentPalette } from './render.js';
import { createAgent } from './agents.js';
import { createTask } from './tasks.js';
import { startPlay, stopPlay, advanceTime, getPlayIntervalMs } from './clock.js';

/* ---------- Import / Export ---------- */

function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hirelings-${state.session.id || 'export'}.json`;
  document.body.appendChild(a);
  a.click();
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
      replaceState(data);
      save(); render();
    } catch (e) { alert('Invalid JSON: ' + e.message); }
  };
  r.readAsText(file);
}

/* ---------- Reset ---------- */

function resetAll() {
  if (!confirm('Reset everything to defaults? All agents, tasks, and inventory will be lost.')) return;
  if (ui.playing) stopPlay();
  localStorage.removeItem(STORAGE_KEY);
  replaceState({
    session: { id: '001', clock: 0, timeStep: '1', playbackRate: '1', bank: 100, rateMultiplier: 1, workRate: 1, skillBonus: 1 },
    agents: [], tasks: [], inventory: [],
  });
  ui.selectedTaskId = null;
  ui.expandedTasks.clear();
  ui.taskWorkPerTick = {};
  save(); render();
}

/* ---------- Settings panel ---------- */

function showConfigPanel() {
  const existing = document.getElementById('config-overlay');
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement('div');
  overlay.className = 'config-overlay';
  overlay.id = 'config-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const panel = document.createElement('div');
  panel.className = 'config-panel';

  const h2 = document.createElement('h2');
  h2.textContent = 'SETTINGS';
  panel.appendChild(h2);

  function addRow(labelText, inputAttrs, onChange) {
    const row = document.createElement('div');
    row.className = 'config-row';
    const lbl = document.createElement('label');
    lbl.textContent = labelText;
    const inp = document.createElement('input');
    Object.assign(inp, inputAttrs);
    inp.addEventListener('change', () => onChange(inp));
    row.appendChild(lbl);
    row.appendChild(inp);
    panel.appendChild(row);
  }

  addRow('TIME RATE', { type: 'number', min: '0.1', step: '0.1', value: String(state.session.rateMultiplier ?? 1) }, (inp) => {
    const v = parseFloat(inp.value);
    state.session.rateMultiplier = isNaN(v) || v <= 0 ? 1 : v;
    save();
    if (ui.playing) { stopPlay(); startPlay(); }
  });
  addRow('WORK RATE', { type: 'number', min: '0', step: '0.1', value: String(state.session.workRate ?? 1) }, (inp) => {
    const v = parseFloat(inp.value);
    state.session.workRate = isNaN(v) || v < 0 ? 1 : v;
    save();
  });
  addRow('SKILL BONUS', { type: 'number', min: '0', step: '0.1', value: String(state.session.skillBonus ?? 1) }, (inp) => {
    const v = parseFloat(inp.value);
    state.session.skillBonus = isNaN(v) || v < 0 ? 1 : v;
    save();
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'ctrl';
  closeBtn.textContent = 'CLOSE';
  closeBtn.style.cssText = 'align-self:flex-end;margin-top:8px';
  closeBtn.addEventListener('click', () => overlay.remove());
  panel.appendChild(closeBtn);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

/* ---------- Inventory panel ---------- */

function showInventoryPanel() {
  const existing = document.getElementById('inventory-overlay');
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement('div');
  overlay.className = 'config-overlay';
  overlay.id = 'inventory-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  function buildPanel() {
    overlay.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'config-panel inventory-panel';

    const h2 = document.createElement('h2');
    h2.textContent = 'INVENTORY';
    panel.appendChild(h2);

    const list = document.createElement('div');
    list.className = 'inventory-list';

    if (!state.inventory.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No items';
      list.appendChild(empty);
    } else {
      state.inventory.forEach((item, i) => {
        const row = document.createElement('div');
        row.className = 'inventory-row';

        const nameSpan = makeEditable(item.name, (v) => { item.name = v || 'ITEM'; save(); });
        nameSpan.className = 'inventory-name';

        const sep = document.createElement('span');
        sep.className = 'inventory-sep';
        sep.textContent = '|';

        const qtySpan = makeEditable(String(item.qty), (v) => {
          const n = parseFloat(v);
          if (isNaN(n) || n <= 0) { state.inventory.splice(i, 1); save(); buildPanel(); }
          else { item.qty = n; save(); }
        });
        qtySpan.className = 'inventory-qty';

        const xBtn = document.createElement('span');
        xBtn.className = 'x'; xBtn.textContent = '×'; xBtn.title = 'Remove';
        xBtn.addEventListener('click', (e) => { e.stopPropagation(); state.inventory.splice(i, 1); save(); buildPanel(); });

        row.appendChild(nameSpan); row.appendChild(sep); row.appendChild(qtySpan); row.appendChild(xBtn);
        list.appendChild(row);
      });
    }
    panel.appendChild(list);

    const addBtn = document.createElement('button');
    addBtn.className = 'add-inline'; addBtn.textContent = '+ ITEM';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const { uid } = { uid: () => Math.random().toString(36).slice(2, 9) };
      state.inventory.push({ id: uid(), name: 'NEW ITEM', qty: 1 });
      save(); buildPanel();
    });
    panel.appendChild(addBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'ctrl'; closeBtn.textContent = 'CLOSE';
    closeBtn.style.cssText = 'align-self:flex-end;margin-top:4px';
    closeBtn.addEventListener('click', () => overlay.remove());
    panel.appendChild(closeBtn);

    overlay.appendChild(panel);
  }

  buildPanel();
  document.body.appendChild(overlay);
}

// Minimal inline-editable span for panel use (no full el() dependency).
function makeEditable(text, oncommit) {
  const span = document.createElement('span');
  span.contentEditable = 'true';
  span.spellcheck = false;
  span.textContent = text || '';
  let original = text || '';
  span.addEventListener('focus', () => { original = span.textContent; });
  span.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); span.blur(); }
    if (e.key === 'Escape') { span.textContent = original; span.blur(); }
  });
  span.addEventListener('blur', () => { const v = span.textContent.trim(); if (v !== original) oncommit(v); });
  span.addEventListener('click', e => e.stopPropagation());
  return span;
}

/* ---------- Menu wiring ---------- */

function wireMenu() {
  document.getElementById('add-agent').onclick  = () => { createAgent(); save(); render(); };
  document.getElementById('add-task').onclick   = () => { createTask();  save(); render(); };
  document.getElementById('clear-active').onclick = () => {
    state.agents.forEach(a => { a.activities = a.activities.filter(t => !t.startsWith('#task:')); });
    save(); render();
  };
  document.getElementById('advance-time').onclick = advanceTime;
  document.getElementById('play-btn').onclick      = startPlay;
  document.getElementById('pause-btn').onclick     = stopPlay;
  document.getElementById('inventory-btn').onclick = showInventoryPanel;
  document.getElementById('config-btn').onclick    = showConfigPanel;
  document.getElementById('reset-btn').onclick     = resetAll;

  // Session ID
  const sessId = document.getElementById('session-id');
  sessId.addEventListener('blur',    () => { state.session.id = sessId.textContent.trim() || '001'; save(); render(); });
  sessId.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sessId.blur(); } });

  // Time step
  const ts = document.getElementById('time-step');
  ts.addEventListener('blur', () => {
    state.session.timeStep = ts.textContent.trim() || '1';
    save(); render();
    if (ui.playing) { stopPlay(); startPlay(); }
  });
  ts.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ts.blur(); } });

  // Clock year / week / day
  ['clock-year', 'clock-week', 'clock-day'].forEach(id => {
    const field = document.getElementById(id);
    field.addEventListener('blur', () => {
      const cur = formatClockParts(state.session.clock);
      const y = id === 'clock-year' ? Math.max(1, parseInt(document.getElementById('clock-year').textContent) || 1) : cur.year;
      const w = id === 'clock-week' ? Math.max(1, parseInt(document.getElementById('clock-week').textContent) || 1) : cur.week;
      const d = id === 'clock-day'  ? Math.max(1, parseInt(document.getElementById('clock-day').textContent)  || 1) : cur.day;
      state.session.clock = clockMinutesFromParts(y, w, d);
      save(); render();
    });
    field.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); field.blur(); } });
  });

  // Playback rate
  const rateEl = document.getElementById('playback-rate');
  if (rateEl) {
    rateEl.addEventListener('blur', () => {
      const m = rateEl.textContent.trim().match(/[\d.]+/);
      const mult = m ? parseFloat(m[0]) : 1;
      state.session.rateMultiplier = mult > 0 ? mult : 1;
      state.session.playbackRate   = String(state.session.rateMultiplier);
      rateEl.textContent = state.session.playbackRate;
      save();
      if (ui.playing) { stopPlay(); startPlay(); }
    });
    rateEl.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); rateEl.blur(); }
      if (e.key === 'Escape') { rateEl.textContent = state.session.playbackRate; }
    });
    rateEl.addEventListener('click', e => e.stopPropagation());
  }

  // Bank
  const bankEl = document.getElementById('bank');
  bankEl.addEventListener('blur',    () => { const v = parseFloat(bankEl.textContent); state.session.bank = isNaN(v) ? 0 : Math.round(v * 100) / 100; save(); render(); });
  bankEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); bankEl.blur(); } });

  // Save / load
  document.getElementById('export-data').onclick = exportJSON;
  document.getElementById('import-data').onclick  = () => document.getElementById('import-file').click();
  document.getElementById('import-file').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) importJSON(f);
    e.target.value = '';
  });

  // Pause play while any contenteditable is focused to prevent render clobbering mid-edit.
  let resumeTimer = null;
  document.addEventListener('focusin', (e) => {
    if (!e.target.matches('[contenteditable], .req-field')) return;
    clearTimeout(resumeTimer);
    if (ui.playing && ui.playInterval) { clearInterval(ui.playInterval); ui.playInterval = null; }
  });
  document.addEventListener('focusout', (e) => {
    if (!e.target.matches('[contenteditable], .req-field')) return;
    resumeTimer = setTimeout(() => {
      if (ui.playing && !ui.playInterval) {
        const interval = getPlayIntervalMs();
        ui.tickIntervalMs   = interval;
        ui.lastTickWallTime = Date.now();
        ui.playInterval = setInterval(advanceTime, interval);
      }
    }, 100);
  });

  // Click outside cards to clear task selection.
  document.addEventListener('click', (e) => {
    if (e.target.closest('.task-card') || e.target.closest('.agent-card')) return;
    if (ui.selectedTaskId) { ui.selectedTaskId = null; render(); }
  });
}

/* ---------- Boot ---------- */

function boot() {
  applyPalette(currentPalette);
  load();
  wireMenu();
  renderPalettePicker();
  render();
}

boot();
