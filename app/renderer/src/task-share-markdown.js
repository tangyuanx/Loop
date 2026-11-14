(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./knowledge-core.js'));
  else root.LoopShareMarkdown = factory(root.LoopKnowledgeCore);
})(globalThis, ({ excludedRanges, escaped, parseTarget }) => {

const ESCAPABLE = /[!"#$%&'()*+,./:;<=>?@[\]\\^_`{|}~-]/;
const LINE_BREAK = /\r\n|\r|\n/;
const DEFINITION_PREFIX = /^(?: {0,3}>[ \t]?)* {0,3}(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)?(?=\[)/;
const NAMED_ENTITIES = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: '\u00a0', quot: '"' };

function unescapeMarkdown(value) {
  return value.replace(/\\([!"#$%&'()*+,./:;<=>?@[\]\\^_`{|}~-])|&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi,
    (source, literal, entity) => {
      if (literal) return literal;
      if (entity[0] !== '#') return Object.hasOwn(NAMED_ENTITIES, entity) ? NAMED_ENTITIES[entity] : source;
      const code = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : '\ufffd';
    });
}

function normalizeReference(value) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase();
}

function exclusionIndex(content) {
  const removed = [];
  const normalized = content.replace(/\r\n?/g, (lineEnding, offset) => {
    if (lineEnding === '\r\n') removed.push(offset - removed.length);
    return '\n';
  });
  function sourceOffset(offset) {
    let left = 0;
    let right = removed.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (removed[middle] < offset) left = middle + 1;
      else right = middle;
    }
    return offset + left;
  }
  const ranges = [];
  for (const [start, end] of excludedRanges(normalized)) {
    const from = sourceOffset(start);
    const to = sourceOffset(end);
    if (to <= from) continue;
    const previous = ranges.at(-1);
    if (previous && from <= previous[1]) previous[1] = Math.max(previous[1], to);
    else ranges.push([from, to]);
  }
  return (position) => {
    let left = 0;
    let right = ranges.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (ranges[middle][1] <= position) left = middle + 1;
      else right = middle;
    }
    return ranges[left]?.[0] <= position ? ranges[left][1] : position;
  };
}

function bracketEnds(content, excludedUntil) {
  const stack = [];
  const ends = new Map();
  const markers = /[\[\]]|(?:\r\n|\r(?!\n)|\n)[ \t]*(?=[\r\n])/g;
  for (const match of content.matchAll(markers)) {
    const position = match.index;
    if (excludedUntil(position) > position) continue;
    const token = match[0];
    if (token !== '[' && token !== ']') {
      stack.length = 0;
      continue;
    }
    if (escaped(content, position)) continue;
    if (token === '[') stack.push(position);
    else if (stack.length) ends.set(stack.pop(), position);
  }
  return ends;
}

function skipWhitespace(content, at) {
  let lineBreaks = 0;
  while (at < content.length && /[ \t\r\n]/.test(content[at])) {
    if (content[at] === '\r' || content[at] === '\n') {
      if (++lineBreaks > 1) return -1;
      if (content[at] === '\r' && content[at + 1] === '\n') at++;
    }
    at++;
  }
  return at;
}

function destinationAt(content, at, allowEmpty) {
  const angle = content[at] === '<';
  const from = at + Number(angle);
  let cursor = from;
  let depth = 0;
  for (; cursor < content.length; cursor++) {
    const character = content[cursor];
    if (character === '\\' && ESCAPABLE.test(content[cursor + 1] || '')) {
      cursor++;
      continue;
    }
    if (character === '\r' || character === '\n') break;
    if (angle) {
      if (character === '>') break;
      if (character === '<') return null;
    } else {
      if (/\s|[\u0000-\u001f\u007f]/.test(character)) break;
      if (character === '(') depth++;
      if (character === ')') {
        if (depth === 0) break;
        depth--;
      }
    }
  }
  if (depth || (angle && content[cursor] !== '>') || (!allowEmpty && from === cursor)) return null;
  return { destination: unescapeMarkdown(content.slice(from, cursor)), destinationFrom: from,
    destinationTo: cursor, end: cursor + Number(angle) };
}

function titleAt(content, from, closer = content[from] === '(' ? ')' : content[from]) {
  if (!['"', "'", '('].includes(content[from])) return -1;
  for (let at = from + 1; at < content.length; at++) {
    if (content[at] === '\\' && ESCAPABLE.test(content[at + 1] || '')) {
      at++;
      continue;
    }
    if (content[at] === closer) return at + 1;
    if (closer === ')' && content[at] === '(') return -1;
    if (LINE_BREAK.test(content[at])) {
      const next = at + (content[at] === '\r' && content[at + 1] === '\n' ? 2 : 1);
      let afterIndent = next;
      while (content[afterIndent] === ' ' || content[afterIndent] === '\t') afterIndent++;
      if (LINE_BREAK.test(content[afterIndent] || '')) return -1;
      at = next - 1;
    }
  }
  return -1;
}

function targetAfter(content, at, { inline = false } = {}) {
  const start = skipWhitespace(content, at);
  if (start < 0) return null;
  const target = destinationAt(content, start, inline);
  if (!target) return null;
  const next = skipWhitespace(content, target.end);
  const titleEnd = next > target.end ? titleAt(content, next) : -1;
  if (inline) {
    const close = titleEnd >= 0 ? skipWhitespace(content, titleEnd) : next;
    if (content[close] !== ')') return null;
    return { ...target, to: close + 1 };
  }
  function lineEnd(position) {
    while (content[position] === ' ' || content[position] === '\t') position++;
    return position === content.length || LINE_BREAK.test(content[position]) ? position : -1;
  }
  const titleLineEnd = titleEnd >= 0 ? lineEnd(titleEnd) : -1;
  const to = titleLineEnd >= 0 ? titleLineEnd : lineEnd(target.end);
  return to >= 0 ? { ...target, to } : null;
}

function readDefinitions(content, ends, excludedUntil) {
  const definitions = [];
  const lines = content.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g);
  let coveredTo = 0;
  for (const line of lines) {
    const prefix = line[0].match(DEFINITION_PREFIX);
    if (!prefix) continue;
    const from = line.index + prefix[0].length;
    if (from < coveredTo || excludedUntil(from) > from) continue;
    const close = ends.get(from);
    if (close === undefined || content[close + 1] !== ':') continue;
    const label = content.slice(from + 1, close);
    if (!label.trim() || label.length > 999 || /(?<!\\)[\[\]]/.test(label)) continue;
    const target = targetAfter(content, close + 2);
    if (!target) continue;
    const reference = normalizeReference(label);
    definitions.push({ from, ...target, label, destination: target.destination, image: false,
      kind: 'link', definition: true, reference });
    coveredTo = target.to;
  }
  return definitions;
}

function readWiki(content, from, at, image, excludedUntil) {
  const match = /^\[\[([^\]\r\n]+)\]\]/.exec(content.slice(at, at + 4096));
  if (!match) return null;
  const to = at + match[0].length;
  if (excludedUntil(to - 1) > to - 1) return null;
  const { target, anchor, label } = parseTarget(match[1]);
  return { from, to, label, destination: target, anchor, image, embed: image, kind: 'wiki' };
}

