// ════════════════════════════════════════
// 01-core.js — Config, Globals, Auth, Helpers
// ════════════════════════════════════════

// =====================================================
//  CONFIG
// =====================================================
const SUPABASE_URL      = 'https://grfwvsedbftvkhkeswck.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdyZnd2c2VkYmZ0dmtoa2Vzd2NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyOTgzMDQsImV4cCI6MjA4OTg3NDMwNH0.qqMxzjBPs5hJNeT67P-Ygyx5nryUNE3UNJJsbeiG23o';

// =====================================================
//  GLOBALS
// =====================================================
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ══════════════════════════════════════════════════════════
// BANCO CACHE — persiste banco por importacao_id via localStorage
// ══════════════════════════════════════════════════════════
const BANCO_CACHE_KEY = 'lumnis_banco_cache';
function getBancoCache() {
  try { return JSON.parse(localStorage.getItem(BANCO_CACHE_KEY) || '{}'); } catch { return {}; }
}
function setBancoCacheEntry(importacaoId, bancoNome) {
  const cache = getBancoCache();
  cache[importacaoId] = bancoNome;
  try { localStorage.setItem(BANCO_CACHE_KEY, JSON.stringify(cache)); } catch {}
}

let USER_ID    = null;
let userData   = null;
let allTx      = [];
let allCats    = [];
let msgDays30  = new Set();
let allDesafios = [];
let allFaturas  = [];
let txFilter   = 'todos';
let MODO_LEITURA = false;   // trial/assinatura vencida: ve os dados, nao lanca

// Guarda usada no inicio de toda funcao que grava.
// A trava REAL esta no trigger do Postgres (05-trial-readonly.sql);
// isto aqui e so para dar um aviso decente em vez de erro de banco.
function bloqueadoPorTrial() {
  if (!MODO_LEITURA) return false;
  showToast('Seu periodo de acesso terminou. Renove para voltar a lancar.', 'error');
  if (typeof abrirModalUpgrade === 'function') abrirModalUpgrade();
  return true;
}
let chartDonut = null;
let chartLine  = null;

// =====================================================
//  UTILS
// =====================================================
const BRL = v => {
  const n = +(v||0);
  return 'R$ ' + n.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
};
// Formato compacto para números grandes (K/M)
const BRLk = v => {
  const n = Math.abs(+(v||0));
  const sign = +(v||0) < 0 ? '-' : '';
  if (n >= 1000000) return sign + 'R$ ' + (n/1000000).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'M';
  if (n >= 1000)    return sign + 'R$ ' + (n/1000).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'k';
  return sign + 'R$ ' + n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
};


// MONTHS_PT e MONTHS_FULL definidos abaixo na seção de navegação por mês

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
}
function today()      { return new Date().toISOString().split('T')[0]; }
function monthStart() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; }

