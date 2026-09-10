// ════════════════════════════════════════
// 03-perfil.js — Perfil, Metas, Temas, Import CSV, Lixeira
// ════════════════════════════════════════


// ══════════════════════════════════════════════════════════
// PERÍODO PICKER — substitui Jan~Dez
// ══════════════════════════════════════════════════════════
let _txInicio = null;
let _txFim = null;

function abrirPeriodoPicker() {
  let modal = document.getElementById('modal-periodo-picker');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-periodo-picker';
    modal.className = 'periodo-picker-overlay';
    modal.onclick = e => { if(e.target===modal) fecharPeriodoPicker(); };
    document.body.appendChild(modal);
  }

  const hoje = new Date();
  const anoAtual = hoje.getFullYear();
  const MESES_FULL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const MESES_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  // Gerar opções de mês/ano: ano atual + anterior
  const opcoes = [];
  for (let ano = anoAtual; ano >= anoAtual - 1; ano--) {
    const maxM = ano === anoAtual ? hoje.getMonth() : 11;
    for (let m = maxM; m >= 0; m--) {
      const val = `${ano}-${String(m+1).padStart(2,'0')}`;
      opcoes.push({ val, label: `${MESES_SHORT[m]}/${String(ano).slice(2)}`, ativo: _txPeriodo === val });
    }
  }

  const gridHTML = opcoes.map(o =>
    `<button class="periodo-mes-btn ${o.ativo?'active':''}" onclick="selecionarPeriodoMes('${o.val}')">${o.label}</button>`
  ).join('');

  const [iniVal, fimVal] = _txPeriodo === 'custom' ? [_txInicio||'', _txFim||''] : ['', ''];

  modal.innerHTML = `<div class="periodo-picker-box">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <div style="font-family:var(--font-head);font-size:1.1rem;font-weight:800">📅 Escolher período</div>
      <button onclick="fecharPeriodoPicker()" style="background:var(--card2);border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:5px 12px;cursor:pointer">✕</button>
    </div>

    <!-- Atalhos rápidos -->
    <div class="periodo-section-label">Atalhos</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:20px">
      <button class="tx-periodo-btn ${_txPeriodo==='mes'?'active':''}" onclick="selecionarPeriodoRapido('mes')">Este mês</button>
      <button class="tx-periodo-btn ${_txPeriodo==='ontem'?'active':''}" onclick="selecionarPeriodoRapido('ontem')">Ontem</button>
      <button class="tx-periodo-btn ${_txPeriodo==='7d'?'active':''}" onclick="selecionarPeriodoRapido('7d')">7 dias</button>
      <button class="tx-periodo-btn ${_txPeriodo==='mes_passado'?'active':''}" onclick="selecionarPeriodoRapido('mes_passado')">Mês passado</button>
    </div>

    <!-- Grid de meses -->
    <div class="periodo-section-label">Mês específico</div>
    <div class="periodo-mes-grid" style="margin-bottom:20px">${gridHTML}</div>

    <!-- Range customizado -->
    <div class="periodo-section-label">Período customizado</div>
    <div class="periodo-custom-row" style="margin-bottom:20px">
      <div>
        <label style="font-size:0.72rem;color:var(--muted);display:block;margin-bottom:4px">De</label>
        <input type="date" id="pp-inicio" class="inv-form-input" value="${iniVal}">
      </div>
      <div>
        <label style="font-size:0.72rem;color:var(--muted);display:block;margin-bottom:4px">Até</label>
        <input type="date" id="pp-fim" class="inv-form-input" value="${fimVal}">
      </div>
    </div>
    <button onclick="aplicarPeriodoCustom()" style="width:100%;background:var(--purple);color:var(--bg);border:none;border-radius:12px;padding:12px;font-weight:700;cursor:pointer;font-family:var(--font-body)">
      Aplicar período customizado
    </button>
  </div>`;
  modal.style.display = 'flex';
}

function fecharPeriodoPicker() {
  const m = document.getElementById('modal-periodo-picker');
  if (m) m.style.display = 'none';
}

