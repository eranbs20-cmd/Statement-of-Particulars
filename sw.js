const CACHE = 'details-v24';
const CORE = ['./details.html','./base.pdf','./manifest.json','./icon-192.png','./icon-512.png','./fonts/Heebo-Bold.ttf'];
const CDN = [
  'https://unpkg.com/pdf-lib/dist/pdf-lib.min.js',
  'https://unpkg.com/@pdf-lib/fontkit/dist/fontkit.umd.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>{c.addAll(CORE);CDN.forEach(u=>c.add(u).catch(()=>{}));}));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(c=>{if(c)return c;return fetch(e.request).then(r=>{if(r&&r.status===200&&r.type!=='opaque')caches.open(CACHE).then(ca=>ca.put(e.request,r.clone()));return r;}).catch(()=>c);}));});