function scan(value) {
  const content = String(value ?? '');
  const excludedUntil = exclusionIndex(content);
  const ends = bracketEnds(content, excludedUntil);
  const definitions = readDefinitions(content, ends, excludedUntil);
  const byReference = new Map();
  for (const definition of definitions) {
    if (!byReference.has(definition.reference)) byReference.set(definition.reference, definition);
  }
  const references = [...definitions];
  let definitionIndex = 0;
  let resumeAt = 0;
  for (const match of content.matchAll(/!?\[|</g)) {
    const image = match[0] === '![' && !escaped(content, match.index);
    const from = match.index + Number(match[0] === '![' && !image);
    if (from < resumeAt || excludedUntil(from) > from || escaped(content, from)) continue;
    while (definitions[definitionIndex]?.to <= from) definitionIndex++;
    if (definitions[definitionIndex]?.from <= from) continue;
    if (match[0] === '<') {
      const url = /^<([a-z][a-z\d+.-]{1,31}:[^\s<>]+)>/i.exec(content.slice(from, from + 4096));
      if (!url) continue;
      const to = from + url[0].length;
      references.push({ from, to, label: url[1], destination: url[1], destinationFrom: from + 1,
        destinationTo: to - 1, kind: 'link', image: false, autolink: true });
      resumeAt = to;
      continue;
    }
    const start = from + Number(image);
    if (content[start + 1] === '[') {
      const wiki = readWiki(content, from, start, image, excludedUntil);
      if (wiki) {
        references.push(wiki);
        resumeAt = wiki.to;
        continue;
      }
    }
    const close = ends.get(start);
    if (close === undefined) continue;
    const target = content[close + 1] === '(' ? targetAfter(content, close + 2, { inline: true }) : null;
    if (target && excludedUntil(target.destinationFrom) <= target.destinationFrom) {
      references.push({ from, to: target.to, label: content.slice(start + 1, close), labelFrom: start + 1,
        labelTo: close, destination: target.destination, destinationFrom: target.destinationFrom,
        destinationTo: target.destinationTo, image, kind: 'link' });
      // Continue scanning the label for a nested image. The last pass removes
      // candidates inside this link's destination and title.
      continue;
    }
    if (!byReference.size || close - start > 1000) continue;
    const explicit = content[close + 1] === '[';
    const refClose = explicit ? ends.get(close + 1) : undefined;
    if (explicit && refClose === undefined) continue;
    const label = content.slice(start + 1, close);
    const ref = explicit ? content.slice(close + 2, refClose) || label : label;
    if (ref.length > 999 || /(?<!\\)[\[\]]/.test(ref)) continue;
    const key = normalizeReference(ref);
    const definition = byReference.get(key);
    if (!definition) continue;
    const to = (refClose ?? close) + 1;
    references.push({ from, to, label, labelFrom: start + 1, labelTo: close, destination: definition.destination,
      image, kind: 'link', reference: key });
  }
  const valid = references.sort((a, b) => a.from - b.from || b.to - a.to);
  // Keep actual image children in a link label, while skipping false tokens
  // found inside its destination or explicit reference ID.
  const outer = [];
  return valid.filter(ref => {
    while (outer.length && outer.at(-1).to <= ref.from) outer.pop();
    const parent = outer.at(-1);
    if (parent && !(ref.image && parent.kind === 'link' && !parent.image && ref.to <= parent.labelTo)) return false;
    outer.push(ref);
    return true;
  });
}

function safeInlineDestination(value, angle) {
  return String(value).replace(angle ? /[\u0000-\u0020<>\\]/g : /[\u0000-\u0020<>()\\]/g, character =>
    '%' + character.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase());
}

/** A transform returns undefined to retain the span, a full replacement string,
 * or {destination} to rewrite only its destination. `source` includes child
 * edits and `reference.label` includes edits inside a nested label. */
function rewrite(value, references, transform) {
  const content = String(value ?? '');
  const roots = [];
  const stack = [];
  for (const reference of [...references].sort((a, b) => a.from - b.from || b.to - a.to)) {
    if (!Number.isInteger(reference.from) || !Number.isInteger(reference.to) || reference.from < 0 ||
        reference.to <= reference.from || reference.to > content.length) throw new RangeError('Invalid Markdown reference range');
    while (stack.length && stack.at(-1).reference.to <= reference.from) stack.pop();
    const entry = { reference, children: [] };
    const parent = stack.at(-1);
    if (parent) {
      if (reference.to > parent.reference.to || reference.from === parent.reference.from) throw new RangeError('Overlapping Markdown reference ranges');
      parent.children.push(entry);
    } else roots.push(entry);
    stack.push(entry);
  }
  function rewriteRange(from, to, entries) {
    const parts = [];
    let cursor = from;
    for (const { reference, children } of entries) {
      parts.push(content.slice(cursor, reference.from));
      let label = reference.label;
      let original = content.slice(reference.from, reference.to);
      if (children.length) {
        label = rewriteRange(reference.labelFrom, reference.labelTo, children);
        original = content.slice(reference.from, reference.labelFrom) + label + content.slice(reference.labelTo, reference.to);
      }
      const updated = transform({ ...reference, label }, original);
      if (typeof updated === 'string') parts.push(updated);
      else if (updated?.destination !== undefined) {
        const destination = safeInlineDestination(updated.destination, content[reference.destinationFrom - 1] === '<');
        if (reference.reference && !reference.definition) {
          parts.push(`${reference.image ? '!' : ''}[${label}](<${destination}>)`);
        } else if (Number.isInteger(reference.destinationFrom)) {
          // The destination follows the label. Account for any nested edits.
          const adjustment = original.length - (reference.to - reference.from);
          parts.push(original.slice(0, reference.destinationFrom - reference.from + adjustment), destination,
            original.slice(reference.destinationTo - reference.from + adjustment));
        } else throw new TypeError('A wiki link needs a complete replacement');
      } else parts.push(original);
      cursor = reference.to;
    }
    parts.push(content.slice(cursor, to));
    return parts.join('');
  }
  return rewriteRange(0, content.length, roots);
}

function updateDestinations(content, destinations) {
  return rewrite(content, scan(content), ref => {
    const destination = destinations.get(ref.destination);
    if (!destination || ref.reference && !ref.definition) return undefined;
    return { destination };
  });
}

return { scan, rewrite, updateDestinations };
});
