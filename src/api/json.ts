/** Loosely-typed JSON accessors mirroring the Kotlin parser's extensions. */

export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

export const isObject = (v: JsonValue | undefined): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export const isArray = (v: JsonValue | undefined): v is JsonValue[] =>
  Array.isArray(v);
export const isString = (v: JsonValue | undefined): v is string => typeof v === 'string';

/** `json.o("key")` — the object under key, or null. */
export function o(obj: JsonObject | undefined, key: string): JsonObject | undefined {
  const v = obj?.[key];
  return isObject(v) ? v : undefined;
}

/** `json.a("key")` — the array under key, or null. */
export function a(obj: JsonObject | undefined, key: string): JsonValue[] | undefined {
  const v = obj?.[key];
  return isArray(v) ? v : undefined;
}

/** `json.s("key")` — the string under key, or null. */
export function s(obj: JsonObject | undefined, key: string): string | null {
  const v = obj?.[key];
  return isString(v) ? v : null;
}

/** Concatenated `text.runs[].text`, the way every renderer spells a label. */
export function runs(node: JsonObject | undefined): string {
  const arr = a(o(node, 'text'), 'runs');
  if (!arr) return s(node, 'simpleText') ?? '';
  return arr
    .map((run) => (isObject(run) ? (s(run, 'text') ?? '') : ''))
    .join('');
}

/** First string value under key anywhere in the tree, depth-first. */
export function findString(node: JsonValue, key: string): string | null {
  if (isObject(node)) {
    const direct = s(node, key);
    if (direct !== null) return direct;
    for (const child of Object.values(node)) {
      const found = findString(child, key);
      if (found !== null) return found;
    }
  } else if (isArray(node)) {
    for (const child of node) {
      const found = findString(child, key);
      if (found !== null) return found;
    }
  }
  return null;
}

/** Depth-first collection of a named renderer, preserving document order. */
export function collectRenderers(root: JsonValue, name: string): JsonObject[] {
  const out: JsonObject[] = [];
  const walk = (node: JsonValue): void => {
    if (isObject(node)) {
      const direct = node[name];
      if (isObject(direct)) out.push(direct);
      Object.values(node).forEach(walk);
    } else if (isArray(node)) {
      node.forEach(walk);
    }
  };
  walk(root);
  return out;
}

/**
 * The page-2 token wherever the response left one. Continuations arrive as
 * `nextContinuationData` / `continuationItemRenderer` objects carrying a
 * `continuation` string; the key they sit under drifts, so both names are
 * walked for.
 */
const CONTINUATION_KEYS = ['nextContinuationData', 'continuationItemRenderer', 'musicNextContinuationData'];

export function continuationToken(root: JsonValue): string | null {
  const walk = (node: JsonValue): string | null => {
    if (isArray(node)) {
      for (const child of node) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    }
    if (isObject(node)) {
      for (const [key, value] of Object.entries(node)) {
        if (CONTINUATION_KEYS.includes(key) && isObject(value)) {
          const token = s(value, 'continuation');
          if (token) return token;
        }
        const found = walk(value);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(root);
}

/** Best thumbnail on a renderer's `thumbnail.thumbnails` ladder. */
export function bestThumbnail(node: JsonObject | undefined): string | null {
  const thumbs = a(o(o(node, 'thumbnail'), 'musicThumbnailRenderer'), 'thumbnails') ??
    a(o(node, 'thumbnail'), 'thumbnails');
  if (!thumbs || thumbs.length === 0) return null;
  let best: string | null = null;
  let bestArea = -1;
  for (const t of thumbs) {
    if (!isObject(t)) continue;
    const width = typeof t.width === 'number' ? t.width : 0;
    const height = typeof t.height === 'number' ? t.height : 0;
    const area = width * height;
    const url = s(t, 'url');
    if (url && area >= bestArea) {
      bestArea = area;
      best = url;
    }
  }
  return best;
}
