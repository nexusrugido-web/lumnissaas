// ════════════════════════════════════════════════════════════
// 08-sonhos-mapa.js — Mapa mental animado dos sonhos
// ════════════════════════════════════════════════════════════
//
// Substitui a lista seca por um mapa em órbita: no centro o motivo,
// em volta os sonhos girando, e no topo uma frase rotativa ligando
// educação financeira à realização deles.
// ════════════════════════════════════════════════════════════

const FRASES_EDU = [
  { t: 'Quem controla o dinheiro compra tempo. Quem não controla, vende o seu.', a: 'Educação financeira' },
  { t: 'Não é sobre ganhar mais. É sobre saber para onde vai o que você já ganha.', a: 'Primeiro princípio' },
  { t: 'Todo sonho tem um preço, um prazo e um plano. Sem os três, é só desejo.', a: 'A regra dos três' },
  { t: 'Orçamento não é prisão. É a permissão de gastar sem culpa no que importa.', a: 'Sobre limites' },
  { t: 'Cada real que você não desperdiça hoje é um dia a menos entre você e isso aqui.', a: 'Sobre constância' },
  { t: 'Rico não é quem tem muito. É quem precisa de pouco para viver o que quer.', a: 'Sobre liberdade' },
  { t: 'A pergunta certa não é "posso pagar?". É "isso me aproxima do que eu quero?".', a: 'Antes de comprar' },
  { t: 'Disciplina por seis meses vale mais que motivação por seis dias.', a: 'Sobre hábito' },
];

let _fraseIdx = 0;
let _fraseTimer = null;

function _sonhosLista() {
  const s = userData?.sonhos;
  if (Array.isArray(s)) return s;
  try { return JSON.parse(s || '[]'); } catch (e) { return []; }
}
function _sonhoTexto(s) {
  return (typeof s === 'string') ? s : (s.titulo || s.nome || s.name || s.texto || '');
}
function _sonhoEmoji(s) {
  return (typeof s === 'string') ? '🌟' : (s.emoji || '🌟');
}

// ── Mapa compacto, para a Home ────────────────────────────────
function renderMapaSonhos() {
  const el = document.getElementById('mapa-sonhos');
  if (!el) return;

  const sonhos = _sonhosLista().filter(s => _sonhoTexto(s));
  const nome = (userData?.nome || '').split(' ')[0] || 'Você';

  if (!sonhos.length) {
    el.innerHTML = `
      <div class="ms-vazio" onclick="switchTab('sonhos')">
        <div class="ms-vazio-ico">✨</div>
        <div>
          <div class="ms-vazio-t">Por que você está economizando?</div>
          <div class="ms-vazio-s">Registre um sonho e ele aparece aqui, girando ao seu redor</div>
        </div>
      </div>`;
    return;
  }

  const mostrar = sonhos.slice(0, 6);
  const R = 108;  // raio da órbita

  const nos = mostrar.map((s, i) => {
    const ang = (i / mostrar.length) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(ang) * R;
    const y = Math.sin(ang) * R * 0.62;   // órbita achatada, dá profundidade
    const txt = _sonhoTexto(s);
    return `
      <div class="ms-no" style="--x:${x.toFixed(1)}px; --y:${y.toFixed(1)}px; --d:${(i * 0.55).toFixed(2)}s"
           title="${txt.replace(/"/g,'&quot;')}">
        <div class="ms-no-bolha">
          <span class="ms-no-emoji">${_sonhoEmoji(s)}</span>
        </div>
        <div class="ms-no-txt">${txt.length > 22 ? txt.slice(0, 21) + '…' : txt}</div>
      </div>`;
  }).join('');

  const linhas = mostrar.map((_, i) => {
    const ang = (i / mostrar.length) * Math.PI * 2 - Math.PI / 2;
    const x2 = 50 + (Math.cos(ang) * R) / 3.4;
    const y2 = 50 + (Math.sin(ang) * R * 0.62) / 2.1;
    return `<line x1="50%" y1="50%" x2="${x2}%" y2="${y2}%"
             stroke="var(--purple)" stroke-width="1" stroke-dasharray="3 4"
             opacity="0.28" style="animation:msFluxo 3s linear infinite; animation-delay:${i*0.3}s"/>`;
  }).join('');

  el.innerHTML = `
    <div class="ms-frase" id="ms-frase"></div>

    <div class="ms-palco">
      <svg class="ms-linhas" viewBox="0 0 100 100" preserveAspectRatio="none">${linhas}</svg>
      <div class="ms-orbita">
        <div class="ms-centro">
          <div class="ms-centro-anel"></div>
          <div class="ms-centro-anel ms-anel2"></div>
          <div class="ms-centro-txt">
            <span class="ms-centro-nome">${nome}</span>
            <span class="ms-centro-sub">${sonhos.length} sonho${sonhos.length>1?'s':''}</span>
          </div>
        </div>
        ${nos}
      </div>
    </div>

    <button class="ms-ver" onclick="abrirMapaSonhosCompleto()">
      Ver o mapa completo ${sonhos.length > 6 ? `· +${sonhos.length - 6}` : ''} ›
    </button>`;

  _iniciarFrases('ms-frase');
}

