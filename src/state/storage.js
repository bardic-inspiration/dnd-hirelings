export const STORAGE_KEY = 'dnd-hirelings-state-v2';
export const PALETTE_KEY = 'dnd-hirelings-palette';

export const DEFAULT_STATE = {
  session: { id: '001', clock: 0, timeStep: '1', playbackRate: '1', bank: 100, rateMultiplier: 1, workRate: 1, skillBonus: 1 },
  agents: [],
  tasks: [],
  inventory: [],
};

export function normalizeState(raw) {
  const state = { ...DEFAULT_STATE, ...raw };
  state.agents = (raw.agents || []).map(a => ({
    ...a,
    attributes:   a.attributes   ?? [],
    activities:   a.activities   ?? [],
    description:  a.description  ?? '',
    icon:         a.icon         ?? '',
    createdAt:    a.createdAt    ?? Date.now(),
    lastAssigned: a.lastAssigned ?? null,
  }));
  state.inventory = (raw.inventory || []).map(item => ({
    id:   item.id   ?? Math.random().toString(36).slice(2, 9),
    name: item.name ?? 'ITEM',
    qty:  item.qty  ?? 1,
  }));
  state.tasks = (raw.tasks || []).map(t => ({
    ...t,
    requirements: (t.requirements || []).filter(Boolean),
    description:  t.description  ?? '',
    isComplete:   t.isComplete   ?? false,
    createdAt:    t.createdAt    ?? Date.now(),
    workProgress: t.workProgress ?? {},
  }));
  const s = raw.session || {};
  const tsNum = parseFloat(s.timeStep ?? '0');
  state.session = {
    ...DEFAULT_STATE.session,
    ...s,
    timeStep:       (isNaN(tsNum) || tsNum >= 30) ? '1' : (s.timeStep ?? '1'),
    playbackRate:   s.playbackRate   ?? '1',
    rateMultiplier: s.rateMultiplier ?? 1,
    workRate:       s.workRate       ?? 1,
    skillBonus:     s.skillBonus     ?? 1,
    bank:           s.bank           ?? 100,
  };
  return state;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    return normalizeState(JSON.parse(raw));
  } catch {
    return DEFAULT_STATE;
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
