import { describe, it, expect, vi } from 'vitest';
import {
  isActionAllowed, deriveMode, gateDispatch,
  PLAYER_ALLOWED_ACTIONS, PLAYER_SESSION_KEYS, SPECTATOR_ALLOWED_ACTIONS,
} from './permissions.js';

describe('isActionAllowed', () => {
  it('gm may dispatch anything, including unknown types', () => {
    expect(isActionAllowed('gm', { type: 'AGENT_UPDATE' })).toBe(true);
    expect(isActionAllowed('gm', { type: 'TAGREG_REPLACE' })).toBe(true);
    expect(isActionAllowed('gm', { type: 'ANYTHING_AT_ALL' })).toBe(true);
  });

  it('player may dispatch every action in the allow-set', () => {
    for (const type of PLAYER_ALLOWED_ACTIONS) {
      // SESSION_UPDATE with no payload has no offending keys, so it passes.
      expect(isActionAllowed('player', { type, payload: {} })).toBe(true);
    }
  });

  it('player is blocked from GM-only actions', () => {
    for (const type of ['AGENT_UPDATE', 'AGENT_CREATE', 'TASK_CREATE',
      'TASK_CONDITION_UPDATE', 'TASK_SET_COMPLETE', 'TAG_APPLY', 'TAGREG_REPLACE',
      'REPLACE_STATE', 'RESET']) {
      expect(isActionAllowed('player', { type })).toBe(false);
    }
  });

  it('player SESSION_UPDATE passes only when every key is allowed', () => {
    for (const key of PLAYER_SESSION_KEYS) {
      expect(isActionAllowed('player', { type: 'SESSION_UPDATE', payload: { [key]: 1 } })).toBe(true);
    }
    // A mix of allowed + forbidden keys rejects the whole action.
    expect(isActionAllowed('player', { type: 'SESSION_UPDATE', payload: { timeStep: 2, clock: 5 } })).toBe(false);
    expect(isActionAllowed('player', { type: 'SESSION_UPDATE', payload: { clock: 5 } })).toBe(false);
    expect(isActionAllowed('player', { type: 'SESSION_UPDATE', payload: { bank: 999 } })).toBe(false);
  });

  it('spectator may only dispatch DYN_RECONCILE', () => {
    for (const type of SPECTATOR_ALLOWED_ACTIONS) {
      expect(isActionAllowed('spectator', { type })).toBe(true);
    }
    expect(isActionAllowed('spectator', { type: 'DYN_RECONCILE' })).toBe(true);
    expect(isActionAllowed('spectator', { type: 'APPLY_TICK' })).toBe(false);
    expect(isActionAllowed('spectator', { type: 'SESSION_UPDATE', payload: { timeStep: 1 } })).toBe(false);
  });

  it('unknown mode denies everything (graceful fallback)', () => {
    expect(isActionAllowed(undefined, { type: 'DYN_RECONCILE' })).toBe(false);
    expect(isActionAllowed('bogus', { type: 'APPLY_TICK' })).toBe(false);
  });
});

describe('deriveMode', () => {
  it('covers the four-row table', () => {
    // GM is always gm regardless of baton/lock.
    expect(deriveMode('gm', { turnOwner: 'gm' }, false)).toBe('gm');
    expect(deriveMode('gm', { turnOwner: 'party' }, true)).toBe('gm');
    // party between turns (GM's turn) → spectator.
    expect(deriveMode('party', { turnOwner: 'gm' }, false)).toBe('spectator');
    // party's turn, holds the pen → player.
    expect(deriveMode('party', { turnOwner: 'party' }, true)).toBe('player');
    // party's turn, another holds the pen → spectator.
    expect(deriveMode('party', { turnOwner: 'party' }, false)).toBe('spectator');
  });

  it('treats a missing baton as spectator for the party', () => {
    expect(deriveMode('party', null, false)).toBe('spectator');
    expect(deriveMode('party', undefined, true)).toBe('spectator');
  });
});

describe('gateDispatch', () => {
  it('forwards allowed actions and drops disallowed ones', () => {
    const raw = vi.fn();
    let mode = 'player';
    const dispatch = gateDispatch(raw, () => mode);

    dispatch({ type: 'APPLY_TICK', newState: {} });
    expect(raw).toHaveBeenCalledTimes(1);

    dispatch({ type: 'AGENT_UPDATE', id: 'x' });
    expect(raw).toHaveBeenCalledTimes(1); // dropped

    // Mode is read live through the getter, not captured at wrap time.
    mode = 'gm';
    dispatch({ type: 'AGENT_UPDATE', id: 'x' });
    expect(raw).toHaveBeenCalledTimes(2);
  });
});