// ── Máscara de moeda para inputs ──────────────────────────────────────────────
// Transforma type=number em input formatado: "R$ 6.000,00"
function _mascaraMoeda(el) {
  if (!el || el._mascaraAtivada) return;
  el._mascaraAtivada = true;
  el.type = 'text';
  el.inputMode = 'decimal';
  function formatar(v) {
    const num = parseInt(String(v).replace(/\D/g,'')) || 0;
    el._numVal = num / 100;
    el.value = (num / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  el.addEventListener('input', function() { formatar(this.value); });
  el.addEventListener('focus', function() {
    // seleciona tudo ao focar para facilitar reescrita
    setTimeout(() => this.select(), 10);
  });
  // inicializa com valor existente se houver
  if (el.value && parseFloat(el.value) > 0) formatar(parseFloat(el.value) * 100);
}
// ── Máscara monetária dos inputs (pt-BR) ─────────────────────────
// Estas três funções são chamadas inline pelo HTML em 6 campos
// (tx-valor, meta-input, emp-valor, emp-valor-combinado,
//  res-valor-deposito, res-valor-meta) mas NAO existiam: cada tecla
// digitada lançava ReferenceError e o valor ficava cru ("1100").
// _parseValorBR também faltava, e era usada pelo saveTx.

function _fmtMoneyLive(el) {
  if (!el) return;
  const dig = String(el.value).replace(/\D/g, '');
  if (!dig) { el.value = ''; el._numVal = 0; return; }
  const n = parseInt(dig, 10) / 100;
  el._numVal = n;
  el.value = n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _fmtMoneyBlur(el) {
  if (!el) return;
  if (!el.value.trim()) { el._numVal = 0; return; }
  const n = _getNumVal(el);
  el._numVal = n;
  el.value = n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _parseValorBR(idOrEl, fallback = 0) {
  const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
  if (!el) return fallback;
  const n = _getNumVal(el);
  return (isFinite(n) && n > 0) ? n : fallback;
}

function _getNumVal(idOrEl) {
  const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
  if (!el) return 0;
  if (el._numVal !== undefined) return el._numVal;
  const raw = el.value.replace(/\./g,'').replace(',','.');
  return parseFloat(raw) || 0;
}
// Aplica máscara automaticamente ao mostrar a tela de reserva e empréstimos
document.addEventListener('DOMContentLoaded', () => {
  ['res-valor-deposito','res-valor-meta','emp-valor','emp-valor-combinado','meta-input'].forEach(id => {
    const el = document.getElementById(id);
    if (el) _mascaraMoeda(el);
  });
});

const MONTHS_FULL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MONTHS_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const CAT_EMOJI = {
  alimentacao:'🍽️', transporte:'🚗', saude:'💊', lazer:'🎮', educacao:'📚',
  moradia:'🏠', vestuario:'👕', roupa:'👕', streaming:'📺', assinaturas:'📦',
  salario:'💼', freela:'💻', freelance:'💻', outros:'📌', investimento:'📈',
  cartao:'💳', compras:'🛍️', shopping:'🛍️', ferramenta:'🔧', ferramentas:'🔧',
  software:'💻', servico:'🔧', servicos:'🔧', chat:'💬', comunicacao:'💬',
  pets:'🐾', animal:'🐾', viagem:'✈️', academia:'💪', fitness:'💪',
  farmacia:'💊', medico:'🩺', telefone:'📱', internet:'🌐', gas:'🔥',
  agua:'💧', energia:'⚡', luz:'⚡', presente:'🎁', festa:'🎉', bar:'🍺',
  restaurante:'🍽️', ifood:'🛵', delivery:'🛵', mercado:'🛒', supermercado:'🛒',
  uber:'🚗', combustivel:'⛽', gasolina:'⛽', seguro:'🛡️', imposto:'📋',
  aluguel:'🏠', condominio:'🏢', curso:'📖', livro:'📚', musica:'🎵',
  cinema:'🎬', jogo:'🎮', games:'🎮', beleza:'💄', cabelo:'✂️', salao:'✂️',
  conta:'📋', boleto:'📋', cartorio:'📋', advogado:'⚖️', consultoria:'💼'
};
function emojiFor(cat) {
  const k = (cat||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  for (const key of Object.keys(CAT_EMOJI)) { if(k.includes(key)) return CAT_EMOJI[key]; }
  return '💸';
}

function countUp(el, target, duration=1000) {
  const start = Date.now();
  function step() {
    const p = Math.min((Date.now()-start)/duration,1);
    const ease = 1-Math.pow(1-p,3);
    el.textContent = Math.round(ease*target);
    if(p<1) requestAnimationFrame(step);
  }
  step();
}

function getToken() {
  // Apenas aceita token via URL (para link de ativação inicial)
  // Cross-device auth funciona via Supabase Auth (persistSession=true salva no localStorage do SDK)
  const p = new URLSearchParams(window.location.search);
  return p.get('token') || p.get('u') || p.get('uid') || null;
}

function clearToken() {
  localStorage.removeItem('lumnis_token'); // legado — mantém para não quebrar sessões antigas
}

// Elementos da "casca" do app — só existem depois de autenticar
const APP_CHROME = ['app-main','app-nav','add-tx-btn','wa-btn',
                    'fab-menu','fab-menu-overlay','pwa-banner'];

function hideAppChrome() {
  APP_CHROME.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  document.body.classList.remove('modal-open');
}

function showScreen(id) {
  ['screen-lock','screen-expired','screen-loading'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = 'none';
  });
  // Mostrar QUALQUER tela cheia significa que o usuário não está no app:
  // esconde o cabeçalho, o menu e o FAB. Sem isto, qualquer caminho que
  // caia no screen-lock depois do loadDashboard deixa a casca visível
  // por cima da tela de login.
  if (id) {
    hideAppChrome();
    const el = document.getElementById(id);
    if (el) el.style.display = 'flex';
  }
}

function showToast(msg, type='success') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--card);border:1px solid var(--border2);border-radius:14px;padding:11px 20px;font-size:0.82rem;font-weight:700;z-index:999;opacity:0;transition:all 0.3s;white-space:nowrap;box-shadow:0 8px 24px rgba(0,0,0,0.4);font-family:var(--font-body)';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.borderColor = type==='error' ? 'rgba(255,110,132,0.4)' : 'rgba(155,255,206,0.4)';
  el.style.color = type==='error' ? 'var(--red)' : 'var(--green)';
  el.style.opacity='1'; el.style.transform='translateX(-50%) translateY(0)';
  clearTimeout(el._t);
  el._t = setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateX(-50%) translateY(20px)'; }, 2500);
}

// =====================================================
//  ★ STREAK MESSAGES
// =====================================================
function getStreakMessage(dias) {
  if (dias === 0) return { emoji: '🌱', text: 'Registre seu primeiro gasto hoje e acenda sua chama financeira!' };
  if (dias === 1) return { emoji: '🌱', text: 'Primeiro dia! Toda grande jornada começa com um único passo. Você deu o seu!' };
  if (dias === 2) return { emoji: '✌️', text: 'Dois dias seguidos! A semente do hábito está brotando. Não deixe apagar!' };
  if (dias === 3) return { emoji: '🔥', text: 'Três dias! Seu cérebro já está começando a criar uma nova rotina. Isso é real!' };
  if (dias === 4) return { emoji: '🔥', text: 'Quatro dias de consistência! Poucos chegam aqui. Você não é mais a maioria.' };
  if (dias === 5) return { emoji: '🔥', text: 'Cinco dias! Você está superando a resistência inicial. O pior já passou!' };
  if (dias === 6) return { emoji: '🔥', text: 'Seis dias! Amanhã é uma semana. Você vai chegar lá, eu sei.' };
  if (dias === 7) return { emoji: '🎉', text: 'UMA SEMANA COMPLETA! 🎉 Você provou que tem disciplina. Celebre — depois continue!' };
  if (dias >= 8  && dias <= 9)  return { emoji: '💪', text: `${dias} dias! Você ultrapassou a semana e não parou. Isso diz muito sobre você.` };
  if (dias >= 10 && dias <= 13) return { emoji: '💪', text: `${dias} dias! Você já está no top 10% de quem começa. Isso não é sorte, é caráter!` };
  if (dias === 14) return { emoji: '⚡', text: 'DUAS SEMANAS! Você é diferente. Poucas pessoas chegam até aqui. Continue sendo extraordinário(a)!' };
  if (dias >= 15 && dias <= 20) return { emoji: '🚀', text: `${dias} dias de ofensiva! Seu futuro financeiro está sendo construído agora, tijolo por tijolo.` };
  if (dias === 21) return { emoji: '🧠', text: 'TRÊS SEMANAS! A ciência confirma: um novo hábito está formado. Você venceu a resistência!' };
  if (dias >= 22 && dias <= 29) return { emoji: '✨', text: `${dias} dias! Você está a passos de um mês histórico. Não deixe a chama apagar agora!` };
  if (dias === 30) return { emoji: '🏆', text: 'UM MÊS COMPLETO! 🏆 Isso é extraordinário. Você não só mudou um hábito — mudou quem você é!' };
  if (dias >= 31 && dias <= 44) return { emoji: '🏆', text: `${dias} dias de ofensiva imparável! Você é prova viva de que disciplina transforma destinos.` };
  if (dias === 45) return { emoji: '👑', text: '45 dias! Você está na elite. Menos de 1% das pessoas mantém um hábito por tanto tempo.' };
  if (dias >= 46 && dias <= 59) return { emoji: '👑', text: `${dias} dias! Quase dois meses de consistência. Seu eu do futuro está muito grato por isso.` };
  if (dias === 60) return { emoji: '👑', text: 'DOIS MESES! Você não é só disciplinado(a) — você é uma inspiração para todos ao redor!' };
  if (dias >= 61 && dias <= 89) return { emoji: '💎', text: `${dias} dias de consistência absoluta. Você está moldando uma identidade financeira irresistível.` };
  if (dias === 90) return { emoji: '💎', text: 'TRÊS MESES! 💎 Lendário. Você transformou um hábito em identidade. Isso é para sempre!' };
  if (dias >= 91 && dias <= 99) return { emoji: '💎', text: `${dias} dias! A caminho dos 100. Uma marca que pouquíssimas pessoas alcançaram.` };
  if (dias === 100) return { emoji: '🌟', text: '100 DIAS! 🌟 Uma marca histórica. Você é inspiração para quem está começando. Obrigado por existir assim!' };
  return { emoji: '🌟', text: `${dias} dias de ofensiva. Você é lendário(a). Obrigado por mostrar que é possível. 💜` };
}

// =====================================================
//  AUTH - LOGIN COM SUPABASE AUTH
// =====================================================
async function doLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const btn      = document.getElementById('login-btn');
  const errEl    = document.getElementById('login-error');

  errEl.style.display = 'none';
  if (!email || !password) {
    errEl.textContent = 'Preencha e-mail e senha.';
    errEl.style.display = 'block';
    return;
  }

  btn.textContent = 'Autenticando...';
  btn.disabled = true;

  const { data, error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    errEl.textContent = 'Credenciais inválidas. Verifique seu e-mail e senha.';
    errEl.style.display = 'block';
    btn.textContent = 'Entrar';
    btn.disabled = false;
    return;
  }

  const user = await resolverUsuarioDaSessao(data.user);

  if (!user) {
    errEl.textContent = 'Autenticado, mas usuário não encontrado na base. Fale com suporte.';
    errEl.style.display = 'block';
    btn.textContent = 'Entrar';
    btn.disabled = false;
    return;
  }

  USER_ID = user.id;
  userData = user;
  try { await loadDashboard(user); }
  catch (err) {
    console.error('[Lumnis] erro ao montar o dashboard:', err);
    showToast('Entrou, mas parte da tela falhou. Recarregue.', 'error');
  }
}

// =====================================================
//  AUTH - LOGIN COM GOOGLE (OAuth)
// =====================================================
async function doLoginGoogle() {
  const btn   = document.getElementById('login-google');
  const errEl = document.getElementById('login-error');
  if (errEl) errEl.style.display = 'none';
  if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Abrindo Google...'; }

  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // volta para a mesma página, sem querystring
      redirectTo: window.location.origin + window.location.pathname,
      queryParams: { prompt: 'select_account' }
    }
  });

  if (error) {
    if (errEl) {
      errEl.textContent = 'Nao foi possivel abrir o login do Google. Tente por e-mail e senha.';
      errEl.style.display = 'block';
    }
    if (btn) { btn.disabled = false; btn.querySelector('span').textContent = 'Entrar com Google'; }
  }
  // Se deu certo, o browser navega para o Google e volta — o init() assume daqui.
}

