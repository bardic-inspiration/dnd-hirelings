import { useRef, useEffect } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { useUI } from '../../state/UIContext.jsx';
import { usePressHoldDrag } from '../../hooks/usePressHoldDrag.js';
import { formatGold } from '../../logic/format.js';

export default function BankPanel() {
  const { state, dispatch } = useGame();
  const { selectedItemId, setSelectedItemId } = useUI();
  const bank = state.session.bank ?? 0;

  const selectedItem = selectedItemId
    ? state.inventory.find(item => item.id === selectedItemId)
    : null;

  const adjust = (delta) =>
    dispatch({ type: 'SESSION_UPDATE', payload: { bank: Math.round((bank + delta) * 100) / 100 } });

  // Sell one unit of the selected item via the unified place-item path: bank +=
  // value, quantity -= 1. Depleted items stay in the list (grayed) rather than
  // being removed. Selection persists while stock remains, matching give.
  const canSell = selectedItem && selectedItem.quantity > 0;
  const sellSelected = () => {
    if (!canSell) return;
    dispatch({ type: 'ITEM_PLACE', target: { type: 'bank' }, itemId: selectedItem.id });
    if (selectedItem.quantity <= 1) setSelectedItemId(null);
  };

  const { onPointerDown } = usePressHoldDrag({
    onClick: () => { if (canSell) sellSelected(); },
    onAdjust: adjust,
  });

  // Flash green on increase, red on decrease.
  const amountRef = useRef(null);
  const prevRef   = useRef(bank);
  useEffect(() => {
    const amountEl = amountRef.current;
    if (!amountEl || bank === prevRef.current) { prevRef.current = bank; return; }
    const cls = bank > prevRef.current ? 'bank-amount--flash-increase' : 'bank-amount--flash-decrease';
    prevRef.current = bank;
    amountEl.classList.remove('bank-amount--flash-increase', 'bank-amount--flash-decrease');
    void amountEl.offsetWidth;
    amountEl.classList.add(cls);
    amountEl.addEventListener('animationend', () => amountEl.classList.remove(cls), { once: true });
  }, [bank]);

  return (
    <div
      className={`bank-panel${canSell ? ' bank-panel--sellable' : ''}`}
      title={canSell
        ? `Click to sell 1 ${selectedItem.name} for ${selectedItem.value || 0} GP`
        : 'Hold and drag up/down to adjust gold'}
      onPointerDown={onPointerDown}
    >
      <span className="bank-label">BANK:</span>
      <span ref={amountRef} className="bank-amount mono">{formatGold(bank)}</span>
      <span className="bank-label">GOLD</span>
    </div>
  );
}
