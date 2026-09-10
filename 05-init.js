// ════════════════════════════════════════
// 05-init.js — Mobile Performance, PWA Manifest, Swipe
// ════════════════════════════════════════

// ── MOBILE PERFORMANCE ────────────────────────────────────────────
// ── MOBILE PERFORMANCE ────────────────────────────────────────────
(function() {
  // Scroll bounce prevenido via CSS (overscroll-behavior no body/html)
  // REMOVIDO: listener touchmove passive:false bloqueava scroll no Android Chrome

  // Melhora scroll nos modais (garante -webkit-overflow-scrolling)
  function fixModalScroll(el) {
    if (!el) return;
    el.style.webkitOverflowScrolling = 'touch';
    el.style.overscrollBehavior = 'contain';
  }

  // Observer para aplicar fix em modais dinamicamente
  const obs = new MutationObserver(function(muts) {
    muts.forEach(function(mut) {
      mut.addedNodes.forEach(function(node) {
        if (node.nodeType === 1) {
          if (node.id && node.id.startsWith('modal-')) fixModalScroll(node.querySelector('div'));
          node.querySelectorAll && node.querySelectorAll('[style*="overflow-y"]').forEach(fixModalScroll);
        }
      });
    });
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // Força re-render suave ao voltar para a aba (iOS background throttle)
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
      // NAO usar transform aqui: enquanto ele existe no body, todo
      // position:fixed filho passa a se ancorar no body em vez da
      // viewport — o chat da IA pulava de lugar ao voltar pro app.
      // Ler offsetHeight forca o mesmo reflow, sem efeito colateral.
      void document.body.offsetHeight;
    }
  });
})();


