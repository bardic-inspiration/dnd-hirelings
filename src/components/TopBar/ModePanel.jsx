import { useState } from 'react';
import { useNetSession } from '../../state/NetSessionContext.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { MODE_CELLS, gmTurnControl, partySlot } from '../../logic/modePanel.js';
import Tooltip from '../Tooltip.jsx';

/**
 * The networked top-bar panel (docs/spec/multiplayer.md "Mode sub-panel"):
 * the read-only mode indicator, then the GM's turn control or the party's
 * claim / commit slot. Its controls make network calls through
 * `useNetSession()`, never reducer actions. Renders nothing offline.
 *
 * @param {{ onStop: () => void }} props `onStop` halts the play clock before
 *   the board changes hands, so no tick lands after a hand-off or commit.
 */
export default function ModePanel({ onStop }) {
  const net = useNetSession();
  const { openConfirm, openReview } = useUI();
  const [busy, setBusy] = useState(false);

  if (!net.enabled) return null;

  const call = async (request) => {
    setBusy(true);
    try {
      await request();
    } finally {
      setBusy(false);
    }
  };

  const gmCalls = {
    handOff: () => call(() => { onStop(); return net.setBaton('party'); }),
    takeBack: () => call(() => net.setBaton('gm')),
    review: () => { onStop(); openReview(); },
  };
  const partyCalls = {
    claim: () => call(() => net.claimPen()),
    commit: () => openConfirm({
      message: 'Commit your turn and hand the board to the GM for review?',
      onConfirm: () => call(() => { onStop(); return net.commitTurn(); }),
    }),
  };

  const gmControl = net.role === 'gm' ? gmTurnControl(net.baton) : null;
  const party = net.role === 'party' ? partySlot(net.baton, net.holdsWriteLock) : null;
  const control = gmControl ?? (party?.action ? party : null);
  const handler = control && (gmCalls[control.action] ?? partyCalls[control.action]);

  return (
    <div className="inset-panel mode-panel">
      <Tooltip content="This client's mode">
        <span className="mode-switch">
          {MODE_CELLS.map(cell => (
            <span
              key={cell.mode}
              className={`mode-switch-cell${net.mode === cell.mode ? ' mode-switch-cell--filled' : ''}`}
            >{cell.label}</span>
          ))}
        </span>
      </Tooltip>
      {party && <span className="mode-panel-status">{party.status}</span>}
      {control && (
        <button
          className="ctrl"
          disabled={busy || !handler}
          onClick={handler}
        >{control.label}</button>
      )}
      {net.error && (
        <Tooltip content={net.error}>
          <span className="mode-panel-error">⚠</span>
        </Tooltip>
      )}
    </div>
  );
}
