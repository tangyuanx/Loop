import { ensureSyntaxTree } from '@codemirror/language';

const headingType = /^(ATX|Setext)Heading([1-6])$/;
const proseType = /^(Paragraph|TableCell|ATXHeading[1-6]|SetextHeading[12])$/;
const opaqueType = /^(Frontmatter|FencedCode|CodeBlock|InlineCode|HTMLBlock|HTMLTag|Comment|ObsidianComment(?:Block)?|Link|LinkReference|Autolink|Image|Escape|Entity)$/;
const scriptBoundary = /(?<=\p{Script=Han})(?=\p{Script=Latin})|(?<=\p{Script=Latin})(?=\p{Script=Han})/gu;
const mixedScripts = /\p{Script=Han}\p{Script=Latin}|\p{Script=Latin}\p{Script=Han}/u;
// The Markdown parser protects standard syntax. These constructs also have
// meaning in Loop or in plain text, even where the parser has no node for them.
const syntaxTokens = /!?\[\[[^\n]*?(?:\]\]|$)|(?<!\\)\$\$[^\n]*?\$\$|(?<!\\)\$[^\n$]+\$|\[\^[^\]\n]+\]|\[![\w-]+\]|\^[\w-]+(?=[ \t]*(?:\n|$))/gu;
const words = /[^\s<>"`|()[\]，。；、！？：]+/gu;
const addressOrPath = /^(?:mailto:|www\.)|[\\/][^\\/]|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\.[A-Za-z][\w-]{0,8}(?![\w.-])/i;
const core = globalThis.LoopKnowledgeCore;

function textEdits(text, from, rules, touches = () => true) {
  const changes = [];
  for (const match of text.matchAll(scriptBoundary)) {
    const pos = from + match.index;
    if (rules.spacing && touches(pos)) changes.push({ from: pos, insert: ' ' });
  }
  if (rules.spaces) {
    for (const match of text.matchAll(/(?<=\S) {2,}(?=\S)/g)) {
      changes.push({ from: from + match.index, to: from + match.index + match[0].length, insert: ' ' });
    }
  }
  return changes;
}

function blockEdits(node, doc, rules, touches, number, bounds, math) {
  const heading = headingType.exec(node.name);
  let from = node.from;
  let to = node.to;
  if (heading?.[1] === 'ATX') {
    const opening = node.firstChild;
    if (opening?.name !== 'HeaderMark') return [];
    const line = doc.lineAt(opening.to);
    from = opening.to + /^[ \t]*/.exec(doc.sliceString(opening.to, line.to))[0].length;
    if (node.lastChild?.name === 'HeaderMark' && node.lastChild.from !== opening.from) to = node.lastChild.from;
  } else if (heading?.[1] === 'Setext') {
    to = doc.lineAt(node.lastChild.from).from - 1;
  }
  if (from >= to || to <= bounds.from || from >= bounds.to) return [];
  const firstLine = heading && number ? doc.sliceString(from, Math.min(to, doc.lineAt(from).to)) : '';
  const headingPrefix = firstLine.slice(0, firstLine.length - core.unnumberedHeading(firstLine).length);
  const edits = [];
  if (heading && number && headingPrefix !== number + ' ') edits.push({ from, to: from + headingPrefix.length, insert: number + ' ' });
  from += headingPrefix.length;
  if (!rules.spacing && !rules.spaces) return edits;

  // Collect ranges before editing plain text so a literal with Markdown-like
  // characters inside it is protected as a whole (for example, a wiki link).
  const protectedRanges = [];
  const raw = doc.sliceString(from, to);
  const protect = match => protectedRanges.push({ from: from + match.index, to: from + match.index + match[0].length });
  for (const match of raw.matchAll(syntaxTokens)) protect(match);
  for (const match of raw.matchAll(words)) if (addressOrPath.test(match[0])) protect(match);
  for (const range of math) protectedRanges.push({ from: Math.max(from, range.from), to: Math.min(to, range.to) });
  let start = from;
  node.cursor().iterate(child => {
    if (child.from === node.from && child.to === node.to && child.name === node.name) return;
    if (child.to <= from || child.from >= to) return false;
    if (!opaqueType.test(child.name) && !/(?:Mark|Delimiter)$/.test(child.name)) return;
    const mark = /^(?:Emphasis|Strikethrough)Mark$/.test(child.name);
    const opening = mark && child.from === child.node.parent?.from;
    const closing = mark && child.to === child.node.parent?.to;
    protectedRanges.push({ from: child.from, to: child.to, mark, opening, closing });
    return false;
  });
  const sorted = protectedRanges.sort((a, b) => a.from - b.from || b.to - a.to);
  for (const [index, range] of sorted.entries()) {
    const previous=sorted[index-1], next=sorted[index+1];
    if (rules.spacing && range.mark && (range.opening || range.closing) && range.from>from && range.to<to &&
        (!previous || previous.to<range.from) && (!next || next.from>range.to)) {
      const before=doc.sliceString(Math.max(from,range.from-2),range.from);
      const after=doc.sliceString(range.to,Math.min(to,range.to+2));
      const boundary=range.opening?range.from:range.to;
      const pair=[...before].at(-1)+[...after][0];
      if (mixedScripts.test(pair) && (!touches || touches(range.from) || touches(range.to))) {
        edits.push({from:boundary,insert:' '});
      }
    }
    if (range.from > start) edits.push(...textEdits(doc.sliceString(start, range.from), start, rules, touches));
    start = Math.max(start, range.to);
  }
  if (to > start) edits.push(...textEdits(doc.sliceString(start, to), start, rules, touches));
  return edits;
}

export function documentFormat(state, rules, bounds = { from: 0, to: state.doc.length }, touches) {
  const tree = ensureSyntaxTree(state, bounds.to, touches ? 12 : 250);
  if (!tree) return null;
  const doc = state.doc;
  const changes = [];
  const counters = [];
  let skippedHeadings = 0;
  const headingCounts = new Map();
  const math = [];
  let mathIndex = 0;
  let opener = null;
  for (const match of doc.sliceString(0, bounds.to).matchAll(/^ {0,3}\$\$[ \t]*$/gm)) {
    let literal = false;
    for (let node = tree.resolveInner(match.index + match[0].indexOf('$'), 1); node; node = node.parent) {
      if (!opaqueType.test(node.name)) continue;
      literal = true;
      break;
    }
    if (literal) continue;
    if (opener === null) opener = match.index;
    else { math.push({ from: opener, to: match.index + match[0].length }); opener = null; }
  }
  if (touches && opener !== null) math.push({ from: opener, to: bounds.to });
  // Preserve older links where removing an old number would otherwise make
  // two headings with the same title indistinguishable.
  if (!touches && (rules.headings || rules.spacing || rules.spaces)) {
    tree.iterate({ enter(node) {
      if (!headingType.test(node.name)) return;
      const key = headingKey(doc, node.node);
      headingCounts.set(key, (headingCounts.get(key) || 0) + 1);
    } });
  }
  tree.iterate({ from: bounds.from, to: bounds.to, enter(node) {
    if (opaqueType.test(node.name)) return false;
    if (!proseType.test(node.name)) return;
    while (math[mathIndex]?.to <= node.from) mathIndex++;
    const mathRanges = [];
    for (let i = mathIndex; math[i]?.from < node.to; i++) mathRanges.push(math[i]);
    if (mathRanges.some(range => range.from <= node.from && range.to >= node.to)) return false;
    const match = headingType.exec(node.name);
    if (match && headingCounts.get(headingKey(doc, node.node)) > 1) {
      skippedHeadings++;
      return false;
    }
    let number = '';
    if (rules.headings && match) {
      const level = Number(match[2]);
      let rootCount = 0;
      while (counters.length && counters.at(-1).level > level) {
        const previous = counters.pop();
        if (!counters.length) rootCount = previous.count;
      }
      if (counters.at(-1)?.level === level) counters.at(-1).count++;
      else counters.push({ level, count: rootCount + 1 });
      number = counters.map(counter => counter.count).join('.');
    }
    changes.push(...blockEdits(node.node, doc, rules, touches, number, bounds, mathRanges));
    return false;
  } });
  return { changes: changes.sort((a, b) => a.from - b.from), skippedHeadings };
}

function headingKey(doc, node) {
  const first = node.firstChild;
  const last = node.lastChild;
  const from = node.name.startsWith('ATX') ? first.to : node.from;
  const to = last?.name === 'HeaderMark' && last.from !== first.from ? last.from : node.name.startsWith('Setext') ? last.from : node.to;
  return core.headingAnchorKey(doc.sliceString(from, to).replace(/[*`]/g, '').trim());
}

export function typedSpacing(transaction) {
  const ranges = [];
  transaction.changes.iterChangedRanges((_from, _to, from, to) => {
    if (to > from) ranges.push({ from, to });
  });
  return spacingAt(transaction.state, ranges);
}

export function spacingAt(state, ranges) {
  if (!ranges.length) return [];
  const from = state.doc.lineAt(ranges[0].from).from;
  const to = state.doc.lineAt(Math.max(...ranges.map(range => range.to))).to;
  return documentFormat(state, { spacing: true }, { from, to },
    pos => ranges.some(range => range.from <= pos && pos <= range.to))?.changes || [];
}