// ── PWA: Manifest Inline + Service Worker + Install Banner ───
(function() {

  // ── 1. Manifest injetado via blob (sem manifest.json externo) ──
  const ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIj4KICA8ZGVmcz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0iYmciIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAlIiBzdG9wLWNvbG9yPSIjMTgxODFiIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3RvcC1jb2xvcj0iIzBmMGYxMiIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0iZ2xvdyIgeDE9IjAlIiB5MT0iMCUiIHgyPSIxMDAlIiB5Mj0iMTAwJSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiNmZmZmZmYiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjZTRlNGU3Ii8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogIDwvZGVmcz4KICA8IS0tIEJhY2tncm91bmQgcm91bmRlZCAtLT4KICA8cmVjdCB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgcng9IjExMiIgZmlsbD0idXJsKCNiZykiLz4KICA8IS0tIFN1YnRsZSBib3JkZXIgLS0+CiAgPHJlY3Qgd2lkdGg9IjUxMiIgaGVpZ2h0PSI1MTIiIHJ4PSIxMTIiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjA4KSIgc3Ryb2tlLXdpZHRoPSIyIi8+CiAgPCEtLSAiTCIgZWxlZ2FudGUgLS0+CiAgPHRleHQgeD0iOTAiIHk9IjM5MCIgZm9udC1mYW1pbHk9Ikdlb3JnaWEsIHNlcmlmIiBmb250LXNpemU9IjM2MCIgZm9udC13ZWlnaHQ9IjcwMCIgZmlsbD0idXJsKCNnbG93KSIgbGV0dGVyLXNwYWNpbmc9Ii0xMCI+TDwvdGV4dD4KICA8IS0tIERvdCBhY2NlbnQgLS0+CiAgPGNpcmNsZSBjeD0iMzgwIiBjeT0iMTMwIiByPSIyMiIgZmlsbD0iIzIyYzU1ZSIvPgo8L3N2Zz4=';
  const manifest = {
    name: 'Lumnis',
    short_name: 'Lumnis',
    description: 'Controle financeiro pessoal',
    start_url: '/',
    display: 'standalone',
    background_color: '#0d0d16',
    theme_color: '#0f0f12',
    orientation: 'portrait-primary',
    icons: [
      { src: 'https://raw.githubusercontent.com/nexusrugido-web/images1/main/lumnis-logo.png', sizes: '1024x1024', type: 'image/png', purpose: 'any maskable' },
      { src: 'https://raw.githubusercontent.com/nexusrugido-web/images1/main/lumnis-logo.png', sizes: '512x512', type: 'image/png' },
      { src: 'https://raw.githubusercontent.com/nexusrugido-web/images1/main/lumnis-logo.png', sizes: '192x192', type: 'image/png' }
    ]
  };
  try {
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
    document.getElementById('pwa-manifest').href = URL.createObjectURL(blob);
  } catch(e) { console.warn('[PWA] manifest inline falhou:', e); }

  // ── 2. Service Worker: tenta /sw.js se existir, senão minimal blob ──
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(r => {
          // SW registrado
          // Detectar nova versão disponível
          r.addEventListener('updatefound', () => {
            const newWorker = r.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                _showPWAUpdatePopup(newWorker);
              }
            });
          });
        })
        .catch(() => {
          // /sw.js não existe — registra SW mínimo via blob (sem cache offline)
          const minSW = `
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('message',e=>{if(e.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  if(e.action==='ver'||!e.action){
    e.waitUntil(clients.matchAll({type:'window'}).then(cs=>{
      for(const c of cs){if(c.url&&'focus' in c){c.postMessage({type:'NAV_FATURAS'});return c.focus();}}
      if(clients.openWindow)return clients.openWindow('/');
    }));
  }
});
`.trim()
          try {
            const blobSW = new Blob([minSW], { type: 'application/javascript' });
            navigator.serviceWorker.register(URL.createObjectURL(blobSW))
              .then(r => console.log('[SW] blob registrado:', r.scope))
              .catch(e => console.warn('[SW] sem SW disponível:', e));
          } catch(e) {}
        });
    });
  }

  // ── 3. Prompt "Instalar App" (Android/Chrome) ──────────────────
  let _deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _deferredPrompt = e;
    setTimeout(() => {
      if (_deferredPrompt && !window.matchMedia('(display-mode: standalone)').matches) {
        _showInstallBanner();
      }
    }, 3000);
  });

  function _showInstallBanner() {
    if (document.getElementById('pwa-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'pwa-banner';
    banner.style.cssText = [
      'position:fixed;bottom:80px;left:50%;transform:translateX(-50%)',
      'background:#18181b;color:#f4f4f5;border:1px solid #27272a',
      'border-radius:14px;padding:12px 16px;z-index:999',
      'display:flex;align-items:center;gap:12px',
      'box-shadow:0 8px 32px rgba(0,0,0,0.4)',
      'font-family:system-ui,sans-serif;font-size:0.82rem',
      'max-width:calc(100vw - 32px);animation:slideUp .3s ease'
    ].join(';');
    banner.innerHTML = `
      <img src="https://raw.githubusercontent.com/nexusrugido-web/images1/main/lumnis-logo.png"
           style="width:36px;height:36px;border-radius:8px;flex-shrink:0;object-fit:contain"
           onerror="this.src='${ICON}'">
      <div>
        <div style="font-weight:700;margin-bottom:2px">Instalar Lumnis</div>
        <div style="color:#71717a;font-size:0.72rem">Acesse sem navegador, como um app</div>
      </div>
      <button onclick="_installPWA()" style="background:#ffffff;color:#18181b;border:none;border-radius:8px;padding:7px 14px;font-size:0.78rem;font-weight:700;cursor:pointer;flex-shrink:0">Instalar</button>
      <button onclick="this.closest('#pwa-banner').remove()" style="background:none;border:none;color:#71717a;cursor:pointer;font-size:1.1rem;padding:0 4px;flex-shrink:0">✕</button>
    `;
    document.body.appendChild(banner);
  }

  window._installPWA = async function() {
    if (!_deferredPrompt) return;
    _deferredPrompt.prompt();
    const { outcome } = await _deferredPrompt.userChoice;
    _deferredPrompt = null;
    const banner = document.getElementById('pwa-banner');
    if (banner) banner.remove();
    if (outcome === 'accepted') {
      setTimeout(() => { if (typeof showToast === 'function') showToast('✅ App instalado!'); }, 500);
    }
  };

  // ── 4. iOS: instrução manual ───────────────────────────────────
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (isIOS && !window.navigator.standalone) {
    setTimeout(() => {
      if (!sessionStorage.getItem('lumnis_ios_hint')) {
        sessionStorage.setItem('lumnis_ios_hint', '1');
        const hint = document.createElement('div');
        hint.style.cssText = [
          'position:fixed;bottom:80px;left:50%;transform:translateX(-50%)',
          'background:#18181b;color:#f4f4f5;border:1px solid #27272a;border-radius:14px',
          'padding:14px 16px;z-index:999;max-width:calc(100vw - 32px)',
          'font-family:system-ui,sans-serif;font-size:0.8rem;text-align:center',
          'box-shadow:0 8px 32px rgba(0,0,0,0.4)'
        ].join(';');
        hint.innerHTML = `
          <div style="font-weight:700;margin-bottom:6px">📲 Instalar no iPhone/iPad</div>
          <div style="color:#a1a1aa;font-size:0.72rem;line-height:1.5">
            Toque em <strong style="color:#f4f4f5">Compartilhar</strong> (□↑) no Safari<br>
            depois em <strong style="color:#f4f4f5">"Adicionar à Tela de Início"</strong>
          </div>
          <button onclick="this.closest('div').remove()" style="margin-top:10px;background:#27272a;color:#f4f4f5;border:none;border-radius:8px;padding:6px 16px;cursor:pointer;font-size:0.75rem">Entendi</button>
        `;
        document.body.appendChild(hint);
      }
    }, 4000);
  }
})();


