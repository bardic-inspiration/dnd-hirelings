import { useGame } from '../../state/GameContext.jsx';
import { useNetSession } from '../../state/NetSessionContext.jsx';
import { useUI } from '../../state/UIContext.jsx';

// The three permission modes, in indicator order. The filled cell is this
// client's derived mode.
const MODE_CELLS = [['gm', 'GM'], ['player', 'PLAYER'], ['spectator', 'OBS']];

/**
 * Read-only three-cell mode indicator — a clone of the palette switch. Reads
 * `deriveMode`, writes nothing; deliberately separate from the GM's turn control
 * so a party client never watches a control it can't operate slide on its own.
 */
function ModeIndicator({ mode }) {
  return (
    <div className="mode-switch" role="img" aria-label={`mode: ${mode}`}>
      {MODE_CELLS.map(([key, label]) => (
        <span key={key} className={`mode-switch-cell${mode === key ? ' mode-switch-cell--filled' : ''}`}>{label}</span>
      ))}
    </div>
  );
}

/**
 * The TopBar mode sub-panel (see docs/specs/gm-player-mode.md §7). Rendered only
 * when networked (self-hides otherwise, so TopBar can mount it unconditionally).
 * Turn management is NOT a game action — every control here writes network calls
 * via `useNetSession()`, never the reducer.
 */
export default function ModePanel() {
  const net = useNetSession();
  const { state } = useGame();
  const { openReview, openConfirm } = useUI();
  if (!net?.enabled) return null;

  const { role, baton, mode, holdsWriteLock, claimPen, commitTurn, setBaton } = net;
  const status = baton?.status;

  // Surfaces a rejected turn-control call (e.g. a 409 stale-base commit) as an
  // alert rather than failing silently.
  const guard = (promise) => promise?.catch(err => openConfirm({ message: err.message, type: 'alert' }));

  // GM turn controls, contextual by baton.status. Hand-off carries the GM's
  // current state as the new HEAD (what the party pulls at turn start).
  const gmControl = () => {
    if (status === 'party-turn') {
      return <button className="ctrl" onClick={() => guard(setBaton('gm'))}>TAKE BACK</button>;
    }
    if (status === 'pending-review') {
      return <button className="ctrl" onClick={() => openReview()}>REVIEW</button>;
    }
    return <button className="ctrl" onClick={() => guard(setBaton('party', state))}>HAND TO PARTY</button>;
  };

  // Party write-control lifecycle — one slot, contextual by (status, holder).
  const partyControl = () => {
    if (baton?.turnOwner !== 'party') {
      return <span className="mode-panel-status dim">GM&apos;s turn</span>;
    }
    if (holdsWriteLock) {
      return (
        <>
          <button className="ctrl" onClick={() => guard(commitTurn())}>COMMIT / END TURN</button>
          <span className="mode-panel-status dim">you&apos;re playing</span>
        </>
      );
    }
    if (baton?.holder) {
      return <span className="mode-panel-status dim">a party member is playing</span>;
    }
    return (
      <>
        <button className="ctrl" onClick={() => guard(claimPen())}>CLAIM PEN</button>
        <span className="mode-panel-status dim">party&apos;s turn — open</span>
      </>
    );
  };

  return (
    <div className="inset-panel mode-panel">
      <ModeIndicator mode={mode} />
      {role === 'gm' ? gmControl() : partyControl()}
    </div>
  );
}
