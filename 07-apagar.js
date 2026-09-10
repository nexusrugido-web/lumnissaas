// ════════════════════════════════════════════════════════════
// 07-apagar.js — Aba "A Pagar": tudo que ainda vai sair, num lugar só
// ════════════════════════════════════════════════════════════
//
// Antes existiam 4 telas paralelas (Faturas, Recorrentes, Avulsas,
// Assinaturas) que nunca se falavam. O eixo aqui não é "que tipo de
// coisa é", e sim "já saiu ou ainda vai sair". Isto é o "ainda vai".
//
// E o ciclo fecha: marcar como paga cria o lançamento no Extrato.
// ════════════════════════════════════════════════════════════

let _apFiltro = 'todos';

const _AP_TIPOS = {
  cartao:     { label: 'Cartão',      emoji: '💳', cor: 'var(--purple)' },
  recorrente: { label: 'Recorrente',  emoji: '🔄', cor: 'var(--cyan)'   },
  avulsa:     { label: 'Avulsa',      emoji: '🧾', cor: 'var(--amber)'  },
  assinatura: { label: 'Assinatura',  emoji: '🔁', cor: 'var(--green)'  },
};

// ── Junta as quatro fontes numa linha do tempo só ─────────────
function _apColetar() {
  const itens = [];

  (allContas || []).filter(c => !c.paga).forEach(c => itens.push({
    id: c.id, fonte: 'conta', tipo: c.tipo === 'recorrente' ? 'recorrente' : 'avulsa',
    nome: c.descricao, valor: +c.valor || 0, data: c.vencimento,
    emoji: c.emoji, categoria: c.categoria, podePagar: true
  }));

  (allAssinaturas || []).filter(a => a.ativa !== false).forEach(a => {
    const prox = a.proxima_cobranca || _proximaCobranca(a.dia_cobranca);
    itens.push({
      id: a.id, fonte: 'assinatura', tipo: 'assinatura',
      nome: a.nome, valor: +a.valor || 0, data: prox,
      emoji: a.emoji, categoria: a.categoria, podePagar: false,
      nota: `todo dia ${a.dia_cobranca}`
    });
  });

  (allFaturas || []).filter(f => !_isFatPagaSafe(f)).forEach(f => itens.push({
    id: f.id, fonte: 'fatura', tipo: 'cartao',
    nome: f.descricao || f.cartao || 'Cartão',
    valor: +f.valor || 0, data: f.data_venc,
    emoji: '💳', categoria: f.categoria, podePagar: false,
    nota: f.cartao || null
  }));

  return itens.sort((a, b) => (a.data || '').localeCompare(b.data || ''));
}

function setApFiltro(f) {
  _apFiltro = f;
  renderAPagar();
}

