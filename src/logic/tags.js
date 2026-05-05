export const TAG_SCHEMA = {
  skill:            { label: 'Skill',      context: 'attribute',   type: 'skill',      isReq: false, hasName: true,  hasValue: true,  nameLabel: 'Name', valueLabel: 'Level'      },
  tool:             { label: 'Tool',       context: 'attribute',   type: 'tool',       isReq: false, hasName: true,  hasValue: false, nameLabel: 'Name'                            },
  trait:            { label: 'Trait',      context: 'attribute',   type: 'trait',      isReq: false, hasName: true,  hasValue: false, nameLabel: 'Name'                            },
  class:            { label: 'Class',      context: 'attribute',   type: 'class',      isReq: false, hasName: true,  hasValue: false, nameLabel: 'Name'                            },
  race:             { label: 'Race',       context: 'attribute',   type: 'race',       isReq: false, hasName: true,  hasValue: false, nameLabel: 'Name'                            },
  level:            { label: 'Level',      context: 'attribute',   type: 'level',      isReq: false, hasName: true,  hasValue: true,  nameLabel: 'Name', valueLabel: 'Value'      },
  'req:skill':      { label: 'Skill',      context: 'requirement', type: 'skill',      isReq: true,  hasName: true,  hasValue: true,  nameLabel: 'Name', valueLabel: 'Min Level', fn: 'require'     },
  'req:tool':       { label: 'Tool',       context: 'requirement', type: 'tool',       isReq: true,  hasName: true,  hasValue: false, nameLabel: 'Name',                           fn: 'require'     },
  'req:trait':      { label: 'Trait',      context: 'requirement', type: 'trait',      isReq: true,  hasName: true,  hasValue: false, nameLabel: 'Name',                           fn: 'require'     },
  'req:class':      { label: 'Class',      context: 'requirement', type: 'class',      isReq: true,  hasName: true,  hasValue: false, nameLabel: 'Name',                           fn: 'require'     },
  'req:race':       { label: 'Race',       context: 'requirement', type: 'race',       isReq: true,  hasName: true,  hasValue: false, nameLabel: 'Name',                           fn: 'require'     },
  'req:item':       { label: 'Item',       context: 'requirement', type: 'item',       isReq: true,  hasName: true,  hasValue: true,  nameLabel: 'Name', valueLabel: 'Qty',        fn: 'block'       },
  'req:consumable': { label: 'Consumable', context: 'requirement', type: 'consumable', isReq: true,  hasName: true,  hasValue: true,  nameLabel: 'Name', valueLabel: 'Qty',        fn: 'consume'     },
  work:             { label: 'General',    context: 'work',        type: 'work',       isReq: false, hasName: false, hasValue: true,  valueLabel: 'Target',                        fn: 'work'        },
  'work:skill':     { label: 'Skill',      context: 'work',        type: 'work',       isReq: false, hasName: true,  hasValue: true,  nameLabel: 'Skill', valueLabel: 'Target',    fn: 'work-skill'  },
  'reward:gold':    { label: 'Gold',       context: 'reward',      type: 'reward',     isReq: false, hasName: false, hasValue: true,  nameFixed: 'gold', valueLabel: 'Amount',     fn: 'reward-gold' },
};

export function parseTag(s) {
  let stripped = s.startsWith('#') ? s.slice(1) : s;
  let isReq = false;
  if (stripped.startsWith('req:')) { isReq = true; stripped = stripped.slice(4); }
  const colonIdx = stripped.indexOf(':');
  const eqIdx    = stripped.indexOf('=');
  if (eqIdx >= 0 && (colonIdx < 0 || eqIdx < colonIdx)) {
    const type = stripped.slice(0, eqIdx);
    const v = parseFloat(stripped.slice(eqIdx + 1));
    return { type, name: null, value: isNaN(v) ? null : v, isReq };
  }
  if (colonIdx < 0) return { type: 'tag', name: stripped, value: null, isReq };
  const type = stripped.slice(0, colonIdx);
  const rest = stripped.slice(colonIdx + 1);
  const restEq = rest.indexOf('=');
  if (restEq < 0) return { type, name: rest, value: null, isReq };
  const v = parseFloat(rest.slice(restEq + 1));
  return { type, name: rest.slice(0, restEq), value: isNaN(v) ? null : v, isReq };
}

export function buildTag(type, name, value, isReq = false) {
  const t = (type || 'tag').trim().toLowerCase();
  const n = (name || '').trim().toLowerCase();
  const hasVal = value !== null && value !== undefined && String(value).trim() !== '';
  const head = isReq ? '#req:' : '#';
  if (!n && hasVal) return `${head}${t}=${Number(value)}`;
  if (!n) return null;
  const v = hasVal ? `=${Number(value)}` : '';
  return `${head}${t}:${n}${v}`;
}

export function getSchemaEntry(parsed) {
  if (!parsed.isReq && parsed.name) {
    const fixed = Object.values(TAG_SCHEMA).find(e => e.type === parsed.type && e.nameFixed === parsed.name);
    if (fixed) return fixed;
  }
  if (!parsed.isReq && parsed.type === 'work' && parsed.name) return TAG_SCHEMA['work:skill'];
  return TAG_SCHEMA[(parsed.isReq ? 'req:' : '') + parsed.type] ?? null;
}

export function tagFn(parsed) {
  return getSchemaEntry(parsed)?.fn ?? null;
}

export function getSchemaByContext(...contexts) {
  return Object.entries(TAG_SCHEMA).filter(([, e]) => contexts.includes(e.context));
}
