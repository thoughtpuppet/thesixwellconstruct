// The same projection is used by Studio selections, public markers and API validation.
export function commentText(value, markdown = false) {
  let result = String(value ?? '').replace(/\r\n?/g, '\n');
  if (markdown) result = result
    .replace(/^\s*\{\{asset:[a-z0-9-]+\}\}\s*$/gmi, '')
    .replace(/^\s*(?:#{1,4}\s+|>\s?|[-*+]\s+)/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1').replace(/(^|\s)\*([^*]+)\*(?=\s|$)/g, '$1$2');
  return result.replace(/\s+/g, ' ').trim();
}

export async function commentFingerprint(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function textAnchor(source, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > source.length)
    throw new Error('Select a non-empty passage inside one source field.');
  return {start, end, quote:source.slice(start,end), prefix:source.slice(Math.max(0,start-48),start), suffix:source.slice(end,end+48)};
}

export function anchorMatches(source, anchor) {
  try { return JSON.stringify(textAnchor(source,anchor.start,anchor.end)) === JSON.stringify({start:anchor.start,end:anchor.end,quote:anchor.quote,prefix:anchor.prefix,suffix:anchor.suffix}); }
  catch { return false; }
}

export function commentTargetKey(target) {
  return [target.target_kind,target.target_id,target.field_key || ''].join(':');
}

export function commentGroupKey(comment) {
  const a = comment.anchor || {};
  return `${commentTargetKey(comment)}:${a.start ?? ''}:${a.end ?? ''}:${a.start_seconds ?? ''}:${a.end_seconds ?? ''}`;
}
