// ════════════════════════════════════════════════════════════
// 06-onboarding.js — Quiz inicial no app + aviso de teste grátis
// ════════════════════════════════════════════════════════════
//
// Substitui o onboarding por conversa no WhatsApp. A fonte não importa:
// se o bot já preencheu renda/meta, o quiz reconhece e pula direto.
// ════════════════════════════════════════════════════════════

let _obPasso = 0;
let _obDados = { renda: 0, meta: 0, categorias: {}, sonhos: [] };

// ── Já passou pelo onboarding, por qualquer caminho? ──────────
function onboardingCompleto(u) {
  if (!u) return true;
  if (u.onboarding_completo === true) return true;
  // Bot do WhatsApp pode ter preenchido antes: se já tem renda e meta,
  // consideramos concluído e não repetimos a pergunta.
  const temRenda = +(u.renda_mensal || 0) > 0;
  const temMeta  = +(u.meta_mensal || u.meta_gastos_mensal || 0) > 0;
  return temRenda && temMeta;
}

function iniciarOnboarding() {
  if (MODO_LEITURA) return;
  _obPasso = 0;
  _obDados = {
    renda: +(userData?.renda_mensal || 0),
    meta:  +(userData?.meta_mensal || userData?.meta_gastos_mensal || 0),
    categorias: {},
    sonhos: []
  };
  _obRender();
}

function _obEl() {
  let el = document.getElementById('onboarding-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'onboarding-overlay';
    document.body.appendChild(el);
  }
  return el;
}

function _obFechar() {
  document.getElementById('onboarding-overlay')?.remove();
}

const _OB_CATS = [
  { nome: 'alimentacao', label: 'Alimentação', emoji: '🍽️', pct: 0.30 },
  { nome: 'transporte',  label: 'Transporte',  emoji: '🚗', pct: 0.15 },
  { nome: 'moradia',     label: 'Moradia',     emoji: '🏠', pct: 0.30 },
  { nome: 'lazer',       label: 'Lazer',       emoji: '🎮', pct: 0.10 },
  { nome: 'saude',       label: 'Saúde',       emoji: '💊', pct: 0.15 },
];