// Resolve a linha de `usuarios` para uma sessao autenticada.
// Ordem: por id (caso normal) -> por e-mail (conta antiga) -> cria nova.
// Devolve null se nao conseguir resolver.
async function resolverUsuarioDaSessao(authUser) {
  if (!authUser) return null;

  const email = (authUser.email || '').trim().toLowerCase();

  // As duas buscas vao juntas: antes eram sequenciais e cada ida custava
  // um round-trip. Em 4G isso era ~600ms de tela branca a toa.
  const [resId, resEmail] = await Promise.all([
    sb.from('usuarios').select('*').eq('id', authUser.id).maybeSingle(),
    email ? sb.from('usuarios').select('*').eq('email', email).maybeSingle()
          : Promise.resolve({ data: null })
  ]);

  const porId = resId?.data;
  if (porId) return porId;

  if (email) {
    const porEmail = resEmail?.data;
    if (porEmail) {
      // Conta antiga com id diferente do auth.uid(): o RLS bloquearia tudo.
      // Nao tentamos migrar o id aqui (ha chaves estrangeiras apontando
      // para ele); o pareamento correto e feito no SQL 04-preparar-google.
      if (porEmail.id !== authUser.id) {
        console.warn('[Lumnis] conta antiga com id divergente:', porEmail.id, 'vs', authUser.id);
        return { ...porEmail, _idDivergente: true };
      }
      return porEmail;
    }
  }

  // Primeiro acesso via Google: cria a linha de usuario
  const meta = authUser.user_metadata || {};
  const { data: novo, error } = await sb.from('usuarios').insert({
    id: authUser.id,
    telegram_id: email || authUser.id,
    nome: meta.full_name || meta.name || (email ? email.split('@')[0] : 'Novo usuario'),
    email: email,
    avatar_url: meta.avatar_url || meta.picture || null,
    plano: 'trial',
    trial_inicio: today(),
    trial_fim: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
  }).select().single();

  if (error) { console.error('[Lumnis] falha ao criar usuario:', error.message); return null; }
  return novo;
}

