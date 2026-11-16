import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt();
const listOpen = /^(?:<ul>|<ol(?: start="(\d{1,9})")?>)/;
const listTag = /^<\/?(?:ul|ol|li)>|^<ol start="\d{1,9}">/;
const codeBlock = /^<pre><code(?: class="language-([\w+.-]{1,40})")?>([^<]*)<\/code><\/pre>/;
const lineBreak = /^<br\s*\/?>/i;
const listTokens = new Set(['bullet_list_open','bullet_list_close','ordered_list_open','ordered_list_close','list_item_open','list_item_close','paragraph_open','paragraph_close','inline','fence','code_block']);

function entity(character) {
  return `&#${character.charCodeAt(0)};`;
}

function encodeCode(token) {
  const language = token.info.trim();
  if (language && !/^[\w+.-]{1,40}$/.test(language)) return null;
  const attribute = language ? ` class="language-${language}"` : '';
  // Protect source scanners as well as the table parser. Code examples can
  // contain Markdown links, images, comments, backticks, and pipes.
  const content = token.content.replace(/\n$/, '').replace(/[\n&<>|\\\x60[\]*_~$%]|=(?==)|(?<==)=/g, entity);
  return `<pre><code${attribute}>${content}</code></pre>`;
}

function pipeEscape(text, escaped) {
  return text.replace(/\|/g, (pipe, offset) => escaped(text, offset) ? pipe : '\\|');
}

function encodeList(tokens, escaped) {
  let result = '';
  for (const token of tokens) {
    if (!listTokens.has(token.type)) return null;
    if (token.type === 'inline') result += pipeEscape(token.content, escaped).replace(/\n/g, '<br>');
    else if (token.type === 'paragraph_open' && !result.endsWith('<li>')) result += '<br><br>';
    else if (token.type === 'fence' || token.type === 'code_block') {
      const code = encodeCode(token);
      if (code === null) return null;
      result += code;
    } else if (['ul','ol','li'].includes(token.tag)) {
      const start = token.type === 'ordered_list_open' && token.attrGet('start');
      result += token.nesting < 0 ? `</${token.tag}>` : start ? `<ol start="${start}">` : `<${token.tag}>`;
    }
  }
  return result;
}

export function encodeTableCell(text, escaped, structured = false) {
  const lines = text.split('\n');
  const parts = [];
  let line = 0;
  if (structured) {
    const tokens = markdown.parse(text, {});
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (token.level !== 0 || !token.map) continue;
      let block;
      if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
        const end = tokens.findIndex((entry, position) => position > index && entry.level === 0 && entry.type === token.type.replace('_open','_close'));
        if (end > index) block = encodeList(tokens.slice(index, end + 1), escaped);
      } else if (token.type === 'fence') block = encodeCode(token);
      if (block == null) continue;
      parts.push(...lines.slice(line, token.map[0]).map(value => pipeEscape(value, escaped)), block);
      line = token.map[1];
    }
  }
  return parts.concat(lines.slice(line).map(value => pipeEscape(value, escaped))).join('<br>');
}