function _iniciarFrases(idAlvo) {
  clearInterval(_fraseTimer);
  const pintar = () => {
    const el = document.getElementById(idAlvo);
    if (!el) { clearInterval(_fraseTimer); return; }
    const f = FRASES_EDU[_fraseIdx % FRASES_EDU.length];
    el.classList.remove('on');
    setTimeout(() => {
      el.innerHTML = `<span class="ms-aspas">"</span>${f.t}<span class="ms-autor">${f.a}</span>`;
      el.classList.add('on');
    }, 260);
    _fraseIdx++;
  };
  pintar();
  _fraseTimer = setInterval(pintar, 7000);
}

// ── Mapa completo, em tela cheia ──────────────────────────────
function abrirMapaSonhosCompleto() {
  const sonhos = _sonhosLista().filter(s => _sonhoTexto(s));
  const nome = (userData?.nome || '').split(' ')[0] || 'Você';

  let ov = document.getElementById('mapa-full');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'mapa-full';
    ov.onclick = e => { if (e.target === ov) fecharMapaSonhos(); };
    document.body.appendChild(ov);
  }

  const R = 150;
  const nos = sonhos.map((s, i) => {
    const ang = (i / Math.max(sonhos.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const raio = R + (i % 2 ? 34 : 0);      // dois anéis, evita amontoar
    const x = Math.cos(ang) * raio;
    const y = Math.sin(ang) * raio * 0.72;
    const txt = _sonhoTexto(s);
    return `
      <div class="mf-no" style="--x:${x.toFixed(1)}px; --y:${y.toFixed(1)}px; --d:${(i*0.4).toFixed(2)}s">
        <div class="mf-no-bolha"><span>${_sonhoEmoji(s)}</span></div>
        <div class="mf-no-txt">${txt}</div>
      </div>`;
  }).join('');

  ov.innerHTML = `
    <button class="mf-fechar" onclick="fecharMapaSonhos()" aria-label="Fechar">✕</button>
    <div class="mf-frase" id="mf-frase"></div>
    <div class="mf-palco">
      <div class="mf-centro">
        <div class="mf-anel"></div><div class="mf-anel mf-anel2"></div><div class="mf-anel mf-anel3"></div>
        <div class="mf-centro-txt">
          <span class="mf-nome">${nome}</span>
          <span class="mf-sub">${sonhos.length ? 'o que te move' : 'sem sonhos ainda'}</span>
        </div>
      </div>
      ${nos}
    </div>
    <div class="mf-rodape">
      <p>Cada real que você não desperdiça é um passo em direção a um destes.</p>
      <button onclick="fecharMapaSonhos();switchTab('sonhos')">Gerenciar sonhos</button>
    </div>`;

  requestAnimationFrame(() => ov.classList.add('on'));
  _iniciarFrases('mf-frase');
  document.body.classList.add('modal-open');
}

function fecharMapaSonhos() {
  const ov = document.getElementById('mapa-full');
  if (ov) { ov.classList.remove('on'); setTimeout(() => ov.remove(), 260); }
  document.body.classList.remove('modal-open');
  _iniciarFrases('ms-frase');
}
