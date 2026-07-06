import { parseTag } from './tags.js';
import { getEffectiveAttributes } from './agents.js';
import { resolveTagValue } from './tagValues.js';

// Returns the numeric value of an ability tag (e.g. 'ability:str=14' → 14).
function getAbility(attributes, name) {
  for (const tag of attributes) {
    const parsed = parseTag(tag);
    if (parsed.segments[0] === 'ability' && parsed.segments[1]?.toLowerCase() === name.toLowerCase()) {
      return parseFloat(parsed.value) || 10;
    }
  }
  return 10; // default ability score
}

// Returns the display value of the first non-modifier tag in a category
// ('class:fighter' → 'fighter' when fighter is a registered leaf, or an
// explicit 'class=fighter'). Strict registry-bounded read: an unregistered
// or non-leaf terminal yields null (see logic/tagValues.js).
function getCategoryValue(attributes, category, registry) {
  for (const tag of attributes) {
    const parsed = parseTag(tag);
    if (parsed.modifier || parsed.segments[0] !== category) continue;
    const value = resolveTagValue('display', parsed, registry);
    if (value !== null) return String(value).toLowerCase();
  }
  return null;
}

/**
 * Computes the XP threshold needed to reach the given level.
 *
 * Inverts the level formula: `level_xp = 0.5*(1+sqrt(1+xp/125))` →
 * `xp = 125*((2*level-1)² - 1)`.
 *
 * @param {number} level - Target level
 * @returns {number} Total XP required to reach that level
 */
export function xpForLevel(level) {
  return 125 * ((2 * level - 1) ** 2 - 1);
}

/**
 * Derives all computed stats for an agent from their raw data.
 *
 * Applies bound-item bonuses via `getEffectiveAttributes` before computing stats,
 * so bound items that grant ability bonuses are reflected in AC, HP, etc.
 *
 * Formulas:
 * - Level: `floor(0.5 * (1 + sqrt(1 + xp / 125)))`, min 1
 * - XP per level N: `125 * ((2N - 1)² - 1)`
 * - AC: `10 + floor((DEX - 10) / 2)`
 * - HP max: `10 + (5 + classBonus + CON_mod) * level` (min 1)
 *   - classBonus: −1 sorcerer/wizard, +1 fighter/paladin/ranger, +2 barbarian, 0 otherwise
 * - Proficiency: `2 + floor((level - 1) / 4)`
 *
 * XP is also exposed relative to the current level (`xpLvl` earned past the
 * level threshold, out of `xpLvlMax`) so ratio displays can track per-level
 * progress — `xpProgress` equals `xpLvl / xpLvlMax`.
 *
 * @param {Agent} agent - `agent.hp === null` means "at full health"
 * @param {InventoryItem[]} [inventory] - Used to resolve `bonus,*` tags on bound items
 * @param {TagRegistry} [registry] - Tag registry; required for class-based HP
 *   bonuses (the class name is a registry-bounded display value — without a
 *   registry, `class:<name>` tags resolve no value and the bonus is 0)
 * @returns {{ xp: number, level: number, xpProgress: number, xpLvl: number, xpLvlMax: number, proficiency: number, ac: number, hp: number, hpMax: number }}
 */
export function computeDynamicAttributes(agent, inventory = [], registry = undefined) {
  const attrs = getEffectiveAttributes(agent.attributes ?? [], agent.activities ?? [], inventory);
  const xp    = agent.xp ?? 0;

  const dex = getAbility(attrs, 'dex');
  const con = getAbility(attrs, 'con');

  // Level derived from XP: levelFromXp = 0.5*(1+sqrt(1+xp/125)), floored, min 1
  const levelFromXp = 0.5 * (1 + Math.sqrt(1 + xp / 125));
  const level       = Math.max(1, Math.floor(levelFromXp));

  // XP progress toward next level (0–1)
  const xpThisLevel = xpForLevel(level);
  const xpNextLevel = xpForLevel(level + 1);
  const xpLvl       = xp - xpThisLevel;
  const xpLvlMax    = xpNextLevel - xpThisLevel;
  const xpProgress  = xpLvlMax > 0 ? Math.min(1, xpLvl / xpLvlMax) : 1;

  // Proficiency bonus: 2 at level 1, +1 every 4 levels
  const proficiency = 2 + Math.floor((level - 1) / 4);

  // AC = 10 + DEX modifier
  const ac = 10 + Math.floor((dex - 10) / 2);

  // HP max: base 10 + (5 + classBonus) per level + CON modifier per level
  const cls = getCategoryValue(attrs, 'class', registry);
  const classBonus =
    cls === 'sorcerer' || cls === 'wizard'                  ? -1 :
    cls === 'fighter'  || cls === 'paladin' || cls === 'ranger' ?  1 :
    cls === 'barbarian'                                     ?  2 : 0;

  const conMod    = Math.floor((con - 10) / 2);
  const hpMax     = Math.max(1, 10 + (5 + classBonus + conMod) * level);
  const hp        = agent.hp !== null && agent.hp !== undefined ? agent.hp : hpMax;

  return { xp, level, xpProgress, xpLvl, xpLvlMax, proficiency, ac, hp, hpMax };
}