// ── Swipe horizontal entre tabs (mobile) ────────────────────────────
// ── Swipe horizontal entre tabs (mobile) ─────────────────────────
(function() {
  // Ordem das tabs visíveis no nav mobile
  const TAB_ORDER = ['home', 'transacoes', 'apagar', 'ia', 'perfil'];

  const main = document.getElementById('app-main');
  if (!main) return;

  let sx = 0, sy = 0, t0 = 0, live = false;

  main.addEventListener('touchstart', function(e) {
    if (e.touches.length !== 1) { live = false; return; }
    // Cancelar swipe de aba se o toque começa dentro de container scroll horizontal
    let _el = e.target;
    while (_el && _el !== main) {
      const _ox = window.getComputedStyle(_el).overflowX;
      if (_ox === 'auto' || _ox === 'scroll') { live = false; return; }
      _el = _el.parentElement;
    }
    sx   = e.touches[0].clientX;
    sy   = e.touches[0].clientY;
    t0   = Date.now();
    live = true;
  }, { passive: true });

  main.addEventListener('touchmove', function(e) {
    if (!live || e.touches.length !== 1) return;
    const dx = Math.abs(e.touches[0].clientX - sx);
    const dy = Math.abs(e.touches[0].clientY - sy);
    // Se verticalidade domina claramente desde o início → cancela swipe
    if (dy > dx + 12) live = false;
  }, { passive: true });

  main.addEventListener('touchend', function(e) {
    if (!live) return;
    live = false;

    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    const dt = Date.now() - t0;

    // Critério: movimento horizontal dominante (>55%), mínimo 45px, até 450ms
    if (Math.abs(dx) < 45 || Math.abs(dy) > Math.abs(dx) * 0.9 || dt > 450) return;

    const activeEl = document.querySelector('.tab-view.active');
    if (!activeEl) return;
    const cur = activeEl.id.replace('tab-', '');
    const idx = TAB_ORDER.indexOf(cur);
    if (idx < 0) return;

    if (dx < 0 && idx < TAB_ORDER.length - 1) {
      // Swipe esquerda → próxima tab
      _swipeToTab(TAB_ORDER[idx + 1], 'right');
    } else if (dx > 0 && idx > 0) {
      // Swipe direita → tab anterior
      _swipeToTab(TAB_ORDER[idx - 1], 'left');
    }
  }, { passive: true });

  function _swipeToTab(tab, dir) {
    if (typeof switchTab !== 'function') return;
    switchTab(tab);
    // Aplica animação na nova tab
    const el = document.getElementById('tab-' + tab);
    if (!el) return;
    const cls = dir === 'right' ? 'tab-slide-right' : 'tab-slide-left';
    el.classList.remove('tab-slide-right', 'tab-slide-left');
    void el.offsetWidth; // reflow
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 250);
  }
})();

// ── POPUP SUPORTE ─────────────────────────────────────────
const _SUPORTE_WEBHOOK = 'https://n8n.nexusrugido.com/webhook/lumnis-suporte';

