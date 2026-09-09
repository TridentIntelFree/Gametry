// Single source of truth for the build identity.
//
// Bump BUILD on every deploy. It is shown on the start screen and in the Info
// panel so "am I running the new version?" is answerable at a glance instead
// of being guessed at.
export const BUILD = '2026.09.09-9';

// Registers the network-first service worker, and provides the escape hatches:
//   ?reset  unregister the worker, drop all caches, reload clean
//   ?nosw   skip registration entirely for this visit
export async function installUpdater(onUpdate) {
  const params = new URLSearchParams(location.search);

  if (params.has('reset')) {
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
      await Promise.all(regs.map((r) => r.unregister()));
      const keys = await caches?.keys?.() || [];
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch { /* nothing to clear */ }
    // strip the flag so a refresh does not loop
    location.replace(location.pathname + '?v=' + Date.now());
    return;
  }

  if (params.has('nosw') || !('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;

  try {
    const reg = await navigator.serviceWorker.register('sw.js', {
      // never let the browser serve sw.js itself from cache — that is how a
      // bad worker becomes permanent
      updateViaCache: 'none',
    });

    // A worker already controlling the page means an update may be waiting.
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          onUpdate?.();
        }
      });
    });

    // Check for a new worker on every launch.
    reg.update().catch(() => {});
  } catch { /* app works fine without it */ }
}