function _obRender() {
  const el = _obEl();
  const nome = (userData?.nome || '').split(' ')[0] || 'você';
  const total = 5;

  const barra = `
    <div class="ob-progress">
      ${Array.from({length: total}, (_, i) =>
        `<span class="${i <= _obPasso ? 'on' : ''}"></span>`).join('')}
    </div>`;

  let corpo = '';

  // ── 0. Boas-vindas ──────────────────────────────────────────
  if (_obPasso === 0) {
    corpo = `
      <div class="ob-emoji">👋</div>
      <h2>Oi, ${nome}!</h2>
      <p>Vou te fazer 4 perguntas rápidas pra deixar o Lumnis do seu jeito.
         Leva menos de um minuto. Depois você muda o que quiser, inclusive criar e editar suas próprias categorias.</p>
      <button class="ob-btn" onclick="_obProximo()">Bora começar</button>
      <button class="ob-skip" onclick="_obPular()">Agora não</button>`;
  }

  // ── 1. Renda ────────────────────────────────────────────────
  else if (_obPasso === 1) {
    corpo = `
      <div class="ob-emoji">💰</div>
      <h2>Quanto entra por mês?</h2>
      <p>Some salário, freelas, tudo. É a base pra calcular seus limites —
         e fica só entre nós.</p>
      <div class="ob-campo">
        <span>R$</span>
        <input id="ob-renda" inputmode="decimal" placeholder="0,00"
               value="${_obDados.renda ? _obDados.renda.toLocaleString('pt-BR',{minimumFractionDigits:2}) : ''}"
               oninput="_fmtMoneyLive(this)" autofocus>
      </div>
      <div id="ob-erro" class="ob-erro"></div>
      <button class="ob-btn" onclick="_obProximo()">Continuar</button>
      <button class="ob-voltar" onclick="_obVoltar()">Voltar</button>`;
  }

  // ── 2. Meta de gastos ───────────────────────────────────────
  else if (_obPasso === 2) {
    const sugestao = Math.round(_obDados.renda * 0.7);
    corpo = `
      <div class="ob-emoji">🎯</div>
      <h2>Quanto quer gastar, no máximo?</h2>
      <p>Sua renda é ${BRL(_obDados.renda)}. Uma meta saudável costuma ficar
         em torno de 70% dela — o resto vira folga.</p>
      <div class="ob-campo">
        <span>R$</span>
        <input id="ob-meta" inputmode="decimal" placeholder="0,00"
               value="${(_obDados.meta || sugestao).toLocaleString('pt-BR',{minimumFractionDigits:2})}"
               oninput="_fmtMoneyLive(this)" autofocus>
      </div>
      <button class="ob-sugestao" onclick="_obUsarSugestao(${sugestao})">
        Usar sugestão: ${BRL(sugestao)}
      </button>
      <div id="ob-erro" class="ob-erro"></div>
      <button class="ob-btn" onclick="_obProximo()">Continuar</button>
      <button class="ob-voltar" onclick="_obVoltar()">Voltar</button>`;
  }

  // ── 3. Limites por categoria ────────────────────────────────
  else if (_obPasso === 3) {
    const linhas = _OB_CATS.map(c => {
      const val = _obDados.categorias[c.nome] ?? Math.round(_obDados.meta * c.pct);
      return `
        <div class="ob-cat">
          <span class="ob-cat-emoji">${c.emoji}</span>
          <span class="ob-cat-nome">${c.label}</span>
          <div class="ob-cat-campo">
            <span>R$</span>
            <input inputmode="decimal" data-cat="${c.nome}"
                   value="${val.toLocaleString('pt-BR',{minimumFractionDigits:2})}"
                   oninput="_fmtMoneyLive(this);_obSomarCats()">
          </div>
        </div>`;
    }).join('');
    corpo = `
      <div class="ob-emoji">📚</div>
      <h2>Onde esse dinheiro vai?</h2>
      <p>Já dividi sua meta de ${BRL(_obDados.meta)} de um jeito comum.
         Ajuste o que não bater com sua vida — e depois, no app, você pode
         mudar esses valores, criar categorias novas ou editar as que já existem.</p>
      <div class="ob-cats">${linhas}</div>
      <div id="ob-soma" class="ob-soma"></div>
      <button class="ob-btn" onclick="_obProximo()">Continuar</button>
      <button class="ob-voltar" onclick="_obVoltar()">Voltar</button>`;
  }

  // ── 4. Sonhos ───────────────────────────────────────────────
  else if (_obPasso === 4) {
    corpo = `
      <div class="ob-emoji">✨</div>
      <h2>Pra que serve esse controle?</h2>
      <p>Economizar sem motivo cansa. Escreva o que você quer conquistar —
         aparece no app pra lembrar você nos dias difíceis.</p>
      <input class="ob-sonho" id="ob-sonho-1" placeholder="Ex: o carro dos sonhos" maxlength="60">
      <input class="ob-sonho" id="ob-sonho-2" placeholder="Ex: a viagem dos sonhos" maxlength="60">
      <input class="ob-sonho" id="ob-sonho-3" placeholder="Ex: liberdade financeira" maxlength="60">
      <button class="ob-btn" onclick="_obFinalizar()">Finalizar</button>
      <button class="ob-voltar" onclick="_obVoltar()">Voltar</button>`;
  }

  el.innerHTML = `<div class="ob-card">${barra}${corpo}</div>`;
  setTimeout(() => el.querySelector('input[autofocus]')?.focus(), 120);
  if (_obPasso === 3) _obSomarCats();
}