function abrirPopupSuporte() {
  const modal = document.getElementById('modal-suporte-popup');
  if (!modal) return;
  // Preencher email automaticamente se disponível
  const emailInput = document.getElementById('sup-popup-email');
  if (emailInput && !emailInput.value) {
    const emailVal = (typeof userData !== 'undefined' && userData?.email) ? userData.email : '';
    if (emailVal) emailInput.value = emailVal;
  }
  modal.style.display = 'flex';
  // Não adiciona modal-open ao body pois o modal é global (fora do main)
}
function fecharPopupSuporte() {
  const modal = document.getElementById('modal-suporte-popup');
  if (modal) { modal.style.display = 'none'; document.body.classList.remove('modal-open'); }
}
async function enviarTicketSuporte() {
  const tipo    = document.getElementById('sup-popup-tipo')?.value || 'outro';
  const assunto = (document.getElementById('sup-popup-assunto')?.value || '').trim();
  const desc    = (document.getElementById('sup-popup-desc')?.value || '').trim();
  const email   = (document.getElementById('sup-popup-email')?.value || '').trim();

  if (!assunto || !desc) {
    if (typeof showToast === 'function') showToast('Preencha o assunto e a descrição', 'warn');
    return;
  }
  if (!email) {
    if (typeof showToast === 'function') showToast('Informe seu email para contato', 'warn');
    return;
  }

  const btn = document.getElementById('sup-popup-btn');
  const btnOrig = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="1"/></svg> Enviando...';
  }

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch(_SUPORTE_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        tipo, assunto, descricao: desc, email,
        report: assunto + ' — ' + desc,
        userId: (typeof USER_ID !== 'undefined' ? USER_ID : null),
        nome: (typeof userData !== 'undefined' ? userData?.nome : null),
        timestamp: new Date().toISOString()
      })
    });
    clearTimeout(tid);

    if (resp.ok || resp.status < 500) {
      if (typeof showToast === 'function') showToast('✅ Pedido enviado! Responderemos em até 24h.', 'success');
      ['sup-popup-tipo','sup-popup-assunto','sup-popup-desc','sup-popup-email'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.tagName !== 'SELECT') el.value = '';
        else if (el) el.selectedIndex = 0;
      });
      fecharPopupSuporte();
    } else {
      if (typeof showToast === 'function') showToast('❌ Erro ' + resp.status + '. Tente novamente.', 'error');
    }
  } catch(e) {
    const msg = e.name === 'AbortError'
      ? '⏱ Timeout. Tente novamente.'
      : '❌ Sem conexão. Verifique sua internet.';
    if (typeof showToast === 'function') showToast(msg, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = btnOrig || 'Enviar Pedido'; }
  }
}
// Fechar popup ao clicar fora
document.addEventListener('click', function(e) {
  const modal = document.getElementById('modal-suporte-popup');
  if (modal && modal.style.display === 'flex' && e.target === modal) fecharPopupSuporte();
});


// ── FAB SPEED-DIAL ────────────────────────────────────
let _fabMenuOpen = false;
function openFabMenu() {
  _fabMenuOpen = !_fabMenuOpen;
  const overlay = document.getElementById('fab-menu-overlay');
  const menu = document.getElementById('fab-menu');
  if (!overlay || !menu) { openTxModal(); return; }
  if (_fabMenuOpen) {
    overlay.style.display = 'block';
    menu.style.display = 'flex';
  } else {
    closeFabMenu();
  }
}
function closeFabMenu() {
  _fabMenuOpen = false;
  const overlay = document.getElementById('fab-menu-overlay');
  const menu = document.getElementById('fab-menu');
  if (overlay) overlay.style.display = 'none';
  if (menu) menu.style.display = 'none';
}


