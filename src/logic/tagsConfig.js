// Tag system runtime configuration (public/config/tags.yml): the `locked`
// switch governing creation-time tag entry. Locked mode validates every new
// entity's tags against the live tag registry and blocks creation on
// unregistered tags; unlocked mode registers them instead (see
// state/reducer.js create actions and docs/gotchas.md → Locked Tags).

/**
 * Shipped defaults for `public/config/tags.yml`. Unlocked by default: new
 * entities may introduce tags, which register on creation.
 *
 * @type {{ locked: boolean }}
 */
export const DEFAULT_TAGS_CONFIG = Object.freeze({ locked: false });

/**
 * Config-editor schema for `public/config/tags.yml` (see logic/configEditor.js
 * for the descriptor grammar).
 */
export const TAGS_SCHEMA = {
  kind: 'map',
  closed: true,
  keys: {
    locked: { kind: 'scalar', value: 'boolean', label: 'LOCKED' },
  },
};

/**
 * Guards a raw tags-config document into the full shape. `locked` is `true`
 * only for an explicit boolean `true` (the switch defaults off, the inverse
 * of the rollback config's default-on idiom). Lenient — never throws.
 *
 * @param {object} doc - Raw document from `yaml.load` (may be `null`/partial)
 * @returns {typeof DEFAULT_TAGS_CONFIG} A fully-populated tags config
 */
export function normalizeTagsConfig(doc) {
  const source = doc && typeof doc === 'object' ? doc : {};
  return { locked: source.locked === true };
}
