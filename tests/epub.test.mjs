import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,unzipSync,strToU8} from 'fflate';
import {JSDOM} from 'jsdom';
import createDOMPurify from 'dompurify';
import {unzipBook,parseBook,resolvePath,renderChapters,previewHTML} from '../epub.js';
const window=new JSDOM('').window, parser=new window.DOMParser(), purifier=createDOMPurify(window);
function fixture({body='<h1>第一章 中文</h1><p>可选择的正文</p>',opf='',chapterPath='chap/a.xhtml'}={}) {
  return Object.fromEntries(Object.entries({
    mimetype:'application/epub+zip',
    'META-INF/container.xml':'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
    'OPS/book.opf':`<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>测试书</dc:title><dc:creator>作者甲</dc:creator>${opf}</metadata><manifest><item id="a" href="${chapterPath}" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>`,
    'OPS/chap/a.xhtml':`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>A</title></head><body>${body}</body></html>`,
    'OPS/b.xhtml':'<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>前言</h1></body></html>',
    'OPS/images/p.png':'fake png'
  }).map(([path,data])=>[path,strToU8(data)]));
}
test('EPUB ZIP round trip, Unicode metadata and spine order',()=>{
  const files=unzipBook(zipSync(fixture()).buffer,unzipSync), book=parseBook(files,parser);
  assert.equal(book.title,'测试书');assert.equal(book.author,'作者甲');assert.equal(book.chapters[0].title,'前言');assert.equal(book.chapters[1].title,'第一章 中文');
});
test('relative paths, percent encoding and traversal boundaries',()=>{
  assert.equal(resolvePath('OPS/chap/a.xhtml','../images/%E4%B8%AD.png#x'),'OPS/images/中.png');
  for(const href of ['https://bad.test/a','//bad.test/a','/absolute','../../../escape','data:image/png,a','%zz']) assert.equal(resolvePath('OPS/a.xhtml',href),null);
});
test('reject corrupt ZIP, wrong mimetype, missing chapter and invalid XML',()=>{
  assert.throws(()=>unzipBook(new Uint8Array([1,2,3]).buffer,unzipSync));
  const wrong=fixture();wrong.mimetype=strToU8('text/plain');assert.throws(()=>parseBook(wrong,parser),/有效的 EPUB/);
  const missing=fixture();delete missing['OPS/b.xhtml'];assert.throws(()=>parseBook(missing,parser),/缺少章节/);
  const broken=fixture();broken['META-INF/container.xml']=strToU8('<bad>');assert.throws(()=>parseBook(broken,parser),/XML/);
});
test('reject encrypted books and flag fixed layout',()=>{
  const files=fixture({opf:'<meta property="rendition:layout">pre-paginated</meta>'});assert.equal(parseBook(files,parser).fixedLayout,true);
  files['META-INF/encryption.xml']=strToU8('<encryption><EncryptedData/></encryption>');assert.throws(()=>parseBook(files,parser),/加密/);
});
test('archive entry, total size, count and path budgets enforced before inflation',()=>{
  for(const entries of [[{name:'big',originalSize:51*1024*1024}],Array.from({length:7},(_,i)=>({name:String(i),originalSize:49*1024*1024})),Array.from({length:10001},(_,i)=>({name:String(i),originalSize:0})),[{name:'../escape',originalSize:0}]]) {
    assert.throws(()=>unzipBook(new ArrayBuffer(0),(_bytes,{filter})=>{entries.forEach(filter);return{};}));
  }
});
test('sanitize active content, remote URLs and CSS; rewrite local images and links',()=>{
  const book=parseBook(fixture({body:`<h1 id="start">中文</h1><script>alert(1)</script><style>@import 'https://bad.test'</style><img src="../images/p.png" onerror="alert(1)"/><img src="https://bad.test/p"/><a href="../b.xhtml">目录</a><a href="#start">内部</a><a href="javascript:alert(1)">危险</a><p style="background:url(https://bad.test)">正文</p><svg xmlns="http://www.w3.org/2000/svg"><image href="https://bad.test"/><rect fill="url(https://bad.test/r)"/></svg>`}),parser);
  const result=renderChapters(book,purifier,window.document,()=> 'blob:local-image');
  const html=result.sections[1];assert.ok(html.includes('src="blob:local-image"'));assert.ok(html.includes('href="#ch0"'));assert.ok(html.includes('href="#ch1-start"'));assert.ok(html.includes('id="ch1-start"'));
  assert.doesNotMatch(html,/https:|onerror|<script|<style|style=|javascript:/);assert.equal(result.urls.length,1);assert.equal(result.warnings.length,1);
});
test('preserve tables, MathML and ruby; print styles and escaped title',()=>{
  const book=parseBook(fixture({body:'<table><tr><td>甲</td></tr></table><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi><mo>=</mo><mn>1</mn></math><ruby>字<rt>zi</rt></ruby>'}),parser);
  const result=renderChapters(book,purifier,window.document,()=> 'blob:test');assert.match(result.sections[1],/<math/);assert.match(result.sections[1],/<table/);assert.match(result.sections[1],/<ruby/);
  const html=previewHTML('<书名>',result.sections,{paper:'A5',size:14,margin:15,line:2,font:'serif',chapterBreak:true});
  assert.match(html,/size:A5;margin:15mm/);assert.match(html,/break-before:page/);assert.match(html,/&lt;书名&gt;/);assert.match(html,/img-src blob:/);
});
test('SVG asset strips styles, external URLs and active elements',()=>{
  const files=fixture({body:'<img src="../images/p.svg"/>'});files['OPS/images/p.svg']=strToU8('<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://bad.test);</style><image href="https://bad.test"/><rect width="20" height="20"/></svg>');
  let blob;renderChapters(parseBook(files,parser),purifier,window.document,value=>{blob=value;return 'blob:svg';});return blob.text().then(svg=>{assert.match(svg,/<rect/);assert.doesNotMatch(svg,/https:|<style|<image/);});
});