// ── PWA UPDATE POPUP ──────────────────────────────────────
function _showPWAUpdatePopup(worker) {
  if (document.getElementById('pwa-update-popup')) return;
  const popup = document.createElement('div');
  popup.id = 'pwa-update-popup';
  popup.style.cssText = [
    'position:fixed;bottom:80px;left:16px;right:16px;z-index:3000',
    'background:var(--card);border:1px solid rgba(139,92,246,0.5)',
    'border-radius:16px;padding:14px 16px',
    'display:flex;align-items:center;gap:12px',
    'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
    'animation:slideUp .3s ease'
  ].join(';');
  popup.innerHTML = `
    <div style="font-size:1.3rem">🚀</div>
    <div style="flex:1;min-width:0">
      <div style="font-weight:700;font-size:0.88rem;color:var(--text)">Nova versão disponível</div>
      <div style="font-size:0.72rem;color:var(--muted);margin-top:2px">Atualize para ter as últimas melhorias do Lumnis.</div>
    </div>
    <button onclick="_applyPWAUpdate()" style="background:var(--purple);color:#fff;border:none;border-radius:10px;padding:8px 14px;font-weight:700;cursor:pointer;font-size:0.82rem;white-space:nowrap">Atualizar</button>
    <button onclick="document.getElementById('pwa-update-popup')?.remove()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1.1rem;padding:4px 6px;flex-shrink:0">✕</button>
  `;
  document.body.appendChild(popup);
  window._pendingPWAWorker = worker;
}
function _applyPWAUpdate() {
  document.getElementById('pwa-update-popup')?.remove();

  // Antes: clicava e "nao acontecia nada" por varios segundos, porque o
  // controllerchange demora. Agora a tela cobre e da feedback — e se o
  // worker nao assumir em 6s, recarrega na marra.
  const tela = document.createElement('div');
  tela.id = 'pwa-updating';
  tela.innerHTML = `
    <div class="pu-box">
      <div class="pu-logo">L</div>
      <div class="pu-txt">Atualizando o Lumnis...</div>
      <div class="pu-barra"><div></div></div>
      <div class="pu-sub">Só um instante</div>
    </div>`;
  document.body.appendChild(tela);
  requestAnimationFrame(() => tela.classList.add('on'));

  let recarregou = false;
  const recarregar = () => { if (!recarregou) { recarregou = true; window.location.reload(); } };

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', recarregar, { once: true });
  }
  if (window._pendingPWAWorker) {
    window._pendingPWAWorker.postMessage({ type: 'SKIP_WAITING' });
  }
  setTimeout(recarregar, 6000);   // rede de seguranca
}


// ═══════════════════════════════════════════════════════════
// 👁️ LUMNIS PWA NOTIFICATIONS — Alertas de Fatura
// ═══════════════════════════════════════════════════════════
const _NOTIF_LOGO = 'https://raw.githubusercontent.com/nexusrugido-web/images1/main/lumnis-logo.png';
const _NOTIF_KEY  = 'lumnis_notif_';

async function _pedirPermissaoNotificacao() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const perm = await Notification.requestPermission();
  return perm === 'granted';
}

async function _mostrarNotificacaoFatura(fatura, diasRestantes) {
  const reg = await navigator.serviceWorker?.ready;
  if (!reg) return;
  const banco = fatura.banco || fatura.cartao || fatura.descricao || 'Cartão';
  const valor = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(+fatura.valor||0);
  const urgencia = diasRestantes === 0 ? '🔴 VENCE HOJE' : diasRestantes === 1 ? '🟠 Vence amanhã' : `🟡 Vence em ${diasRestantes} dias`;
  reg.showNotification(`👁️ Lumnis — Fatura Vencendo`, {
    body: `${urgencia}\n${banco} · ${valor}`,
    icon: _NOTIF_LOGO,
    badge: _NOTIF_LOGO,
    tag: `lumnis-fatura-${fatura.id}`,
    requireInteraction: diasRestantes <= 1,
    data: { faturaId: fatura.id, url: self?.location?.origin || '' },
    actions: [
      { action: 'ver', title: '📋 Ver Faturas' },
      { action: 'ok',  title: '✅ Ok, ciente' }
    ]
  });
}

async function verificarNotificacoesFaturas() {
  if (!allFaturas || allFaturas.length === 0) return;
  const temPermissao = await _pedirPermissaoNotificacao();
  if (!temPermissao) return;

  const hoje = new Date();
  hoje.setHours(0,0,0,0);
  const chaveHoje = _NOTIF_KEY + hoje.toISOString().substring(0,10);

  // Evitar spam: notificar só 1x por dia por fatura
  const jaNotificados = JSON.parse(localStorage.getItem(chaveHoje) || '[]');

  const faturasPendentes = allFaturas.filter(f => {
    if (!f.data_venc) return false;
    const venc = new Date(f.data_venc + 'T12:00:00');
    const diff = Math.round((venc - hoje) / 86400000);
    return diff >= 0 && diff <= 7 && !jaNotificados.includes(f.id);
  });

  if (faturasPendentes.length === 0) return;

  // Agrupa por urgência: hoje (0), amanhã (1), 3 dias, 7 dias
  const prioridade = (f) => {
    const venc = new Date(f.data_venc + 'T12:00:00');
    return Math.round((venc - hoje) / 86400000);
  };

  faturasPendentes.sort((a,b) => prioridade(a) - prioridade(b));

  // Mostra 1 notificação por fatura (até 3 por sessão para não spam)
  let count = 0;
  const notificados = [...jaNotificados];
  for (const fat of faturasPendentes) {
    if (count >= 3) break;
    const dias = prioridade(fat);
    await _mostrarNotificacaoFatura(fat, dias);
    notificados.push(fat.id);
    count++;
    await new Promise(r => setTimeout(r, 800)); // delay entre notificações
  }
  localStorage.setItem(chaveHoje, JSON.stringify(notificados));

  // Limpar chaves antigas (só manter últimos 7 dias)
  Object.keys(localStorage).filter(k => k.startsWith(_NOTIF_KEY)).forEach(k => {
    const dataKey = k.replace(_NOTIF_KEY,'');
    const diff = Math.round((hoje - new Date(dataKey)) / 86400000);
    if (diff > 7) localStorage.removeItem(k);
  });
}