function selecionarPeriodoRapido(periodo) {
  fecharPeriodoPicker();
  _txInicio = null; _txFim = null;
  setTxPeriodo(periodo);
  _atualizarLabelPeriodoPicker(periodo);
}

function selecionarPeriodoMes(yyyyMM) {
  fecharPeriodoPicker();
  _txInicio = null; _txFim = null;
  setTxPeriodo(yyyyMM);
  const [yr, mo] = yyyyMM.split('-');
  // MESES_SHORT já declarado acima
  _atualizarLabelPeriodoPicker(`${MESES_SHORT[+mo-1]}/${yr}`);
}

function aplicarPeriodoCustom() {
  const ini = document.getElementById('pp-inicio')?.value;
  const fim = document.getElementById('pp-fim')?.value;
  if (!ini || !fim) { alert('Preencha as duas datas'); return; }
  if (ini > fim) { alert('Data inicial deve ser menor que a final'); return; }
  _txInicio = ini;
  _txFim = fim;
  _txPeriodo = 'custom';
  fecharPeriodoPicker();
  document.querySelectorAll('.tx-periodo-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('txp-custom');
  if (btn) {
    const [ay,am,ad] = ini.split('-');
    const [by,bm,bd] = fim.split('-');
    btn.textContent = `📅 ${ad}/${am} → ${bd}/${bm}`;
    btn.classList.add('active');
  }
  renderTransacoes(allTx, userData);
}

function _atualizarLabelPeriodoPicker(label) {
  const btn = document.getElementById('txp-custom');
  if (btn) btn.textContent = '📅 Escolher período';
}


// ══════════════════════════════════════════════════════════
// RENDER PERFIL
// ══════════════════════════════════════════════════════════
// Descreve o acesso com precisao, contando os dias que faltam.
function _rotuloAcesso(user) {
  const hoje = today();
  const fim  = user.acesso_fim || (user.plano === 'trial' ? user.trial_fim : null);

  if (!fim) {
    // So e vitalicio em plano pago sem data de fim.
    return (user.plano && user.plano !== 'trial') ? 'Vitalício' : '—';
  }

  const dias = Math.ceil((new Date(fim + 'T12:00:00') - new Date(hoje + 'T12:00:00')) / 86400000);
  if (dias < 0)  return fmtDate(fim) + ' · expirado';
  if (dias === 0) return fmtDate(fim) + ' · vence hoje';
  if (dias === 1) return fmtDate(fim) + ' · falta 1 dia';
  return fmtDate(fim) + ' · faltam ' + dias + ' dias';
}

function renderPerfil(user) {
  const el = (id, v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  el('p-nome', user.nome || '—');
  el('p-plano', user.plano || 'Básico');
  // BUG: mostrava "Vitalício" para qualquer um sem acesso_fim — inclusive
  // quem esta em teste de 7 dias, que e o oposto de vitalicio.
  el('p-acesso', _rotuloAcesso(user));
  el('p-modo', user.modo_receita ? 'Modo Completo' : 'Modo Básico');

  // Meta input
  const metaInput = document.getElementById('meta-input');
  if (metaInput) metaInput.value = user.meta_mensal || user.meta_gastos_mensal || '';

  // Modo receita toggle
  const toggle = document.getElementById('modo-receita-toggle');
  const slider = document.getElementById('modo-receita-slider');
  const knob   = document.getElementById('modo-receita-knob');
  if (toggle) toggle.checked = !!user.modo_receita;
  if (slider && knob) {
    if (user.modo_receita) {
      slider.style.background = 'var(--purple)';
      knob.style.transform = 'translateX(20px)';
      knob.style.background = 'white';
    } else {
      slider.style.background = 'var(--card2)';
      knob.style.transform = 'translateX(0)';
      knob.style.background = 'var(--muted2)';
    }
  }

  // Avatar
  const initials = document.getElementById('avatar-initials');
  const avatarName = document.getElementById('avatar-name');
  if (initials) initials.textContent = (user.nome||'?').charAt(0).toUpperCase();
  if (avatarName) avatarName.textContent = user.nome || 'Usuário';
  if (user.avatar_url) {
    const img = document.getElementById('avatar-img');
    const ini = document.getElementById('avatar-initials');
    // O avatar e um base64 inteiro na coluna avatar_url. Reatribuir o
    // src a cada render fazia o navegador REDECODIFICAR a imagem toda
    // vez que a aba Perfil abria — era isso que travava o clique.
    if (img && img.dataset.src !== user.avatar_url) {
      img.dataset.src = user.avatar_url;
      img.decoding = 'async';
      img.loading  = 'lazy';
      img.src = user.avatar_url;
      img.style.display = 'block';
    }
    if (ini) ini.style.display = 'none';
  }

  // Sonhos no perfil
  renderSonhosPerfil(Array.isArray(user.sonhos) ? user.sonhos : []);

  // Categorias
  renderCatEditList();

  // Tema ativo
  const theme = localStorage.getItem('lumnis_theme') || 'lumnis';
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
  const activeThemeBtn = document.getElementById('theme-' + theme);
  if (activeThemeBtn) activeThemeBtn.classList.add('active');
}

// ══════════════════════════════════════════════════════════
// SONHOS (home + perfil)
// ══════════════════════════════════════════════════════════
// A lista de sonhos saiu da Home — quem mostra sonhos la agora e o
// mapa mental (08-sonhos-mapa.js). Esta funcao vira um encaminhador
// para nao quebrar as 3 chamadas que ja existiam.
function renderSonhosHome(sonhos) {
  if (sonhos && userData) userData.sonhos = sonhos;
  if (typeof renderMapaSonhos === 'function') renderMapaSonhos();
}

function renderSonhosPerfil(sonhos) {
  const el = document.getElementById('sonhos-perfil-list');
  if (!el) return;
  if (!sonhos || !sonhos.length) {
    el.innerHTML = '<div style="font-size:0.8rem;color:var(--muted);text-align:center;padding:12px 0">Nenhum sonho adicionado ainda. ✨</div>';
    return;
  }
  el.innerHTML = sonhos.map((s, i) => `
    <div class="sonho-card-i" style="margin-bottom:8px">
      <div style="font-size:1.3rem;flex-shrink:0">${s.emoji || '🌟'}</div>
      <div style="flex:1;min-width:0">
        <div class="sonho-nome">${s.titulo || s.nome || s.name || s.texto || ''}</div>
        ${s.motivo || s.why ? `<div class="sonho-motivo">"${s.motivo || s.why}"</div>` : ''}
      </div>
      <button class="sonho-del" onclick="deleteSonho(${i})" title="Remover">✕</button>
    </div>`).join('');
}

function toggleSonhoForm() {
  const wrap = document.getElementById('sonho-why-wrap');
  if (!wrap) return;
  wrap.style.display = wrap.style.display === 'block' ? 'none' : 'block';
}

async function addSonho() {
  const nome = document.getElementById('sonho-nome-input')?.value.trim();
  if (!nome) { showToast('Informe o nome do sonho.', 'error'); return; }
  const motivo = document.getElementById('sonho-motivo-input')?.value.trim() || '';
  const sonhos = Array.isArray(userData?.sonhos) ? [...userData.sonhos] : [];
  sonhos.push({ nome, titulo: nome, motivo, emoji: '🌟', criadoEm: today() });
  try {
    const { error } = await sb.from('usuarios').update({ sonhos }).eq('id', USER_ID);
    if (error) throw error;
    userData.sonhos = sonhos;
    renderSonhosPerfil(sonhos);
    renderSonhosHome(sonhos);
    document.getElementById('sonho-nome-input').value = '';
    document.getElementById('sonho-motivo-input').value = '';
    toggleSonhoForm();
    showToast('Sonho adicionado! 🌟', 'success');
  } catch(e) { showToast('Erro ao salvar sonho.', 'error'); }
}

async function deleteSonho(idx) {
  const sonhos = Array.isArray(userData?.sonhos) ? [...userData.sonhos] : [];
  sonhos.splice(idx, 1);
  try {
    await sb.from('usuarios').update({ sonhos }).eq('id', USER_ID);
    userData.sonhos = sonhos;
    renderSonhosPerfil(sonhos);
    renderSonhosHome(sonhos);
    showToast('Sonho removido.', 'success');
  } catch(e) { showToast('Erro ao remover sonho.', 'error'); }
}

// ══════════════════════════════════════════════════════════
// META DE GASTOS
// ══════════════════════════════════════════════════════════
async function saveMeta() {
  if (bloqueadoPorTrial()) return;
  // BUG CORRIGIDO: meta-input tem máscara. Meta de R$2.000 virava R$2.
  const val = _parseValorBR('meta-input', 0);
  if (!val || val <= 0) { showToast('Informe um valor válido.', 'error'); return; }
  try {
    const { error } = await sb.from('usuarios').update({ meta_mensal: val, meta_gastos_mensal: val }).eq('id', USER_ID);
    if (error) throw error;
    if (userData) { userData.meta_mensal = val; userData.meta_gastos_mensal = val; }
    renderHome(userData, userData);
    showToast('✅ Meta salva!', 'success');
  } catch(e) { showToast('Erro ao salvar meta.', 'error'); }
}

// ══════════════════════════════════════════════════════════
// MODO RECEITA
// ══════════════════════════════════════════════════════════
async function toggleModoReceita() {
  if (bloqueadoPorTrial()) return;
  const toggle = document.getElementById('modo-receita-toggle');
  // FIX: inverte o estado atual (toggle.checked não muda pois click é no div pai)
  const novoModo = !(userData?.modo_receita);
  if (toggle) toggle.checked = novoModo;
  try {
    const { error } = await sb.from('usuarios').update({ modo_receita: novoModo }).eq('id', USER_ID);
    if (error) throw error;
    if (userData) userData.modo_receita = novoModo;
    renderHome(userData, userData);
    const slider = document.getElementById('modo-receita-slider');
    const knob   = document.getElementById('modo-receita-knob');
    if (slider && knob) {
      if (novoModo) {
        slider.style.background = 'var(--purple)';
        knob.style.transform = 'translateX(20px)';
        knob.style.background = 'white';
      } else {
        slider.style.background = 'var(--card2)';
        knob.style.transform = 'translateX(0)';
        knob.style.background = 'var(--muted2)';
      }
    }
    showToast(novoModo ? '✅ Modo Receita ativado!' : 'Modo Básico ativado', 'success');
  } catch(e) { showToast('Erro ao salvar configuração.', 'error'); }
}

// ══════════════════════════════════════════════════════════
// AVATAR UPLOAD
// ══════════════════════════════════════════════════════════
async function uploadAvatar(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('Envie uma imagem', 'error'); return; }

  showToast('Processando foto...');
  try {
    // Antes salvava o arquivo original em base64 na coluna avatar_url:
    // uma foto de celular virava ~2 MB de texto no banco, trafegado em
    // TODO login e redecodificado a cada render. Aqui reduzimos para
    // 256px e qualidade 0.75 — some para ~25 KB sem perda visivel.
    const base64 = await _comprimirImagem(file, 256, 0.75);

    const img = document.getElementById('avatar-img');
    const ini = document.getElementById('avatar-initials');
    if (img) { img.dataset.src = base64; img.src = base64; img.style.display = 'block'; }
    if (ini) ini.style.display = 'none';

    const { error } = await sb.from('usuarios').update({ avatar_url: base64 }).eq('id', USER_ID);
    if (error) throw error;
    if (userData) userData.avatar_url = base64;
    showToast('✅ Foto atualizada!');
  } catch (e) {
    console.error('[Lumnis] avatar:', e);
    showToast('Não consegui salvar a foto', 'error');
  }
}

function _comprimirImagem(file, lado, qualidade) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = reject;
    leitor.onload = e => {
      const im = new Image();
      im.onerror = reject;
      im.onload = () => {
        // corta quadrado no centro, depois reduz
        const menor = Math.min(im.width, im.height);
        const sx = (im.width  - menor) / 2;
        const sy = (im.height - menor) / 2;
        const cv = document.createElement('canvas');
        cv.width = cv.height = lado;
        const ctx = cv.getContext('2d');
        ctx.drawImage(im, sx, sy, menor, menor, 0, 0, lado, lado);
        resolve(cv.toDataURL('image/jpeg', qualidade));
      };
      im.src = e.target.result;
    };
    leitor.readAsDataURL(file);
  });
}

