import { unzipBook } from './epub.js';
import './vendor/fflate.js';
self.onmessage = ({data}) => {
  try {
    const files = unzipBook(data, self.fflate.unzipSync);
    self.postMessage({files}, Object.values(files).map(file => file.buffer));
  } catch (error) { self.postMessage({error: '无法解压 EPUB：' + error.message}); }
};