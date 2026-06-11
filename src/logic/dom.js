/**
 * Retriggers the error-flash animation on an agent card.
 * Removes then re-adds `agent-card--flash-error`, forcing a reflow in between so
 * the CSS animation restarts even if it was already running. The class is cleared
 * on `animationend` so the card returns to its resting state.
 *
 * No-op if no card with the given id is mounted.
 *
 * @param {string} agentId - The agent's id, matched against `.agent-card[data-id]`
 */
export function flashAgentCard(agentId) {
  const card = document.querySelector(`.agent-card[data-id="${agentId}"]`);
  if (!card) return;
  card.classList.remove('agent-card--flash-error');
  void card.offsetWidth;
  card.classList.add('agent-card--flash-error');
  card.addEventListener('animationend', () => card.classList.remove('agent-card--flash-error'), { once: true });
}
