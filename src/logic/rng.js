// Seeded randomness for the task engine (docs/spec/task-engine.md
// "Randomness"). A string key hashes to a 32-bit seed that feeds a small
// PRNG, so the same key always replays the same rolls. No dependency.
//
// Changing either algorithm changes every replayed roll; rng.test.js pins
// golden values to catch that.

/**
 * Hashes a string to an unsigned 32-bit seed: FNV-1a, then MurmurHash3's
 * finalizer so keys differing in one trailing character land far apart.
 *
 * @param {string} key
 * @returns {number} Integer in [0, 2^32)
 */
export function hashSeed(key) {
  let hash = 0x811c9dc5;
  const text = String(key);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/**
 * Creates the random stream for a key (mulberry32 over `hashSeed(key)`).
 *
 * @param {string} key
 * @returns {() => number} Each call returns the stream's next value in [0, 1)
 */
export function createRng(key) {
  let state = hashSeed(key);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 32;
  };
}

/**
 * Rolls `count` dice of `sides` faces from one key's stream — one `NdM`
 * literal is one key.
 *
 * @param {string} key - Usually `rollSeedKey(...)`
 * @param {number} count - N, a positive integer
 * @param {number} sides - M, a positive integer
 * @returns {{ result: number, values: number[] }} The sum, and each die in draw order
 */
export function rollDice(key, count, sides) {
  const next = createRng(key);
  const values = [];
  for (let i = 0; i < count; i++) values.push(1 + Math.floor(next() * sides));
  return { result: values.reduce((sum, value) => sum + value, 0), values };
}

/**
 * Builds the seed key for one roll: `${clock}|${taskId}|${operatorId}|${agentId}|${rollIndex}`.
 *
 * @param {{ clock: number, taskId: string, operatorId: string,
 *   agentId: string, rollIndex: number }} parts
 * @returns {string}
 */
export function rollSeedKey({ clock, taskId, operatorId, agentId, rollIndex }) {
  return `${clock}|${taskId}|${operatorId}|${agentId}|${rollIndex}`;
}
