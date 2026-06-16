const INSTALL_DISMISS_KEY = "platevision_install_dismissed";

let deferredInstallPrompt = null;
let swRegistration = null;

function showToast(message) {
  const toastBanner = document.getElementById("toastBanner");
  if (!toastBanner) return;

  toastBanner.textContent = message;
  toastBanner.classList.add("visible");

  setTimeout(() => {
    toastBanner.classList.remove("visible");
  }, 4000);
}

function setOfflineBadge(isOffline) {
  const badge = document.getElementById("offlineBadge");
  if (!badge) return;

  badge.classList.toggle("d-none", !isOffline);
}

async function checkOfflineReady() {
  const statusEl = document.getElementById("offlineReadyStatus");
  if (!statusEl || !("caches" in window)) return;

  try {
    const keys = await caches.keys();
    const assetKey = keys.find(key => key.endsWith("-assets"));
    if (!assetKey) {
      statusEl.textContent = "Caching for offline…";
      return;
    }

    const cache = await caches.open(assetKey);
    const detector = await cache.match("./models/best.onnx");
    const ocr = await cache.match("./models/cct_s_v2_global.onnx");
    const ort = await cache.match("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.min.js");

    if (detector && ocr && ort) {
      statusEl.textContent = "Offline ready";
      statusEl.classList.add("ready");
    } else {
      statusEl.textContent = "Caching for offline…";
      statusEl.classList.remove("ready");
    }
  } catch (_) {
    statusEl.textContent = "";
  }
}

function showInstallBanner() {
  const banner = document.getElementById("installBanner");
  if (!banner || localStorage.getItem(INSTALL_DISMISS_KEY) === "1") return;
  if (window.matchMedia("(display-mode: standalone)").matches) return;

  banner.classList.remove("d-none");
}

function hideInstallBanner() {
  const banner = document.getElementById("installBanner");
  if (banner) banner.classList.add("d-none");
}

function showUpdateBanner() {
  const banner = document.getElementById("updateBanner");
  if (banner) banner.classList.remove("d-none");
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  try {
    swRegistration = await navigator.serviceWorker.register("./sw.js");

    swRegistration.addEventListener("updatefound", () => {
      const newWorker = swRegistration.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          showUpdateBanner();
        }
      });
    });

    if (swRegistration.waiting && navigator.serviceWorker.controller) {
      showUpdateBanner();
    }

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (window.__platevisionRefreshing) return;
      window.__platevisionRefreshing = true;
      window.location.reload();
    });

    if (swRegistration.active) {
      swRegistration.active.postMessage({ type: "CACHE_ASSETS" });
    }

    await checkOfflineReady();
    setTimeout(checkOfflineReady, 8000);
  } catch (error) {
    console.warn("Service worker registration failed:", error);
  }
}

function initPwaUi() {
  const installBtn = document.getElementById("installBtn");
  const dismissInstallBtn = document.getElementById("dismissInstallBtn");
  const updateBtn = document.getElementById("updateRefreshBtn");
  const dismissUpdateBtn = document.getElementById("dismissUpdateBtn");

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    showInstallBanner();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    hideInstallBanner();
    showToast("PlateVision installed successfully.");
  });

  window.addEventListener("online", () => setOfflineBadge(false));
  window.addEventListener("offline", () => setOfflineBadge(true));
  setOfflineBadge(!navigator.onLine);

  installBtn?.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      showToast("Install from your browser menu: Add to Home Screen.");
      return;
    }

    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    hideInstallBanner();

    if (outcome !== "accepted") {
      localStorage.setItem(INSTALL_DISMISS_KEY, "1");
    }
  });

  dismissInstallBtn?.addEventListener("click", () => {
    localStorage.setItem(INSTALL_DISMISS_KEY, "1");
    hideInstallBanner();
  });

  updateBtn?.addEventListener("click", () => {
    if (swRegistration?.waiting) {
      swRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
      return;
    }
    window.location.reload();
  });

  dismissUpdateBtn?.addEventListener("click", () => {
    document.getElementById("updateBanner")?.classList.add("d-none");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initPwaUi();
  registerServiceWorker();
});