// ══════════════════════════════════════════════════════════
// COLOR SWATCHES para modal de categoria
// ══════════════════════════════════════════════════════════
const CAT_COLORS = ['#18181b','#53ddfc','#9bffce','#ff6e84','#fcd34d','#f97316','#06b6d4','#ec4899','#84cc16','#a78bfa'];

function renderColorSwatches(selectedColor) {
  const container = document.getElementById('color-swatches');
  if (!container) return;
  container.innerHTML = CAT_COLORS.map(c => `
    <div onclick="selectSwatch('${c}')" style="width:24px;height:24px;border-radius:50%;background:${c};cursor:pointer;border:3px solid ${c===selectedColor?'white':'transparent'};box-sizing:border-box;transition:all 0.15s" id="swatch-${c.replace('#','')}"></div>
  `).join('');
  const picker = document.getElementById('cat-modal-cor');
  if (picker) picker.value = selectedColor;
}

function selectSwatch(color) {
  document.querySelectorAll('#color-swatches > div').forEach(d => {
    d.style.border = '3px solid transparent';
  });
  const sw = document.getElementById('swatch-' + color.replace('#',''));
  if (sw) sw.style.border = '3px solid white';
  const picker = document.getElementById('cat-modal-cor');
  if (picker) picker.value = color;
}

