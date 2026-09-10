// ════════════════════════════════════════════════════════════
// 04-contas.js — Mapa de Calor, Cards da Home, Contas & Assinaturas
// ════════════════════════════════════════════════════════════

// ── Helpers de data ────────────────────────────────────────
function _mesAtualISO() {
  const d = _mesRef || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
let _mesRef = null; // null = mês corrente

function _diasNoMes(ano, mes0) { return new Date(ano, mes0 + 1, 0).getDate(); }

function _clampDia(dia, ano, mes0) {
  return Math.min(+dia || 1, _diasNoMes(ano, mes0));
}

function _proximaCobranca(dia, apartir) {
  const base = apartir ? new Date(apartir + 'T12:00:00') : new Date();
  let ano = base.getFullYear(), mes0 = base.getMonth();
  let d = _clampDia(dia, ano, mes0);
  if (d < base.getDate()) {
    mes0++;
    if (mes0 > 11) { mes0 = 0; ano++; }
    d = _clampDia(dia, ano, mes0);
  }
  return `${ano}-${String(mes0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function _txDoMes(mesISO) {
  return (allTx || []).filter(t => (t.data || '').startsWith(mesISO));
}

// ════════════════════════════════════════════════════════════
// 🔥 MAPA DE CALOR — gasto por dia
// ════════════════════════════════════════════════════════════
function renderMapaCalor() {
  const el = document.getElementById('mapa-calor');
  if (!el) return;

  const mesISO = _mesAtualISO();
  const [ano, mes] = mesISO.split('-').map(Number);
  const totalDias = _diasNoMes(ano, mes - 1);
  const hojeISO = today();

  // Soma gastos por dia (transações + faturas com vencimento no dia)
  const porDia = {};
  _txDoMes(mesISO).filter(t => t.tipo === 'despesa').forEach(t => {
    const d = +(t.data || '').split('-')[2];
    porDia[d] = (porDia[d] || 0) + (+t.valor || 0);
  });

  const valores = Object.values(porDia).filter(v => v > 0);
  const max = valores.length ? Math.max(...valores) : 0;
  const total = valores.reduce((s, v) => s + v, 0);

  // 4 níveis de intensidade
  const NIVEIS = [
    'var(--heat-1)', 'var(--heat-2)', 'var(--heat-3)', 'var(--heat-4)'
  ];
  function corDe(v) {
    if (!v || max <= 0) return 'var(--card2)';
    const r = v / max;
    if (r <= 0.25) return NIVEIS[0];
    if (r <= 0.50) return NIVEIS[1];
    if (r <= 0.78) return NIVEIS[2];
    return NIVEIS[3];
  }
  function abrev(v) {
    if (v >= 1000) return (v / 1000).toFixed(1).replace('.', ',') + 'k';
    return Math.round(v);
  }

  // Offset da primeira coluna: semana começa no sábado (igual referência: S T Q Q S S D)
  const primeiroDiaSemana = new Date(ano, mes - 1, 1).getDay(); // 0=dom
  const offset = (primeiroDiaSemana + 1) % 7; // desloca p/ começar no sábado

  let celulas = '';
  for (let i = 0; i < offset; i++) celulas += '<div></div>';

  for (let d = 1; d <= totalDias; d++) {
    const v = porDia[d] || 0;
    const iso = `${mesISO}-${String(d).padStart(2, '0')}`;
    const isHoje = iso === hojeISO;
    const futuro = iso > hojeISO;
    const cor = futuro ? 'transparent' : corDe(v);
    const temValor = v > 0;
    celulas += `
      <div class="heat-cell${isHoje ? ' heat-hoje' : ''}${futuro ? ' heat-futuro' : ''}"
           style="background:${cor}"
           onclick="_heatClick('${iso}')"
           title="${fmtDate(iso)}: ${BRL(v)}">
        <span class="heat-dia">${d}</span>
        ${temValor ? `<span class="heat-val">${abrev(v)}</span>` : ''}
      </div>`;
  }

  const picoDia = Object.entries(porDia).sort((a, b) => b[1] - a[1])[0];

  el.innerHTML = `
    <div class="heat-head">
      <div class="heat-icon">🔥</div>
      <div>
        <div class="heat-title">Mapa de calor</div>
        <div class="heat-sub">gasto por dia</div>
      </div>
    </div>
    <div class="heat-weekdays"><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span><span>D</span></div>
    <div class="heat-grid">${celulas}</div>
    <div class="heat-foot">
      <div class="heat-legend">
        <span>menos</span>
        <i style="background:var(--heat-1)"></i><i style="background:var(--heat-2)"></i><i style="background:var(--heat-3)"></i><i style="background:var(--heat-4)"></i>
        <span>mais</span>
      </div>
      ${picoDia ? `<div class="heat-pico">pico do mês: dia ${picoDia[0]} (${BRL(picoDia[1])})</div>` : ''}
    </div>
    ${total > 0 ? `<div class="heat-total">Total do mês: <strong>${BRL(total)}</strong></div>` : ''}`;
}

function _heatClick(iso) {
  if (typeof abrirCalendarioDia === 'function') {
    try { return abrirCalendarioDia(iso); } catch (e) {}
  }
  const dia = +iso.split('-')[2];
  const lista = _txDoMes(iso.substring(0, 7)).filter(t => t.data === iso);
  if (!lista.length) { showToast('Nenhum gasto nesse dia'); return; }
  showToast(`${fmtDate(iso)} · ${lista.length} lançamento(s)`);
}

// ════════════════════════════════════════════════════════════
// 🎯 LIMITE DO MÊS
// ════════════════════════════════════════════════════════════
function renderLimiteMesCard() {
  const el = document.getElementById('limite-mes-card');
  if (!el) return;

  const mesISO = _mesAtualISO();
  const gastoTx  = _txDoMes(mesISO).filter(t => t.tipo === 'despesa').reduce((s, t) => s + (+t.valor || 0), 0);
  const gastoFat = (allFaturas || []).filter(f => (f.data_venc || '').startsWith(mesISO)).reduce((s, f) => s + (+f.valor || 0), 0);
  const gasto = gastoTx + gastoFat;
  const meta  = +(userData?.meta_mensal || userData?.meta_gastos_mensal || 0);

  if (meta <= 0) {
    el.innerHTML = `
      <div class="lim-empty" onclick="switchTab('perfil')">
        <div class="lim-empty-ico">🎯</div>
        <div>
          <div class="lim-empty-t">Defina um limite mensal</div>
          <div class="lim-empty-s">Toque para configurar sua meta de gastos</div>
        </div>
      </div>`;
    return;
  }

  const pct = Math.round((gasto / meta) * 100);
  const estourou = gasto > meta;
  const cor = estourou ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : 'var(--green)';
  const R = 42, C = 2 * Math.PI * R;
  const dash = C * Math.min(pct, 100) / 100;

  el.innerHTML = `
    <div class="lim-wrap">
      <div class="lim-donut">
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="${R}" fill="none" stroke="var(--card2)" stroke-width="9"/>
          <circle cx="50" cy="50" r="${R}" fill="none" stroke="${cor}" stroke-width="9"
                  stroke-linecap="round" stroke-dasharray="${dash} ${C}"
                  transform="rotate(-90 50 50)"/>
        </svg>
        <div class="lim-pct" style="color:${cor}">${pct}%</div>
      </div>
      <div class="lim-info">
        <div class="lim-title">
          Limite do mês
          ${estourou ? '<span class="lim-badge">⚠ ESTOUROU</span>' : ''}
        </div>
        <div class="lim-vals"><strong>${BRL(gasto)}</strong> de ${BRL(meta)}</div>
        <div class="lim-diff" style="color:${cor}">
          ${estourou ? `Ultrapassou em ${BRL(gasto - meta)}` : `Restam ${BRL(meta - gasto)}`}
        </div>
        <div class="lim-link" onclick="switchTab('perfil')">Editar metas ›</div>
      </div>
    </div>`;
}

// ════════════════════════════════════════════════════════════
// 📚 ONDE FOI SEU DINHEIRO — top categorias
// ════════════════════════════════════════════════════════════
function renderOndeFoiDinheiro() {
  const el = document.getElementById('onde-foi-dinheiro');
  if (!el) return;

  const mesISO = _mesAtualISO();
  const somas = {};
  _txDoMes(mesISO).filter(t => t.tipo === 'despesa').forEach(t => {
    const c = t.categoria || 'outros';
    somas[c] = (somas[c] || 0) + (+t.valor || 0);
  });
  (allFaturas || []).filter(f => (f.data_venc || '').startsWith(mesISO)).forEach(f => {
    const c = f.categoria || 'compras';
    somas[c] = (somas[c] || 0) + (+f.valor || 0);
  });

  const itens = Object.entries(somas).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (!itens.length) { el.closest('.card-sec')?.style.setProperty('display', 'none'); return; }

  const cards = itens.map(([cat, val]) => {
    const conf  = (allCats || []).find(c => c.nome === cat);
    const lim   = +(conf?.limite_mensal || 0);
    const emoji = conf?.emoji || emojiFor(cat);
    const nome  = cat.charAt(0).toUpperCase() + cat.slice(1);
    const pct   = lim > 0 ? Math.min(100, Math.round((val / lim) * 100)) : 0;
    const over  = lim > 0 && val > lim;
    const cor   = !lim ? 'var(--muted2)' : over ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : 'var(--green)';
    const nota  = !lim
      ? 'Sem meta definida'
      : over ? `+${BRL(val - lim)} do limite` : `de ${BRL(lim)}`;
    return `
      <div class="ofd-card">
        <div class="ofd-top">
          <span class="ofd-emoji">${emoji}</span>
          <span class="ofd-nome">${nome}</span>
          <span class="ofd-val">${BRL(val)}</span>
        </div>
        <div class="ofd-bar"><div style="width:${lim ? pct : 0}%;background:${cor}"></div></div>
        <div class="ofd-nota" style="color:${over ? 'var(--red)' : 'var(--muted)'}">${nota}</div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="sec-head">
      <div class="sec-ico">📚</div>
      <div>
        <div class="sec-title">Onde foi seu dinheiro</div>
        <div class="sec-sub">Top categorias do mês</div>
      </div>
      <div class="sec-link" onclick="switchTab('transacoes')">Ver todas ›</div>
    </div>
    <div class="ofd-grid">${cards}</div>`;
}

// ════════════════════════════════════════════════════════════
// 📅 PRÓXIMOS 7 DIAS
// ════════════════════════════════════════════════════════════
function _compromissosJanela(dias = 7) {
  const hoje = today();
  const fim = new Date(Date.now() + dias * 86400000).toISOString().split('T')[0];
  const out = [];

  (allContas || []).filter(c => !c.paga && c.vencimento >= hoje && c.vencimento <= fim)
    .forEach(c => out.push({ tipo: 'conta', nome: c.descricao, valor: +c.valor || 0, data: c.vencimento, emoji: c.emoji || '🧾' }));

  (allAssinaturas || []).filter(a => a.ativa !== false).forEach(a => {
    const prox = a.proxima_cobranca || _proximaCobranca(a.dia_cobranca);
    if (prox >= hoje && prox <= fim) out.push({ tipo: 'assinatura', nome: a.nome, valor: +a.valor || 0, data: prox, emoji: a.emoji || '🔁' });
  });

  (allFaturas || []).filter(f => f.data_venc >= hoje && f.data_venc <= fim && !_isFatPagaSafe(f))
    .forEach(f => out.push({ tipo: 'fatura', nome: f.banco || f.descricao || 'Cartão', valor: +f.valor || 0, data: f.data_venc, emoji: '💳' }));

  return out.sort((a, b) => a.data.localeCompare(b.data));
}

function _isFatPagaSafe(f) {
  try { return typeof _isFatPaga === 'function' ? _isFatPaga(f) : false; } catch (e) { return false; }
}

function renderProximos7Dias() {
  const el = document.getElementById('proximos-7');
  if (!el) return;

  const itens = _compromissosJanela(7);
  const total = itens.reduce((s, i) => s + i.valor, 0);
  const hoje = today();

  if (!itens.length) {
    el.innerHTML = `
      <div class="sec-head">
        <div class="sec-ico">📅</div>
        <div><div class="sec-title">Próximos 7 dias</div></div>
      </div>
      <div class="p7-empty">Nada vencendo nos próximos 7 dias. ✨</div>
      <div class="sec-link p7-all" onclick="switchTab('contas')">Ver todos os compromissos ›</div>`;
    return;
  }

  const linhas = itens.slice(0, 6).map(i => {
    const dias = Math.round((new Date(i.data + 'T12:00:00') - new Date(hoje + 'T12:00:00')) / 86400000);
    const urg = dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : `em ${dias}d`;
    const cor = dias === 0 ? 'var(--red)' : dias <= 2 ? 'var(--amber)' : 'var(--muted)';
    return `
      <div class="p7-row">
        <span class="p7-emoji">${i.emoji}</span>
        <span class="p7-nome">${i.nome}</span>
        <span class="p7-quando" style="color:${cor}">${urg}</span>
        <span class="p7-val">${BRL(i.valor)}</span>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="sec-head">
      <div class="sec-ico">📅</div>
      <div>
        <div class="sec-title">Próximos 7 dias</div>
        <div class="sec-sub">${itens.length} compromisso(s) · ${BRL(total)}</div>
      </div>
    </div>
    <div class="p7-list">${linhas}</div>
    ${itens.length > 6 ? `<div class="p7-mais">+${itens.length - 6} outros</div>` : ''}
    <div class="sec-link p7-all" onclick="switchTab('contas')">Ver todos os compromissos ›</div>`;
}

// ════════════════════════════════════════════════════════════
// 🗓 CARROSSEL DE MESES
// ════════════════════════════════════════════════════════════
function renderMesesCarrossel() {
  const el = document.getElementById('meses-carrossel');
  if (!el) return;

  const hoje = new Date();
  const ativo = _mesAtualISO();
  let html = '';

  for (let i = -6; i <= 2; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const tx = (allTx || []).filter(t => (t.data || '').startsWith(iso));
    const gastos = tx.filter(t => t.tipo === 'despesa').reduce((s, t) => s + (+t.valor || 0), 0)
                 + (allFaturas || []).filter(f => (f.data_venc || '').startsWith(iso)).reduce((s, f) => s + (+f.valor || 0), 0);
    const receitas = tx.filter(t => t.tipo === 'receita').reduce((s, t) => s + (+t.valor || 0), 0);
    const saldo = receitas - gastos;
    const vazio = !gastos && !receitas;
    const isAtivo = iso === ativo;

    html += `
      <div class="mes-card${isAtivo ? ' mes-ativo' : ''}" onclick="irParaMes('${iso}')">
        <div class="mes-lbl">${MONTHS_SHORT[d.getMonth()].toUpperCase()}/${String(d.getFullYear()).slice(2)}</div>
        <div class="mes-saldo" style="color:${vazio ? 'var(--muted2)' : saldo >= 0 ? 'var(--green)' : 'var(--red)'}">
          ${vazio ? '—' : (saldo >= 0 ? '' : '-') + BRLk(Math.abs(saldo))}
        </div>
        <div class="mes-mini">
          <span style="color:var(--green)">▲ ${vazio ? '—' : BRLk(receitas)}</span>
          <span style="color:var(--red)">▼ ${vazio ? '—' : BRLk(gastos)}</span>
        </div>
      </div>`;
  }

  el.innerHTML = html;
  const alvo = el.querySelector('.mes-ativo');
  if (alvo) alvo.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function irParaMes(iso) {
  const [a, m] = iso.split('-').map(Number);
  const agora = new Date();
  _mesRef = (a === agora.getFullYear() && m - 1 === agora.getMonth()) ? null : new Date(a, m - 1, 1);
  renderMapaCalor();
  renderLimiteMesCard();
  renderOndeFoiDinheiro();
  renderMesesCarrossel();
  const lbl = document.getElementById('mes-atual-label');
  if (lbl) lbl.textContent = `${MONTHS_FULL[m - 1]} ${a}`;
}

// ════════════════════════════════════════════════════════════
// 💳 ABA CONTAS — Recorrentes | Avulsas | Assinaturas
// ════════════════════════════════════════════════════════════
let _contasTab = 'assinaturas';

function setContasTab(t) {
  _contasTab = t;
  ['recorrentes', 'avulsas', 'assinaturas'].forEach(k => {
    const b = document.getElementById('ct-tab-' + k);
    if (b) b.classList.toggle('active', k === t);
  });
  renderContas();
}

function renderContas() {
  const el = document.getElementById('contas-body');
  if (!el) return;
  if (_contasTab === 'assinaturas') return renderAssinaturas(el);
  return renderContasLista(el, _contasTab === 'recorrentes' ? 'recorrente' : 'avulsa');
}

// ── Assinaturas ────────────────────────────────────────────
function renderAssinaturas(el) {
  const lista = (allAssinaturas || []).slice().sort((a, b) => (a.dia_cobranca || 0) - (b.dia_cobranca || 0));
  const ativas = lista.filter(a => a.ativa !== false);
  const custo  = ativas.reduce((s, a) => s + (+a.valor || 0), 0);

  // Carrossel de custo por mês (5 meses)
  const hoje = new Date();
  let meses = '';
  for (let i = 0; i < 5; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1);
    const isAtual = i === 0;
    meses += `
      <div class="assin-mes${isAtual ? ' assin-mes-on' : ''}">
        <div class="assin-mes-lbl">${MONTHS_SHORT[d.getMonth()].toUpperCase()}${isAtual ? ' <i class="dot"></i>' : ''}</div>
        <div class="assin-mes-val">${BRL(custo)}</div>
        <div class="assin-mes-qtd">${ativas.length} assinatura${ativas.length === 1 ? '' : 's'}</div>
      </div>`;
  }

  const linhas = lista.map(a => {
    const prox = a.proxima_cobranca || _proximaCobranca(a.dia_cobranca);
    const p = new Date(prox + 'T12:00:00');
    const on = a.ativa !== false;
    return `
      <div class="assin-row${on ? '' : ' assin-off'}">
        <button class="assin-toggle${on ? ' on' : ''}" onclick="toggleAssinatura('${a.id}')" aria-label="Ativar/desativar"><span></span></button>
        <div class="assin-info" onclick="abrirModalAssinatura('${a.id}')">
          <div class="assin-nome">${a.emoji || '🔁'} ${a.nome}</div>
          <div class="assin-meta">
            ${BRL(+a.valor || 0)}/mês
            <span class="assin-chip">Todo dia ${a.dia_cobranca} · próx ${p.getDate()} ${MONTHS_SHORT[p.getMonth()].toLowerCase()}</span>
          </div>
        </div>
        <button class="assin-del" onclick="deletarAssinatura('${a.id}')">✕</button>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="ct-hint">💡 Cobrança automática de valor fixo — Netflix, Spotify, academia digital, iCloud.</div>
    <div class="ct-sec-title">🔁 Assinaturas</div>
    <div class="assin-meses-lbl">📋 CUSTO POR MÊS</div>
    <div class="assin-meses">${meses}</div>
    <div class="assin-estimado">
      <div class="assin-estimado-lbl">Custo mensal estimado</div>
      <div class="assin-estimado-val">${BRL(custo)}</div>
    </div>
    <div class="assin-list">${linhas || '<div class="ct-empty">Nenhuma assinatura cadastrada ainda.</div>'}</div>
    <button class="ct-add" onclick="abrirModalAssinatura()">+ Nova assinatura</button>
    <div id="assin-sugestoes" class="sug-box" style="display:none"></div>`;
  setTimeout(renderSugestoesAssinatura, 0);
}

async function toggleAssinatura(id) {
  if (bloqueadoPorTrial()) return;
  const a = (allAssinaturas || []).find(x => String(x.id) === String(id));
  if (!a) return;
  const novo = !(a.ativa !== false);
  a.ativa = novo;
  renderContas();
  const { error } = await sb.from('assinaturas_usuario').update({ ativa: novo }).eq('id', id).eq('user_id', USER_ID);
  if (error) { a.ativa = !novo; renderContas(); showToast('Erro ao salvar', 'error'); return; }
  showToast(novo ? 'Assinatura ativada' : 'Assinatura pausada');
  renderProximos7Dias();
}

async function deletarAssinatura(id) {
  if (bloqueadoPorTrial()) return;
  if (!await confirmar({
    emoji: '🗑', titulo: 'Excluir assinatura?', perigo: true,
    texto: 'As transações já lançadas continuam no seu extrato.',
    confirmar: 'Excluir'
  })) return;
  const { error } = await sb.from('assinaturas_usuario').delete().eq('id', id).eq('user_id', USER_ID);
  if (error) { showToast('Erro ao excluir', 'error'); return; }
  allAssinaturas = (allAssinaturas || []).filter(a => String(a.id) !== String(id));
  renderContas(); renderProximos7Dias();
  showToast('Assinatura excluída');
}

function abrirModalAssinatura(id) {
  const a = id ? (allAssinaturas || []).find(x => String(x.id) === String(id)) : null;
  let m = document.getElementById('modal-assinatura');
  if (!m) {
    m = document.createElement('div');
    m.id = 'modal-assinatura';
    m.className = 'modal-overlay';
    m.onclick = e => { if (e.target === m) fecharModalAssinatura(); };
    document.body.appendChild(m);
  }
  m.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">${a ? 'Editar' : 'Nova'} assinatura</div>
      <input type="hidden" id="as-id" value="${a?.id || ''}">
      <label class="fld-lbl">Nome</label>
      <input id="as-nome" class="fld" placeholder="Netflix" value="${a?.nome || ''}">
      <label class="fld-lbl">Valor mensal</label>
      <input id="as-valor" class="fld" inputmode="decimal" placeholder="0,00" value="${a ? (+a.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : ''}" oninput="_fmtMoedaSimples(this)">
      <label class="fld-lbl">Dia da cobrança</label>
      <input id="as-dia" class="fld" type="number" min="1" max="31" value="${a?.dia_cobranca || 1}">
      <label class="fld-lbl">Emoji</label>
      <input id="as-emoji" class="fld" maxlength="4" placeholder="🔁" value="${a?.emoji || ''}">
      <label class="fld-lbl">Categoria</label>
      <select id="as-cat" class="fld">
        ${['assinaturas', 'lazer', 'educacao', 'saude', 'compras', 'outros']
          .map(c => `<option value="${c}" ${a?.categoria === c ? 'selected' : ''}>${emojiFor(c)} ${c.charAt(0).toUpperCase() + c.slice(1)}</option>`).join('')}
      </select>
      <div class="modal-actions">
        <button class="btn-ghost" onclick="fecharModalAssinatura()">Cancelar</button>
        <button class="btn-primary" onclick="salvarAssinatura()">Salvar</button>
      </div>
    </div>`;
  m.style.display = 'flex';
}

function fecharModalAssinatura() {
  const m = document.getElementById('modal-assinatura');
  if (m) m.style.display = 'none';
}

function _fmtMoedaSimples(inp) {
  const raw = inp.value.replace(/\D/g, '');
  if (!raw) { inp.value = ''; inp.dataset.raw = '0'; return; }
  const v = parseInt(raw, 10) / 100;
  inp.dataset.raw = v;
  inp.value = v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function _lerMoeda(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  if (el.dataset.raw) return parseFloat(el.dataset.raw) || 0;
  return parseFloat((el.value || '0').replace(/\./g, '').replace(',', '.')) || 0;
}

async function salvarAssinatura() {
  if (bloqueadoPorTrial()) return;
  const id    = document.getElementById('as-id')?.value || null;
  const nome  = (document.getElementById('as-nome')?.value || '').trim();
  const valor = _lerMoeda('as-valor');
  const dia   = Math.min(31, Math.max(1, +document.getElementById('as-dia')?.value || 1));
  const emoji = (document.getElementById('as-emoji')?.value || '').trim() || null;
  const cat   = document.getElementById('as-cat')?.value || 'assinaturas';

  if (!nome)     { showToast('Informe o nome', 'error'); return; }
  if (valor <= 0) { showToast('Informe o valor', 'error'); return; }

  const payload = {
    user_id: USER_ID, nome, valor, dia_cobranca: dia,
    categoria: cat, emoji, ativa: true,
    proxima_cobranca: _proximaCobranca(dia)
  };

  let res;
  if (id) res = await sb.from('assinaturas_usuario').update(payload).eq('id', id).eq('user_id', USER_ID).select().single();
  else    res = await sb.from('assinaturas_usuario').insert(payload).select().single();

  if (res.error) { showToast('Erro ao salvar: ' + res.error.message, 'error'); return; }

  if (id) allAssinaturas = allAssinaturas.map(a => String(a.id) === String(id) ? res.data : a);
  else    allAssinaturas.push(res.data);

  fecharModalAssinatura();
  renderContas(); renderProximos7Dias();
  showToast('Assinatura salva ✅');
}

// ── Contas (recorrentes / avulsas) ─────────────────────────
function renderContasLista(el, tipo) {
  const lista = (allContas || []).filter(c => c.tipo === tipo)
    .sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || ''));
  const abertas = lista.filter(c => !c.paga);
  const total = abertas.reduce((s, c) => s + (+c.valor || 0), 0);
  const hoje = today();

  const hint = tipo === 'recorrente'
    ? '💡 Contas que se repetem todo mês com valor variável — luz, água, internet, aluguel.'
    : '💡 Contas pontuais que não se repetem — conserto, presente, matrícula.';

  const linhas = lista.map(c => {
    const atrasada = !c.paga && c.vencimento < hoje;
    return `
      <div class="conta-row${c.paga ? ' conta-paga' : ''}">
        <button class="conta-check${c.paga ? ' on' : ''}" onclick="toggleContaPaga('${c.id}')">${c.paga ? '✓' : ''}</button>
        <div class="conta-info" onclick="abrirModalConta('${c.id}')">
          <div class="conta-nome">${c.emoji || '🧾'} ${c.descricao}</div>
          <div class="conta-meta" style="color:${atrasada ? 'var(--red)' : 'var(--muted)'}">
            ${atrasada ? '⚠ vencida · ' : ''}vence ${fmtDate(c.vencimento)}
            ${c.recorrencia ? ` · ${c.recorrencia}` : ''}
          </div>
        </div>
        <div class="conta-val">${BRL(+c.valor || 0)}</div>
        <button class="assin-del" onclick="deletarConta('${c.id}')">✕</button>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="ct-hint">${hint}</div>
    <div class="ct-sec-title">${tipo === 'recorrente' ? '🔄 Recorrentes' : '📄 Avulsas'}</div>
    <div class="assin-estimado">
      <div class="assin-estimado-lbl">Em aberto</div>
      <div class="assin-estimado-val">${BRL(total)}</div>
    </div>
    <div class="assin-list">${linhas || '<div class="ct-empty">Nenhuma conta cadastrada.</div>'}</div>
    <button class="ct-add" onclick="abrirModalConta()">+ Nova conta</button>`;
}

async function toggleContaPaga(id) {
  if (bloqueadoPorTrial()) return;
  const c = (allContas || []).find(x => String(x.id) === String(id));
  if (!c) return;

  // Marcar como paga passa pelo mesmo caminho do "A pagar", para que
  // o lancamento no extrato seja criado. Assim nao existem dois jeitos
  // de pagar uma conta com resultados diferentes.
  if (!c.paga) {
    if (typeof pagarItem === 'function') return pagarItem('conta', id);
  }

  // Reabrir: desfaz o lancamento correspondente, senao ele fica orfao
  // no extrato e o gasto conta duas vezes.
  c.paga = false;
  renderContas();
  const { error } = await sb.from('contas_pagar')
    .update({ paga: false, paga_em: null }).eq('id', id).eq('user_id', USER_ID);
  if (error) { c.paga = true; renderContas(); showToast('Erro ao salvar', 'error'); return; }

  await sb.from('transacoes').delete().eq('user_id', USER_ID).eq('conta_id', id);
  allTx = (allTx || []).filter(t => String(t.conta_id) !== String(id));

  showToast('Conta reaberta — lançamento removido do extrato');
  if (typeof _apAtualizarTudo === 'function') _apAtualizarTudo();
}

async function deletarConta(id) {
  if (bloqueadoPorTrial()) return;
  if (!await confirmar({
    emoji: '🗑', titulo: 'Excluir esta conta?', perigo: true,
    confirmar: 'Excluir'
  })) return;
  const { error } = await sb.from('contas_pagar').delete().eq('id', id).eq('user_id', USER_ID);
  if (error) { showToast('Erro ao excluir', 'error'); return; }
  allContas = (allContas || []).filter(c => String(c.id) !== String(id));
  renderContas(); renderProximos7Dias();
  showToast('Conta excluída');
}

function abrirModalConta(id) {
  const c = id ? (allContas || []).find(x => String(x.id) === String(id)) : null;
  const tipo = c?.tipo || (_contasTab === 'recorrentes' ? 'recorrente' : 'avulsa');
  let m = document.getElementById('modal-conta');
  if (!m) {
    m = document.createElement('div');
    m.id = 'modal-conta';
    m.className = 'modal-overlay';
    m.onclick = e => { if (e.target === m) fecharModalConta(); };
    document.body.appendChild(m);
  }
  m.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">${c ? 'Editar' : 'Nova'} conta ${tipo}</div>
      <input type="hidden" id="ct-id" value="${c?.id || ''}">
      <input type="hidden" id="ct-tipo" value="${tipo}">
      <label class="fld-lbl">Descrição</label>
      <input id="ct-desc" class="fld" placeholder="Conta de luz" value="${c?.descricao || ''}">
      <label class="fld-lbl">Valor</label>
      <input id="ct-valor" class="fld" inputmode="decimal" placeholder="0,00" value="${c ? (+c.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : ''}" oninput="_fmtMoedaSimples(this)">
      <label class="fld-lbl">Vencimento</label>
      <input id="ct-venc" class="fld" type="date" value="${c?.vencimento || today()}">
      <label class="fld-lbl">Emoji</label>
      <input id="ct-emoji" class="fld" maxlength="4" placeholder="🧾" value="${c?.emoji || ''}">
      <label class="fld-lbl">Categoria</label>
      <select id="ct-cat" class="fld">
        ${['moradia', 'transporte', 'saude', 'educacao', 'alimentacao', 'outros']
          .map(k => `<option value="${k}" ${c?.categoria === k ? 'selected' : ''}>${emojiFor(k)} ${k.charAt(0).toUpperCase() + k.slice(1)}</option>`).join('')}
      </select>
      ${tipo === 'recorrente' ? `
        <label class="fld-lbl">Repetição</label>
        <select id="ct-rec" class="fld">
          <option value="mensal" ${c?.recorrencia === 'mensal' ? 'selected' : ''}>Mensal</option>
          <option value="anual"  ${c?.recorrencia === 'anual' ? 'selected' : ''}>Anual</option>
        </select>` : ''}
      <div class="modal-actions">
        <button class="btn-ghost" onclick="fecharModalConta()">Cancelar</button>
        <button class="btn-primary" onclick="salvarConta()">Salvar</button>
      </div>
    </div>`;
  m.style.display = 'flex';
}

function fecharModalConta() {
  const m = document.getElementById('modal-conta');
  if (m) m.style.display = 'none';
}

async function salvarConta() {
  if (bloqueadoPorTrial()) return;
  const id    = document.getElementById('ct-id')?.value || null;
  const tipo  = document.getElementById('ct-tipo')?.value || 'avulsa';
  const desc  = (document.getElementById('ct-desc')?.value || '').trim();
  const valor = _lerMoeda('ct-valor');
  const venc  = document.getElementById('ct-venc')?.value || today();
  const emoji = (document.getElementById('ct-emoji')?.value || '').trim() || null;
  const cat   = document.getElementById('ct-cat')?.value || 'outros';
  const rec   = document.getElementById('ct-rec')?.value || null;

  if (!desc)      { showToast('Informe a descrição', 'error'); return; }
  if (valor <= 0) { showToast('Informe o valor', 'error'); return; }

  const payload = {
    user_id: USER_ID, descricao: desc, valor, vencimento: venc,
    tipo, categoria: cat, emoji, paga: false,
    recorrencia: tipo === 'recorrente' ? (rec || 'mensal') : null
  };

  let res;
  if (id) res = await sb.from('contas_pagar').update(payload).eq('id', id).eq('user_id', USER_ID).select().single();
  else    res = await sb.from('contas_pagar').insert(payload).select().single();

  if (res.error) { showToast('Erro ao salvar: ' + res.error.message, 'error'); return; }

  if (id) allContas = allContas.map(c => String(c.id) === String(id) ? res.data : c);
  else    allContas.push(res.data);

  fecharModalConta();
  renderContas(); renderProximos7Dias();
  showToast('Conta salva ✅');
}

// ════════════════════════════════════════════════════════════
// ⚙️ MOTOR DE RECORRÊNCIA (fallback client-side)
// ════════════════════════════════════════════════════════════
// O n8n roda o cron diário e é a fonte principal. Isto aqui é a rede
// de segurança: se o app abrir e houver assinatura vencida sem
// lançamento, cria a transação. Idempotente via (assinatura_id, data).
async function processarRecorrencias() {
  if (MODO_LEITURA) return;   // silencioso: roda sozinha, nao avisa nada
  if (!USER_ID || !allAssinaturas?.length) return;
  const hoje = today();
  const pendentes = allAssinaturas.filter(a =>
    a.ativa !== false && (a.proxima_cobranca || _proximaCobranca(a.dia_cobranca)) <= hoje
  );
  if (!pendentes.length) return;

  for (const a of pendentes) {
    const dataCobranca = a.proxima_cobranca || _proximaCobranca(a.dia_cobranca);

    // Idempotência: já existe transação dessa assinatura nessa data?
    const { data: existe } = await sb.from('transacoes').select('id')
      .eq('user_id', USER_ID).eq('assinatura_id', a.id).eq('data', dataCobranca).limit(1);
    if (existe?.length) { await _avancarAssinatura(a, dataCobranca); continue; }

    const { error } = await sb.from('transacoes').insert({
      user_id: USER_ID, tipo: 'despesa', valor: +a.valor || 0,
      categoria: a.categoria || 'assinaturas',
      descricao: a.nome, data: dataCobranca,
      origem: 'assinatura', assinatura_id: a.id
    });
    if (error) { console.warn('[Lumnis] recorrência falhou:', a.nome, error.message); continue; }
    await _avancarAssinatura(a, dataCobranca);
  }

  // Recarrega transações
  const { data: novas } = await sb.from('transacoes').select('*')
    .eq('user_id', USER_ID).is('deleted_at', null).order('data', { ascending: false }).limit(400);
  if (novas) { allTx = novas; if (typeof renderHome === 'function') renderHome(userData); }
}

async function _avancarAssinatura(a, aPartirDe) {
  const prox = _proximaCobranca(a.dia_cobranca, _somaDia(aPartirDe));
  a.proxima_cobranca = prox;
  await sb.from('assinaturas_usuario').update({ proxima_cobranca: prox }).eq('id', a.id).eq('user_id', USER_ID);
}

function _somaDia(iso) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

// ════════════════════════════════════════════════════════════
// 🔎 DETECTOR DE ASSINATURAS — lê faturas/transações já importadas
// ════════════════════════════════════════════════════════════
// Custo zero: não usa API externa. Procura a MESMA descrição com valor
// parecido repetindo em meses diferentes e sugere cadastrar como assinatura.

const _RX_ASSINATURA = /netflix|spotify|disney|hbo|max\b|prime video|amazon prime|youtube|deezer|tidal|apple\s?(music|tv|one|icloud)|icloud|google\s?one|dropbox|notion|canva|adobe|office\s?365|microsoft\s?365|playstation|xbox|nintendo|crunchyroll|globoplay|paramount|star\+|telecine|kindle|audible|duolingo|chatgpt|openai|claude|midjourney|smartfit|gympass|totalpass/i;

function _normDesc(d) {
  return (d || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\d{2,}/g, '')
    .replace(/parcela|parc\.?|\d+\/\d+/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function detectarAssinaturasCandidatas() {
  const fontes = [
    ...(allTx || []).filter(t => t.tipo === 'despesa' && t.origem !== 'assinatura')
      .map(t => ({ desc: t.descricao, valor: +t.valor || 0, data: t.data, cat: t.categoria })),
    ...(allFaturas || []).map(f => ({ desc: f.descricao, valor: +f.valor || 0, data: f.data_venc, cat: f.categoria }))
  ].filter(x => x.desc && x.valor > 0 && x.data);

  // Já cadastradas — não sugerir de novo
  const jaTem = new Set((allAssinaturas || []).map(a => _normDesc(a.nome)));

  const grupos = {};
  fontes.forEach(x => {
    const k = _normDesc(x.desc);
    if (!k || k.length < 3 || jaTem.has(k)) return;
    (grupos[k] = grupos[k] || []).push(x);
  });

  const candidatas = [];
  Object.entries(grupos).forEach(([chave, itens]) => {
    const meses = new Set(itens.map(i => (i.data || '').substring(0, 7)));
    if (meses.size < 2) return; // precisa repetir em pelo menos 2 meses

    const valores = itens.map(i => i.valor);
    const media = valores.reduce((s, v) => s + v, 0) / valores.length;
    // Valor estável: desvio máximo de 12% da média
    const estavel = valores.every(v => Math.abs(v - media) / Math.max(media, 1) <= 0.12);

    const nomeConhecido = _RX_ASSINATURA.test(itens[0].desc);
    if (!estavel && !nomeConhecido) return;
    if (meses.size < 3 && !nomeConhecido) return; // desconhecido exige 3 meses

    const dias = itens.map(i => +(i.data || '').split('-')[2]).filter(Boolean);
    const diaTipico = dias.length
      ? dias.sort((a, b) => dias.filter(d => d === a).length - dias.filter(d => d === b).length).pop()
      : 1;

    candidatas.push({
      chave,
      nome: (itens[0].desc || chave).trim().slice(0, 40),
      valor: Math.round(media * 100) / 100,
      dia: diaTipico,
      meses: meses.size,
      categoria: itens[0].cat || 'assinaturas',
      confianca: nomeConhecido ? 'alta' : 'media'
    });
  });

  return candidatas.sort((a, b) => b.meses - a.meses || b.valor - a.valor);
}

function renderSugestoesAssinatura() {
  const el = document.getElementById('assin-sugestoes');
  if (!el) return;
  const cands = detectarAssinaturasCandidatas()
    .filter(c => !_sugestoesIgnoradas().includes(c.chave))
    .slice(0, 5);

  if (!cands.length) { el.style.display = 'none'; return; }
  el.style.display = '';

  el.innerHTML = `
    <div class="sug-head">🔎 Encontrei cobranças que se repetem</div>
    <div class="sug-sub">Detectado no seu extrato e nas faturas importadas — nenhum dado sai do app.</div>
    ${cands.map(c => `
      <div class="sug-row">
        <div class="sug-info">
          <div class="sug-nome">${c.nome}${c.confianca === 'alta' ? ' <span class="sug-badge">provável</span>' : ''}</div>
          <div class="sug-meta">${BRL(c.valor)} · ${c.meses} meses seguidos · dia ${c.dia}</div>
        </div>
        <button class="sug-add" onclick='_criarAssinaturaDaSugestao(${JSON.stringify(c).replace(/'/g, "&#39;")})'>Cadastrar</button>
        <button class="sug-no" onclick="_ignorarSugestao('${c.chave}')">✕</button>
      </div>`).join('')}`;
}

const _SUG_IGNORE_KEY = 'lumnis_sug_ignoradas';
function _sugestoesIgnoradas() {
  try { return JSON.parse(localStorage.getItem(_SUG_IGNORE_KEY) || '[]'); } catch (e) { return []; }
}
function _ignorarSugestao(chave) {
  const l = _sugestoesIgnoradas();
  if (!l.includes(chave)) l.push(chave);
  try { localStorage.setItem(_SUG_IGNORE_KEY, JSON.stringify(l)); } catch (e) {}
  renderSugestoesAssinatura();
}

async function _criarAssinaturaDaSugestao(c) {
  if (bloqueadoPorTrial()) return;
  const payload = {
    user_id: USER_ID, nome: c.nome, valor: c.valor,
    dia_cobranca: Math.min(31, Math.max(1, c.dia)),
    categoria: c.categoria || 'assinaturas', emoji: null, ativa: true,
    proxima_cobranca: _proximaCobranca(c.dia)
  };
  const { data, error } = await sb.from('assinaturas_usuario').insert(payload).select().single();
  if (error) { showToast('Erro: ' + error.message, 'error'); return; }
  allAssinaturas.push(data);
  _ignorarSugestao(c.chave);
  renderContas(); renderProximos7Dias();
  showToast(`${c.nome} cadastrada ✅`);
}
