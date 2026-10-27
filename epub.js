// EPUB parsing and rendering. All archive data stays in the current browser session.
const MAX_FILE = 100 * 1024 * 1024;
const MAX_EXPANDED = 300 * 1024 * 1024;
const MAX_ENTRY = 50 * 1024 * 1024;
export function unzipBook(buffer, unzipSync) {
  if (buffer.byteLength > MAX_FILE) throw new Error('文件超过 100 MB，请选择较小的 EPUB。');
  let size = 0, count = 0;
  const files = unzipSync(new Uint8Array(buffer), { filter(entry) {
    if (++count > 10000) throw new Error('书籍包含过多文件，最多支持 10000 个。');
    if (entry.originalSize > MAX_ENTRY || (size += entry.originalSize) > MAX_EXPANDED) throw new Error('解压后体积过大，已停止处理。');
    if (/^[/\\]|^[a-z]:|(^|[/\\])\.\.([/\\]|$)/i.test(entry.name)) throw new Error('EPUB 包含无效的文件路径。');
    return !entry.name.endsWith('/');
  }});
  return files;
}
export function resolvePath(base, href) {
  if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(href.trim())) return null;
  let decoded;
  try { decoded = decodeURIComponent(href.split('#')[0].split('?')[0]); } catch { return null; }
  const parts = base.split('/').slice(0, -1);
  for (const part of decoded.split('/')) {
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}
const text = (files, path) => {
  if (!files[path]) throw new Error('EPUB 缺少文件：' + path);
  return new TextDecoder().decode(files[path]).replace(/^\uFEFF/, '');
};
function xml(source, parser) {
  const doc = parser.parseFromString(source, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || doc.getElementsByTagNameNS('*', 'parsererror').length) throw new Error('EPUB 目录或章节 XML 已损坏。');
  return doc;
}
const nodes = (doc, name) => [...doc.getElementsByTagNameNS('*', name)];
export function parseBook(files, parser = new DOMParser()) {
  if (files.mimetype && text(files, 'mimetype').trim() !== 'application/epub+zip') throw new Error('这不是有效的 EPUB 文件。');
  const container = xml(text(files, 'META-INF/container.xml'), parser);
  const root = nodes(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!root || !files[root]) throw new Error('找不到 EPUB 主目录。');
  if (files['META-INF/encryption.xml']) {
    const encryption = xml(text(files, 'META-INF/encryption.xml'), parser);
    if (nodes(encryption, 'EncryptedData').length) throw new Error('此书包含加密资源或混淆字体，暂不支持。请使用无加密的 EPUB。');
  }
  const opf = xml(text(files, root), parser);
  const items = new Map(nodes(opf, 'item').map(item => [item.getAttribute('id'), {
    path: resolvePath(root, item.getAttribute('href')),
    type: item.getAttribute('media-type'), properties: item.getAttribute('properties') || ''
  }]));
  const spine = nodes(opf, 'itemref').filter(ref => ref.getAttribute('linear') !== 'no').map(ref => items.get(ref.getAttribute('idref')));
  if (!spine.length || spine.some(item => !item?.path || !files[item.path])) throw new Error('EPUB 阅读顺序无效或缺少章节。');
  if (spine.some(item => !['application/xhtml+xml', 'text/html'].includes(item.type))) throw new Error('此 EPUB 包含暂不支持的章节格式。');
  const chapters = spine.map((item, index) => {
    const doc = parser.parseFromString(text(files, item.path), 'application/xhtml+xml');
    if (nodes(doc, 'parsererror').length) throw new Error('第 ' + (index + 1) + ' 章格式损坏，无法可靠转换。');
    const body = nodes(doc, 'body')[0];
    if (!body) throw new Error('章节缺少正文。');
    return { path: item.path, html: body.innerHTML, title: body.querySelector('h1,h2,h3')?.textContent?.trim() || nodes(doc, 'title')[0]?.textContent?.trim() || '第 ' + (index + 1) + ' 节', index };
  });
  return {
    title: nodes(opf, 'title')[0]?.textContent?.trim() || '未命名书籍',
    author: nodes(opf, 'creator').map(el => el.textContent.trim()).join(' / ') || '作者未署名',
    language: nodes(opf, 'language')[0]?.textContent?.trim() || 'zh-CN',
    fixedLayout: nodes(opf, 'meta').some(el => el.getAttribute('property') === 'rendition:layout' && el.textContent.trim() === 'pre-paginated'),
    chapters, files, items
  };
}
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const imageTypes = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', avif:'image/avif', svg:'image/svg+xml' };
export function renderChapters(book, purifier, doc = document, makeURL = blob => URL.createObjectURL(blob)) {
  const urls = [], assets = new Map(), warnings = new Set();
  function image(base, href) {
    const path = resolvePath(base, href);
    if (!path || !book.files[path]) { warnings.add('部分图片缺失或引用了外部地址，已省略。'); return null; }
    if (assets.has(path)) return assets.get(path);
    const ext = path.split('.').pop().toLowerCase();
    if (!imageTypes[ext]) { warnings.add('部分图片格式不受支持，已省略。'); return null; }
    let bytes = book.files[path];
    if (ext === 'svg') {
      const svg = purifier.sanitize(new TextDecoder().decode(bytes), { USE_PROFILES:{svg:true,svgFilters:true}, FORBID_TAGS:['style','foreignObject','image','use','animate','animateMotion','animateTransform','set'], FORBID_ATTR:['style','href','xlink:href'] });
      bytes = new TextEncoder().encode(svg);
    }
    const url = makeURL(new Blob([bytes], {type:imageTypes[ext]}));
    assets.set(path, url); urls.push(url); return url;
  }
  const sections = book.chapters.map(chapter => {
    const fragment = purifier.sanitize(chapter.html, {
      RETURN_DOM_FRAGMENT:true, USE_PROFILES:{html:true,svg:true,mathMl:true},
      FORBID_TAGS:['script','style','link','iframe','form','input','button','textarea','select','object','embed','audio','video','source','track','foreignObject','animate','animateMotion','animateTransform','set','base','meta'],
      FORBID_ATTR:['style','srcset','background','poster','action','formaction','srcdoc','autofocus','contenteditable','download','target','ping']
    });
    // Replace every resource URL before moving the inert fragment into the preview.
    for (const el of fragment.querySelectorAll('*')) {
      if (el.hasAttribute('id')) el.id = 'ch' + chapter.index + '-' + el.id;
      for (const attr of [...el.attributes]) {
        if (['src','href','xlink:href'].includes(attr.name)) {
          const original = attr.value; el.removeAttribute(attr.name);
          if (['img','image'].includes(el.localName)) {
            const url = image(chapter.path, original);
            if (url) el.setAttribute(el.localName === 'img' ? 'src' : 'href', url);
            else { el.setAttribute('aria-label', '图片已省略'); if (el.localName === 'img') el.alt ||= '图片已省略'; }
          } else if (el.localName === 'a') {
            const path = original.startsWith('#') ? chapter.path : resolvePath(chapter.path, original);
            const target = book.chapters.find(item => item.path === path);
            if (target) {
              let hash = original.includes('#') ? original.slice(original.indexOf('#') + 1) : '';
              try { hash = decodeURIComponent(hash); } catch { hash = ''; }
              el.setAttribute('href', '#ch' + target.index + (hash ? '-' + hash : ''));
            }
          } else if (el.localName === 'use' && original.startsWith('#')) {
            el.setAttribute('href', '#ch' + chapter.index + '-' + original.slice(1));
          }
        }
        // Prevent SVG paint servers from fetching external URLs.
        if (/url\s*\(/i.test(attr.value)) {
          if (/^url\(#[\w:.-]+\)$/.test(attr.value)) el.setAttribute(attr.name, attr.value.replace('url(#','url(#ch' + chapter.index + '-'));
          else el.removeAttribute(attr.name);
        }
      }
    }
    const section = doc.createElement('section');
    section.id = 'ch' + chapter.index; section.className = 'chapter';
    section.append(fragment);
    return section.outerHTML;
  });
  return {sections, urls, warnings:[...warnings]};
}
export function previewHTML(title, sections, settings) {
  const paper = ['A4','A5','Letter'].includes(settings.paper) ? settings.paper : 'A4';
  const width = {A4:210,A5:148,Letter:215.9}[paper];
  const margin = Math.min(25, Math.max(15, Number(settings.margin) || 20));
  const size = Math.min(20, Math.max(9, Number(settings.size) || 12));
  const line = Math.min(2, Math.max(1.5, Number(settings.line) || 1.8));
  const font = settings.font === 'sans' ? '"Microsoft YaHei","Noto Sans CJK SC",sans-serif' : '"Noto Serif CJK SC","SimSun","Songti SC",serif';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(title)}</title><style>
  @page{size:${paper};margin:${margin}mm}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:24px auto;background:#e9ece4;color:#202320;font:${size}pt/${line} ${font};overflow-wrap:anywhere}main{background:white;width:${width}mm;max-width:calc(100% - 32px);padding:${margin}mm;margin:auto;box-shadow:0 3px 18px #25332314}section+section{margin-top:2em}h1,h2,h3,h4,h5,h6{line-height:1.4;break-after:avoid}h1{font-size:1.8em}h2{font-size:1.4em}p{orphans:3;widows:3}img,svg{max-width:100%;height:auto;max-height:230mm;object-fit:contain}figure{margin:1em 0;break-inside:avoid}figcaption{font-size:.85em;color:#666}table{border-collapse:collapse;max-width:100%;width:auto;table-layout:auto;font-size:.9em}td,th{border:1px solid #aaa;padding:.35em;overflow-wrap:anywhere}tr{break-inside:avoid}thead{display:table-header-group}pre{white-space:pre-wrap;font-size:.85em}blockquote{margin:1em;padding-left:1em;border-left:2px solid #bbc5b4}a{color:inherit;text-decoration:none}ruby{ruby-position:over}rt{font-size:.5em}math{max-width:100%}hr{border:0;border-top:1px solid #ddd} @media print{html{scroll-behavior:auto}body{margin:0;background:white}main{width:auto;max-width:none;padding:0;box-shadow:none}section+section{margin-top:${settings.chapterBreak ? '0' : '2em'};break-before:${settings.chapterBreak ? 'page' : 'auto'}}a{color:black}img,svg{max-height:${{A4:297,A5:210,Letter:279.4}[paper]-margin*2-8}mm}}
  </style></head><body><main>${sections.join('\n')}</main></body></html>`;
}