// Ativa notificações ao abrir a aba de Faturas também
function _ativarNotifFaturas() {
  _pedirPermissaoNotificacao().then(ok => {
    if (ok) {
      setTimeout(verificarNotificacoesFaturas, 1500);
      if (typeof showToast === 'function') showToast('👁️ Notificações de fatura ativadas!', 'success');
    } else {
      if (typeof showToast === 'function') showToast('Permita notificações no browser para receber alertas de fatura', 'warn');
    }
  });
}


// Ouvir mensagem do SW quando usuário clica em notificação de fatura
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'NAV_FATURAS') {
      if (typeof switchTab === 'function') switchTab('faturas');
    }
  });
}

// ═══════════════════════════════════════════════════════════
// 📊 RELATÓRIO MENSAL — Envia sumário financeiro via n8n → Gmail
// ═══════════════════════════════════════════════════════════
const _RELATORIO_WEBHOOK = 'https://n8n.nexusrugido.com/webhook/lumnis-relatorio-mensal';

async function gerarRelatorioMensal() {
  const btn = document.getElementById('btn-relatorio');
  const btnOrig = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Gerando relatório...'; }

  try {
    const mes = (new Date()).toISOString().substring(0, 7);
    const mesLabel = new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date());

    // Coletar dados do mês atual
    const txMes = (allTx||[]).filter(t => (t.data||'').startsWith(mes));
    const gastosDiretos = txMes.filter(t=>t.tipo==='despesa').reduce((s,t)=>s+(+t.valor),0);
    const receitasMes   = txMes.filter(t=>t.tipo==='receita').reduce((s,t)=>s+(+t.valor),0);
    const gastosCartao  = (allFaturas||[]).filter(f=>(f.data_venc||'').startsWith(mes)).reduce((s,f)=>s+(+f.valor),0);
    const totalGasto    = gastosDiretos + gastosCartao;
    const meta          = userData?.meta_mensal || userData?.meta_gastos_mensal || 0;
    const pctMeta       = meta > 0 ? Math.round((totalGasto/meta)*100) : null;
    const modoRec       = !!(userData?.modo_receita);

    // Top 3 categorias de gasto
    const cats = {};
    txMes.filter(t=>t.tipo==='despesa').forEach(t => {
      cats[t.categoria||'Outros'] = (cats[t.categoria||'Outros']||0) + (+t.valor||0);
    });
    const topCats = Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,3)
      .map(([cat,val]) => cat + ': R$ ' + val.toFixed(2)).join(', ');

    // Faturas vencendo nos próximos 30 dias
    const hoje = new Date().toISOString().substring(0,10);
    const em30 = new Date(Date.now() + 30*86400000).toISOString().substring(0,10);
    const fatProximas = (allFaturas||[]).filter(f => f.data_venc >= hoje && f.data_venc <= em30);
    const fatResume = fatProximas.slice(0,5).map(f =>
      (f.banco||f.descricao||'Cartão') + ' · R$' + (+f.valor||0).toFixed(2) + ' · ' + (f.data_venc||'?')
    ).join(' | ') || 'Nenhuma';

    const payload = {
      userId: USER_ID,
      nome: userData?.nome || 'Usuário',
      email: userData?.email || '',
      mes: mesLabel,
      modoReceita: modoRec,
      gastosDiretos, receitasMes, gastosCartao, totalGasto, meta, pctMeta,
      topCategorias: topCats,
      streak: userData?.dias_consecutivos || 0,
      fatProximas: fatResume,
      timestamp: new Date().toISOString()
    };

    const resp = await fetch(_RELATORIO_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (resp.ok || resp.status < 500) {
      showToast('📊 Relatório enviado para ' + (userData?.email||'seu email') + '!', 'success');
    } else {
      showToast('❌ Erro ' + resp.status + ' ao enviar relatório.', 'error');
    }
  } catch(e) {
    showToast('❌ Sem conexão. Tente novamente.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = btnOrig || '📊 Enviar Relatório por Email'; }
  }
}


