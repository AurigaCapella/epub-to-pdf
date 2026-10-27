const status=document.getElementById('print-status'), button=document.getElementById('print-button');
function print(){window.focus();window.print();}
button.addEventListener('click',print);
document.getElementById('close-button').addEventListener('click',()=>window.close());
async function receive(event){
  if(event.origin!==location.origin||event.source!==window.opener||event.data?.type!=='paperbridge-print'||typeof event.data.html!=='string')return;
  window.removeEventListener('message',receive);
  const doc=new DOMParser().parseFromString(event.data.html,'text/html');
  const content=doc.querySelector('main'),style=doc.querySelector('style');
  if(!content||!style){status.textContent='书籍内容无效，请返回工作台重试。';return;}
  document.title=doc.title;
  document.head.append(document.importNode(style,true));
  document.getElementById('book-content').append(document.importNode(content,true));
  // Local blob image bytes must finish decoding before the print engine measures pages.
  await Promise.all([...document.images].map(img=>img.decode().catch(()=>{})));
  await document.fonts.ready;
  button.disabled=false;
  status.textContent='请选择浏览器「另存为 PDF / Save as PDF」，不要选「Microsoft Print to PDF」。关闭页眉页脚，保存完成后再关闭此页。';
  window.opener=null;
  print();
}
window.addEventListener('message',receive);
if(window.opener)window.opener.postMessage('paperbridge-ready',location.origin);
else status.textContent='请先在纸桥工作台选择 EPUB，再点击「另存为 PDF」。';
