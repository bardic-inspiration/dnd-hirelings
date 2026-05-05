export const uid = () => Math.random().toString(36).slice(2, 9);
export const now = () => Date.now();

export function flashAgentCard(agentId) {
  const card = document.querySelector(`.agent-card[data-id="${agentId}"]`);
  if (!card) return;
  card.classList.remove('flash-error');
  void card.offsetWidth;
  card.classList.add('flash-error');
  card.addEventListener('animationend', () => card.classList.remove('flash-error'), { once: true });
}
