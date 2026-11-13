/*
 * 综合安全管理系统 —— Service Worker
 * 目标：可安装 PWA + 离线可用（双击 file:// 打开的老用法不受影响，此处仅在 http/https 下注册）。
 * 策略：
 *   - 页面导航：网络优先，失败回退缓存（离线打开即为完整系统）
 *   - 同源静态资源（图标/manifest）：缓存优先，后台静默更新
 *   - 跨域请求（OCR 联网增强等）：完全放行，不做拦截
 */
const VERSION = 'v1';
const CACHE = 'aqgl-' + VERSION;
const APP_HTML = './综合安全管理系统.html';

const PRECACHE_URLS = [
  './',
  './index.html',
  APP_HTML,
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
  './icons/favicon-64.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // 逐个 add，单个失败不阻断安装
      await Promise.all(
        PRECACHE_URLS.map((u) =>
          cache.add(new Request(u, { cache: 'reload' })).catch(() => null)
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function isNavigation(request) {
  return request.mode === 'navigate' ||
    (request.headers.get('accept') || '').includes('text/html');
}

/* 页面导航：网络优先，失败回退缓存 */
async function handleNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      cache.put(request, fresh.clone()).catch(() => null);
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // 离线且未命中（如从主屏图标启动的 index.html）：直接给出系统主文件
    const shell = await cache.match(APP_HTML, { ignoreSearch: true });
    if (shell) return shell;
    return new Response(
      '<!DOCTYPE html><meta charset="utf-8"><title>离线</title>' +
      '<body style="font:14px/1.7 sans-serif;text-align:center;padding:60px 20px;color:#2d3748">' +
      '<h2>当前处于离线状态</h2><p>请恢复网络后重新打开综合安全管理系统。</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

/* 同源静态资源：缓存优先 + 后台更新 */
async function handleStatic(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok && res.type === 'basic') {
        cache.put(request, res.clone()).catch(() => null);
      }
      return res;
    })
    .catch(() => null);
  return cached || (await network) || new Response('', { status: 504 });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 跨域（OCR、字体等）与 blob/data 协议一律放行
  if (url.origin !== self.location.origin) return;

  if (isNavigation(request)) {
    event.respondWith(handleNavigation(request));
  } else {
    event.respondWith(handleStatic(request));
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