function renderAPagar() {
  const el = document.getElementById('apagar-body');
  if (!el) return;

  const todos = _apColetar();
  const itens = _apFiltro === 'todos' ? todos : todos.filter(i => i.tipo === _apFiltro);
  const hoje = today();

  // Chips de filtro com contagem real
  const contagem = { todos: todos.length };
  Object.keys(_AP_TIPOS).forEach(t => contagem[t] = todos.filter(i => i.tipo === t).length);
  const chips = ['todos', ...Object.keys(_AP_TIPOS)]
    .filter(t => t === 'todos' || contagem[t] > 0)
    .map(t => {
      const lbl = t === 'todos' ? 'Tudo' : _AP_TIPOS[t].label;
      return `<button class="ap-chip${_apFiltro === t ? ' on' : ''}" onclick="setApFiltro('${t}')">
                ${lbl} <span>${contagem[t]}</span>
              </button>`;
    }).join('');

  // Totais
  const total   = itens.reduce((s, i) => s + i.valor, 0);
  const em7     = itens.filter(i => i.data >= hoje && i.data <= _apDias(7));
  const vencidas = itens.filter(i => i.data < hoje);

  // Agrupa por mês
  const grupos = {};
  itens.forEach(i => {
    const k = (i.data || '').substring(0, 7);
    (grupos[k] = grupos[k] || []).push(i);
  });

  const corpo = Object.entries(grupos).map(([mes, lista]) => {
    const [a, m] = mes.split('-').map(Number);
    const somaMes = lista.reduce((s, i) => s + i.valor, 0);
    const linhas = lista.map(i => {
      const dias = Math.round((new Date(i.data + 'T12:00:00') - new Date(hoje + 'T12:00:00')) / 86400000);
      const atrasado = dias < 0;
      const quando = atrasado ? `${-dias}d atrás`
                   : dias === 0 ? 'hoje'
                   : dias === 1 ? 'amanhã' : `em ${dias}d`;
      const cor = atrasado ? 'var(--red)' : dias === 0 ? 'var(--red)' : dias <= 2 ? 'var(--amber)' : 'var(--muted)';
      const t = _AP_TIPOS[i.tipo];
      return `
        <div class="ap-item${atrasado ? ' ap-atrasado' : ''}">
          ${i.podePagar
            ? `<button class="ap-check" onclick="pagarItem('${i.fonte}','${i.id}')" title="Marcar como paga"></button>`
            : `<span class="ap-emoji">${i.emoji || t.emoji}</span>`}
          <div class="ap-info" onclick="_apAbrir('${i.fonte}','${i.id}')">
            <div class="ap-nome">${i.nome}</div>
            <div class="ap-meta">
              <span class="ap-tag" style="color:${t.cor};border-color:${t.cor}">${t.label}</span>
              <span style="color:${cor}">${atrasado ? '⚠ ' : ''}${quando}</span>
              <span class="ap-data">${fmtDate(i.data)}</span>
            </div>
          </div>
          <div class="ap-valor">${BRL(i.valor)}</div>
        </div>`;
    }).join('');
    return `
      <div class="ap-grupo">
        <div class="ap-grupo-head">
          <span>${MONTHS_FULL[m - 1]} ${a}</span>
          <strong>${BRL(somaMes)}</strong>
        </div>
        ${linhas}
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="ap-chips">${chips}</div>

    <div class="ap-resumo">
      <div class="ap-resumo-item">
        <div class="ap-resumo-lbl">Total em aberto</div>
        <div class="ap-resumo-val">${BRL(total)}</div>
      </div>
      <div class="ap-resumo-item">
        <div class="ap-resumo-lbl">Próximos 7 dias</div>
        <div class="ap-resumo-val" style="color:var(--amber)">${BRL(em7.reduce((s,i)=>s+i.valor,0))}</div>
      </div>
      ${vencidas.length ? `
      <div class="ap-resumo-item">
        <div class="ap-resumo-lbl">Vencidas</div>
        <div class="ap-resumo-val" style="color:var(--red)">${vencidas.length}</div>
      </div>` : ''}
    </div>

    ${corpo || '<div class="ap-vazio">Nada a pagar por aqui. ✨</div>'}

    <div class="ap-acoes">
      <button onclick="abrirModalConta()">＋ Conta</button>
      <button onclick="abrirModalAssinatura()">＋ Assinatura</button>
      <button onclick="switchTab('faturas')">💳 Faturas do cartão</button>
    </div>`;
}

function _apDias(n) {
  return new Date(Date.now() + n * 86400000).toISOString().split('T')[0];
}

function _apAbrir(fonte, id) {
  if (fonte === 'conta')      return abrirModalConta(id);
  if (fonte === 'assinatura') return abrirModalAssinatura(id);
  if (fonte === 'fatura')     return switchTab('faturas');
}

// ════════════════════════════════════════════════════════════
// 🔗 O CICLO: pagar aqui vira lançamento no Extrato
// ════════════════════════════════════════════════════════════
async function pagarItem(fonte, id) {
  if (bloqueadoPorTrial()) return;
  if (fonte !== 'conta') return;

  const c = (allContas || []).find(x => String(x.id) === String(id));
  if (!c) return;
  if (!await confirmar({
    emoji: '✅', titulo: `Marcar "${c.descricao}" como paga?`,
    texto: `Isso lança <strong>${BRL(+c.valor)}</strong> no seu extrato de hoje.`,
    detalhe: c.recorrencia ? 'A próxima já será criada automaticamente.' : '',
    confirmar: 'Sim, paguei'
  })) return;

  const hoje = today();

  // 1) cria o lançamento — é isto que faltava: as duas telas eram
  //    bancos paralelos que nunca se falavam.
  const { data: tx, error: errTx } = await sb.from('transacoes').insert({
    user_id: USER_ID, tipo: 'despesa', valor: +c.valor || 0,
    categoria: c.categoria || 'outros', descricao: c.descricao,
    data: hoje, origem: 'conta', conta_id: c.id
  }).select().single();

  if (errTx) {
    showToast('Não consegui lançar no extrato: ' + errTx.message, 'error');
    return;
  }

  // 2) marca a conta como paga
  const { error: errC } = await sb.from('contas_pagar')
    .update({ paga: true, paga_em: hoje }).eq('id', c.id).eq('user_id', USER_ID);
  if (errC) {
    // desfaz o lançamento para não deixar duplicidade órfã
    await sb.from('transacoes').delete().eq('id', tx.id);
    showToast('Erro ao marcar como paga. Nada foi alterado.', 'error');
    return;
  }

  c.paga = true; c.paga_em = hoje;
  allTx.unshift(tx);

  // 3) se for recorrente, já cria a próxima
  if (c.recorrencia === 'mensal' || c.recorrencia === 'anual') {
    const d = new Date(c.vencimento + 'T12:00:00');
    if (c.recorrencia === 'mensal') d.setMonth(d.getMonth() + 1);
    else d.setFullYear(d.getFullYear() + 1);
    const proxima = d.toISOString().split('T')[0];

    const { data: nova } = await sb.from('contas_pagar').insert({
      user_id: USER_ID, descricao: c.descricao, valor: c.valor,
      vencimento: proxima, tipo: c.tipo, categoria: c.categoria,
      emoji: c.emoji, paga: false, recorrencia: c.recorrencia
    }).select().single();
    if (nova) allContas.push(nova);
  }

  showToast(`✅ Pago e lançado no extrato`);
  _apAtualizarTudo();
}

// Um único ponto de atualização: pagar algo mexe em várias telas.
function _apAtualizarTudo() {
  if (typeof renderAPagar === 'function')        _safeRender('a-pagar', renderAPagar);
  if (typeof renderProximos7Dias === 'function') _safeRender('proximos-7', renderProximos7Dias);
  if (typeof renderLimiteMesCard === 'function') _safeRender('limite-mes', renderLimiteMesCard);
  if (typeof renderOndeFoiDinheiro === 'function') _safeRender('onde-foi', renderOndeFoiDinheiro);
  if (typeof renderMapaCalor === 'function')     _safeRender('mapa-calor', renderMapaCalor);
  if (typeof renderContas === 'function')        _safeRender('contas', renderContas);
  if (typeof renderTransacoes === 'function')    _safeRender('extrato', () => renderTransacoes(allTx, userData));
}