// ── MODAL FATURA MANUAL — cartões existentes ──────────────
function _mafPopularCartoes() {
  const sel = document.getElementById('maf-banco-select');
  if (!sel) return;
  const cartoes = window._faturasCartoes || {};
  // Limpar opções antigas (manter primeira)
  while (sel.options.length > 0) sel.remove(0);

  // Opção padrão
  const optDefault = document.createElement('option');
  optDefault.value = ''; optDefault.textContent = 'Escolher cartão existente...';
  sel.appendChild(optDefault);

  // Cartões existentes
  Object.entries(cartoes).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([nome, data]) => {
    const opt = document.createElement('option');
    opt.value = nome;
    opt.dataset.venc = data.venc || '';
    // Ícone do banco
    const icone = (typeof detectarBanco === 'function') ? detectarBanco(nome) : null;
    opt.textContent = (icone?.emoji || '💳') + ' ' + nome;
    sel.appendChild(opt);
  });

  // Opção para novo cartão
  const optNovo = document.createElement('option');
  optNovo.value = '__novo__';
  optNovo.textContent = '✏️ Digitar novo cartão...';
  sel.appendChild(optNovo);

  // Se veio de um modal de fatura, pré-selecionar o banco
  const bancoPreset = document.getElementById('modal-mes-fatura')?._ultimoBanco || '';
  if (bancoPreset && cartoes[bancoPreset]) {
    sel.value = bancoPreset;
    _mafSelecionarCartao(sel);
  } else if (Object.keys(cartoes).length > 0) {
    // Selecionar o primeiro cartão por padrão
    sel.selectedIndex = 1;
    _mafSelecionarCartao(sel);
  }
}

function _mafSelecionarCartao(sel) {
  const val = sel?.value || '';
  const novoWrap = document.getElementById('maf-banco-novo-wrap');
  const bancoValEl = document.getElementById('maf-banco-val');

  if (val === '__novo__') {
    // Mostrar input para digitar novo cartão
    if (novoWrap) { novoWrap.style.display = 'block'; }
    if (bancoValEl) bancoValEl.value = '';
    const inp = document.getElementById('maf-banco');
    if (inp) { inp.value = ''; inp.focus(); }
    return;
  }

  // Ocultar input de novo cartão
  if (novoWrap) novoWrap.style.display = 'none';
  if (bancoValEl) bancoValEl.value = val;

  if (!val) return;

  // Pré-preencher data de vencimento com o dia típico do cartão
  const cartoes = window._faturasCartoes || {};
  const cardData = cartoes[val];
  if (cardData?.venc) {
    const vencDate = new Date(cardData.venc + 'T12:00:00');
    const day = vencDate.getDate();
    const dataInput = document.getElementById('maf-data');
    if (dataInput) {
      const parts = (dataInput.value || '').split('-');
      if (parts.length === 3) {
        dataInput.value = parts[0] + '-' + parts[1] + '-' + String(day).padStart(2,'0');
      }
    }
  }
}

// Garantir que maf-banco-val é atualizado quando input texto muda
document.addEventListener('input', function(e) {
  if (e.target && e.target.id === 'maf-banco') {
    const v = document.getElementById('maf-banco-val');
    if (v) v.value = e.target.value;
  }
});


