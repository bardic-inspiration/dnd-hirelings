import { describe, expect, it, vi } from 'vitest';
import reducerSource from '../state/reducer.js?raw';
import {
  PLAYER_ALLOWED_ACTIONS,
  PLAYER_SESSION_KEYS,
  SPECTATOR_ALLOWED_ACTIONS,
  deriveMode,
  gateDispatch,
  isActionAllowed,
} from './permissions.js';

describe('multiplayer permissions', () => {
  describe('exported sets', () => {
    it('defines PLAYER_ALLOWED_ACTIONS with the specified members', () => {
      const expected = [
        'APPLY_TICK',
        'APPLY_ROLLBACK',
        'AGENT_ADD_ACTIVITY',
        'AGENT_REMOVE_ACTIVITY',
        'AGENT_BIND_ITEM',
        'AGENT_UNBIND_ITEM',
        'AGENT_RETURN_ITEM',
        'ITEM_PLACE',
        'SESSION_UPDATE',
        'DYN_RECONCILE',
      ];
      expect(PLAYER_ALLOWED_ACTIONS).toBeInstanceOf(Set);
      expect(PLAYER_ALLOWED_ACTIONS.size).toBe(expected.length);
      expected.forEach((actionType) => {
        expect(PLAYER_ALLOWED_ACTIONS.has(actionType)).toBe(true);
      });
    });

    it('defines PLAYER_SESSION_KEYS with timeStep, stepBack, and rateMultiplier', () => {
      const expected = ['timeStep', 'stepBack', 'rateMultiplier'];
      expect(PLAYER_SESSION_KEYS).toBeInstanceOf(Set);
      expect(PLAYER_SESSION_KEYS.size).toBe(expected.length);
      expected.forEach((key) => {
        expect(PLAYER_SESSION_KEYS.has(key)).toBe(true);
      });
    });

    it('defines SPECTATOR_ALLOWED_ACTIONS with only DYN_RECONCILE', () => {
      expect(SPECTATOR_ALLOWED_ACTIONS).toBeInstanceOf(Set);
      expect(SPECTATOR_ALLOWED_ACTIONS.size).toBe(1);
      expect(SPECTATOR_ALLOWED_ACTIONS.has('DYN_RECONCILE')).toBe(true);
    });

    it('verifies every allowed action is actively handled by the reducer', () => {
      const reducerActionTypes = new Set(
        [...reducerSource.matchAll(/case '([A-Z_]+)':/g)].map((match) => match[1]),
      );

      for (const actionType of PLAYER_ALLOWED_ACTIONS) {
        expect(reducerActionTypes.has(actionType)).toBe(true);
      }
      for (const actionType of SPECTATOR_ALLOWED_ACTIONS) {
        expect(reducerActionTypes.has(actionType)).toBe(true);
      }
    });
  });

  describe('isActionAllowed', () => {
    describe('gm mode', () => {
      it('allows all player-allowed actions', () => {
        for (const actionType of PLAYER_ALLOWED_ACTIONS) {
          expect(isActionAllowed('gm', { type: actionType })).toBe(true);
        }
      });

      it('allows actions excluded from player mode', () => {
        const gmOnlyActions = [
          'AGENT_CREATE',
          'AGENT_UPDATE',
          'AGENT_DELETE',
          'AGENT_DUPLICATE',
          'TASK_CREATE',
          'TASK_UPDATE',
          'TASK_DELETE',
          'TASK_CONDITION_UPDATE',
          'TASK_SET_COMPLETE',
          'INVENTORY_ADD',
          'TAG_APPLY',
          'TAGREG_REPLACE',
          'RESET',
        ];
        for (const actionType of gmOnlyActions) {
          expect(isActionAllowed('gm', { type: actionType })).toBe(true);
        }
      });

      it('allows SESSION_UPDATE with any payload keys including restricted keys', () => {
        expect(isActionAllowed('gm', { type: 'SESSION_UPDATE', payload: { bank: 500 } })).toBe(true);
        expect(isActionAllowed('gm', { type: 'SESSION_UPDATE', payload: { clock: 1000 } })).toBe(true);
        expect(isActionAllowed('gm', { type: 'SESSION_UPDATE', payload: { title: 'Guild' } })).toBe(true);
      });
    });

    describe('player mode', () => {
      it('allows non-SESSION_UPDATE player-allowed actions', () => {
        const actions = [
          'APPLY_TICK',
          'APPLY_ROLLBACK',
          'AGENT_ADD_ACTIVITY',
          'AGENT_REMOVE_ACTIVITY',
          'AGENT_BIND_ITEM',
          'AGENT_UNBIND_ITEM',
          'AGENT_RETURN_ITEM',
          'ITEM_PLACE',
          'DYN_RECONCILE',
        ];
        for (const actionType of actions) {
          expect(isActionAllowed('player', { type: actionType })).toBe(true);
        }
      });

      it('allows SESSION_UPDATE when all payload keys are in PLAYER_SESSION_KEYS', () => {
        expect(isActionAllowed('player', { type: 'SESSION_UPDATE', payload: { timeStep: 1 } })).toBe(true);
        expect(isActionAllowed('player', { type: 'SESSION_UPDATE', payload: { stepBack: 5 } })).toBe(true);
        expect(isActionAllowed('player', { type: 'SESSION_UPDATE', payload: { rateMultiplier: 2 } })).toBe(true);
        expect(
          isActionAllowed('player', {
            type: 'SESSION_UPDATE',
            payload: { timeStep: 2, stepBack: 1, rateMultiplier: 0.5 },
          }),
        ).toBe(true);
        expect(isActionAllowed('player', { type: 'SESSION_UPDATE', payload: {} })).toBe(true);
        expect(isActionAllowed('player', { type: 'SESSION_UPDATE' })).toBe(true);
      });

      it('rejects SESSION_UPDATE when any payload key is not in PLAYER_SESSION_KEYS', () => {
        expect(isActionAllowed('player', { type: 'SESSION_UPDATE', payload: { bank: 100 } })).toBe(false);
        expect(isActionAllowed('player', { type: 'SESSION_UPDATE', payload: { clock: 42 } })).toBe(false);
        expect(isActionAllowed('player', { type: 'SESSION_UPDATE', payload: { title: 'New Guild' } })).toBe(false);
        expect(
          isActionAllowed('player', {
            type: 'SESSION_UPDATE',
            payload: { timeStep: 1, bank: 100 },
          }),
        ).toBe(false);
      });

      it('rejects actions not in PLAYER_ALLOWED_ACTIONS', () => {
        const disallowed = [
          'AGENT_CREATE',
          'AGENT_UPDATE',
          'AGENT_DELETE',
          'TASK_CONDITION_UPDATE',
          'TASK_SET_COMPLETE',
          'TASK_CREATE',
          'INVENTORY_ADD',
          'RESET',
        ];
        for (const actionType of disallowed) {
          expect(isActionAllowed('player', { type: actionType })).toBe(false);
        }
      });
    });

    describe('spectator mode', () => {
      it('allows only DYN_RECONCILE', () => {
        expect(isActionAllowed('spectator', { type: 'DYN_RECONCILE' })).toBe(true);
      });

      it('rejects all other actions', () => {
        const disallowed = [
          'APPLY_TICK',
          'APPLY_ROLLBACK',
          'AGENT_ADD_ACTIVITY',
          'ITEM_PLACE',
          'SESSION_UPDATE',
          'AGENT_CREATE',
          'TASK_SET_COMPLETE',
        ];
        for (const actionType of disallowed) {
          expect(isActionAllowed('spectator', { type: actionType })).toBe(false);
        }
      });
    });

    describe('unknown mode and invalid inputs', () => {
      it('rejects all actions for unknown or missing modes', () => {
        expect(isActionAllowed('unknown', { type: 'APPLY_TICK' })).toBe(false);
        expect(isActionAllowed('party', { type: 'APPLY_TICK' })).toBe(false);
        expect(isActionAllowed('', { type: 'APPLY_TICK' })).toBe(false);
        expect(isActionAllowed(null, { type: 'APPLY_TICK' })).toBe(false);
        expect(isActionAllowed(undefined, { type: 'APPLY_TICK' })).toBe(false);
      });

      it('rejects non-object or missing actions', () => {
        expect(isActionAllowed('gm', null)).toBe(false);
        expect(isActionAllowed('player', null)).toBe(false);
        expect(isActionAllowed('spectator', null)).toBe(false);
        expect(isActionAllowed('player', undefined)).toBe(false);
        expect(isActionAllowed('player', 'not-an-action')).toBe(false);
      });
    });
  });

  describe('deriveMode', () => {
    it('returns gm when role is gm regardless of baton and lock state', () => {
      expect(deriveMode('gm', { turnOwner: 'gm' }, false)).toBe('gm');
      expect(deriveMode('gm', { turnOwner: 'party' }, true)).toBe('gm');
      expect(deriveMode('gm', { turnOwner: 'party' }, false)).toBe('gm');
      expect(deriveMode('gm', null, false)).toBe('gm');
    });

    it('returns player when non-gm, baton is party, and holdsWriteLock is true', () => {
      expect(deriveMode('party', { turnOwner: 'party' }, true)).toBe('player');
      expect(deriveMode('other', { turnOwner: 'party' }, true)).toBe('player');
    });

    it('returns spectator when baton is party but pen is not held', () => {
      expect(deriveMode('party', { turnOwner: 'party' }, false)).toBe('spectator');
      expect(deriveMode('other', { turnOwner: 'party' }, false)).toBe('spectator');
    });

    it('returns spectator when baton is with gm', () => {
      expect(deriveMode('party', { turnOwner: 'gm' }, false)).toBe('spectator');
      expect(deriveMode('party', { turnOwner: 'gm' }, true)).toBe('spectator');
    });

    it('returns spectator when baton is null or malformed', () => {
      expect(deriveMode('party', null, true)).toBe('spectator');
      expect(deriveMode('party', undefined, true)).toBe('spectator');
      expect(deriveMode('party', {}, true)).toBe('spectator');
      expect(deriveMode('party', 'party', true)).toBe('spectator');
    });
  });

  describe('gateDispatch', () => {
    it('forwards allowed actions to rawDispatch', () => {
      const rawDispatch = vi.fn();
      const dispatch = gateDispatch(rawDispatch, () => 'player');
      const action = { type: 'APPLY_TICK' };

      dispatch(action);

      expect(rawDispatch).toHaveBeenCalledTimes(1);
      expect(rawDispatch).toHaveBeenCalledWith(action);
    });

    it('silently drops disallowed actions without invoking rawDispatch', () => {
      const rawDispatch = vi.fn();
      const dispatch = gateDispatch(rawDispatch, () => 'player');
      const disallowedAction = { type: 'AGENT_CREATE' };

      dispatch(disallowedAction);

      expect(rawDispatch).not.toHaveBeenCalled();
    });

    it('evaluates mode dynamically on each dispatch call', () => {
      const rawDispatch = vi.fn();
      let currentMode = 'spectator';
      const dispatch = gateDispatch(rawDispatch, () => currentMode);

      const tickAction = { type: 'APPLY_TICK' };

      // Dropped while spectator
      dispatch(tickAction);
      expect(rawDispatch).not.toHaveBeenCalled();

      // Allowed once promoted to player
      currentMode = 'player';
      dispatch(tickAction);
      expect(rawDispatch).toHaveBeenCalledTimes(1);
      expect(rawDispatch).toHaveBeenCalledWith(tickAction);
    });

    it('accepts a static mode string instead of a getter function', () => {
      const rawDispatch = vi.fn();
      const dispatch = gateDispatch(rawDispatch, 'gm');
      const action = { type: 'ANY_ACTION' };

      dispatch(action);

      expect(rawDispatch).toHaveBeenCalledTimes(1);
      expect(rawDispatch).toHaveBeenCalledWith(action);
    });

    it('returns the result of rawDispatch when allowed, or undefined when dropped', () => {
      const rawDispatch = vi.fn().mockReturnValue('dispatched');
      const dispatch = gateDispatch(rawDispatch, () => 'player');

      const allowedResult = dispatch({ type: 'APPLY_TICK' });
      expect(allowedResult).toBe('dispatched');

      const droppedResult = dispatch({ type: 'AGENT_CREATE' });
      expect(droppedResult).toBeUndefined();
    });
  });
});
