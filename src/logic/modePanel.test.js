import { describe, expect, it } from 'vitest';
import { MODE_CELLS, gmTurnControl, partySlot } from './modePanel.js';

const baton = (turnOwner, status, holder = null) => ({ turnOwner, status, holder });

describe('MODE_CELLS', () => {
  it('lists the three indicator cells in order, keyed by derived mode', () => {
    expect(MODE_CELLS.map(cell => [cell.mode, cell.label])).toEqual([
      ['gm', 'GM'],
      ['player', 'PLAYER'],
      ['spectator', 'OBS'],
    ]);
  });
});

describe('gmTurnControl', () => {
  it('offers hand to party while the GM is editing', () => {
    expect(gmTurnControl(baton('gm', 'gm-editing'))).toEqual({ action: 'handOff', label: 'HAND TO PARTY' });
  });

  it('offers take back during the party turn', () => {
    expect(gmTurnControl(baton('party', 'party-turn', 'tok'))).toEqual({ action: 'takeBack', label: 'TAKE BACK' });
  });

  it('offers review while a turn is pending review', () => {
    expect(gmTurnControl(baton('gm', 'pending-review'))).toEqual({ action: 'review', label: 'REVIEW' });
  });

  it('offers nothing before the baton is known or for an unknown status', () => {
    expect(gmTurnControl(null)).toBeNull();
    expect(gmTurnControl(baton('gm', 'bogus'))).toBeNull();
  });
});

describe('partySlot', () => {
  it("shows GM's turn with no control while the GM holds the baton", () => {
    expect(partySlot(baton('gm', 'gm-editing'), false)).toEqual({ action: null, label: null, status: "GM's turn" });
  });

  it('shows awaiting review while the turn is pending review', () => {
    expect(partySlot(baton('gm', 'pending-review'), false)).toEqual({ action: null, label: null, status: 'awaiting review' });
  });

  it('offers claim pen when it is the party turn and the pen is free', () => {
    expect(partySlot(baton('party', 'party-turn'), false)).toEqual({ action: 'claim', label: 'CLAIM PEN', status: "party's turn — open" });
  });

  it('offers commit / end turn to the pen holder', () => {
    expect(partySlot(baton('party', 'party-turn', 'tok'), true)).toEqual({ action: 'commit', label: 'COMMIT / END TURN', status: "you're playing" });
  });

  it('shows another member playing when someone else holds the pen', () => {
    expect(partySlot(baton('party', 'party-turn', 'tok'), false)).toEqual({ action: null, label: null, status: 'a party member is playing' });
  });

  it('shows connecting before the baton is known', () => {
    expect(partySlot(null, false)).toEqual({ action: null, label: null, status: 'connecting…' });
  });
});