// ── Máscara monetária brasileira para campo de valor de fatura ──
function _mafFormatarValor(input) {
  // Remove tudo que não é dígito
  let raw = input.value.replace(/\D/g, '');
  if (!raw) { input.value = ''; input.dataset.raw = '0'; _mafAtualizarPreview(); return; }
  // Formata como centavos: 50000 → 500,00
  const cents = parseInt(raw, 10);
  const formatted = (cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  input.value = formatted;
  input.dataset.raw = (cents / 100).toString();
  _mafAtualizarPreview();
}

function _mafGetValor() {
  const el = document.getElementById('maf-valor');
  if (!el) return 0;
  // Tentar dataset.raw primeiro (formatado), senão parsear manualmente
  if (el.dataset.raw) return parseFloat(el.dataset.raw) || 0;
  // Fallback: remover pontos de milhar e trocar vírgula por ponto
  return parseFloat((el.value || '0').replace(/\./g, '').replace(',', '.')) || 0;
}


// ── Popular select de categorias no modal de fatura manual ──────
function _mafPopularCategorias() {
  const sel = document.getElementById('maf-categoria');
  if (!sel) return;

  // Base: categorias padrão do sistema
  const base = [
    { value: 'compras',     label: '🛍️ Compras'     },
    { value: 'alimentacao', label: '🍽️ Alimentação'  },
    { value: 'transporte',  label: '🚗 Transporte'   },
    { value: 'moradia',     label: '🏠 Moradia'      },
    { value: 'saude',       label: '🏥 Saúde'        },
    { value: 'lazer',       label: '🎮 Lazer'        },
    { value: 'assinaturas', label: '📱 Assinaturas'  },
    { value: 'educacao',    label: '📚 Educação'     },
    { value: 'pets',        label: '🐾 Pets'         },
    { value: 'outros',      label: '📦 Outros'       },
  ];

  // Mesclar com categorias customizadas do usuário (allCats)
  const userCats = (typeof allCats !== 'undefined' ? allCats : []) || [];
  const extra = userCats
    .filter(c => c.ativa !== false && !base.some(b => b.value === c.nome))
    .map(c => ({ value: c.nome, label: (c.emoji || '📦') + ' ' + c.nome.charAt(0).toUpperCase() + c.nome.slice(1) }));

  const todas = [...base, ...extra];

  // Reconstruir opções
  sel.innerHTML = '';
  todas.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.value;
    opt.textContent = cat.label;
    sel.appendChild(opt);
  });

  // Manter seleção atual se possível
  sel.value = sel.value || 'compras';
}




// ── Parse de valor monetário formatado em pt-BR ───────────────
function _parseBRLText(str) {
  if (!str) return 0;
  // Remove pontos de milhar e troca vírgula por ponto
  return parseFloat((str+'').replace(/\./g,'').replace(',','.')) || 0;
}


// ══════════════════════════════════════════════════════════
// ✨ SCROLL REVEAL — leve
// ══════════════════════════════════════════════════════════
(function() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!('IntersectionObserver' in window)) return;

  const obs = new IntersectionObserver((entradas) => {
    for (const e of entradas) {
      if (e.isIntersecting) { e.target.classList.add('rv-on'); obs.unobserve(e.target); }
    }
  }, { threshold: 0.05, rootMargin: '0px 0px -30px 0px' });

  // Menos seletores: so os blocos grandes. Animar cada linha de lista
  // era o que dava sensacao de travado.
  const SELETORES = '.card-sec, .ap-grupo, .perfil-menu button, .ap-resumo-item';

  let agendado = false;
  function observar() {
    // Uma passada por frame, no maximo. Antes rodava a cada mutacao do
    // DOM — em telas que renderizam muito, eram centenas de varreduras.
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(() => {
      agendado = false;
      const raiz = document.getElementById('app-main') || document;
      let i = 0;
      raiz.querySelectorAll(SELETORES).forEach(el => {
        if (el.dataset.rv) return;
        el.dataset.rv = '1';
        el.classList.add('rv');
        el.style.transitionDelay = Math.min(i++ * 28, 110) + 'ms';  // era ate 260ms
        obs.observe(el);
      });
    });
  }

  // Observa so o container do app, e sem subtree: mutacao interna de
  // card nao precisa disparar varredura.
  const alvo = document.getElementById('app-main');
  if (alvo) new MutationObserver(observar).observe(alvo, { childList: true });
  document.addEventListener('DOMContentLoaded', observar);
  setTimeout(observar, 400);
  window._rvObservar = observar;

  // Ao trocar de aba, o conteudo ja esta pronto: revela na hora, sem
  // esperar o observer. Era isso que dava atraso na troca de abas.
  window._rvRevelarJa = function(raiz) {
    (raiz || document).querySelectorAll('.rv').forEach(el => {
      el.style.transitionDelay = '0ms';
      el.classList.add('rv-on');
    });
  };
})();
