// The app shell, cached, so the installed phone app opens on a music stand with no
// laptop on the network. Registered from learn-m.html only: the desktop pages are
// opened straight off the dev server while they are being edited, and a shell
// cached there would turn every refresh into a debugging trap.
//
// Which way round a file is served matters more than it looks, because this project
// has no build step -- the files the phone loads are the files being edited on the
// laptop, live. So:
//
//   network-first  everything the project writes: the page, the CSS, the modules
//                  and the songs. The network is a laptop three metres away; the
//                  cached copy is there for when it is asleep, not for speed. This
//                  is what keeps edit-and-refresh honest.
//   cache-first    what never changes: the vendored abcjs bundle and the icons.
//
// Either way the response is put in the cache, so the first offline launch has
// everything the last online one touched.

// Bump this whenever the shell list below changes. Activating a new version deletes
// the old cache outright, which is the only way a phone that has been installed on a
// home screen for a week is guaranteed not to answer one module out of the old shell
// and the rest out of the new one.
const VERSION = 'mm-learn-v3';

const SHELL = [
  'learn-m.html', 'learn-m.css', 'style.css', 'looper.css', 'learn.css',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/abcjs-basic-min.js',
  'src/song.js', 'src/clock.js', 'src/midi.js', 'src/synth.js', 'src/metronome.js',
  'src/keyboard.js', 'src/theory.js',
  'src/notation/beams.js',
  'src/outtoggle.js',
  'src/learn/mobile.js', 'src/learn/phone.js', 'src/learn/store.js', 'src/learn/pass.js',
  'src/learn/plan.js', 'src/learn/scorer.js', 'src/learn/engine.js', 'src/learn/meter.js',
  'src/learn/tempo.js', 'src/learn/roll.js', 'src/learn/staff.js', 'src/learn/fall.js',
  // the scrolling staff and its camera, and the whole of remote mode: mobile.js
  // imports all five, so a shell without them is a shell that cannot boot
  'src/learn/scroll.js', 'src/learn/camera.js',
  'src/learn/remote.js', 'src/learn/relay.js', 'src/learn/sync.js',
  // the Feedback sheet. It is no use offline -- the note goes to the laptop, and a
  // phone with no laptop has nowhere to send one -- but mobile.js imports it, so a
  // shell without it is a shell that will not boot at all.
  'src/learn/feedback.js',
  'songs/index.json',
];

self.addEventListener('install', e => {
  // one miss must not fail the whole install -- a file may have been renamed
  e.waitUntil(caches.open(VERSION)
    .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const keep = (req, res) => {
  if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
  return res;
};

/** Frozen third-party payload: bytes that only change when they are replaced wholesale. */
const immutable = url => url.pathname.includes('/vendor/') || url.pathname.includes('/icons/');

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // The relay is a live stream, not a document. Proxied through here it becomes the
  // worker's connection rather than the page's, so it outlives the page -- the laptop
  // never hears that the phone has gone, and keeps its own speakers muted for it.
  // (keep() would also try to cache an endless response, which never finishes.)
  if (url.pathname.startsWith('/relay/')) return;

  if (immutable(url)) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => keep(e.request, r))));
    return;
  }

  e.respondWith(fetch(e.request)
    .then(r => keep(e.request, r))
    .catch(() => caches.match(e.request)
      // a navigation with nothing cached for it still gets the shell
      .then(hit => hit || (e.request.mode === 'navigate' ? caches.match('learn-m.html') : undefined))));
});