// Envia link de redefinicao de senha. Usado tanto por quem esqueceu
// quanto por quem comprou e nunca definiu uma (o n8n cria a conta com
// senha aleatoria que ninguem ve).
async function pedirResetSenha() {
  const email = (document.getElementById('login-email')?.value || '').trim();
  const errEl = document.getElementById('login-error');
  if (!email) {
    if (errEl) { errEl.textContent = 'Digite seu e-mail no campo acima primeiro.'; errEl.style.display = 'block'; }
    return;
  }
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });
  if (errEl) {
    // Resposta identica havendo conta ou nao, para nao revelar quem e cliente
    errEl.style.background = 'rgba(155,255,206,0.10)';
    errEl.style.borderColor = 'rgba(155,255,206,0.3)';
    errEl.style.color = 'var(--green)';
    errEl.textContent = 'Se existir uma conta com esse e-mail, o link de redefinicao chega em instantes.';
    errEl.style.display = 'block';
  }
  if (error) console.warn('[Lumnis] reset:', error.message);
}

async function doLogout() {
  // Para o Realtime antes de sair
  if (_realtimeCatChannel) {
    sb.removeChannel(_realtimeCatChannel);
    _realtimeCatChannel = null;
  }
  await sb.auth.signOut();
  USER_ID = null; userData = null; allTx = []; allCats = [];
  if (typeof closeFabMenu === 'function') closeFabMenu();
  showScreen('screen-lock');
}