function syncColorSwatches(value) {
  renderColorSwatches(value);
  selectSwatch(value);
}

// ══════════════════════════════════════════════════════════
// ANIMAÇÕES (fade-in)
// ══════════════════════════════════════════════════════════
function runAnimations() {
  // Garante que elementos fade-in sejam sempre visíveis
  // A animação é cosmética - o conteúdo nunca fica oculto
  if (!document.getElementById('lumnis-anim-style')) {
    const el = document.createElement('style');
    el.id = 'lumnis-anim-style';
    el.textContent = `
      @keyframes fadeInSlide {
        from { transform: translateY(8px); }
        to   { transform: translateY(0); }
      }
      .fade-in { animation: fadeInSlide 0.3s ease; }
    `;
    document.head.appendChild(el);
  }
}

// ══════════════════════════════════════════════════════════
// HANDLER: IMPORTAR CSV / PDF (input file na aba Faturas)
// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// FUNÇÕES DE CONFIGURAÇÃO DO CARTÃO E LIXEIRA (Faturas)
// ══════════════════════════════════════════════════════════
function openCardSettings() {
  let modal = document.getElementById('modal-card-settings');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-card-settings';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:450;background:rgba(0,0,0,0.82);align-items:center;justify-content:center;padding:16px';
    modal.onclick = e => { if(e.target===modal) fecharCardSettings(); };
    document.body.appendChild(modal);
  }

  // Get current cards from allFaturas
  const cartoes = [...new Set((allFaturas||[]).map(f=>f.cartao).filter(Boolean))];
  const rows = cartoes.length ? cartoes.map(c => {
    const banco = detectarBanco(c);
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
      <span>${banco.emoji}</span>
      <div style="flex:1;font-size:0.85rem;font-weight:600">${banco.nome}</div>
      <div style="font-size:0.72rem;color:var(--muted)">${c}</div>
    </div>`;
  }).join('') : '<div style="font-size:0.82rem;color:var(--muted);padding:12px">Nenhum cartão identificado. Importe uma fatura primeiro.</div>';

  modal.innerHTML = `<div style="background:var(--card);border-radius:20px;padding:24px;width:100%;max-width:460px;max-height:80vh;overflow-y:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div style="font-family:var(--font-head);font-size:1.1rem;font-weight:800">⚙️ Cartões Identificados</div>
      <button onclick="fecharCardSettings()" style="background:var(--card2);border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:5px 12px;cursor:pointer">✕</button>
    </div>
    <div style="font-size:0.72rem;color:var(--muted);margin-bottom:12px">
      Os bancos são detectados automaticamente pelo nome do cartão nas faturas importadas.
    </div>
    ${rows}
    <div style="margin-top:16px;padding:12px;background:var(--card2);border-radius:10px;font-size:0.75rem;color:var(--muted)">
      💡 Dica: Ao importar CSVs e PDFs, o banco é identificado automaticamente. Nomeie seus arquivos com o nome do banco (ex: "nubank.csv", "santander.pdf") para melhor detecção.
    </div>
  </div>`;
  modal.style.display = 'flex';
}
function fecharCardSettings() {
  const m = document.getElementById('modal-card-settings'); if(m) m.style.display='none';
}


// ══════════════════════════════════════════════════════════
// REVERTER ÚLTIMA IMPORTAÇÃO
// ══════════════════════════════════════════════════════════
async function reverterUltimaImportacao() {
  // Tenta pegar importacaoId da sessão ou da última fatura do banco
  let importacaoId = window._lastImportacaoId;
  let banco = window._lastImportacaoBanco || 'desconhecido';

  // Se não tem na memória, busca o último importacao_id do banco
  if (!importacaoId) {
    try {
      const { data: ultimaFatura } = await sb
        .from('faturas_futuras')
        .select('importacao_id, created_at')
        .eq('user_id', USER_ID)
        .not('importacao_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (ultimaFatura?.importacao_id) {
        importacaoId = ultimaFatura.importacao_id;
        const bancoCache = getBancoCache();
        banco = bancoCache[importacaoId] || 'último lote';
      }
    } catch(e) { /* sem dados */ }
  }

  if (!importacaoId) {
    showToast('Nenhuma importação recente para reverter.', 'error');
    return;
  }

  const confirmed = await confirmar({ emoji:'↩️', titulo:`Reverter importação de "${banco}"?`, perigo:true,
    texto:'Apaga todas as parcelas futuras deste lote.', detalhe:'Não dá para desfazer.', confirmar:'Reverter' });
  if (!confirmed) return;

  try {
    // 1. Apagar faturas_futuras deste lote
    const { error: e1 } = await sb
      .from('faturas_futuras')
      .delete()
      .eq('importacao_id', importacaoId)
      .eq('user_id', USER_ID);

    if (e1) {
      showToast('Erro ao reverter: ' + e1.message, 'error');
      return;
    }

    // 2. Apagar transações deste lote (se tiver importacao_id — não obrigatório)
    try {
      await sb.from('transacoes').delete()
        .eq('importacao_id', importacaoId)
        .eq('user_id', USER_ID);
    } catch(e) { /* coluna pode não existir */ }

    // 3. Limpar caches locais
    try {
      const FILE_HASH_STORAGE_KEY = 'lumnis_imported_hashes';
      const hashes = JSON.parse(localStorage.getItem(FILE_HASH_STORAGE_KEY) || '{}');
      for (const [hash, data] of Object.entries(hashes)) {
        if (data.importacaoId === importacaoId) delete hashes[hash];
      }
      localStorage.setItem(FILE_HASH_STORAGE_KEY, JSON.stringify(hashes));
    } catch(e) { /* ignore localStorage errors */ }

    try {
      const cache = getBancoCache();
      delete cache[importacaoId];
      localStorage.setItem(BANCO_CACHE_KEY, JSON.stringify(cache));
    } catch(e) { /* ignore */ }

    window._lastImportacaoId = null;
    window._lastImportacaoBanco = null;
    const btnRev = document.getElementById('btn-reverter');
    if (btnRev) btnRev.style.display = 'none';

    // 4. Recarregar dados
    const { data: novasTx } = await sb.from('transacoes').select('*').eq('user_id', USER_ID).order('data', { ascending: false });
    if (novasTx) { allTx = novasTx; if(typeof renderTransacoes==='function') renderTransacoes(allTx, userData); if(typeof renderHome==='function') renderHome(userData, userData); }

    const { data: novasFat } = await sb.from('faturas_futuras').select('*')
      .eq('user_id', USER_ID).is('deleted_at', null)
      .gte('data_venc', (()=>{ const d=new Date(); d.setMonth(d.getMonth()-1); return d.toISOString().split('T')[0]; })())
      .order('data_venc');
    if (novasFat) { allFaturas = novasFat; if(typeof renderFaturas==='function') renderFaturas(allFaturas); }

    showToast('✅ Importação revertida com sucesso!', 'success');
  } catch(e) {
    console.error('Erro ao reverter:', e);
    showToast('Erro ao reverter importação.', 'error');
  }
}

async function showLixeira() {
  if (!USER_ID) return;
  const { data: faturas } = await sb.from('faturas_futuras')
    .select('*').eq('user_id', USER_ID).order('data_venc');
  if (!faturas || faturas.length === 0) {
    showToast('Nenhuma fatura futura para remover.', 'success');
    return;
  }
  const _ok = await confirmar({ emoji:'🗑', titulo:`Remover ${faturas.length} faturas futuras?`, perigo:true,
    detalhe:'Não dá para desfazer.', confirmar:'Remover tudo' });
  if (!_ok) return;
  try {
    await sb.from('faturas_futuras').delete().eq('user_id', USER_ID);
    showToast('🗑️ Faturas futuras removidas!', 'success');
    // Re-carregar dashboard
    const { data: faturasRes } = await sb.from('faturas_futuras').select('*').eq('user_id', USER_ID).is('deleted_at', null).gte('data_venc', (()=>{const d=new Date();d.setMonth(d.getMonth()-3);return d.toISOString().split('T')[0];})()).order('data_venc');
    renderFaturas(faturasRes || []);
  } catch(e) {
    showToast('Erro ao remover faturas. Tenta de novo.', 'error');
  }
}

// ── Utilitários de hash para deduplicação de arquivos importados ──────────────
async function computeFileHash(arrayBuffer) {
  try {
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch(e) {
    // Fallback: hash simples baseado no tamanho + primeiros bytes
    const bytes = new Uint8Array(arrayBuffer);
    let h = bytes.length;
    for (let i = 0; i < Math.min(bytes.length, 64); i++) h = (h * 31 + bytes[i]) >>> 0;
    return h.toString(16) + '_' + bytes.length;
  }
}

function _getImportedHashes() {
  try { return JSON.parse(localStorage.getItem('lumnis_imported_hashes') || '{}'); } catch(e) { return {}; }
}

function checkFileAlreadyImported(hash) {
  if (!hash) return null;
  const hashes = _getImportedHashes();
  return hashes[hash] || null;
}

function saveFileHash(hash, importacaoId, bancoNome) {
  if (!hash) return;
  try {
    const hashes = _getImportedHashes();
    hashes[hash] = { importacaoId, bancoNome, importadoEm: new Date().toISOString() };
    localStorage.setItem('lumnis_imported_hashes', JSON.stringify(hashes));
  } catch(e) { console.warn('saveFileHash error', e); }
}
// ─────────────────────────────────────────────────────────────────────────────

async function handleDashCSV(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = ''; // reset para permitir re-upload do mesmo arquivo

  const fileName = file.name;
  const isPDF = fileName.toLowerCase().endsWith('.pdf');

  if (!isPDF) {
    // ── CSV ──────────────────────────────────────────────
    const arrayBufferCSV = await file.arrayBuffer();
    const hashCSV = await computeFileHash(arrayBufferCSV);
    const existingCSV = checkFileAlreadyImported(hashCSV);
    if (existingCSV) {
      const confirmed = await confirmar({ emoji:'⚠️', titulo:'Este arquivo já foi importado', perigo:true,
        texto:'Foi em ' + (existingCSV.importadoEm?.substring(0,10)||'?') + '. Importar de novo pode <strong>duplicar</strong> os dados.',
        confirmar:'Importar mesmo assim' });
      if (!confirmed) return;
    }
    const decoder = new TextDecoder('UTF-8');
    const textCSV = decoder.decode(arrayBufferCSV);
    const resultado = parsearCSVDashboard(textCSV, fileName);
    if (resultado.erro) {
      showToast('❌ ' + resultado.erroMsg, 'error');
    } else {
      resultado._fileHash = hashCSV;
      abrirPreviewCSV(resultado);
    }
    return;
  }

  // ── PDF ──────────────────────────────────────────────
  // Carregar PDF.js sob demanda
  if (typeof pdfjsLib === 'undefined') {
    try {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    } catch(e) {
      showToast('❌ Não foi possível carregar o leitor de PDF.', 'error');
      return;
    }
  }

  try {
    showToast('⏳ Lendo PDF...', 'success');
    const arrayBuffer = await file.arrayBuffer();
    const hashPDF = await computeFileHash(arrayBuffer);
    const existingPDF = checkFileAlreadyImported(hashPDF);
    if (existingPDF) {
      const confirmed = await confirmar({ emoji:'⚠️', titulo:'Este PDF já foi importado', perigo:true,
        texto:'Foi em ' + (existingPDF.importadoEm?.substring(0,10)||'?') + '. Importar de novo pode <strong>duplicar</strong> as parcelas.',
        confirmar:'Importar mesmo assim' });
      if (!confirmed) { showToast('Importação cancelada.', 'success'); return; }
    }
    window._currentPDFHash = hashPDF;
    const text = await extrairTextoPDF(arrayBuffer);
    const banco = detectarBancoPDF(text);
    const hoje = new Date().toLocaleDateString('en-CA');

    if (banco === 'desconhecido') {
      showToast('⚠️ Banco não reconhecido. Tente exportar como CSV.', 'error');
      return;
    }

    const vencimento = extrairVencimentoPDF(text, banco);

    if (!vencimento) {
      // Pedir vencimento manual
      _pdfResultadoPendente = { _banco: banco, _text: text, _fileName: fileName };
      abrirModalVencimentoPDF();
      return;
    }

    const isPago = vencimento < hoje;

    let parsed = { transacoes: [], futuras: [], ignoradas: 0 };
    if (banco === 'mercadopago') parsed = parsearMercadoPago(text, vencimento, isPago, hoje);
    else if (banco === 'santander') parsed = parsearSantander(text, vencimento, isPago, hoje);

    if (!parsed.transacoes.length && !parsed.futuras.length) {
      showToast('⚠️ Nenhuma transação encontrada no PDF.', 'error');
      return;
    }

    const totalDespesas = parsed.transacoes.reduce((s, t) => s + t.valor, 0);
    const futurasPorMes = {};
    parsed.futuras.forEach(t => {
      const mes = t.data.substring(0, 7);
      if (!futurasPorMes[mes]) futurasPorMes[mes] = { total: 0, qtd: 0 };
      futurasPorMes[mes].total += t.valor;
      futurasPorMes[mes].qtd++;
    });

    abrirPreviewCSV({
      erro: false, fileName, banco, vencimento, isPago,
      transacoes: parsed.transacoes, futuras: parsed.futuras,
      totalDespesas, ignoradas: parsed.ignoradas, futurasPorMes
    });

  } catch(e) {
    console.error('Erro ao processar PDF:', e);
    const errMsg = e?.message || String(e) || 'Erro desconhecido';
    const shortErr = errMsg.length > 80 ? errMsg.substring(0, 80) + '...' : errMsg;
    showToast('❌ Erro no PDF: ' + shortErr, 'error');
  }
}