function _obUsarSugestao(v) {
  const el = document.getElementById('ob-meta');
  if (el) { el._numVal = v; el.value = v.toLocaleString('pt-BR',{minimumFractionDigits:2}); }
}

function _obSomarCats() {
  const inputs = document.querySelectorAll('#onboarding-overlay input[data-cat]');
  let soma = 0;
  inputs.forEach(i => { soma += _getNumVal(i); });
  const el = document.getElementById('ob-soma');
  if (!el) return;
  const dif = _obDados.meta - soma;
  el.innerHTML = dif >= 0
    ? `Somando ${BRL(soma)} — sobram <strong style="color:var(--green)">${BRL(dif)}</strong> pra outras coisas`
    : `Somando ${BRL(soma)} — <strong style="color:var(--red)">${BRL(-dif)} acima</strong> da sua meta`;
}

function _obVoltar() { if (_obPasso > 0) { _obPasso--; _obRender(); } }

function _obErro(msg) {
  const el = document.getElementById('ob-erro');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function _obProximo() {
  if (_obPasso === 1) {
    const v = _getNumVal('ob-renda');
    if (v <= 0) return _obErro('Informe um valor maior que zero.');
    _obDados.renda = v;
  }
  if (_obPasso === 2) {
    const v = _getNumVal('ob-meta');
    if (v <= 0) return _obErro('Informe um valor maior que zero.');
    // Regra pedida: a meta de gastos nao pode passar da renda.
    if (v > _obDados.renda) {
      return _obErro(`Sua meta (${BRL(v)}) ficou acima da renda (${BRL(_obDados.renda)}). Isso vira dívida todo mês.`);
    }
    _obDados.meta = v;
  }
  if (_obPasso === 3) {
    document.querySelectorAll('#onboarding-overlay input[data-cat]').forEach(i => {
      _obDados.categorias[i.dataset.cat] = _getNumVal(i);
    });
  }
  _obPasso++;
  _obRender();
}

async function _obPular() {
  _obFechar();
  showToast('Sem problema. Você configura no Perfil quando quiser.');
  setTimeout(() => { try { iniciarTour(); } catch(e){ console.error(e); } }, 350);
  await sb.from('usuarios').update({ onboarding_step: 1 }).eq('id', USER_ID);
}

async function _obFinalizar() {
  ['1','2','3'].forEach(n => {
    const v = (document.getElementById('ob-sonho-' + n)?.value || '').trim();
    if (v) _obDados.sonhos.push({ titulo: v, emoji: '🌟', criado: today() });
  });

  const btn = document.querySelector('#onboarding-overlay .ob-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

  try {
    const { error } = await sb.from('usuarios').update({
      renda_mensal: _obDados.renda,
      meta_mensal: _obDados.meta,
      meta_gastos_mensal: _obDados.meta,
      sonhos: _obDados.sonhos,
      onboarding_completo: true,
      onboarding_step: 99
    }).eq('id', USER_ID);
    if (error) throw error;

    // Limites por categoria: cria a categoria se ainda nao existir
    for (const [nome, limite] of Object.entries(_obDados.categorias)) {
      if (!(limite > 0)) continue;
      const existente = (allCats || []).find(c => c.nome === nome);
      const conf = _OB_CATS.find(c => c.nome === nome);
      if (existente) {
        await sb.from('categorias').update({ limite_mensal: limite }).eq('id', existente.id);
      } else {
        await sb.from('categorias').insert({
          user_id: USER_ID, nome, limite_mensal: limite,
          emoji: conf?.emoji || '📦', ativa: true
        });
      }
    }

    Object.assign(userData, {
      renda_mensal: _obDados.renda,
      meta_mensal: _obDados.meta,
      sonhos: _obDados.sonhos,
      onboarding_completo: true
    });

    const { data: cats } = await sb.from('categorias')
      .select('*').eq('user_id', USER_ID).eq('ativa', true);
    if (cats) allCats = cats;

    _obFechar();
    _obCelebrar();
  } catch (e) {
    console.error('[Lumnis] onboarding:', e);
    if (btn) { btn.disabled = false; btn.textContent = 'Finalizar'; }
    _obErro('Não consegui salvar. Verifique a conexão e tente de novo.');
  }
}

function _obCelebrar() {
  const nome = (userData?.nome || '').split(' ')[0] || '';
  const el = _obEl();
  el.innerHTML = `
    <div class="ob-card">
      <div class="ob-emoji">🎉</div>
      <h2>Pronto${nome ? ', ' + nome : ''}!</h2>
      <p>Seu limite é <strong>${BRL(_obDados.meta)}</strong> por mês.
         Agora é só registrar os gastos — pelo botão <strong>+</strong> aqui
         ou mandando mensagem no WhatsApp.</p>
      <button class="ob-btn" onclick="_obConcluir()">Ver meu painel</button>
    </div>`;
}

function _obConcluir() {
  _obFechar();
  // o tour comeca logo apos o quiz
  setTimeout(() => { try { iniciarTour(); } catch(e){ console.error(e); } }, 350);
  if (typeof renderHome === 'function') renderHome(userData);
  if (typeof renderLimiteMesCard === 'function') renderLimiteMesCard();
  if (typeof renderOndeFoiDinheiro === 'function') renderOndeFoiDinheiro();
}

// ════════════════════════════════════════════════════════════
// ⏳ AVISO DE TESTE GRÁTIS
// ════════════════════════════════════════════════════════════
function renderAvisoTrial() {
  const alvo = document.getElementById('trial-aviso-slot');
  const existente = document.getElementById('trial-aviso');
  if (existente) existente.remove();

  if (!userData || MODO_LEITURA) return;
  if (userData.plano !== 'trial') return;
  const fim = userData.trial_fim;
  if (!fim) return;

  const dias = Math.ceil((new Date(fim + 'T12:00:00') - new Date(today() + 'T12:00:00')) / 86400000);
  if (dias < 0) return;

  const urgente = dias <= 2;
  const txt = dias === 0 ? 'Último dia do seu teste'
            : dias === 1 ? 'Falta 1 dia de teste'
            : `Faltam ${dias} dias de teste`;

  const div = document.createElement('div');
  div.id = 'trial-aviso';
  div.className = 'trial-aviso' + (urgente ? ' urgente' : '');
  div.innerHTML = `
    <div class="ta-topo">
      <span class="ta-ico">${urgente ? '⏳' : '🎁'}</span>
      <div class="ta-txt">
        <div class="ta-titulo">${txt}</div>
        <div class="ta-sub">Acesso completo até ${fmtDate(fim)}</div>
      </div>
      <a href="${linkAssinatura()}" target="_blank" rel="noopener" class="ta-btn">${rotuloAssinatura()}</a>
    </div>
    <div class="ta-barra"><div style="width:${Math.max(4, (dias / 7) * 100)}%"></div></div>`;

  const host = alvo || document.getElementById('app-main');
  if (host === alvo) host.appendChild(div);
  else host?.insertBefore(div, host.firstChild);
}

// ════════════════════════════════════════════════════════════
// 🎓 TOUR — roda depois do quiz, pode ser pulado
// ════════════════════════════════════════════════════════════
let _tourPasso = 0;

const _TOUR = [
  {
    emoji: '🔒',
    titulo: 'Antes de tudo: seus dados',
    html: `
      <p>Você está prestes a registrar informações sobre o seu dinheiro.
         É justo saber exatamente o que acontece com elas.</p>
      <ul class="tour-lista">
        <li><b>Não pedimos senha de banco.</b> Nunca. Se alguém pedir, não somos nós.</li>
        <li><b>Não conectamos à sua conta bancária.</b> O Lumnis não tem — e não quer ter — acesso ao seu banco.</li>
        <li><b>Você digita o que quiser.</b> Nada é puxado automaticamente de lugar nenhum.</li>
        <li><b>Só você enxerga seus lançamentos.</b> O banco de dados isola por usuário; nem outro cliente nem nossa equipe vê seus números.</li>
        <li><b>Nada é vendido.</b> Sem anunciante, sem revenda de dado, sem treino de IA com o seu histórico.</li>
      </ul>
      <p class="tour-nota">Pode apagar sua conta e todos os dados quando quiser, direto no Perfil.
         Detalhes em <a href="/privacidade.html" target="_blank" rel="noopener">Política de Privacidade</a>.</p>`
  },
  {
    emoji: '➕',
    titulo: 'Registrar leva 5 segundos',
    html: `<p>O botão <b>+</b> no canto abre o registro. Valor, categoria, pronto.</p>
           <p>Se preferir, mande mensagem no <b>WhatsApp</b>: "gastei 30 no almoço"
              e o lançamento aparece aqui sozinho.</p>`
  },
  {
    emoji: '🔥',
    titulo: 'O mapa de calor',
    html: `<p>Na Home, cada quadradinho é um dia do mês. Quanto mais forte a cor,
              mais você gastou naquele dia.</p>
           <p>É o jeito mais rápido de perceber padrão — aquela sexta que sempre pesa,
              o dia seguinte ao pagamento.</p>`
  },
  {
    emoji: '📅',
    titulo: 'A pagar',
    html: `<p>Tudo que <b>ainda vai sair</b> mora numa aba só: contas do mês,
              assinaturas e faturas do cartão, em ordem de vencimento.</p>
           <p>Marcou como paga, vira lançamento no Extrato automaticamente.
              Você não digita duas vezes.</p>`
  },
  {
    emoji: '🤖',
    titulo: 'Sua assistente',
    html: `<p>O robô ao lado do seu nome abre o chat. Ela enxerga seus números
              e responde perguntas de verdade.</p>
           <p>"Onde posso cortar esse mês?", "Quais assinaturas não uso?" —
              pergunte como perguntaria a um amigo que entende de finanças.</p>`
  },
];

function iniciarTour() {
  if (localStorage.getItem('lumnis_tour_ok') === '1') return;
  _tourPasso = 0;
  _tourRender();
}

function _tourRender() {
  let el = document.getElementById('tour-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tour-overlay';
    document.body.appendChild(el);
  }
  const p = _TOUR[_tourPasso];
  const ultimo = _tourPasso === _TOUR.length - 1;
  const primeiro = _tourPasso === 0;

  el.innerHTML = `
    <div class="tour-card">
      <div class="tour-prog">
        ${_TOUR.map((_, i) => `<span class="${i <= _tourPasso ? 'on' : ''}"></span>`).join('')}
      </div>
      <div class="tour-emoji">${p.emoji}</div>
      <h2>${p.titulo}</h2>
      <div class="tour-corpo">${p.html}</div>
      <div class="tour-acoes">
        ${primeiro ? '' : '<button class="tour-voltar" onclick="_tourVoltar()">Voltar</button>'}
        <button class="tour-btn" onclick="${ultimo ? '_tourFim()' : '_tourProx()'}">
          ${primeiro ? 'Entendi, continuar' : ultimo ? 'Começar a usar' : 'Próximo'}
        </button>
      </div>
      <button class="tour-pular" onclick="_tourFim()">Pular tutorial</button>
    </div>`;
  requestAnimationFrame(() => el.classList.add('on'));
}

function _tourProx()   { _tourPasso++; _tourRender(); }
function _tourVoltar() { if (_tourPasso > 0) { _tourPasso--; _tourRender(); } }

function _tourFim() {
  try { localStorage.setItem('lumnis_tour_ok', '1'); } catch (e) {}
  const el = document.getElementById('tour-overlay');
  if (el) { el.classList.remove('on'); setTimeout(() => el.remove(), 220); }
}