// =====================================================
//  INIT
// =====================================================
async function init() {
  loadTheme();
  hideAppChrome();   // estado inicial e sempre "deslogado"

  // Se Supabase não carregou (CDN bloqueado em arquivo local), ir direto para login
  if (typeof supabase === 'undefined' || typeof sb === 'undefined') {
    console.warn('[Lumnis] Supabase não carregado. Verifique a conexão.');
    showScreen('screen-lock');
    return;
  }

  // Rede lenta nao e o mesmo que "nao logado". O timeout so age se a sessao
  // ainda nem comecou a resolver, e da folga suficiente para 3G ruim.
  let _resolvendo = false;
  const timeout = setTimeout(() => {
    if (_resolvendo) return;
    const loading = document.getElementById('screen-loading');
    if (loading && loading.style.display !== 'none') {
      console.warn('[Lumnis] sem resposta da sessao — mostrando login');
      showScreen('screen-lock');
    }
  }, 8000);

  try {
    // 1. PRIORIDADE: Sessão Supabase Auth (cross-device — persiste em qualquer dispositivo)
    const { data: { session } } = await sb.auth.getSession().catch(() => ({ data: { session: null } }));
    if (session) {
      _resolvendo = true;
      // Limpa o #access_token que o OAuth deixa na URL
      if (window.location.hash.includes('access_token')) {
        window.history.replaceState({}, '', window.location.pathname);
      }
      const user = await resolverUsuarioDaSessao(session.user);
      if (user && !user._idDivergente) {
        clearTimeout(timeout);
        // Blindagem: um erro de RENDER nao pode ser confundido com falha de
        // autenticacao. Sem este try/catch o erro sobe para o catch do init,
        // que chama showScreen('screen-lock') e desloga um usuario valido.
        try { await loadDashboard(user); }
        catch (err) { console.error('[Lumnis] erro ao montar o dashboard:', err); }
        return;
      }
      if (user && user._idDivergente) {
        clearTimeout(timeout);
        showScreen('screen-lock');
        const errEl = document.getElementById('login-error');
        if (errEl) {
          errEl.textContent = 'Sua conta existe, mas ainda nao esta vinculada ao login social. Entre com e-mail e senha ou fale com o suporte.';
          errEl.style.display = 'block';
        }
        await sb.auth.signOut();
        return;
      }
    }

    // 2. FALLBACK: Token via URL (link de ativação inicial) ou localStorage legado
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('uid') || urlParams.get('token') || urlParams.get('u');
    const tokenId = urlToken || localStorage.getItem('lumnis_token') || null;
    if (tokenId) {
      if (urlToken) window.history.replaceState({},'',window.location.pathname);
      const { data: user, error } = await sb.from('usuarios').select('*').eq('id', tokenId).single();
      if (!error && user) {
        clearTimeout(timeout);
        try { await loadDashboard(user); }
        catch (err) { console.error('[Lumnis] erro ao montar o dashboard:', err); }
        return;
      }
      if (error) localStorage.removeItem('lumnis_token');
    }

    clearTimeout(timeout);
    showScreen('screen-lock');
  } catch(e) {
    clearTimeout(timeout);
    console.error('[Lumnis] Erro no init:', e);
    showScreen('screen-lock');
  }
}

