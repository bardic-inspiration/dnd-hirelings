import { parseTag } from './tags.js';

// Returns the numeric value of an ability tag (e.g. 'ability:str=14' → 14).
function getAbility(attributes, name) {
  for (const t of attributes) {
    const p = parseTag(t);
    if (p.segments[0] === 'ability' && p.segments[1]?.toLowerCase() === name.toLowerCase()) {
      return parseFloat(p.value) || 10;
    }
  }
  return 10; // default ability score
}

// Returns the sub-segment value of a single-child tag (e.g. 'class:fighter' → 'fighter').
function getTagSub(attributes, seg0) {
  for (const t of attributes) {
    const p = parseTag(t);
    if (p.segments[0] === seg0 && p.segments[1]) return p.segments[1].toLowerCase();
  }
  return null;
}

// Computes the XP threshold needed to reach the given level.
function xpForLevel(lvl) {
  // Invert: level_xp = 0.5*(1+sqrt(1+xp/125)) → xp = 125*((2*lvl-1)^2-1)
  return 125 * ((2 * lvl - 1) ** 2 - 1);
}

// Pure computation of all dynamic attributes from an agent object.
// agent.attributes  — tag strings (ability:str=14, class:fighter, …)
// agent.xp          — total accumulated XP (number, default 0)
// agent.hp          — current HP override (number | null; null = full)
export function computeDynamicAttributes(agent) {
  const attrs = agent.attributes ?? [];
  const xp    = agent.xp ?? 0;

  const dex = getAbility(attrs, 'dex');
  const con = getAbility(attrs, 'con');

  // Level derived from XP: level_xp = 0.5*(1+sqrt(1+xp/125)), floored, min 1
  const level_xp  = 0.5 * (1 + Math.sqrt(1 + xp / 125));
  const level     = Math.max(1, Math.floor(level_xp));

  // XP progress toward next level (0–1)
  const xpThisLevel = xpForLevel(level);
  const xpNextLevel = xpForLevel(level + 1);
  const xpProgress  = xpNextLevel > xpThisLevel
    ? Math.min(1, (xp - xpThisLevel) / (xpNextLevel - xpThisLevel))
    : 1;

  // Proficiency bonus: 2 at level 1, +1 every 4 levels
  const proficiency = 2 + Math.floor((level - 1) / 4);

  // AC = 10 + DEX modifier
  const ac = 10 + Math.floor((dex - 10) / 2);

  // HP max: base 10 + (5 + classBonus) per level + CON modifier per level
  const cls = getTagSub(attrs, 'class');
  const classBonus =
    cls === 'sorcerer' || cls === 'wizard'                  ? -1 :
    cls === 'fighter'  || cls === 'paladin' || cls === 'ranger' ?  1 :
    cls === 'barbarian'                                     ?  2 : 0;

  const conMod    = Math.floor((con - 10) / 2);
  const hp_max    = Math.max(1, 10 + (5 + classBonus + conMod) * level);
  const hp        = agent.hp !== null && agent.hp !== undefined ? agent.hp : hp_max;

  return { xp, level, xpProgress, proficiency, ac, hp, hp_max };
}
