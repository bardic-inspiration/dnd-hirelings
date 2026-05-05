export const STORAGE_KEY = 'dnd-hirelings-state-v2';

// Default settings
export const DEFAULT_CONFIG = {
  defaults: {
    agentName: 'NEW HIRELING',
    rate: 1,
    rateUnit: 'GP/DAY',
    taskName: 'NEW TASK',
    defaultMessages: { activeAgentEmpty: '', idleAgentEmpty: '', taskEmpty: '' },
  },
};

// Global state object, which is persisted to localStorage and shared across all modules. This includes both the core game state (agents, tasks, inventory, session settings) and some UI state (selected task, play status, etc).
export let state = {
  session: { id: '001', clock: 0, timeStep: '1', playbackRate: '1', bank: 100, rateMultiplier: 1, workRate: 1, skillBonus: 1 },
  agents: [],
  tasks: [],
  inventory: [],
};

// UI state, which is not persisted and only relevant to the current session. This is separated from the main state for clarity and to avoid accidentally persisting transient UI data.
export const ui = {
  selectedTaskId: null,
  expandedTasks: new Set(),
  playing: false,
  playInterval: null,
  animationFrameId: null,
  lastTickWallTime: 0,
  tickIntervalMs: 1000,
  taskWorkPerTick: {},
};

export const uid = () => Math.random().toString(36).slice(2, 9);
export const now = () => Date.now();

// Save current state to localStorage. This is called automatically on any change to the state, but can also be triggered manually for testing or debugging.
export function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Replace entire state in-place (used by import and reset so module binding stays valid).
export function replaceState(newState) {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, newState);
}

// Load state from localStorage, with validation and defaults to handle missing or malformed data. This is called automatically on app startup, but can also be triggered manually for testing or debugging.
export function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    Object.assign(state, parsed);
    state.agents.forEach(a => {
      a.attributes   ||= [];
      a.activities   ||= [];
      a.description  ??= '';
      a.icon         ??= '';
      a.createdAt    ??= Date.now();
      a.lastAssigned ??= null;
    });
    state.session.bank ??= 100;
    { const tsNum = parseFloat(state.session.timeStep ?? '0');
      if (isNaN(tsNum) || tsNum >= 30) state.session.timeStep = '1'; }
    state.session.timeStep       ??= '1';
    state.session.playbackRate   ??= '1';
    state.session.rateMultiplier ??= 1;
    state.session.workRate       ??= 1;
    state.session.skillBonus     ??= 1;
    state.inventory ??= [];
    state.inventory.forEach(item => { item.id ??= uid(); item.name ??= 'ITEM'; item.qty ??= 1; });
    state.tasks.forEach(t => {
      t.requirements ??= [];
      t.description  ??= '';
      t.isComplete   ??= false;
      t.createdAt    ??= Date.now();
      t.workProgress ??= {};
      t.requirements  = t.requirements.filter(r => !!r);
    });
  } catch (e) { console.warn('Failed to load state:', e); }
}
