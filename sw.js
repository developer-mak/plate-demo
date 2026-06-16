const CACHE_VERSION = "platevision-v1.4.1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./app.js",
  "./pwa.js",
  "./sw.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

const CDN_URLS = [
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css",
  "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css",
  "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/fonts/bootstrap-icons.woff2",
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.min.js",
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.wasm",
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.mjs",
  "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"
];

const MODEL_URLS = [
  "./models/best.onnx",
  "./models/cct_s_v2_global.onnx"
];

const ALL_ASSET_URLS = [...CDN_URLS, ...MODEL_URLS];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => caches.open(ASSET_CACHE))
      .then(cache =>
        Promise.allSettled(
          ALL_ASSET_URLS.map(url =>
            cache.add(new Request(url, { cache: "reload" }))
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key.startsWith("platevision-") && key !== STATIC_CACHE && key !== ASSET_CACHE)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  if (event.data && event.data.type === "CACHE_ASSETS") {
    event.waitUntil(precacheAssets());
  }
});

async function precacheAssets() {
  const cache = await caches.open(ASSET_CACHE);
  await Promise.allSettled(
    ALL_ASSET_URLS.map(async url => {
      if (await cache.match(url)) return;
      try {
        await cache.add(new Request(url, { cache: "reload" }));
      } catch (_) {}
    })
  );
}

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isCdn(url) {
  return url.hostname === "cdn.jsdelivr.net";
}

function isShellAsset(url) {
  if (!isSameOrigin(url)) return false;

  const path = url.pathname;
  return path.endsWith(".js") ||
    path.endsWith(".html") ||
    path.endsWith(".webmanifest") ||
    path === "/" ||
    path.endsWith("/");
}

function isCacheableRequest(request) {
  return request.method === "GET";
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const staticCache = await caches.open(STATIC_CACHE);
    const fallback = await staticCache.match(request);
    if (fallback) return fallback;
    throw error;
  }
}

async function networkFirst(request) {
  const staticCache = await caches.open(STATIC_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok) {
      staticCache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await staticCache.match(request);
    if (cached) return cached;
    const index = await staticCache.match("./index.html");
    if (index) return index;
    throw error;
  }
}

self.addEventListener("fetch", event => {
  const { request } = event;
  if (!isCacheableRequest(request)) return;

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isShellAsset(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (MODEL_URLS.some(modelUrl => url.href.endsWith(modelUrl.replace("./", ""))) ||
      url.pathname.endsWith(".onnx")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isCdn(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isSameOrigin(url) && url.pathname.endsWith(".png")) {
    event.respondWith(cacheFirst(request));
  }
});