// =====================================================
//  REALTIME — Categorias sincronizadas com o bot
// =====================================================
let _realtimeCatChannel = null;

function setupRealtimeCategories(userId) {
  // Remove canal anterior se existir
  if (_realtimeCatChannel) {
    sb.removeChannel(_realtimeCatChannel);
    _realtimeCatChannel = null;
  }

  _realtimeCatChannel = sb.channel(`categorias-user-${userId}`)
    .on('postgres_changes', {
      event: '*',           // INSERT, UPDATE, DELETE
      schema: 'public',
      table: 'categorias',
      filter: `user_id=eq.${userId}`
    }, async (payload) => {
      console.log('[Lumnis Realtime] Categoria alterada:', payload.eventType, payload.new?.nome || payload.old?.nome);

      // Re-busca categorias do Supabase
      const { data: cats } = await sb.from('categorias').select('*').eq('user_id', userId).eq('ativa', true);
      if (cats) {
        allCats = cats;
        // Re-renderiza seções que dependem de categorias
        if (typeof renderCategorias === 'function') renderCategorias();
        if (typeof renderHome === 'function') renderHome();
        showToast('Categorias atualizadas 🔄', 'success');
      }
    })
    .subscribe((status) => {
      console.log('[Lumnis Realtime] Status categorias:', status);
    });
}

// ─── Link de compra x renovacao ──────────────────────────────
// Quem ja e cliente nao pode cair na pagina de VENDAS: precisa do
// checkout de RENOVACAO. A plataforma manda checkout_url em todo
// evento; guardamos em usuarios.checkout_url no n8n.
const LUMNIS_VENDAS = 'https://www.uselumnis.com';

function linkAssinatura() {
  const u = userData || {};
  const eCliente = u.plano && u.plano !== 'trial';
  // 1) link individual salvo pelo webhook da compra
  if (eCliente && u.checkout_url) return u.checkout_url;
  // 2) cliente sem link salvo: manda pro checkout generico
  if (eCliente) return 'https://app.uselumnis.com';
  // 3) nunca comprou: pagina de vendas
  return LUMNIS_VENDAS;
}

function rotuloAssinatura() {
  const u = userData || {};
  return (u.plano && u.plano !== 'trial') ? 'Renovar' : 'Assinar';
}

