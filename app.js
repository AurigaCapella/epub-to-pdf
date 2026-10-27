import {parseBook, renderChapters, previewHTML} from './epub.js';
const $ = id => document.getElementById(id);
let book = null, rendered = null, busy = false, previewReady = false, renderID = 0;
const controls = ['paper','margin','font','line-height','font-size','chapter-break'];
function settings() { return {paper:$('paper').value, margin:$('margin').value, font:$('font').value, line:$('line-height').value, size:$('font-size').value, chapterBreak:$('chapter-break').checked}; }
function message(value, error = false) { $('status').textContent = value; $('status').classList.toggle('error', error); }
function revoke() { if (rendered) rendered.urls.forEach(url => URL.revokeObjectURL(url)); rendered = null; }
function selection() { return [...$('chapter-list').querySelectorAll('input:checked')].map(input => Number(input.value)); }
function releaseBook() {
  renderID++; $('preview').srcdoc = ''; revoke(); book = null; previewReady = false;
  $('preview').hidden = true; $('empty-preview').hidden = false; $('drop-zone').hidden = false; $('book-info').hidden = true;
  $('chapter-panel').hidden = true; $('chapter-list').replaceChildren(); $('export').disabled = true; $('file-input').value = '';
  $('preview-label').textContent = '等待你的第一本书'; document.title = '纸桥 Paperbridge · EPUB 转 PDF';
}
async function refreshPreview() {
  if (!book || !rendered) return;
  const id = ++renderID, chosen = selection(); previewReady = false; $('export').disabled = true;
  $('size-output').textContent = $('font-size').value + ' pt';
  $('chapter-count').textContent = chosen.length + ' / ' + book.chapters.length;
  $('preview-label').textContent = settings().paper + ' / ' + settings().size + ' pt / ' + chosen.length + ' 节';
  const frame = $('preview');
  frame.onload = async () => {
    try {
      const images = [...frame.contentDocument.images];
      await Promise.all(images.map(img => img.decode().catch(() => { img.alt ||= '图片无法解码'; })));
      await frame.contentDocument.fonts.ready;
      if (id !== renderID) return;
      previewReady = true; $('export').disabled = !chosen.length || busy;
    } catch { if (id === renderID) message('预览准备失败，请重新选择 EPUB。', true); }
  };
  frame.srcdoc = previewHTML(book.title, chosen.map(index => rendered.sections[index]), settings());
}
function showBook(nextBook) {
  book = nextBook;
  rendered = renderChapters(book, window.DOMPurify);
  $('book-title').textContent = book.title; $('book-author').textContent = book.author;
  $('book-meta').textContent = book.chapters.length + ' 个章节 · 本地处理';
  $('drop-zone').hidden = true; $('book-info').hidden = false; $('chapter-panel').hidden = false;
  $('chapter-list').replaceChildren(...book.chapters.map(ch => {
    const label = document.createElement('label'), input = document.createElement('input');
    input.type = 'checkbox'; input.checked = true; input.value = ch.index;
    input.addEventListener('change', refreshPreview); label.append(input, document.createTextNode(ch.title)); return label;
  }));
  $('empty-preview').hidden = true; $('preview').hidden = false;
  message(['已就绪。在本地重新排版，原书 CSS 和嵌入字体已省略。', ...(book.fixedLayout ? ['检测到固定版式，转换结果可能与原书不同。'] : []), ...rendered.warnings].join(' '));
  document.title = book.title + ' · 纸桥'; refreshPreview();
}
function unpack(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./unzip-worker.js', {type:'module'});
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('解压超时，请尝试较小的文件。')); }, 45000);
    const finish = () => {clearTimeout(timer); worker.terminate();};
    worker.onmessage = ({data}) => {finish(); data.error ? reject(new Error(data.error)) : resolve(data.files);};
    worker.onerror = () => {finish(); reject(new Error('解压组件无法运行，请刷新页面重试。'));};
    worker.postMessage(buffer, [buffer]);
  });
}
async function load(file) {
  if (!file || busy) return;
  if (!/\.epub$/i.test(file.name)) { message('请选择 .epub 格式的电子书。', true); $('file-input').value=''; return; }
  if (file.size > 100*1024*1024) {message('文件超过 100 MB，请选择较小的 EPUB。',true);$('file-input').value='';return;}
  releaseBook(); busy = true; $('pick-file').disabled = true; $('demo').disabled = true;
  $('progress').hidden = false; $('progress').value = 12; message('正在本地解压 EPUB…');
  try {
    const files = await unpack(await file.arrayBuffer()); $('progress').value = 65;
    message('正在读取章节并准备排版…');
    await new Promise(resolve => requestAnimationFrame(resolve));
    showBook(parseBook(files)); $('progress').value = 100;
  } catch (error) {releaseBook(); message(error.message || '转换失败，请检查文件是否完整。', true);}
  finally {busy = false; $('pick-file').disabled = false; $('demo').disabled = false; $('progress').hidden = true; $('file-input').value = ''; if (previewReady) $('export').disabled = !selection().length;}
}
$('pick-file').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', event => load(event.target.files[0]));
const drop = $('drop-zone');
for (const event of ['dragenter','dragover']) drop.addEventListener(event, e => {e.preventDefault(); drop.classList.add('dragover');});
for (const event of ['dragleave','drop']) drop.addEventListener(event, e => {e.preventDefault(); drop.classList.remove('dragover');});
drop.addEventListener('drop', e => {if(e.dataTransfer.files.length!==1){message('请一次选择一本 EPUB。',true);return;}load(e.dataTransfer.files[0]);});
// A dropped file elsewhere must never navigate away from the current book.
window.addEventListener('dragover', e => e.preventDefault()); window.addEventListener('drop', e => e.preventDefault());
$('clear-book').addEventListener('click', () => {releaseBook(); message('书籍已从当前会话移除。');});
for (const id of controls) $(id).addEventListener(id === 'font-size' ? 'input' : 'change', () => { $('size-output').textContent=$('font-size').value+' pt'; refreshPreview(); });
$('reset-settings').addEventListener('click', () => {['A4','20','serif','1.8','12'].forEach((v,i) => $(controls[i]).value=v); $('chapter-break').checked = true; $('size-output').textContent='12 pt'; refreshPreview();});
for (const [id, checked] of [['select-all',true],['select-none',false]]) $(id).addEventListener('click', () => {$('chapter-list').querySelectorAll('input').forEach(input=>input.checked=checked);refreshPreview();});
$('export').addEventListener('click', () => {
  if (!book || !previewReady || !selection().length) return;
  const html = previewHTML(book.title, selection().map(index => rendered.sections[index]), settings());
  let printWindow;
  const receive = event => {
    if (event.origin !== location.origin || event.source !== printWindow || event.data !== 'paperbridge-ready') return;
    printWindow.postMessage({type:'paperbridge-print', html}, location.origin);
    window.removeEventListener('message', receive);
    clearTimeout(timer);
  };
  window.addEventListener('message', receive);
  const timer = setTimeout(() => window.removeEventListener('message', receive), 30000);
  printWindow = window.open('./print.html', '_blank');
  if (!printWindow) {
    window.removeEventListener('message', receive); clearTimeout(timer);
    message('浏览器阻止了打印页面，请允许此站点弹出窗口后重试。', true);
  }
});
$('demo').addEventListener('click', () => {
  const enc = s => new TextEncoder().encode(s);
  const chapter = (title, body) => `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;
  const content = {
    mimetype:enc('application/epub+zip'),
    'META-INF/container.xml':enc('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'),
    'book.opf':enc('<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>纸间漫游</dc:title><dc:creator>纸桥 · 示例书籍</dc:creator><dc:language>zh-CN</dc:language></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>'),
    'one.xhtml':enc(chapter('第一章 · 另一种阅读', '<p>这是一本完全在你的浏览器中生成的示例书籍。你可以调整字号、纸张和页边距，看看文字如何重新找到自己的位置。</p><p>书页让阅读有了节奏。一行文字、一个停顿、一段留白，让信息变成可以慢慢体会的故事。</p><h2>把书带走</h2><p>点击「另存为 PDF」，在打印窗口中选择「另存为 PDF」，即可得到自己的纸质阅读版本。</p><blockquote>让格式少一点，让阅读多一点。</blockquote><p>English text stays selectable. 中文、<strong>粗体</strong>、<em>强调</em>与公式都能保留。</p><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></math>')),
    'two.xhtml':enc(chapter('第二章 · 安静的工作台','<p>你的书籍不需要离开设备。解压、读取、排版与导出，都由当前浏览器在本地完成。</p><figure><img src="art.svg" alt="本地生成的山峦插图"/><figcaption>插图也在本机处理。</figcaption></figure><table><thead><tr><th>步骤</th><th>发生在哪里</th></tr></thead><tbody><tr><td>读取 EPUB</td><td>本地浏览器</td></tr><tr><td>重新排版</td><td>本地浏览器</td></tr><tr><td>生成 PDF</td><td>浏览器打印引擎</td></tr></tbody></table><p>首次联网打开后，等待离线缓存准备完成，之后就可以带着纸桥走得更远。</p>'))
  };
  content['art.svg'] = enc('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="140" viewBox="0 0 600 140"><rect width="600" height="140" fill="#254f43"/><path d="M50 110L160 35l110 75L390 25l110 85" fill="none" stroke="#e7dfb9" stroke-width="6"/><circle cx="510" cy="35" r="14" fill="#e7dfb9"/></svg>');
  const blob = window.fflate.zipSync(content);
  load(new File([blob], '纸间漫游.epub', {type:'application/epub+zip'}));
});
async function offline() {
  const badge = $('offline-state');
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') {badge.textContent='本地使用中';return;}
  try {
    await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    badge.textContent = '离线已就绪';
    window.addEventListener('offline',()=>badge.textContent='离线模式');
    window.addEventListener('online',()=>badge.textContent='离线已就绪');
    if (!navigator.onLine) badge.textContent='离线模式';
  } catch {badge.textContent='离线缓存不可用';}
}
offline();