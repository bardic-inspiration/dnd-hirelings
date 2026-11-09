import { describe, expect, it, vi } from 'vitest';
import {
  CLOCK_SOURCE_REGISTRY,
  getClockSource,
  logPrefix,
  stateAt,
  createPlayClockDriver,
} from './clockSources.js';

describe('clockSources', () => {
  const sampleTagRegistry = { skill: { stealth: {} } };

  const sampleEventLog = [
    // Tick 1
    { seq: 1, eventType: 'work_contribution', clock: 101, delta: 1 },
    { seq: 2, eventType: 'tick', clock: 101, data: { wagesTotal: 5 } },
    // Tick 2
    { seq: 3, eventType: 'work_contribution', clock: 102, delta: 2 },
    { seq: 4, eventType: 'action', clock: 102, actionKind: 'bank.adjust' },
    { seq: 5, eventType: 'tick', clock: 102, data: { wagesTotal: 5 } },
    // Tick 3
    { seq: 6, eventType: 'task_complete', clock: 103 },
    { seq: 7, eventType: 'tick', clock: 103, data: { wagesTotal: 0 } },
  ];

  const sampleSnapshots = [
    { session: { clock: 100 }, agents: [{ id: 'a1' }], tasks: [{ id: 't1' }] },
    { session: { clock: 101 }, agents: [{ id: 'a1' }], tasks: [{ id: 't1' }] },
    { session: { clock: 102 }, agents: [{ id: 'a1' }], tasks: [{ id: 't1' }] },
  ];

  const sampleEndState = {
    session: { clock: 102, note: 'edited after last tick' },
    agents: [{ id: 'a1' }],
    tasks: [{ id: 't1' }],
    tagRegistry: sampleTagRegistry,
    eventLog: sampleEventLog,
  };

  const sampleCtx = {
    snapshots: sampleSnapshots,
    eventLog: sampleEventLog,
    endState: sampleEndState,
  };

  describe('CLOCK_SOURCE_REGISTRY', () => {
    it('exports live and recorded clock sources with interpolation settings', () => {
      expect(CLOCK_SOURCE_REGISTRY.live).toBeDefined();
      expect(CLOCK_SOURCE_REGISTRY.recorded).toBeDefined();

      expect(CLOCK_SOURCE_REGISTRY.live.interpolates).toBe(true);
      expect(CLOCK_SOURCE_REGISTRY.recorded.interpolates).toBe(false);
    });

    it('falls back to live for unknown source names via getClockSource', () => {
      expect(getClockSource('live')).toBe(CLOCK_SOURCE_REGISTRY.live);
      expect(getClockSource('recorded')).toBe(CLOCK_SOURCE_REGISTRY.recorded);
      expect(getClockSource('unknown')).toBe(CLOCK_SOURCE_REGISTRY.live);
      expect(getClockSource(null)).toBe(CLOCK_SOURCE_REGISTRY.live);
      expect(getClockSource(undefined)).toBe(CLOCK_SOURCE_REGISTRY.live);
    });
  });

  describe('logPrefix', () => {
    it('returns an empty array when tickCount is <= 0 or eventLog is empty', () => {
      expect(logPrefix(sampleEventLog, 0)).toEqual([]);
      expect(logPrefix(sampleEventLog, -1)).toEqual([]);
      expect(logPrefix([], 2)).toEqual([]);
      expect(logPrefix(null, 1)).toEqual([]);
    });

    it('cleanly cuts turn log at the 1st tick boundary', () => {
      const cut1 = logPrefix(sampleEventLog, 1);
      expect(cut1).toHaveLength(2);
      expect(cut1[cut1.length - 1]).toMatchObject({ eventType: 'tick', clock: 101 });
    });

    it('cleanly cuts turn log at the 2nd tick boundary', () => {
      const cut2 = logPrefix(sampleEventLog, 2);
      expect(cut2).toHaveLength(5);
      expect(cut2[cut2.length - 1]).toMatchObject({ eventType: 'tick', clock: 102 });
    });

    it('returns the entire log when tickCount is >= total ticks', () => {
      const cut3 = logPrefix(sampleEventLog, 3);
      expect(cut3).toEqual(sampleEventLog);

      const cutOver = logPrefix(sampleEventLog, 10);
      expect(cutOver).toEqual(sampleEventLog);
    });

    it('accepts a context object containing eventLog', () => {
      const cut = logPrefix({ eventLog: sampleEventLog }, 2);
      expect(cut).toHaveLength(5);
    });
  });

  describe('stateAt', () => {
    it('returns null for empty or invalid context', () => {
      expect(stateAt(null, 0)).toBeNull();
      expect(stateAt({}, 0)).toBeNull();
      expect(stateAt({ snapshots: [] }, 0)).toBeNull();
    });

    it('clamps negative index to 0, restores tagRegistry, and cuts eventLog to []', () => {
      const state = stateAt(sampleCtx, -1);
      expect(state.session.clock).toBe(100);
      expect(state.tagRegistry).toEqual(sampleTagRegistry);
      expect(state.eventLog).toEqual([]);
    });

    it('returns state for an intermediate tick with logPrefix(i) and tagRegistry', () => {
      const state = stateAt(sampleCtx, 1);
      expect(state.session.clock).toBe(101);
      expect(state.tagRegistry).toEqual(sampleTagRegistry);
      expect(state.eventLog).toHaveLength(2);
      expect(state.eventLog[state.eventLog.length - 1].eventType).toBe('tick');
    });

    it('resolves directly to endState at the final index (max)', () => {
      const finalIndex = sampleSnapshots.length - 1; // 2
      const state = stateAt(sampleCtx, finalIndex);
      expect(state).toBe(sampleEndState);
      expect(state.session.note).toBe('edited after last tick');
    });

    it('clamps indices beyond max to max and resolves to endState', () => {
      const state = stateAt(sampleCtx, 99);
      expect(state).toBe(sampleEndState);
    });

    it('works when ctx carries commit wrapper', () => {
      const wrappedCtx = {
        commit: {
          snapshots: sampleSnapshots,
          eventLog: sampleEventLog,
          endState: sampleEndState,
        },
      };
      const state = stateAt(wrappedCtx, 1);
      expect(state.session.clock).toBe(101);
      expect(state.tagRegistry).toEqual(sampleTagRegistry);
    });
  });

  describe('recorded source stepForward, stepBack, and getBounds', () => {
    const recorded = CLOCK_SOURCE_REGISTRY.recorded;

    it('steps forward from index 0 to 1 and returns uniform result with action and nextIndex', () => {
      const result = recorded.stepForward(sampleSnapshots[0], {
        sourceContext: sampleCtx,
        index: 0,
        count: 1,
      });
      expect(result).not.toBeNull();
      expect(result.nextIndex).toBe(1);
      expect(result.atMax).toBe(false);
      expect(result.action).toEqual({ type: 'APPLY_TICK', newState: result.newState });
      expect(result.newState.session.clock).toBe(101);
    });

    it('marks atMax: true when stepping forward reaches max index', () => {
      const result = recorded.stepForward(sampleSnapshots[1], {
        sourceContext: sampleCtx,
        index: 1,
        count: 1,
      });
      expect(result).not.toBeNull();
      expect(result.nextIndex).toBe(2);
      expect(result.atMax).toBe(true);
      expect(result.newState).toBe(sampleEndState);
    });

    it('returns null at the forward bound when index >= max', () => {
      const maxIndex = sampleSnapshots.length - 1;
      const result = recorded.stepForward(sampleEndState, {
        sourceContext: sampleCtx,
        index: maxIndex,
        count: 1,
      });
      expect(result).toBeNull();
    });

    it('steps back from index 2 to 1 and returns uniform result with action and nextIndex', () => {
      const result = recorded.stepBack(sampleEndState, {
        sourceContext: sampleCtx,
        index: 2,
        count: 1,
      });
      expect(result).not.toBeNull();
      expect(result.nextIndex).toBe(1);
      expect(result.action).toEqual({ type: 'APPLY_ROLLBACK', newState: result.newState });
      expect(result.newState.session.clock).toBe(101);
    });

    it('returns null at the back bound when index <= 0', () => {
      const result = recorded.stepBack(sampleSnapshots[0], {
        sourceContext: sampleCtx,
        index: 0,
        count: 1,
      });
      expect(result).toBeNull();
    });

    it('computes bounds correctly across start, middle, and end of recording', () => {
      const max = sampleSnapshots.length - 1;

      // Start: index 0
      const atStart = recorded.getBounds(null, {
        sourceContext: { ...sampleCtx, index: 0 },
      });
      expect(atStart.canStepBack).toBe(false);
      expect(atStart.canStepForward).toBe(true);
      expect(atStart.canPlay).toBe(true);

      // Middle: index 1
      const atMid = recorded.getBounds(null, {
        sourceContext: { ...sampleCtx, index: 1 },
      });
      expect(atMid.canStepBack).toBe(true);
      expect(atMid.canStepForward).toBe(true);
      expect(atMid.canPlay).toBe(true);

      // End: index max
      const atEnd = recorded.getBounds(null, {
        sourceContext: { ...sampleCtx, index: max },
      });
      expect(atEnd.canStepBack).toBe(true);
      expect(atEnd.canStepForward).toBe(false);
      expect(atEnd.canPlay).toBe(false);
    });
  });

  describe('live source bounds and step forwarding', () => {
    const live = CLOCK_SOURCE_REGISTRY.live;

    it('returns unbounded forward bounds and checks rollback horizon for back bounds', () => {
      const boundsWithLog = live.getBounds({ eventLog: sampleEventLog });
      expect(boundsWithLog.canStepForward).toBe(true);
      expect(boundsWithLog.canPlay).toBe(true);
      expect(boundsWithLog.canStepBack).toBe(true);

      const boundsEmpty = live.getBounds({ eventLog: [] });
      expect(boundsEmpty.canStepForward).toBe(true);
      expect(boundsEmpty.canPlay).toBe(true);
      expect(boundsEmpty.canStepBack).toBe(false);
    });

    it('returns uniform action shape on stepForward and stepBack', () => {
      const baseState = {
        session: { clock: 0, bank: 10, timeStep: 1, stepBack: 1, rateMultiplier: 1, workRate: 1, skillBonus: 1 },
        agents: [],
        tasks: [],
        inventory: [],
        tagRegistry: {},
        eventLog: [],
      };
      const fwd = live.stepForward(baseState);
      expect(fwd.action).toEqual({ type: 'APPLY_TICK', newState: fwd.newState });
      expect(fwd.newState.session.clock).toBe(1);

      const back = live.stepBack(fwd.newState);
      expect(back.action).toEqual({ type: 'APPLY_ROLLBACK', newState: back.newState });
      expect(back.resetProgress).toBe(true);
    });
  });

  describe('createPlayClockDriver', () => {
    function setupDriver(overrides = {}) {
      let state = sampleSnapshots[0];
      const dispatched = [];
      const intervalsScheduled = [];
      const intervalsCanceled = [];
      const rafsScheduled = [];
      const rafsCanceled = [];
      let playingState = false;

      const driver = createPlayClockDriver({
        source: 'recorded',
        sourceContext: { ...sampleCtx, index: 0 },
        getState: () => state,
        dispatch: (action) => {
          dispatched.push(action);
          state = action.newState;
        },
        scheduleInterval: (fn, ms) => {
          const handle = { id: intervalsScheduled.length + 1, fn, ms };
          intervalsScheduled.push(handle);
          return handle;
        },
        cancelInterval: (handle) => {
          intervalsCanceled.push(handle);
        },
        scheduleRaf: (fn) => {
          const handle = { id: rafsScheduled.length + 1, fn };
          rafsScheduled.push(handle);
          return handle;
        },
        cancelRaf: (handle) => {
          rafsCanceled.push(handle);
        },
        onPlayingChange: (nextPlaying) => {
          playingState = nextPlaying;
        },
        ...overrides,
      });

      return {
        driver,
        getState: () => state,
        dispatched,
        intervalsScheduled,
        intervalsCanceled,
        rafsScheduled,
        rafsCanceled,
        isPlaying: () => playingState,
      };
    }

    it('refuses to start when canPlay is false (e.g. recorded source at max)', () => {
      const maxIndex = sampleSnapshots.length - 1;
      const { driver, intervalsScheduled, isPlaying } = setupDriver({
        sourceContext: { ...sampleCtx, index: maxIndex },
      });

      const started = driver.start();
      expect(started).toBe(false);
      expect(driver.isPlaying()).toBe(false);
      expect(isPlaying()).toBe(false);
      expect(intervalsScheduled).toHaveLength(0);
    });

    it('auto-stops immediately when a tick lands on max without lagging by one interval', () => {
      const maxIndex = sampleSnapshots.length - 1; // 2
      const onIndexChange = vi.fn();
      const { driver, intervalsScheduled, intervalsCanceled, isPlaying, dispatched } = setupDriver({
        sourceContext: { ...sampleCtx, index: 1, onIndexChange },
      });

      // Start playing from index 1
      const started = driver.start();
      expect(started).toBe(true);
      expect(driver.isPlaying()).toBe(true);
      expect(intervalsScheduled).toHaveLength(1);

      // Interval fires tick(): advances from 1 to 2 (max)
      intervalsScheduled[0].fn();

      expect(driver.getIndex()).toBe(maxIndex);
      expect(onIndexChange).toHaveBeenCalledWith(maxIndex);
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0].type).toBe('APPLY_TICK');

      // Auto-stop triggered immediately on this tick
      expect(driver.isPlaying()).toBe(false);
      expect(isPlaying()).toBe(false);
      expect(intervalsCanceled).toHaveLength(1);
      expect(intervalsCanceled[0]).toBe(intervalsScheduled[0]);
    });

    it('syncs internal index and clears progress rates when syncIndex is called', () => {
      const { driver } = setupDriver({
        sourceContext: { ...sampleCtx, index: 0 },
      });

      expect(driver.getIndex()).toBe(0);
      expect(driver.getBounds().canStepBack).toBe(false);

      driver.syncIndex(2);
      expect(driver.getIndex()).toBe(2);
      expect(driver.getBounds().canStepBack).toBe(true);
      expect(driver.getBounds().canStepForward).toBe(false);
      expect(driver.getBounds().canPlay).toBe(false);
    });

    it('does not schedule RAF loop when source does not interpolate', () => {
      // Recorded source (interpolates: false)
      const recorded = setupDriver({ source: 'recorded' });
      recorded.driver.start();
      expect(recorded.intervalsScheduled).toHaveLength(1);
      expect(recorded.rafsScheduled).toHaveLength(0);

      // Live source (interpolates: true)
      const live = setupDriver({
        source: 'live',
        getState: () => ({ session: { clock: 0 }, eventLog: [] }),
      });
      live.driver.start();
      expect(live.intervalsScheduled).toHaveLength(1);
      expect(live.rafsScheduled).toHaveLength(1);
    });

    it('switches source cleanly, stopping running interval and resetting index and tickInfo', () => {
      const { driver, intervalsScheduled, intervalsCanceled, isPlaying } = setupDriver({
        source: 'live',
        getState: () => ({ session: { clock: 0 }, eventLog: [] }),
      });

      driver.start();
      expect(driver.isPlaying()).toBe(true);
      expect(intervalsScheduled).toHaveLength(1);

      // Switch to recorded at index 1
      driver.switchSource('recorded', { ...sampleCtx, index: 1 });

      expect(driver.isPlaying()).toBe(false);
      expect(isPlaying()).toBe(false);
      expect(intervalsCanceled).toHaveLength(1);
      expect(driver.getIndex()).toBe(1);
      expect(driver.getTickInfo().lastTickWallTime).toBe(0);
    });

    it('notifies onIndexChange on stepBack and advance', () => {
      const onIndexChange = vi.fn();
      const { driver, dispatched } = setupDriver({
        sourceContext: { ...sampleCtx, index: 1, onIndexChange },
      });

      driver.advance();
      expect(onIndexChange).toHaveBeenCalledWith(2);
      expect(dispatched[0].type).toBe('APPLY_TICK');

      driver.retreat();
      expect(onIndexChange).toHaveBeenCalledWith(1);
      expect(dispatched[1].type).toBe('APPLY_ROLLBACK');
    });
  });
});