// ─── Resgate de compra por codigo ────────────────────────────
// Comprou com um e-mail e entrou com outro (Google)? O codigo de
// ativacao liga as duas pontas sem intervencao manual.
async function resgatarCodigo() {
  const el = document.getElementById('codigo-input');
  const cod = (el?.value || '').trim().toUpperCase();
  const msg = document.getElementById('codigo-msg');
  const mostrar = (t, ok) => { if (msg) { msg.textContent = t; msg.style.color = ok ? 'var(--green)' : 'var(--red)'; msg.style.display='block'; } };

  if (!cod) return mostrar('Digite o código que chegou no seu e-mail.', false);
  if (!USER_ID) return mostrar('Faça login primeiro.', false);

  const { data: reg, error } = await sb.from('codigos_ativacao')
    .select('*').eq('codigo', cod).maybeSingle();

  if (error || !reg)  return mostrar('Código não encontrado. Confira o e-mail da compra.', false);
  if (reg.usado)      return mostrar('Este código já foi usado.', false);

  const { error: e2 } = await sb.from('usuarios').update({
    plano:       reg.plano || 'solo',
    acesso_fim:  reg.validade_acesso,
    codigo_ativacao: cod
  }).eq('id', USER_ID);
  if (e2) return mostrar('Não consegui ativar: ' + e2.message, false);

  await sb.from('codigos_ativacao')
    .update({ usado: true, usado_por: USER_ID, usado_em: new Date().toISOString() })
    .eq('codigo', cod);

  Object.assign(userData, { plano: reg.plano || 'solo', acesso_fim: reg.validade_acesso });
  mostrar('✅ Acesso liberado! Recarregando...', true);
  setTimeout(() => location.reload(), 1200);
}

// ─── Confirmacao bonita (substitui o confirm() do navegador) ──
// O confirm() nativo mostra "dash.uselumnis.com diz", nao respeita o
// tema e trava a thread. Este devolve uma Promise<boolean>.
function confirmar(opts) {
  const o = typeof opts === 'string' ? { texto: opts } : (opts || {});
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'cf-overlay';
    ov.innerHTML = `
      <div class="cf-card">
        <div class="cf-emoji">${o.emoji || '❓'}</div>
        <div class="cf-titulo">${o.titulo || 'Confirmar'}</div>
        ${o.texto ? `<div class="cf-texto">${o.texto}</div>` : ''}
        ${o.detalhe ? `<div class="cf-detalhe">${o.detalhe}</div>` : ''}
        <div class="cf-acoes">
          <button class="cf-nao">${o.cancelar || 'Cancelar'}</button>
          <button class="cf-sim${o.perigo ? ' cf-perigo' : ''}">${o.confirmar || 'Confirmar'}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('on'));

    const fechar = (v) => {
      ov.classList.remove('on');
      setTimeout(() => ov.remove(), 180);
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = e => {
      if (e.key === 'Escape') fechar(false);
      if (e.key === 'Enter')  fechar(true);
    };
    ov.querySelector('.cf-sim').onclick = () => fechar(true);
    ov.querySelector('.cf-nao').onclick = () => fechar(false);
    ov.onclick = e => { if (e.target === ov) fechar(false); };
    document.addEventListener('keydown', onKey);
    setTimeout(() => ov.querySelector('.cf-sim')?.focus(), 120);
  });
}

// ─── Medicao real do header e do nav ───────────────
// Nao da para cravar 64px/62px no CSS: o nav declara height:62px mas
// tem padding-bottom:env(safe-area-inset-bottom) por dentro (border-box),
// e o conteudo (icone + label) nao encolhe — entao ele ESTOURA e fica
// maior que 62px em aparelhos com gesture bar. Medir e a unica forma
// que funciona em todo aparelho.
function medirChrome() {
  const raiz = document.documentElement;
  const hdr  = document.getElementById('app-header');
  const nav  = document.getElementById('app-nav');
  const hH = (hdr && hdr.offsetParent !== null) ? hdr.offsetHeight : 0;
  const nH = (nav && nav.offsetParent !== null) ? nav.offsetHeight : 0;
  raiz.style.setProperty('--header-h', hH + 'px');
  raiz.style.setProperty('--nav-h',    nH + 'px');
}

// Roda quando a casca aparece, ao girar a tela e quando o teclado
// abre/fecha (visualViewport muda de altura no Android).
window.addEventListener('resize', medirChrome);
window.addEventListener('orientationchange', () => setTimeout(medirChrome, 250));
if (window.visualViewport) window.visualViewport.addEventListener('resize', medirChrome);

// ─── Diagnostico ───────────────────────────────────
// Erros nao capturados eram invisiveis: a tela quebrava e o usuario
// nao tinha ideia do porque. Agora ficam registrados no console.
window.addEventListener('error', e => {
  console.error('[Lumnis] erro nao tratado:', e.message, 'em', e.filename + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', e => {
  console.error('[Lumnis] promise rejeitada:', e.reason);
});

// ─── Inicializa o app ──────────────────────────────
document.addEventListener('DOMContentLoaded', init);
