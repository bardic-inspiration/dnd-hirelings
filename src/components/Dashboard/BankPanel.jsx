import { useRef, useEffect } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { usePressHoldDrag } from '../../hooks/usePressHoldDrag.js';

export default function BankPanel() {
  const { state, dispatch } = useGame();
  const { selectedItemId, setSelectedItemId } = useUI();
  const bank = state.session.bank ?? 0;

  const selectedItem = selectedItemId
    ? state.inventory.find(i => i.id === selectedItemId)
    : null;

  const adjust = (delta) =>
    dispatch({ type: 'SESSION_UPDATE', payload: { bank: Math.round((bank + delta) * 100) / 100 } });

  // Sell one unit of the selected item: bank += value, qty -= 1. Depleted items
  // stay in the list (grayed) rather than being removed.
  const canSell = selectedItem && selectedItem.qty > 0;
  const sellSelected = () => {
    if (!canSell) return;
    adjust(selectedItem.value || 0);
    dispatch({ type: 'INVENTORY_UPDATE_ITEM', id: selectedItem.id, changes: { qty: selectedItem.qty - 1 } });
  };

  const { holding, onPointerDown } = usePressHoldDrag({
    onClick: () => { if (canSell) sellSelected(); },
    onAdjust: adjust,
  });

  // Flash green on increase, red on decrease.
  const elRef   = useRef(null);
  const prevRef = useRef(bank);
  useEffect(() => {
    const el = elRef.current;
    if (!el || bank === prevRef.current) { prevRef.current = bank; return; }
    const cls = bank > prevRef.current ? 'flash-increase' : 'flash-decrease';
    prevRef.current = bank;
    el.classList.remove('flash-increase', 'flash-decrease');
    void el.offsetWidth;
    el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
  }, [bank]);

  return (
    <div
      className={`bank-panel${canSell ? ' sellable' : ''}${holding ? ' holding' : ''}`}
      title={canSell
        ? `Click to sell 1 ${selectedItem.name} for ${selectedItem.value || 0} GP`
        : 'Hold and drag up/down to adjust gold'}
      onPointerDown={onPointerDown}
    >
      <span className="bank-label">BANK:</span>
      <span ref={elRef} className="bank-amount mono">{bank.toFixed(1)}</span>
      <span className="bank-label">GOLD</span>
    </div>
  );
}