function decodeCode(content) {
  return content.replace(/&(?:#(\d{1,3})|(amp|lt|gt|quot));/g, (_, code, name) =>
    code ? String.fromCharCode(Number(code)) : ({amp:'&',lt:'<',gt:'>',quot:'"'})[name]);
}

function markdownCode(match, indent = '') {
  const content = decodeCode(match[2]);
  const fence = '`'.repeat(Math.max(3, ...(content.match(/`+/g) || []).map(run => run.length + 1)));
  return [fence + (match[1] || ''), ...content.split('\n'), fence].map(line => indent + line).join('\n');
}

// Skip escaped markup and code spans when reading the literal leaf Markdown.
const inlinePart = /^(?:\\.|(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)|<br\s*\/?>|[^\\`<]+|[\s\S])/i;

function decodeList(source, indent = '', depth = 0) {
  const open = listOpen.exec(source);
  if (!open || depth >= 24) return null;
  const ordered = open[0].startsWith('<ol');
  const close = ordered ? '</ol>' : '</ul>';
  let count = Number(open[1] || 1), cursor = open[0].length;
  const lines = [];
  while (source.startsWith('<li>', cursor)) {
    const marker = ordered ? `${count++}. ` : '- ';
    const continuation = indent + ' '.repeat(marker.length);
    cursor += 4;
    let text = '', nested = false;
    while (cursor < source.length && !source.startsWith('</li>', cursor)) {
      const rest = source.slice(cursor);
      const part = decodeList(rest, continuation, depth + 1);
      const code = part ? null : codeBlock.exec(rest);
      if (part || code) {
        if (!nested) lines.push(indent + marker + text);
        else if (text) lines.push(continuation + text);
        text = '';
        nested = true;
        if (part && /^<ol start="(?!1")/.test(rest)) lines.push('');
        lines.push(part ? part.text : markdownCode(code, continuation));
        cursor += part ? part.length : code[0].length;
        continue;
      }
      if (listTag.test(rest)) return null;
      const value = inlinePart.exec(rest)?.[0];
      if (!value) break;
      text += lineBreak.test(value) ? '\n' + continuation : value;
      cursor += value.length;
    }
    if (!source.startsWith('</li>', cursor)) return null;
    if (!nested) lines.push(indent + marker + text);
    else if (text) lines.push(continuation + text);
    cursor += 5;
  }
  if (!lines.length || !source.startsWith(close, cursor)) return null;
  return {text:lines.join('\n'), length:cursor + close.length};
}

export function decodeTableCell(source) {
  let text = '', structured = false, afterBlock = false;
  for (let cursor = 0; cursor < source.length;) {
    const rest = source.slice(cursor);
    const list = decodeList(rest);
    const code = list ? null : codeBlock.exec(rest);
    if (list || code) {
      if (text && !text.endsWith('\n')) text += '\n';
      text += list ? list.text : markdownCode(code);
      cursor += list ? list.length : code[0].length;
      structured = afterBlock = true;
    } else {
      const value = inlinePart.exec(rest)[0];
      if (afterBlock && !lineBreak.test(value)) text += '\n';
      afterBlock = false;
      text += lineBreak.test(value) ? '\n' : value;
      cursor += value.length;
    }
  }
  return {text, structured};
}

export function installTableContent(renderer) {
  renderer.inline.ruler.before('html_inline', 'loop_table_structure', (state, silent) => {
    if (state.src[state.pos] !== '<') return false;
    const rest = state.src.slice(state.pos, state.posMax);
    const code = codeBlock.exec(rest);
    const tag = code || listTag.exec(rest);
    if (!tag) return false;
    if (!silent) {
      const token = state.push('loop_table_structure', '', 0);
      token.content = tag[0];
      if (code) token.meta = { code: decodeCode(code[2]), language: code[1] };
    }
    state.pos += tag[0].length;
    return true;
  });
  const escape = renderer.utils.escapeHtml;
  renderer.renderer.rules.loop_table_structure = (tokens, index) => escape(tokens[index].content);
  renderer.renderer.rules.loop_table_list = (tokens, index) => tokens[index].content;
  renderer.renderer.rules.loop_table_code = (tokens, index, _options, env) => {
    const { code, language } = tokens[index].meta;
    const highlight = !env.spanStorage && language && renderer.options.highlight?.(code, language);
    const className = language ? ` class="language-${language}"` : '';
    return `<pre${env.spanStorage?'':' class="kn-table-code"'}><code${className}>${highlight || escape(code)}</code></pre>`;
  };
  renderer.core.ruler.after('inline', 'loop_table_structure', state => {
    let cell = false;
    for (const token of state.tokens) {
      if (token.type === 'td_open' || token.type === 'th_open') cell = true;
      if (token.type === 'td_close' || token.type === 'th_close') cell = false;
      if (!cell || token.type !== 'inline') continue;
      const stack = [];
      const matches = [];
      for (const child of token.children || []) {
        if (child.type !== 'loop_table_structure') continue;
        if (child.meta) { child.type = 'loop_table_code'; continue; }
        const name = child.content.replace(/^<\/?(\w+)[^>]*>$/, '$1');
        if (child.content.startsWith('</')) {
          if (stack.at(-1)?.name !== name) { stack.length = matches.length = 0; continue; }
          matches.push(stack.pop().child, child);
          if (!stack.length) {
            matches.forEach(item => { item.type = 'loop_table_list'; });
            matches.length = 0;
          }
        } else {
          const parent = stack.at(-1)?.name;
          const valid = name === 'li' ? parent === 'ul' || parent === 'ol' : !parent || parent === 'li';
          if (!valid) { stack.length = matches.length = 0; continue; }
          stack.push({name, child});
        }
      }
    }
  });
}
