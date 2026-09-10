// ─────────────────────────────────────────────────────────────
// Lumnis — Service Worker v2
// Atualizado para arquitetura modular (5 arquivos JS separados)
// ─────────────────────────────────────────────────────────────
const CACHE = 'lumnis-v3-20';  // ← bump força limpeza do cache antigo
const SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/privacidade.html',
  '/01-core.js',
  '/02-ui.js',
  '/03-perfil.js',
  '/04-contas.js',
  '/07-apagar.js',
  '/08-sonhos-mapa.js',
  '/06-onboarding.js',
  '/05-init.js',
];

// Instala e faz cache do shell
self.addEventListener('install', e => {
  self.skipWaiting();  // ativa imediatamente, sem esperar fechar abas antigas
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {}))
  );
});

// Ativa e limpa caches antigos (remove lumnis-v1)
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first para API, cache-first para shell
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // APIs externas — sempre rede, sem cache
  if (url.hostname.includes('supabase') ||
      url.hostname.includes('n8n') ||
      url.hostname.includes('anthropic')) {
    return;
  }

  // Navegação — network-first, fallback ao cache
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return r;
        })
        .catch(() => caches.match('/index.html') || caches.match('/'))
    );
    return;
  }

  // JS/CSS/assets — network-first para garantir versão mais recente
  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r.ok) {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
