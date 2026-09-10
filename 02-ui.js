// ════════════════════════════════════════
// 02-ui.js — UI Rendering, Home, Transações, Faturas, Empréstimos
// ════════════════════════════════════════

// =====================================================
//  LOAD DASHBOARD
// =====================================================
// Executa um render sem deixar que ele derrube a tela inteira.
// Antes, um unico render com erro estourava ate o catch do init() e
// deslogava o usuario. Agora o pior caso e um card faltando.
function _safeRender(nome, fn) {
  try { fn(); }
  catch (e) { console.error('[Lumnis] render "' + nome + '" falhou:', e); }
}

async function loadDashboard(user) {
  // Acesso vencido nao expulsa mais: entra em MODO_LEITURA.
  // O usuario continua vendo tudo o que ja registrou, mas nao grava nada
  // (a trava real e o trigger no Postgres, nao esta linha).
  const acessoFim = user.acesso_fim || user.trial_fim;
  MODO_LEITURA = false;
  if (acessoFim && new Date(acessoFim) < new Date(today())) {
    const emGraca = user.grace_period_fim && new Date(user.grace_period_fim) >= new Date(today());
    if (!emGraca) MODO_LEITURA = true;
  }

  userData = user;
  USER_ID  = user.id;
  showScreen(null);

  // Monta a casca do app (o showScreen esconde tudo isso ao sair)
  // Tira o splash ANTES de renderizar os cards: a casca ja e util,
  // os dados chegam preenchendo. Antes o usuario olhava "Carregando
  // Lumnis..." ate a ultima query terminar.
  const _splash = document.getElementById('screen-loading');
  if (_splash) _splash.style.display = 'none';

  const _mn  = document.getElementById('app-main');
  const _nav = document.getElementById('app-nav');
  const _fab = document.getElementById('add-tx-btn');
  if (_mn)  _mn.style.display  = '';
  if (_nav) _nav.style.display = 'flex';
  if (_fab) _fab.style.display = MODO_LEITURA ? 'none' : 'flex';
  renderFaixaLeitura();
  // mede depois que header e nav estao realmente visiveis
  if (typeof medirChrome === 'function') { medirChrome(); setTimeout(medirChrome, 300); }

  // Inicia Realtime para sincronizar categorias com o bot
  setupRealtimeCategories(user.id);

  const msgsSince = new Date(Date.now() - 29 * 86400000).toISOString();

  const tresAtras = (()=>{const d=new Date();d.setMonth(d.getMonth()-3);return d.toISOString().split('T')[0];})();

  const [txRes, faturasRes, desafiosRes, categoriasRes, msgsRes, streakRes, assinRes, contasRes] = await Promise.all([
    sb.from('transacoes').select('*').eq('user_id', USER_ID).is('deleted_at', null).order('data', {ascending:false}).limit(400),
    sb.from('faturas_futuras').select('*').eq('user_id', USER_ID).is('deleted_at', null).gte('data_venc', tresAtras).order('data_venc'),
    sb.from('desafios').select('*').eq('user_id', USER_ID).eq('status','ativo'),
    sb.from('categorias').select('*').eq('user_id', USER_ID).eq('ativa', true),
    user?.telegram_id
      ? sb.from('mensagens_processadas').select('processed_at').eq('chat_id', user.telegram_id).gte('processed_at', msgsSince)
      : Promise.resolve({ data: [] }),
    // ── STREAKS TABLE — fonte canônica (n8n + dashboard) ──
    sb.from('streaks').select('*').eq('user_id', USER_ID).maybeSingle(),
    sb.from('assinaturas_usuario').select('*').eq('user_id', USER_ID).order('dia_cobranca'),
    sb.from('contas_pagar').select('*').eq('user_id', USER_ID).order('vencimento')
  ]);

  allTx       = txRes.data || [];
  allCats     = categoriasRes.data || [];
  allDesafios = desafiosRes.data || [];
  allFaturas  = faturasRes.data || [];
  allAssinaturas = assinRes?.data || [];
  allContas      = contasRes?.data || [];
  if (faturasRes.error) console.warn('[Lumnis] faturas_futuras error:', faturasRes.error);
  if (txRes.error) console.warn('[Lumnis] transacoes error:', txRes.error);
  // [Lumnis] dados carregados;

  // ── Sincronizar streak com tabela canônica ──────────────────────
  // A tabela `streaks` é atualizada pelo n8n/WhatsApp bot.
  // O dashboard lê e escreve aqui também para garantir coerência total.
  if (streakRes.data) {
    const s = streakRes.data;
    // Prefere streaks table se mais recente que usuarios
    const streakDate = s.ultimo_registro || '';
    const userDate   = user.ultimo_registro || user.last_streak_date || '';
    if (streakDate >= userDate) {
      // streaks table tem dado mais atual
      userData.dias_consecutivos = s.dias_consecutivos ?? userData.dias_consecutivos;
      userData.maior_streak = s.maior_streak ?? userData.maior_streak;
      userData.ultimo_registro = s.ultimo_registro ?? userData.ultimo_registro;
      userData.last_streak_date = s.ultimo_registro ?? userData.last_streak_date;
    }
    // guardar referência para updates futuros
    window._streakRowExists = true;
  } else {
    // streaks row não existe ainda — criar ao marcar presença
    window._streakRowExists = false;
  }

  const faturas    = faturasRes.data  || [];
  const desafios   = desafiosRes.data || [];

  msgDays30 = new Set((msgsRes.data || []).map(m => {
    try { return new Date(m.processed_at).toISOString().split('T')[0]; } catch(e) { return null; }
  }).filter(Boolean));

  // Inicializa mês atual PRIMEIRO (evita renderHome com mês errado)
  if (typeof changeMonth === "function") changeMonth(0);
  renderHome(user, user);
  renderTransacoes(allTx, user);
  renderFaturas(faturas);
  renderMetas(user, desafios, allTx);
  renderPerfil(user);
  runAnimations();
  loadEmprestimos();
  updateEmpResumHome();
  
  // Se não tem categorias e tem meta definida — criar automaticamente
  if (allCats.length === 0) {
    const metaTotal = user.meta_mensal || user.meta_gastos_mensal || 0;
    if (metaTotal > 0) {
      await criarCategoriasAutomaticas(metaTotal);
    }
  }
}

// =====================================================
//  RENDER HOME
// =====================================================
function renderHome(user, streak) {
  // Atualiza streak sempre com o valor sincronizado do banco
  const streakDias = user?.dias_consecutivos || 0;
  window._streakAtual = streakDias;
  ['streak-hero-num', 'streak-count', 'stat-streak'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = streakDias;
  });
  // Atualiza mensagem do hero
  if (typeof getStreakMessage === 'function') {
    const msg = getStreakMessage(streakDias);
    const msgEl = document.getElementById('streak-hero-msg');
    if (msgEl && streakDias > 0) msgEl.textContent = msg?.text || '';
  }
  const modoReceita = !!user.modo_receita;
  const myName = user.nome?.split(' ')[0] || 'você';

  document.getElementById('greeting-name').textContent = `Olá, ${myName} 👋`;
  const d = new Date();
  const h = d.getHours();
  document.getElementById('greeting-sub').textContent =
    `${h<12?'Bom dia ☀️':h<18?'Boa tarde 🌤️':'Boa noite 🌙'} · ${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;

  const escudosUser = user.escudos || 0;
  const elEscudos = document.getElementById('stat-escudos');
  if (elEscudos) elEscudos.textContent = escudosUser;
  const escEl = document.getElementById('escudos-count');
  if (escEl) escEl.textContent = escudosUser;

  // Reserva
  renderReserva(user);

  // Modo badge
  const badgeEl = document.getElementById('modo-badge-home');
  if (badgeEl) {
    badgeEl.textContent = modoReceita ? '✅ Modo Completo' : '📊 Modo Básico';
    badgeEl.className = 'modo-badge ' + (modoReceita ? 'completo' : 'basico');
  }

  const mStart = monthStart();
  const txMes  = allTx.filter(t=>t.data>=mStart);
  const gastos  = txMes.filter(t=>t.tipo==='despesa').reduce((s,t)=>s+(+t.valor),0);
  const receita = txMes.filter(t=>t.tipo==='receita').reduce((s,t)=>s+(+t.valor),0);
  const saldo   = receita - gastos;
  const meta    = user.meta_mensal || user.meta_gastos_mensal || 2000;
  const meAtual2 = today().substring(0,7);
  const fatMes2 = (window._todasFaturas||allFaturas||[]).filter(f=>(f.data_venc||f.data_vencimento||'').startsWith(meAtual2));
  const totalFat2 = fatMes2.reduce((s,f)=>s+(+f.valor||0),0);
  const gastosTotal = gastos + totalFat2;
  const pct     = Math.min(100, Math.round((gastosTotal/meta)*100));
  const cor     = pct>=90?'red':pct>=70?'amber':'purple';

  document.getElementById('kpi-gastos').textContent  = BRL(gastosTotal);
  const kpiMetaSubEl = document.getElementById('kpi-meta-sub');
  if (kpiMetaSubEl) kpiMetaSubEl.innerHTML = `de ${BRL(meta)} · ${pct}% usado${totalFat2>0?'<br><span style="font-size:0.6rem;color:var(--muted)">Direto: '+BRL(gastos)+' + Cartão: '+BRL(totalFat2)+'</span>':''}`;
  setTimeout(()=>{
    const bar = document.getElementById('bar-meta');
    if (bar) { bar.style.width = pct+'%'; bar.className = `progress-fill ${cor}`; }
  }, 400);

  if (modoReceita) {
    document.getElementById('kpi-receita-card').style.display = 'block';
    document.getElementById('kpi-saldo-card').style.display   = 'block';
    // Modo Completo: kpi-gastos no tamanho normal
    const kpiGastosCard = document.getElementById('kpi-gastos-card');
    if (kpiGastosCard) kpiGastosCard.style.gridColumn = '';
    document.getElementById('kpi-receita').textContent        = BRL(receita);
    document.getElementById('kpi-saldo').textContent          = BRL(saldo);
    document.getElementById('kpi-receita-sub').textContent    = 'este mês';
    document.getElementById('kpi-saldo').style.color          = saldo>=0 ? 'var(--green)' : 'var(--red)';
    const chipRec = document.getElementById('chip-receita');
    if (chipRec) chipRec.style.display = '';
  } else {
    document.getElementById('kpi-receita-card').style.display = 'none';
    document.getElementById('kpi-saldo-card').style.display   = 'none';
    // No Modo Básico, expandir kpi-gastos para ocupar largura total
    const kpiGastosCard = document.getElementById('kpi-gastos-card');
    if (kpiGastosCard) kpiGastosCard.style.gridColumn = 'span 2';
    const chipRec = document.getElementById('chip-receita');
    if (chipRec) chipRec.style.display = 'none';
  }

  // AI Analysis
  window._lumnisAnaliseParams = {user, txMes, gastos:gastosTotal, receita, saldo, meta, pct};
  window._gastosComCartao = gastosTotal;
  renderLumnisAnalise(user, txMes, gastosTotal, receita, saldo, meta, pct);

  // Pie chart saldo (only in modo receita)
  renderHomePie(gastos, receita, saldo, modoReceita, txMes);

  renderCatLimitsHome(allCats, txMes);
  renderSonhosHome(Array.isArray(user.sonhos) ? user.sonhos : []);
  renderFaturasHome();
  // Recorrencia roda em segundo plano: nao pode atrasar a pintura da tela.
  if (typeof processarRecorrencias === 'function') {
    setTimeout(() => { try { processarRecorrencias(); } catch(e){ console.error(e); } }, 1200);
  }
  _safeRender('mapa-calor',     renderMapaCalor);
  _safeRender('limite-mes',     renderLimiteMesCard);
  _safeRender('onde-foi',       renderOndeFoiDinheiro);
  _safeRender('proximos-7',     renderProximos7Dias);
  _safeRender('meses',          renderMesesCarrossel);
  _safeRender('aviso-trial',    renderAvisoTrial);
  _safeRender('mapa-sonhos',    renderMapaSonhos);

  // Quiz inicial: so para quem ainda nao configurou renda/meta por
  // NENHUMA fonte (app ou bot do WhatsApp).
  if (typeof onboardingCompleto === 'function' && !onboardingCompleto(user)) {
    setTimeout(() => { try { iniciarOnboarding(); } catch(e){ console.error(e); } }, 700);
  } else if (typeof iniciarTour === 'function') {
    // ja configurou, mas nunca viu o tutorial
    setTimeout(() => { try { iniciarTour(); } catch(e){ console.error(e); } }, 900);
  }
  // Atualizar botão de presença
  atualizarBotaoPresenca();
}

function renderLumnisAnalise(user, txMes, gastos, receita, saldo, meta, pct) {
  const el = document.getElementById('lumnis-ai-insights');
  if (!el) return;

  const nome = user?.nome?.split(' ')[0] || 'você';
  const insights = [];

  // ── Insight 1: Visão geral do mês ────────────────────────────────
  if (meta > 0 && gastos >= 0) {
    const margem = meta - gastos;
    const gastoPct = Math.round(pct);
    if (gastoPct >= 100) {
      insights.push(`📊 <strong>Este mês já passou do limite:</strong> ${nome}, você gastou ${BRL(gastos)} e sua meta era ${BRL(meta)}. Bateu o teto. Hora de apertar o freio no que der.`);
    } else if (gastoPct >= 80) {
      insights.push(`📊 <strong>Atenção: quase no limite!</strong> Você usou ${gastoPct}% da meta este mês (${BRL(gastos)} de ${BRL(meta)}). Sobraram ${BRL(margem)} — vale pensar antes de gastar mais.`);
    } else if (gastoPct >= 50) {
      insights.push(`📊 <strong>Mês indo bem:</strong> você já usou ${gastoPct}% da meta (${BRL(gastos)} de ${BRL(meta)}). Ainda tem espaço de ${BRL(margem)}. Continua assim.`);
    } else {
      insights.push(`📊 <strong>Mês ótimo até agora:</strong> apenas ${gastoPct}% da meta usada (${BRL(gastos)} de ${BRL(meta)}). Você tem ${BRL(margem)} de margem. Tá indo bem.`);
    }
  } else if (gastos > 0) {
    insights.push(`📊 <strong>Gastos do mês:</strong> ${BRL(gastos)}. Defina uma meta mensal no perfil pra acompanhar melhor.`);
  }

  // ── Insight 2: Categoria que mais pesou ──────────────────────────
  if (txMes && txMes.length > 0 && allCats && allCats.length > 0) {
    const catMap = {};
    txMes.filter(t=>t.tipo==='despesa').forEach(t => {
      catMap[t.categoria] = (catMap[t.categoria]||0) + (+t.valor);
    });
    const topCat = Object.entries(catMap).sort((a,b)=>b[1]-a[1])[0];
    if (topCat) {
      const [catNome, catVal] = topCat;
      const catConfig = allCats.find(c => c.nome === catNome);
      const limite = catConfig?.limite_mensal;
      const emoji = catConfig?.emoji || '📦';
      const pctGasto = gastos > 0 ? Math.round(catVal/gastos*100) : 0;
      if (limite && catVal > limite) {
        insights.push(`${emoji} <strong>${catNome} estourou:</strong> você gastou ${BRL(catVal)} nessa categoria — ${BRL(catVal-limite)} acima do limite de ${BRL(limite)}. É ${pctGasto}% dos seus gastos do mês. Vale revisar.`);
      } else if (limite) {
        const usoLimite = Math.round(catVal/limite*100);
        insights.push(`${emoji} <strong>${catNome} é seu maior gasto</strong> (${BRL(catVal)}, ${usoLimite}% do limite). Ainda dentro do combinado.`);
      } else {
        insights.push(`${emoji} <strong>${catNome} é onde você gastou mais:</strong> ${BRL(catVal)} — ${pctGasto}% dos gastos do mês. Faz sentido pra você?`);
      }
    }
  }

  // ── Insight 3: Poupança / saldo ──────────────────────────────────
  if (receita > 0) {
    const poupPct = Math.round(((receita - gastos) / receita) * 100);
    if (poupPct >= 50) {
      insights.push(`💚 <strong>Poupança excelente:</strong> você está guardando ${poupPct}% da renda. Isso é raro. Continue assim — cada real poupado agora vale muito no futuro.`);
    } else if (poupPct >= 30) {
      insights.push(`💚 <strong>Poupança saudável:</strong> ${poupPct}% da renda poupada. A regra do 50-30-20 pede 20% — você tá acima. Bom sinal.`);
    } else if (poupPct >= 10) {
      insights.push(`💛 <strong>Poupando ${poupPct}% da renda</strong> — começa a ser ok. Se conseguir chegar a 20%, muda o jogo no médio prazo.`);
    } else if (poupPct > 0) {
      insights.push(`🔴 <strong>Poupando só ${poupPct}% da renda.</strong> Isso é pouco, ${nome}. Quando vier uma despesa inesperada, de onde vai sair? Vale pensar no que cortar.`);
    } else if (poupPct <= 0) {
      insights.push(`🔴 <strong>Gastos maiores que a receita este mês.</strong> Isso não pode virar hábito — você está consumindo reservas ou se endividando. Hora de agir.`);
    }
  }

  // ── Insight 4: Streak / consistência ─────────────────────────────
  const streak = window._streakAtual !== undefined ? window._streakAtual : 0;
  if (streak >= 30) {
    insights.push(`🔥 <strong>${streak} dias consecutivos registrando!</strong> Você criou o hábito. Quem acompanha as finanças todo dia toma decisões melhores — simples assim.`);
  } else if (streak >= 7) {
    insights.push(`🔥 <strong>${streak} dias seguidos.</strong> Uma semana de consistência já diz muito. Não quebra agora.`);
  } else if (streak >= 3) {
    insights.push(`✨ <strong>${streak} dias seguidos</strong> — bom começo. O hábito se forma com repetição. Tenta chegar a 7.`);
  } else if (streak === 0) {
    insights.push(`⚡ <strong>Marque presença hoje</strong> e comece sua ofensiva. Consistência é o que separa quem sonha de quem realiza.`);
  }

  // ── Render ───────────────────────────────────────────────────────
  el.innerHTML = insights.map(txt =>
    `<div style="margin-bottom:10px;line-height:1.55;font-size:0.83rem;color:var(--text)">${txt}</div>`
  ).join('');
}


function renderHomePie(gastos, receita, saldo, modoReceita, txMes) {
  const pieCard = document.getElementById('home-pie-card');
  const canvas  = document.getElementById('chart-home-pie');
  if (!canvas || !pieCard) return;

  // Build data: gastos diretos + faturas do cartão do mês, por categoria
  const catMap = {};
  txMes.filter(t=>t.tipo==='despesa').forEach(t => {
    const c = t.categoria || 'outros';
    catMap[c] = (catMap[c]||0) + (+t.valor);
  });
  // Merge faturas do mês atual no gráfico
  const meAtualPie = today().substring(0,7);
  (allFaturas || []).filter(f => (f.data_venc||'').startsWith(meAtualPie)).forEach(f => {
    const c = f.categoria || (typeof _sugerirCategoria === 'function' ? _sugerirCategoria(f.descricao) : 'compras') || 'compras';
    catMap[c] = (catMap[c]||0) + (+f.valor||0);
  });

  const catLabels = Object.keys(catMap);
  const catValues = catLabels.map(k=>catMap[k]);
  const catColors = catLabels.map((cat, i) => {
    const found = allCats.find(c => c.nome?.toLowerCase() === cat?.toLowerCase());
    const defaults = ['#18181b','#a78bfa','#fcd34d','#ff6e84','#06b6d4','#f97316','#e879f9','#0ea5e9','#84cc16','#fb923c'];
    return found?.cor || defaults[i % defaults.length];
  });

  // If no gastos AND no receita, hide card
  if (!catLabels.length) { pieCard.style.display = 'none'; return; }
  pieCard.style.display = 'block';

  // Só gastos por categoria (receita tem gráfico próprio no Extrato)
  let allLabels = [...catLabels];
  let allValues = [...catValues];
  let allColors = [...catColors];
  let allEmojis = catLabels.map(cat => allCats.find(c=>c.nome?.toLowerCase()===cat?.toLowerCase())?.emoji || '📦');

  const ctx = canvas.getContext('2d');
  if (window._chartHomePie) { window._chartHomePie.destroy(); window._chartHomePie = null; }
  window._chartHomePie = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: allLabels,
      datasets: [{
        data: allValues,
        backgroundColor: allColors,
        borderWidth: 3,
        borderColor: 'rgba(10,10,18,0.8)',
        hoverOffset: 6
      }]
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: { legend: { display: false }, tooltip: {
        callbacks: {
          label: ctx => ` ${BRL(ctx.parsed)}`
        }
      }},
      animation: { duration: 900, easing: 'easeInOutQuart' }
    }
  });

  // Center label — total com faturas incluídas
  const totalComFat = Object.values(catMap).reduce((s,v)=>s+v,0);
  const centerVal = document.getElementById('home-pie-center-val');
  if (centerVal) centerVal.textContent = BRL(totalComFat);

  // Saldo badge
  const badge = document.getElementById('home-pie-saldo-badge');
  if (badge && modoReceita && receita > 0) {
    badge.textContent = saldo >= 0 ? `Saldo: +${BRL(saldo)}` : `Saldo: -${BRL(Math.abs(saldo))}`;
    badge.style.color = saldo >= 0 ? 'var(--green)' : 'var(--red)';
    badge.style.background = saldo >= 0 ? 'var(--green-dim)' : 'rgba(255,110,132,0.12)';
  }

  // Legend
  const total = allValues.reduce((s,v)=>s+v, 0);
  const legendEl = document.getElementById('home-pie-legend');
  if (legendEl) {
    legendEl.innerHTML = allLabels.map((l, i) => {
      const pct = total > 0 ? Math.round(allValues[i]/total*100) : 0;
      return `<div style="display:flex;align-items:center;gap:8px;padding:3px 0">
        <span style="width:10px;height:10px;border-radius:50%;background:${allColors[i]};flex-shrink:0;display:inline-block"></span>
        <span style="color:var(--text);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${allEmojis[i]} ${l}</span>
        <span style="color:var(--muted);font-size:0.68rem">${pct}%</span>
        <span class="pie-val-col" style="color:var(--text);font-weight:700;font-family:var(--font-head);font-size:0.78rem;min-width:60px;text-align:right">${BRL(allValues[i])}</span>
      </div>`;
    }).join('');
  }
}

// ══════════════════════════════════════════════════════════
// STREAK — LÓGICA CENTRAL (dia calendário, não 24h)
// ══════════════════════════════════════════════════════════
async function atualizarStreak() {
  if (!USER_ID || !userData) return;
  const hoje = today();

  // ─── RE-FETCH da DB: prioriza tabela `streaks` (canônica do n8n) ───
  try {
    const [{ data: freshStreak }, { data: freshUser }] = await Promise.all([
      sb.from('streaks').select('dias_consecutivos,maior_streak,ultimo_registro,total_registros').eq('user_id', USER_ID).maybeSingle(),
      sb.from('usuarios').select('dias_consecutivos,maior_streak,ultimo_registro,last_streak_date').eq('id', USER_ID).single()
    ]);
    // Determina fonte mais atual: streaks (n8n) ou usuarios (dashboard legado)
    const streakUlt = freshStreak?.ultimo_registro || '';
    const userUlt   = freshUser?.ultimo_registro || freshUser?.last_streak_date || '';
    const usarStreaks = freshStreak && streakUlt >= userUlt;
    const fonte = usarStreaks ? freshStreak : freshUser;
    if (fonte) {
      userData.dias_consecutivos = fonte.dias_consecutivos ?? userData.dias_consecutivos;
      userData.maior_streak      = fonte.maior_streak ?? userData.maior_streak;
      userData.ultimo_registro   = usarStreaks ? fonte.ultimo_registro : (freshUser?.ultimo_registro ?? userData.ultimo_registro);
      userData.last_streak_date  = userData.ultimo_registro;
    }
    window._streakRowExists = !!freshStreak;
  } catch(e) { /* usa cache local se falhar */ }

  const ultimoReg = userData.ultimo_registro || userData.last_streak_date || null;

  // Já registrou hoje → não faz nada
  if (ultimoReg === hoje) return;

  const ontem = new Date(); ontem.setDate(ontem.getDate()-1);
  const ontemStr = ontem.toISOString().split('T')[0];

  const diasAtuais = userData.dias_consecutivos || 0;
  const maiorAtual = userData.maior_streak || diasAtuais;

  // Dia calendário: se último registro foi ontem → incrementa; senão → reinicia em 1
  let novosDias = ultimoReg === ontemStr ? diasAtuais + 1 : 1;
  let novoMaior = Math.max(maiorAtual, novosDias);

  try {
    // Update usuarios (compatibilidade)
    await sb.from('usuarios').update({
      dias_consecutivos: novosDias,
      maior_streak: novoMaior,
      ultimo_registro: hoje,
      last_streak_date: hoje
    }).eq('id', USER_ID);

    // Update streaks table (fonte canônica do n8n/bot)
    if (window._streakRowExists) {
      await sb.from('streaks').update({
        dias_consecutivos: novosDias,
        maior_streak: novoMaior,
        ultimo_registro: hoje,
        total_registros: (userData.total_registros || 0) + 1
      }).eq('user_id', USER_ID);
    } else {
      // Criar linha na streaks table se não existia
      const { error: insErr } = await sb.from('streaks').upsert({
        user_id: USER_ID,
        dias_consecutivos: novosDias,
        maior_streak: novoMaior,
        ultimo_registro: hoje,
        total_registros: 1
      }, { onConflict: 'user_id' });
      if (!insErr) window._streakRowExists = true;
    }

    userData.dias_consecutivos = novosDias;
    userData.maior_streak = novoMaior;
    userData.ultimo_registro = hoje;
    userData.last_streak_date = hoje;

    // Atualizar UI
    ['streak-hero-num','streak-count','stat-streak'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = novosDias;
    });
    const msg = getStreakMessage(novosDias);
    const msgEl = document.getElementById('streak-hero-msg');
    if (msgEl) msgEl.textContent = msg.text;
    const emojiEl = document.getElementById('streak-hero-emoji');
    if (emojiEl) emojiEl.textContent = msg.emoji;

    // Esconder botão presença, mostrar ok
    atualizarBotaoPresenca();
    return novosDias;
  } catch(e) {
    console.log('Erro streak:', e);
  }
}

function atualizarBotaoPresenca() {
  const hoje = today();
  const registrouHoje = userData?.ultimo_registro === hoje || userData?.last_streak_date === hoje;
  const btnWrap = document.getElementById('presenca-btn-wrap');
  const okMsg   = document.getElementById('presenca-ok');
  if (btnWrap) btnWrap.style.display = registrouHoje ? 'none' : 'block';
  if (okMsg)   okMsg.style.display   = registrouHoje ? 'block' : 'none';
}

async function marcarPresenca() {
  if (bloqueadoPorTrial()) return;
  const btn = document.getElementById('btn-presenca');
  if (btn) { btn.textContent = '⏳ Registrando...'; btn.disabled = true; }
  try {
    const novoDia = await atualizarStreak();
    if (novoDia !== undefined) {
      showToast(`🔥 Ofensiva: ${novoDia} dias seguidos!`, 'success');
    } else {
      showToast('✅ Presença já registrada hoje!', 'success');
    }
  } catch(e) {
    showToast('Erro ao registrar presença', 'error');
  } finally {
    if (btn) { btn.textContent = '🔥 Marcar presença hoje'; btn.disabled = false; }
    atualizarBotaoPresenca();
  }
}

// =====================================================
//  CATEGORIAS — HOME
// =====================================================
function renderCatLimitsHome(cats, txMes) {
  const el = document.getElementById('cat-limits-list');
  const catsComLimite = cats.filter(c=>c.limite_mensal>0);
  if (!catsComLimite.length) {
    el.innerHTML = '<p style="font-size:0.8rem;color:var(--muted)">Nenhum limite configurado. Clique em ✏️ Editar para definir. 💬</p>';
    return;
  }
  const myTxMes = txMes.filter(t => !t.user_id || t.user_id === USER_ID);
  const r = 22, cx = 26, cy = 26, circ2 = 2 * Math.PI * r;

  el.innerHTML = '<div class="cat-circ-grid">' + catsComLimite.map(function(c) {
    const gasto = myTxMes.filter(t=>t.tipo==='despesa'&&(t.categoria||'').toLowerCase()===(c.nome||'').toLowerCase())
      .reduce(function(s,t){return s+(+t.valor);},0);
    const p = Math.min(100, Math.round((gasto/c.limite_mensal)*100));
    const col = p>=90 ? 'var(--red)' : p>=70 ? 'var(--amber)' : 'var(--purple)';
    const offset = circ2 * (1 - p/100);
    const svg = '<svg viewBox="0 0 52 52" style="width:52px;height:52px">'
      + '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--card2)" stroke-width="5"/>'
      + '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="5"'
      + ' stroke-dasharray="' + circ2.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '"'
      + ' stroke-linecap="round" transform="rotate(-90 ' + cx + ' ' + cy + ')"'
      + ' style="transition:stroke-dashoffset 1s ease"/>'
      + '<text x="' + cx + '" y="' + (cy+4) + '" text-anchor="middle" font-size="11" fill="var(--text)">' + (c.emoji||'📦') + '</text>'
      + '</svg>';
    return '<div class="cat-circ-item" title="' + c.nome + ': ' + BRL(gasto) + ' / ' + BRL(c.limite_mensal) + '">'
      + svg
      + '<div class="cat-circ-nome">' + c.nome + '</div>'
      + '<div class="cat-circ-valores" style="color:' + col + '">' + p + '%</div>'
      + '<div class="cat-circ-valores">' + BRL(gasto) + ' / ' + BRL(c.limite_mensal) + '</div>'
      + '</div>';
  }).join('') + '</div>';
}

function renderCatEditList(mostrarTodas) {
  const el = document.getElementById('cat-edit-list');
  if (!el) return;
  // Deduplicate by ID to fix duplicate display bug
  const seen = new Set();
  const cats = allCats.filter(c => { if(seen.has(c.id)) return false; seen.add(c.id); return true; });
  if (!cats.length) {
    el.innerHTML = '<p style="font-size:0.8rem;color:var(--muted)">Nenhuma categoria. Clique em "+ Nova" para criar. 💡</p>';
    return;
  }
  const LIMIT = 10;
  const visiveis = mostrarTodas ? cats : cats.slice(0, LIMIT);
  const temMais = !mostrarTodas && cats.length > LIMIT;
  el.innerHTML = visiveis.map(function(c) {
    const delBtn = !c.ativa
      ? '<button onclick="deleteCatPermanente(\'' + c.id + '\')" title="Apagar permanentemente" style="background:rgba(255,110,132,0.1);border:1px solid rgba(255,110,132,0.25);color:var(--red);border-radius:8px;padding:5px 10px;font-size:0.72rem;font-weight:700;cursor:pointer;flex-shrink:0">🗑️</button>'
      : '';
    const toggleStyle = c.ativa
      ? 'background:rgba(255,110,132,0.1);border:1px solid rgba(255,110,132,0.25);color:var(--red)'
      : 'background:var(--green-dim);border:1px solid rgba(155,255,206,0.25);color:var(--green)';
    const corDot = c.cor ? `<span style="width:10px;height:10px;border-radius:50%;background:${c.cor};display:inline-block;flex-shrink:0"></span>` : '';
    return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">'
      + '<span style="font-size:1.2rem;flex-shrink:0">' + (c.emoji||'📦') + '</span>'
      + corDot
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-size:0.85rem;font-weight:500">' + c.nome + '</div>'
      + '<div style="font-size:0.72rem;color:var(--muted)">' + (c.limite_mensal>0?'Limite: '+BRL(c.limite_mensal):'Sem limite') + '</div>'
      + '</div>'
      + '<button onclick="editCat(\'' + c.id + '\')" style="background:var(--purple-dim);border:1px solid rgba(24,24,27,0.2);color:var(--purple-light);border-radius:8px;padding:5px 10px;font-size:0.72rem;font-weight:700;cursor:pointer;flex-shrink:0">✏️</button>'
      + '<button onclick="toggleCatAtiva(\'' + c.id + '\')" title="' + (c.ativa?'Desativar':'Reativar') + '" style="' + toggleStyle + ';border-radius:8px;padding:5px 10px;font-size:0.72rem;font-weight:700;cursor:pointer;flex-shrink:0">' + (c.ativa?'🔕':'✅') + '</button>'
      + delBtn
      + '</div>';
  }).join('');

  if (temMais) {
    el.innerHTML += `<div style="text-align:center;padding:12px 0">
      <button onclick="abrirModalTodasCats()" style="background:var(--purple-dim);border:1px solid rgba(24,24,27,0.25);color:var(--purple-light);border-radius:20px;padding:7px 20px;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:var(--font-body)">
        Ver todas (${cats.length}) categorias →
      </button>
    </div>`;
  }
}

function abrirModalTodasCats() {
  let modal = document.getElementById('modal-todas-cats');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-todas-cats';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:350;background:rgba(0,0,0,0.8);align-items:flex-end;justify-content:center';
    modal.onclick = e => { if(e.target===modal) fecharModalTodasCats(); };
    document.body.appendChild(modal);
  }
  const seen = new Set();
  const cats = allCats.filter(c => { if(seen.has(c.id)) return false; seen.add(c.id); return true; });
  const rows = cats.map(c => {
    const toggleStyle = c.ativa
      ? 'background:rgba(255,110,132,0.1);border:1px solid rgba(255,110,132,0.25);color:var(--red)'
      : 'background:var(--green-dim);border:1px solid rgba(155,255,206,0.25);color:var(--green)';
    const corDot = c.cor ? `<span style="width:10px;height:10px;border-radius:50%;background:${c.cor};display:inline-block;flex-shrink:0;margin-right:2px"></span>` : '';
    return `<div style="display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:1.1rem">${c.emoji||'📦'}</span>${corDot}
      <div style="flex:1">
        <div style="font-size:0.82rem;font-weight:600">${c.nome}</div>
        <div style="font-size:0.68rem;color:var(--muted)">${c.limite_mensal>0?'Limite: '+BRL(c.limite_mensal):'Sem limite'}</div>
      </div>
      <button onclick="editCat('${c.id}');fecharModalTodasCats()" style="background:var(--purple-dim);border:1px solid rgba(24,24,27,0.2);color:var(--purple-light);border-radius:8px;padding:4px 10px;font-size:0.68rem;font-weight:700;cursor:pointer">✏️</button>
      <button onclick="toggleCatAtiva('${c.id}')" style="${toggleStyle};border-radius:8px;padding:4px 10px;font-size:0.68rem;font-weight:700;cursor:pointer">${c.ativa?'🔕':'✅'}</button>
    </div>`;
  }).join('');

  modal.innerHTML = `<div style="background:var(--card);border-radius:22px 22px 0 0;padding:24px;width:100%;max-width:520px;max-height:85vh;overflow-y:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div style="font-family:var(--font-head);font-size:1.1rem;font-weight:800">📦 Todas as Categorias (${cats.length})</div>
      <button onclick="fecharModalTodasCats()" style="background:var(--card2);border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:5px 12px;cursor:pointer">✕</button>
    </div>
    ${rows}
  </div>`;
  modal.style.display = 'flex';
}
function fecharModalTodasCats() {
  const m = document.getElementById('modal-todas-cats');
  if (m) m.style.display = 'none';
}

function addCatModal() {
  // Bloquear criação se não há meta total
  const metaTotal = userData?.meta_mensal || userData?.meta_gastos_mensal || 0;
  if (!metaTotal || metaTotal === 0) {
    showToast('Primeiro defina sua meta total de gastos antes de criar categorias.', 'error');
    const metaInput = document.getElementById('meta-input');
    if (metaInput) {
      metaInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => metaInput.focus(), 500);
    }
    return;
  }
  document.getElementById('cat-modal-id').value    = '';
  document.getElementById('cat-modal-nome').value  = '';
  document.getElementById('cat-modal-emoji').value = '📦';
  document.getElementById('cat-modal-cor').value = '#18181b';
  renderColorSwatches('#18181b');
  document.getElementById('cat-modal-limite').value = '';
  document.getElementById('cat-modal-title').textContent = 'Nova Categoria';
  document.getElementById('cat-modal').style.display = 'flex';
  updateCatBudgetInfo(null);
}

function editCat(id) {
  const c = allCats.find(x=>x.id===id);
  if (!c) return;
  document.getElementById('cat-modal-id').value     = c.id;
  document.getElementById('cat-modal-nome').value   = c.nome;
  document.getElementById('cat-modal-emoji').value  = c.emoji||'📦';
  document.getElementById('cat-modal-limite').value = c.limite_mensal||0;
  document.getElementById('cat-modal-title').textContent = 'Editar Categoria';
  document.getElementById('cat-modal').style.display = 'flex';
  updateCatBudgetInfo(c.id);
}

function closeCatModal() { document.getElementById('cat-modal').style.display = 'none'; }

function updateCatBudgetInfo(excludeId=null) {
  const metaTotal = userData?.meta_mensal || userData?.meta_gastos_mensal || 0;
  const info = document.getElementById('cat-modal-budget-info');
  if (!info || !metaTotal) return;
  // Excluir a própria categoria da soma para não contar duas vezes ao editar
  const somaOutras = allCats
    .filter(c => String(c.id) !== String(excludeId) && c.ativa && (c.limite_mensal||0) > 0)
    .reduce((s, c) => s + (c.limite_mensal || 0), 0);
  const disponivel = Math.max(0, metaTotal - somaOutras);
  info.style.display = 'block';
  const metaEl = document.getElementById('cat-modal-meta-total');
  const alocEl = document.getElementById('cat-modal-alocado');
  const dispEl = document.getElementById('cat-modal-disponivel');
  if (metaEl) metaEl.textContent = BRL(metaTotal);
  if (alocEl) alocEl.textContent = BRL(somaOutras);
  if (dispEl) {
    dispEl.textContent = BRL(disponivel);
    dispEl.style.color = disponivel > 0 ? 'var(--green)' : 'var(--red)';
  }
}

// ── Seletor de cor da categoria ──────────────────────────────
// renderColorSwatches e syncColorSwatches eram chamadas pelo modal
// mas nao existiam: clicar numa cor nao fazia nada e o valor nunca
// chegava no saveCat. Por isso a cor "nao salvava".

const CAT_CORES = ['#18181b','#53ddfc','#9bffce','#ff6e84','#fcd34d',
                   '#fb923c','#0ea5e9','#e879f9','#a3e635'];

function renderColorSwatches(corAtual) {
  const box = document.getElementById('color-swatches');
  if (!box) return;
  const sel = (corAtual || '#18181b').toLowerCase();
  box.innerHTML = CAT_CORES.map(c => `
    <button type="button" class="cat-swatch${c.toLowerCase() === sel ? ' on' : ''}"
            style="background:${c}" data-cor="${c}"
            onclick="syncColorSwatches('${c}')" aria-label="Cor ${c}"></button>`).join('');
  _previewCorBotao(sel);
}

function syncColorSwatches(cor) {
  if (!cor) return;
  const input = document.getElementById('cat-modal-cor');
  if (input) input.value = cor;
  document.querySelectorAll('#color-swatches .cat-swatch').forEach(b => {
    b.classList.toggle('on', (b.dataset.cor || '').toLowerCase() === cor.toLowerCase());
  });
  _previewCorBotao(cor);
}

// O botao Salvar assume a cor escolhida, antes mesmo de gravar.
function _previewCorBotao(cor) {
  const btn = document.querySelector('#cat-modal button[onclick="saveCat()"]');
  if (!btn) return;
  btn.style.background = cor;
  // contraste automatico: fundo claro pede texto escuro
  const hex = (cor || '').replace('#','');
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
    const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
    btn.style.setProperty('color', lum > 0.6 ? '#18181b' : '#ffffff', 'important');
  }
}

async function saveCat() {
  if (bloqueadoPorTrial()) return;
  const id     = document.getElementById('cat-modal-id').value;
  const nome   = document.getElementById('cat-modal-nome').value.trim();
  const emoji  = document.getElementById('cat-modal-emoji').value.trim() || '📦';
  const limite = parseFloat(document.getElementById('cat-modal-limite').value)||0;
  const cor    = document.getElementById('cat-modal-cor')?.value || '#18181b';
  if (!nome) { showToast('Informe o nome da categoria','error'); return; }

  // Só valida limite se realmente mudou o limite (permite salvar cor/emoji livremente)
  if (id && limite > 0) {
    const catAtual = allCats.find(c => String(c.id) === String(id));
    const limiteAtual = catAtual?.limite_mensal || 0;
    // Só bloqueia se o limite aumentou (evita bloquear quando só muda cor/emoji)
    if (limite > limiteAtual) {
      const metaTotal = userData?.meta_mensal || userData?.meta_gastos_mensal || 0;
      if (metaTotal > 0) {
        const somaOutras = allCats
          .filter(c => String(c.id) !== String(id) && c.ativa && c.limite_mensal > 0)
          .reduce((s, c) => s + (c.limite_mensal || 0), 0);
        if (somaOutras + limite > metaTotal) {
          const disponivel = Math.max(0, metaTotal - somaOutras);
          showToast('Limite disponível: ' + BRL(disponivel) + '. Meta total: ' + BRL(metaTotal), 'error');
          return;
        }
      }
    }
  }

  if (id) {
    const { error } = await sb.from('categorias').update({nome, emoji, cor, limite_mensal:limite}).eq('id',id);
    if (!error) {
      const idx = allCats.findIndex(c=>c.id===id);
      if (idx>=0) allCats[idx] = {...allCats[idx], nome, emoji, cor, limite_mensal:limite};
      showToast('Categoria atualizada ✅');
    } else {
      showToast('Erro ao salvar. Tente novamente.', 'error'); return;
    }
  } else {
    const { data, error } = await sb.from('categorias')
      .insert({user_id:USER_ID, nome, emoji, cor, limite_mensal:limite, ativa:true}).select().single();
    if (!error && data) { allCats.push(data); showToast('Categoria criada ✅'); }
    else { showToast('Erro ao criar categoria.', 'error'); return; }
  }
  closeCatModal();
  renderCatEditList();
  renderTransacoes(allTx, userData);
  const mStart = monthStart();
  renderCatLimitsHome(allCats.filter(c=>c.ativa), allTx.filter(t=>t.data>=mStart));
}

async function toggleCatAtiva(id) {
  if (bloqueadoPorTrial()) return;
  const c = allCats.find(x => x.id === id);
  if (!c) return;
  if (c.ativa) {
    if (!await confirmar({ emoji:'👁', titulo:'Desativar "' + c.nome + '"?',
      texto:'Ela some das listas, mas o histórico continua intacto.', confirmar:'Desativar' })) return;
    await sb.from('categorias').update({ ativa: false }).eq('id', id);
    allCats = allCats.map(x => x.id === id ? { ...x, ativa: false } : x);
    showToast('Categoria desativada.', 'success');
  } else {
    await sb.from('categorias').update({ ativa: true }).eq('id', id);
    allCats = allCats.map(x => x.id === id ? { ...x, ativa: true } : x);
    showToast('Categoria reativada ✅', 'success');
  }
  renderCatEditList();
  renderCatLimitsHome(allCats, allTx.filter(t => t.data >= monthStart()));
}

async function deleteCatPermanente(id) {
  const c = allCats.find(x => x.id === id);
  if (!c) return;
  if (!await confirmar({ emoji:'🗑', titulo:'Apagar "' + c.nome + '"?', perigo:true,
    texto:'As transações já registradas não são apagadas.', confirmar:'Apagar' })) return;
  try {
    await sb.from('categorias').delete().eq('id', id);
    allCats = allCats.filter(x => x.id !== id);
    showToast('Categoria apagada.', 'success');
    renderCatEditList();
    renderCatLimitsHome(allCats, allTx.filter(t => t.data >= monthStart()));
  } catch(e) { showToast('Erro ao apagar.', 'error'); }
}

// =====================================================
//  RENDER TRANSAÇÕES
// =====================================================
function filterTx(tipo) {
  _txTipoFiltro = tipo;
  txFilter = tipo;
  document.querySelectorAll('.chip[data-tipo]').forEach(c=>{ c.classList.toggle('active', c.dataset.tipo===tipo); });
  // Toggle title + canvas inside the SAME card
  const titleEl  = document.getElementById('extrato-chart-title');
  const donutWrap = document.getElementById('extrato-donut-wrap');
  const recWrap   = document.getElementById('extrato-receita-wrap');
  const modoReceita = !!(userData?.modo_receita);
  if (tipo === 'receita' && modoReceita) {
    if (titleEl) titleEl.textContent = 'Receitas por Categoria';
    if (donutWrap) donutWrap.style.display = 'none';
    if (recWrap) recWrap.style.display = 'block';
  } else {
    if (titleEl) titleEl.textContent = tipo === 'despesa' ? 'Gastos por Categoria' : 'Gastos por Categoria';
    if (donutWrap) donutWrap.style.display = 'block';
    if (recWrap) recWrap.style.display = 'none';
  }
  renderTransacoes(allTx, userData);
}

function detectarBanco(nome) {
  const n = (nome || '').toLowerCase();
  if (/nubank|nu\b/.test(n)) return { nome: 'Nubank', emoji: '💜', cor: '#820AD1' };
  if (/santander/.test(n)) return { nome: 'Santander', emoji: '🔴', cor: '#EC0000' };
  if (/bradesco/.test(n)) return { nome: 'Bradesco', emoji: '🔵', cor: '#CC092F' };
  if (/itau|itaú/.test(n)) return { nome: 'Itaú', emoji: '🟠', cor: '#EC7000' };
  if (/caixa|cef/.test(n)) return { nome: 'Caixa', emoji: '🟦', cor: '#005CA9' };
  if (/inter\b/.test(n)) return { nome: 'Inter', emoji: '🟧', cor: '#FF7A00' };
  if (/c6\b/.test(n)) return { nome: 'C6 Bank', emoji: '⚫', cor: '#242424' };
  if (/bb\b|brasil/.test(n)) return { nome: 'Banco do Brasil', emoji: '🟡', cor: '#FBCD00' };
  if (/mercado.pago|mercadopago/.test(n)) return { nome: 'Mercado Pago', emoji: '🔵', cor: '#009EE3' };
  if (/xp\b/.test(n)) return { nome: 'XP', emoji: '⚫', cor: '#000000' };
  if (/ame\b/.test(n)) return { nome: 'Ame Digital', emoji: '🔴', cor: '#EE0025' };
  if (/picpay/.test(n)) return { nome: 'PicPay', emoji: '💚', cor: '#11C76F' };
  return { nome: nome || 'Cartão', emoji: '💳', cor: '#18181b' };
}

// ══════════════════════════════════════════════════════════
// EXTRATO — FILTROS E PERÍODO
// ══════════════════════════════════════════════════════════
let _txPeriodo = 'mes'; // 'ontem'|'7d'|'mes'|'mes_passado'|'YYYY-MM'
let _txTipoFiltro = 'todos';
let _txMostrarTodos = false;
const TX_PAGE_SIZE = 10;

function setTxPeriodo(periodo) {
  _txPeriodo = periodo;
  _txInicio = null; _txFim = null; // Clear custom range when using quick buttons
  _txMostrarTodos = false;
  document.querySelectorAll('.tx-periodo-btn').forEach(b => {
    b.classList.remove('active');
    // Reset the custom picker button label
    if (b.id === 'txp-custom') b.textContent = '📅 Escolher período';
  });
  const btn = document.getElementById('txp-' + periodo);
  if (btn) btn.classList.add('active');
  renderTransacoes(allTx, userData);
}

function getTxPeriodoRange() {
  const hoje = today();
  const d = new Date();
  // Custom date range (from period picker)
  if (_txPeriodo === 'custom' && _txInicio && _txFim) {
    return [_txInicio, _txFim];
  }
  if (_txPeriodo === 'ontem') {
    d.setDate(d.getDate()-1);
    const ontem = d.toISOString().split('T')[0];
    return [ontem, ontem];
  }
  if (_txPeriodo === '7d') {
    d.setDate(d.getDate()-6);
    return [d.toISOString().split('T')[0], hoje];
  }
  if (_txPeriodo === 'mes') {
    return [monthStart(), hoje];
  }
  if (_txPeriodo === 'mes_passado') {
    const y = d.getFullYear(), m = d.getMonth();
    const inicio = new Date(y, m-1, 1).toISOString().split('T')[0];
    const fim = new Date(y, m, 0).toISOString().split('T')[0];
    return [inicio, fim];
  }
  // Specific day YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(_txPeriodo)) {
    return [_txPeriodo, _txPeriodo];
  }
  // Specific month YYYY-MM
  if (/^\d{4}-\d{2}$/.test(_txPeriodo)) {
    const [yr, mo] = _txPeriodo.split('-').map(Number);
    const inicio = `${yr}-${String(mo).padStart(2,'0')}-01`;
    const last = new Date(yr, mo, 0).getDate();
    const fim = `${yr}-${String(mo).padStart(2,'0')}-${last}`;
    return [inicio, fim];
  }
  return [monthStart(), hoje];
}

function getTxFiltradas() {
  const [inicio, fim] = getTxPeriodoRange();
  let txf = allTx.filter(t => t.data >= inicio && t.data <= fim);
  if (_txTipoFiltro !== 'todos') txf = txf.filter(t => t.tipo === _txTipoFiltro);
  return txf;
}

function abrirModalTxDetalhes(txAll) {
  // Guarda lista atual no modal para o delete poder atualizar
  window._modalTxList = txAll.slice();
  _renderModalTxDetalhes(window._modalTxList);
}

function _renderModalTxDetalhes(txAll) {
  let modal = document.getElementById('modal-tx-detalhes');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-tx-detalhes';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:450;background:rgba(0,0,0,0.8);align-items:flex-end;justify-content:center';
    modal.onclick = e => { if(e.target===modal) fecharModalTxDetalhes(); };
    document.body.appendChild(modal);
  }
  const html = txAll.map(t => {
    const emoji = emojiFor(t.categoria||t.descricao||'');
    const sign = t.tipo==='receita' ? '+' : '-';
    const cls = t.tipo==='receita' ? 'color:var(--green)' : 'color:var(--red)';
    const fonteBadgeM = (t.fonte==='csv'||t.fonte==='pdf')
      ? `<span style="font-size:0.55rem;background:rgba(24,24,27,0.1);color:var(--purple-light);border-radius:6px;padding:1px 4px;margin-left:4px;vertical-align:middle">💳</span>`
      : (t.fonte==='manual'||t.fonte==='bot'||t.fonte==='whatsapp')
      ? `<span style="font-size:0.55rem;background:rgba(83,221,252,0.08);color:var(--cyan);border-radius:6px;padding:1px 4px;margin-left:4px;vertical-align:middle">✏️</span>`
      : '';
    return `<div class="tx-item" style="position:relative">
      <div class="tx-icon">${emoji}</div>
      <div class="tx-info">
        <div class="tx-name">${t.descricao||'—'}${fonteBadgeM}</div>
        <div class="tx-date">${t.categoria||'outros'} · ${fmtDate(t.data)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="tx-amount" style="${cls}">${sign} ${BRL(t.valor)}</div>
        <button onclick="deletarTxModal('${t.id}')" title="Apagar transação"
          style="background:rgba(255,110,132,0.1);border:1px solid rgba(255,110,132,0.25);color:var(--red);border-radius:8px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:0.8rem;flex-shrink:0;padding:0">🗑</button>
      </div>
    </div>`;
  }).join('');
  modal.innerHTML = `<div style="background:var(--card);border-radius:22px 22px 0 0;padding:24px;width:100%;max-width:640px;max-height:80vh;overflow-y:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div style="font-family:var(--font-head);font-size:1.1rem;font-weight:800">Todas as Transações (${txAll.length})</div>
      <button onclick="fecharModalTxDetalhes()" style="background:var(--card2);border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:5px 12px;cursor:pointer;font-size:0.85rem">✕ Fechar</button>
    </div>
    <div>${html}</div>
  </div>`;
  modal.style.display = 'flex';
}

async function deletarTxModal(txId) {
  if (bloqueadoPorTrial()) return;
  if (!await confirmar({ emoji:'🗑', titulo:'Apagar esta transação?', perigo:true,
    texto:'Ela vai para a lixeira e sai dos seus totais.', confirmar:'Apagar' })) return;
  const { error } = await sb.from('transacoes').delete().eq('id', txId).eq('user_id', USER_ID);
  if (error) { alert('Erro ao apagar: ' + error.message); return; }
  // Atualiza allTx e re-renderiza o modal
  allTx = allTx.filter(t => t.id !== txId);
  window._modalTxList = (window._modalTxList || []).filter(t => t.id !== txId);
  _renderModalTxDetalhes(window._modalTxList);
  // Atualiza o extrato e home sem fechar o modal
  if (typeof renderTransacoes === 'function') renderTransacoes(allTx, userData);
  if (typeof renderHome === 'function') renderHome(userData, userData);
}

function fecharModalTxDetalhes() {
  const m = document.getElementById('modal-tx-detalhes');
  if (m) m.style.display = 'none';
}

function renderTransacoes(txAll, user) {
  // Label gerenciado por changeExtratoMes — não sobrescreve aqui
  // Período filter bar - quick buttons only (picker button is in HTML)
  const filterBarEl = document.getElementById('tx-periodo-bar');
  if (filterBarEl && !filterBarEl.dataset.built) {
    filterBarEl.innerHTML = `
      <button class="tx-periodo-btn active" id="txp-mes" onclick="setTxPeriodo('mes')">Este mês</button>
      <button class="tx-periodo-btn" id="txp-ontem" onclick="setTxPeriodo('ontem')">Ontem</button>
      <button class="tx-periodo-btn" id="txp-7d" onclick="setTxPeriodo('7d')">7 dias</button>
      <button class="tx-periodo-btn" id="txp-mes_passado" onclick="setTxPeriodo('mes_passado')">Mês passado</button>
    `;
    filterBarEl.dataset.built = '1';
  }
  // Sync active buttons
  document.querySelectorAll('.tx-periodo-btn').forEach(b => {
    if (b.id === 'txp-custom') {
      b.classList.toggle('active', _txPeriodo === 'custom');
    } else {
      b.classList.toggle('active', b.id === 'txp-' + _txPeriodo);
    }
  });

  const txFiltradas = getTxFiltradas();
  renderTxList(txFiltradas);

  // Stats do período — inclui faturas do cartão no total de gastos
  const [_stInicio, _stFim] = getTxPeriodoRange();
  const gastos = txFiltradas.filter(t=>t.tipo==='despesa').reduce((s,t)=>s+(+t.valor),0);
  // Para faturas: se "Este mês", usar fim do mês (não hoje) — faturas podem vencer no futuro
  const _stFimFaturas = (_txPeriodo === 'mes')
    ? new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).toISOString().split('T')[0]
    : _stFim;
  const gastosFat = (allFaturas||[]).filter(f=>(f.data_venc||'')>=_stInicio&&(f.data_venc||'')<=_stFimFaturas).reduce((s,f)=>s+(+f.valor||0),0);
  const gastosComFat = _txTipoFiltro !== 'receita' ? gastos + gastosFat : gastos;
  const receitas = txFiltradas.filter(t=>t.tipo==='receita').reduce((s,t)=>s+(+t.valor),0);
  const statsEl = document.getElementById('extrato-stats');
  if (statsEl) {
    const partes = [];
    if (gastosComFat > 0 && _txTipoFiltro !== 'receita') partes.push(`<span style="color:var(--red);font-weight:700">💸 ${BRL(gastosComFat)}</span>`);
    if (_txTipoFiltro !== 'despesa' && receitas > 0) partes.push(`<span style="color:var(--green);font-weight:700">💰 +${BRL(receitas)}</span>`);
    statsEl.innerHTML = partes.join('<span style="margin:0 8px;color:var(--muted)">|</span>');
  }

  // Donut chart — categorias do período
  const txDespPeriodo = txFiltradas.filter(t=>t.tipo==='despesa');
  const catMap = {};
  txDespPeriodo.forEach(t => { const cat=t.categoria||'outros'; catMap[cat]=(catMap[cat]||0)+(+t.valor); });
  // Merge credit card faturas into category chart — TODOS os períodos
  if (_stInicio) { // inclui faturas de todos os períodos
    // Para gráfico: também usar fim do mês quando "Este mês"
    const _stFimChart = (_txPeriodo === 'mes')
      ? new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).toISOString().split('T')[0]
      : _stFim;
    (window._todasFaturas||allFaturas||[])
      .filter(f => { const d=f.data_venc||f.data_vencimento||''; return d>=_stInicio&&d<=_stFimChart; })
      .forEach(f => {
        const cat = f.categoria||(typeof _sugerirCategoria==='function'?_sugerirCategoria(f.descricao||''):'compras');
        catMap[cat]=(catMap[cat]||0)+(+f.valor||0);
      });
  }
    const totalGastoChart = Object.values(catMap).reduce((s,v)=>s+v,0);
  const labels = Object.keys(catMap);
  const values = labels.map(k=>catMap[k]);
  const DEFAULT_COLORS = ['#18181b','#53ddfc','#9bffce','#fcd34d','#ff6e84','#a78bfa','#0ea5e9','#6ee7b7','#fb923c','#e879f9'];
  const catColors = labels.map((cat, i) => {
    const found = allCats.find(c => c.nome?.toLowerCase() === cat?.toLowerCase());
    return found?.cor || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
  });
  const catEmojis = labels.map(cat => {
    const found = allCats.find(c => c.nome?.toLowerCase() === cat?.toLowerCase());
    return found?.emoji || '📦';
  });

  if (chartDonut) chartDonut.destroy();
  const ctxD = document.getElementById('chart-donut')?.getContext('2d');
  if (ctxD && labels.length > 0) {
    chartDonut = new Chart(ctxD, {
      type:'doughnut',
      data:{ labels: labels.map((l,i)=>`${catEmojis[i]} ${l.charAt(0).toUpperCase()+l.slice(1)}`), datasets:[{data:values, backgroundColor:catColors, borderWidth:3, borderColor:'#191923'}] },
      options:{
        responsive:true, maintainAspectRatio:false, cutout:'62%',
        plugins:{
          legend:{ position:'bottom', labels:{ color:'#acaab5', font:{size:11}, boxWidth:12, padding:14 } },
          tooltip:{ callbacks:{ label: ctx => ` ${ctx.label}: ${BRL(+ctx.raw)} (${Math.round((+ctx.raw/totalGastoChart)*100)}%)` } },
          centerText: { total: totalGastoChart, label: 'Total' }
        },
        animation:{ duration:800, easing:'easeInOutQuart' }
      }
    });
  } else if (ctxD) {
    // Clear canvas if no data
    ctxD.clearRect(0,0,ctxD.canvas.width,ctxD.canvas.height);
  }

  // Circulos de limite por categoria
  renderCatLimitCircles(txDespPeriodo);

  // Toggle title/canvas based on current filter
  const titleEl  = document.getElementById('extrato-chart-title');
  const donutWrap = document.getElementById('extrato-donut-wrap');
  const recWrap   = document.getElementById('extrato-receita-wrap');
  if (_txTipoFiltro === 'todos') {
    if (titleEl) titleEl.textContent = 'Gastos & Receitas';
    if (donutWrap) { donutWrap.style.display='block'; donutWrap.style.flex=''; }
    if (recWrap) { recWrap.style.display='block'; recWrap.style.flex=''; }
    const ca = donutWrap?.parentElement;
    if (ca) { ca.style.display='block'; } // empilhado, não flex row
    requestAnimationFrame(() => { if (chartDonut) chartDonut.resize(); });
    renderReceitasChart(txFiltradas, user);
  } else if (_txTipoFiltro === 'receita') {
    if (titleEl) titleEl.textContent = 'Receitas por Fonte';
    if (donutWrap) donutWrap.style.display='none';
    if (recWrap) { recWrap.style.display='block'; recWrap.style.flex=''; }
    renderReceitasChart(txFiltradas, user);
  } else {
    if (titleEl) titleEl.textContent = 'Gastos por Categoria';
    if (donutWrap) donutWrap.style.display = 'block';
    if (recWrap) recWrap.style.display = 'none';
  }

  // Line chart — últimos 30 dias
  const days30 = [];
  for(let i=29;i>=0;i--) { const d=new Date(); d.setDate(d.getDate()-i); days30.push(d.toISOString().split('T')[0]); }
  const dayMap = {};
  days30.forEach(d=>dayMap[d]=0);
  allTx.filter(t=>t.tipo==='despesa'&&t.data>=days30[0]).forEach(t=>{ if(dayMap[t.data]!==undefined) dayMap[t.data]+=(+t.valor); });

  if (chartLine) chartLine.destroy();
  const ctxL = document.getElementById('chart-line')?.getContext('2d');
  if (ctxL) {
    chartLine = new Chart(ctxL, {
      type:'line',
      data:{
        labels: days30.map(d=>{ const dt=new Date(d+'T00:00:00'); return `${dt.getDate()}/${dt.getMonth()+1}`; }),
        datasets:[{
          data: days30.map(d=>dayMap[d]),
          borderColor:'#18181b', backgroundColor:'rgba(124,58,237,0.08)',
          borderWidth:2, pointRadius:0, fill:true, tension:0.4
        }]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ display:false } },
        scales:{
          x:{ ticks:{ color:'#acaab5', maxTicksLimit:8, font:{size:9} }, grid:{ color:'rgba(72,71,81,0.15)' } },
          y:{ ticks:{ color:'#acaab5', font:{size:9} }, grid:{ color:'rgba(72,71,81,0.15)' } }
        },
        animation:{ duration:600 }
      }
    });
  }

}
function renderReceitasChart(txFiltradas, user) {
  // Now uses the unified extrato-chart-card — toggle via extrato-receita-wrap
  const recWrap = document.getElementById('extrato-receita-wrap');
  const ctx = document.getElementById('chart-receita')?.getContext('2d');
  if (!ctx) return;

  // Só mostra em modo receita
  const modoReceita = !!(user?.modo_receita || userData?.modo_receita);
  // Only auto-show if filter is 'receita'; otherwise filterTx controls visibility
  if (!modoReceita) {
    if (recWrap) recWrap.style.display = 'none';
    return;
  }

  const recMap = {};
  txFiltradas.filter(t=>t.tipo==='receita').forEach(t => {
    const c = t.categoria || t.descricao || 'receita';
    recMap[c] = (recMap[c]||0) + (+t.valor);
  });

  const rLabels = Object.keys(recMap);
  if (!rLabels.length) {
    if (recWrap && _txTipoFiltro === 'receita') recWrap.style.display = 'none';
    return;
  }
  // Only set display if filter explicitly chose receita
  if (_txTipoFiltro === 'receita' && recWrap) recWrap.style.display = 'block';

  const rValues = rLabels.map(k=>recMap[k]);
  const GREEN_PALETTE = ['#22c55e','#4ade80','#86efac','#16a34a','#15803d','#6ee7b7','#34d399','#10b981','#059669','#d1fae5'];
  const rColors = rLabels.map((_, i) => GREEN_PALETTE[i % GREEN_PALETTE.length]);

  if (window._chartReceita) window._chartReceita.destroy();
  window._chartReceita = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: rLabels.map(l => l.charAt(0).toUpperCase() + l.slice(1)),
      datasets: [{ data: rValues, backgroundColor: rColors, borderWidth: 3, borderColor: '#191923' }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: { position: 'bottom', labels: { color: '#acaab5', font: { size: 11 }, boxWidth: 12, padding: 14 } },
        tooltip: { callbacks: { label: ctx => ` ${BRL(ctx.parsed)}` } }
      },
      animation: { duration: 800, easing: 'easeInOutQuart' }
    }
  });
}

function renderCatLimitCircles(txDesp) {
  const el = document.getElementById('cat-limit-circles');
  if (!el) return;
  const catsComLimite = (allCats || []).filter(c => c.ativa && c.limite_mensal > 0);
  if (!catsComLimite.length) { el.style.display='none'; return; }
  el.style.display = 'block';
  const catGastos = {};
  txDesp.forEach(t => { const c=(t.categoria||'outros').toLowerCase(); catGastos[c]=(catGastos[c]||0)+(+t.valor); });
  el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div class="label">Limite por Categoria</div>
    <button onclick="abrirModalEditarCat()" style="background:transparent;border:1px solid var(--border2);color:var(--muted);border-radius:8px;padding:3px 10px;font-size:0.68rem;font-weight:700;cursor:pointer;font-family:var(--font-body)">✏️ Editar cores</button>
  </div><div class="cat-circ-grid">` +
    catsComLimite.map(c => {
      const gasto = catGastos[c.nome?.toLowerCase()] || 0;
      const pct = Math.min(100, Math.round((gasto/c.limite_mensal)*100));
      const cor = pct>=90?'var(--red)':pct>=70?'var(--amber)':(c.cor||'var(--purple)');
      const r=22,cx=26,cy=26,circ2=2*Math.PI*r;
      const offset = circ2*(1-pct/100);
      return `<div class="cat-circ-item" title="Editar" onclick="abrirModalEditarCatSingle('${c.id}')" style="cursor:pointer">
        <svg viewBox="0 0 52 52" style="width:52px;height:52px;display:block">
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--card2)" stroke-width="5"/>
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${cor}" stroke-width="5"
            stroke-dasharray="${circ2.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
            stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"
            style="transition:stroke-dashoffset 1s ease"/>
          <text x="${cx}" y="${cy-2}" text-anchor="middle" font-size="8" fill="var(--text)">${c.emoji||'📦'}</text>
          <text x="${cx}" y="${cy+8}" text-anchor="middle" font-size="7" font-weight="800" fill="${cor}">${pct}%</text>
        </svg>
        <div style="font-size:0.62rem;color:var(--muted);text-align:center;margin-top:4px;max-width:52px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.nome}</div>
        <div style="font-size:0.6rem;color:var(--muted2);text-align:center">${BRL(gasto)}</div>
      </div>`;
    }).join('') + '</div>';
}

// Modal para editar cor/emoji de UMA categoria
function abrirModalEditarCatSingle(catId) {
  const cat = allCats.find(c => c.id === catId);
  if (!cat) return;
  const modal = document.getElementById('cat-modal');
  if (!modal) return;
  document.getElementById('cat-modal-id').value = cat.id;
  document.getElementById('cat-modal-title').textContent = `Editar: ${cat.nome}`;
  document.getElementById('cat-modal-nome').value = cat.nome || '';
  document.getElementById('cat-modal-emoji').value = cat.emoji || '📦';
  document.getElementById('cat-modal-limite').value = cat.limite_mensal || '';
  document.getElementById('cat-modal-cor').value = cat.cor || '#e4e4e7';
  renderColorSwatches(cat.cor || '#e4e4e7');
  updateCatBudgetInfo(cat.id);
  modal.style.display = 'flex';
}

// Modal de editar todas as categorias (cores e emojis)
function abrirModalEditarCat() {
  let modal = document.getElementById('modal-editar-cats');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-editar-cats';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:350;background:rgba(0,0,0,0.8);align-items:flex-end;justify-content:center';
    modal.onclick = e => { if(e.target===modal) fecharModalEditarCat(); };
    document.body.appendChild(modal);
  }

  const EMOJIS_RAPIDOS = ['📦','🛒','🚌','🏠','💊','🎉','🛍️','📲','📖','🐾','💰','⚡','🍕','☕','✈️','🎮','🏋️','💼','🎵','🔧'];

  const rows = allCats.filter(c=>c.ativa).map(c => {
    const eid = `emoji-${c.id}`;
    const cid = `cor-${c.id}`;
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="font-size:0.82rem;color:var(--text);font-weight:600;flex:1;min-width:80px">${c.nome}</div>
      <input id="${eid}" type="text" value="${c.emoji||'📦'}" maxlength="2"
        style="width:44px;text-align:center;font-size:1.2rem;background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:4px;color:var(--text)"
        placeholder="📦"/>
      <input id="${cid}" type="color" value="${c.cor||'#e4e4e7'}"
        style="width:36px;height:36px;border:none;border-radius:8px;cursor:pointer;padding:0;background:none"
        title="Cor"/>
      <button onclick="salvarCatCorEmoji('${c.id}','${eid}','${cid}')"
        style="background:var(--purple);color:var(--bg);border:none;border-radius:8px;padding:6px 12px;font-size:0.72rem;font-weight:700;cursor:pointer;font-family:var(--font-body)">
        ✓
      </button>
    </div>`;
  }).join('');

  modal.innerHTML = `<div style="background:var(--card);border-radius:22px 22px 0 0;padding:24px;width:100%;max-width:520px;max-height:80vh;overflow-y:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div style="font-family:var(--font-head);font-size:1.1rem;font-weight:800">✏️ Editar Categorias</div>
      <button onclick="fecharModalEditarCat()" style="background:var(--card2);border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:5px 12px;cursor:pointer;font-size:0.85rem">✕</button>
    </div>
    <div style="font-size:0.75rem;color:var(--muted);margin-bottom:14px">Clique em ✓ após editar cada categoria</div>
    ${rows}
  </div>`;
  modal.style.display = 'flex';
}

function fecharModalEditarCat() {
  const m = document.getElementById('modal-editar-cats');
  if (m) m.style.display = 'none';
}

async function salvarCatCorEmoji(catId, emojiInputId, corInputId) {
  if (bloqueadoPorTrial()) return;
  const emoji = document.getElementById(emojiInputId)?.value?.trim() || '📦';
  const cor = document.getElementById(corInputId)?.value || '#e4e4e7';
  try {
    await sb.from('categorias').update({ emoji, cor }).eq('id', catId);
    const cat = allCats.find(c=>c.id===catId);
    if (cat) { cat.emoji = emoji; cat.cor = cor; }
    showToast('✅ Categoria atualizada!', 'success');
    renderTransacoes(allTx, userData);
  } catch(e) {
    showToast('Erro ao salvar. Tenta de novo.', 'error');
  }
}

// ══════════════════════════════════════════════════════════
// EDIÇÃO DE TRANSAÇÕES
// ══════════════════════════════════════════════════════════
function _abrirEditTx(txId) {
  const tx = allTx.find(t => t.id === txId);
  if (!tx) return;

  let modal = document.getElementById('_modal-edit-tx');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = '_modal-edit-tx';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:550;background:rgba(0,0,0,0.85);align-items:flex-end;justify-content:center';
    modal.onclick = e => { if(e.target===modal) modal.style.display='none'; };
    document.body.appendChild(modal);
  }

  // Categorias: combina as do usuário + lista padrão
  const userCats = (allCats||[]).map(c=>({ nome:c.nome, emoji:c.emoji||'📦' }));
  const defaultCats = _CATS_LIST.map(n=>({ nome:n, emoji:(_CATS_EMOJI||{})[n]||emojiFor(n) }));
  const todasCats = [...new Map([...defaultCats,...userCats].map(c=>[c.nome,c])).values()].sort((a,b)=>a.nome.localeCompare(b.nome));
  const catOptions = todasCats.map(c => `<option value="${c.nome}" ${c.nome===tx.categoria?'selected':''}>${c.emoji} ${c.nome}</option>`).join('');

  modal.innerHTML = `<div style="background:var(--card);border-radius:22px 22px 0 0;padding:24px;width:100%;max-width:560px;max-height:88vh;overflow-y:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <div style="font-family:var(--font-head);font-size:1rem;font-weight:800">✏️ Editar Transação</div>
      <button onclick="document.getElementById('_modal-edit-tx').style.display='none'" style="background:var(--card2);border:1px solid var(--border2);color:var(--muted);border-radius:8px;padding:4px 10px;cursor:pointer">✕</button>
    </div>

    <input type="hidden" id="_etx-id" value="${tx.id}"/>

    <div style="margin-bottom:14px">
      <label style="font-size:0.72rem;color:var(--muted);display:block;margin-bottom:4px">Descrição</label>
      <input id="_etx-desc" value="${tx.descricao||''}" placeholder="Ex: Supermercado"
        style="width:100%;background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:11px 12px;font-size:0.88rem;font-family:var(--font-body);box-sizing:border-box"/>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div>
        <label style="font-size:0.72rem;color:var(--muted);display:block;margin-bottom:4px">Tipo</label>
        <select id="_etx-tipo" style="width:100%;background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:11px 10px;font-size:0.85rem;font-family:var(--font-body)">
          <option value="despesa" ${tx.tipo==='despesa'?'selected':''}>💸 Despesa</option>
          <option value="receita" ${tx.tipo==='receita'?'selected':''}>💰 Receita</option>
        </select>
      </div>
      <div>
        <label style="font-size:0.72rem;color:var(--muted);display:block;margin-bottom:4px">Categoria</label>
        <select id="_etx-cat" style="width:100%;background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:11px 10px;font-size:0.85rem;font-family:var(--font-body)">${catOptions}</select>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
      <div>
        <label style="font-size:0.72rem;color:var(--muted);display:block;margin-bottom:4px">Valor (R$)</label>
        <input id="_etx-valor" type="text" inputmode="decimal" value="${(+tx.valor).toLocaleString('pt-BR',{minimumFractionDigits:2})}"
          style="width:100%;background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:11px 12px;font-size:0.88rem;font-family:var(--font-body);box-sizing:border-box"/>
      </div>
      <div>
        <label style="font-size:0.72rem;color:var(--muted);display:block;margin-bottom:4px">Data</label>
        <input id="_etx-data" type="date" value="${tx.data||today()}"
          style="width:100%;background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:11px 12px;font-size:0.85rem;font-family:var(--font-body);box-sizing:border-box"/>
      </div>
    </div>

    <div style="display:flex;gap:10px">
      <button onclick="_deletarTx('${tx.id}')" style="background:rgba(255,110,132,0.1);border:1px solid rgba(255,110,132,0.3);color:var(--red);border-radius:12px;padding:12px 16px;cursor:pointer;font-size:0.82rem;font-family:var(--font-body)">🗑 Excluir</button>
      <button onclick="_salvarEditTx()" style="flex:1;background:var(--purple);border:none;color:#fff;border-radius:12px;padding:13px;font-size:0.88rem;font-weight:700;cursor:pointer;font-family:var(--font-body)">💾 Salvar alterações</button>
    </div>
  </div>`;

  modal.style.display = 'flex';
  // Aplica máscara de moeda
  const valEl = document.getElementById('_etx-valor');
  if (valEl) _mascaraMoeda(valEl);
}

async function _salvarEditTx() {
  const id    = document.getElementById('_etx-id')?.value;
  const desc  = document.getElementById('_etx-desc')?.value?.trim();
  const tipo  = document.getElementById('_etx-tipo')?.value;
  const cat   = document.getElementById('_etx-cat')?.value;
  const valor = _getNumVal('_etx-valor');
  const data  = document.getElementById('_etx-data')?.value;

  if (!desc)  { showToast('Preencha a descrição', 'error'); return; }
  if (!valor) { showToast('Valor inválido', 'error'); return; }

  const btn = document.querySelector('#_modal-edit-tx button[onclick="_salvarEditTx()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

  try {
    const { error } = await sb.from('transacoes')
      .update({ descricao: desc, tipo, categoria: cat, valor, data })
      .eq('id', id).eq('user_id', USER_ID);
    if (error) throw error;

    // Atualiza em memória
    const idx = allTx.findIndex(t => t.id === id);
    if (idx >= 0) allTx[idx] = { ...allTx[idx], descricao: desc, tipo, categoria: cat, valor, data };

    document.getElementById('_modal-edit-tx').style.display = 'none';
    showToast('✅ Transação atualizada!', 'success');
    renderTransacoes(allTx, userData); // re-renderiza lista
  } catch(e) {
    showToast('Erro: ' + (e.message||e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar alterações'; }
  }
}

async function _deletarTx(id) {
  _confirmarAcao({
    titulo: 'Excluir transação?',
    msg: 'Esta ação move a transação para a lixeira. Pode ser recuperada depois.',
    labelOk: 'Excluir',
    corOk: 'var(--red)'
  }, async (ok) => {
    if (!ok) return;
    try {
      await sb.from('transacoes').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('user_id', USER_ID);
      allTx = allTx.filter(t => t.id !== id);
      document.getElementById('_modal-edit-tx').style.display = 'none';
      showToast('🗑 Transação excluída', 'success');
      renderTransacoes(allTx, userData);
    } catch(e) { showToast('Erro: ' + (e.message||e), 'error'); }
  });
}

function renderTxList(txAll) {
  const el = document.getElementById('tx-list');
  if (!el) return;
  const tipo = _txTipoFiltro || 'todos';
  const filtered = tipo==='todos' ? txAll : txAll.filter(t=>t.tipo===tipo);
  if (!filtered.length) { el.innerHTML='<div style="font-size:0.82rem;color:var(--muted);padding:16px 0;text-align:center">Nenhuma transação encontrada.</div>'; return; }

  const visiveis = _txMostrarTodos ? filtered : filtered.slice(0, TX_PAGE_SIZE);
  const temMais = !_txMostrarTodos && filtered.length > TX_PAGE_SIZE;

  el.innerHTML = visiveis.map(t => {
    const emoji = emojiFor(t.categoria||t.descricao||'');
    const sign  = t.tipo==='receita' ? '+' : '-';
    const cls   = t.tipo==='receita' ? 'rece' : 'desp';
    const fonteBadge = (t.fonte==='csv'||t.fonte==='pdf')
      ? `<span style="font-size:0.55rem;background:rgba(24,24,27,0.1);color:var(--purple-light);border-radius:6px;padding:1px 4px;margin-left:4px;vertical-align:middle" title="Importado de fatura">💳</span>`
      : '';
    return `<div class="tx-item" style="position:relative">
      <div class="tx-icon">${emoji}</div>
      <div class="tx-info" style="flex:1;min-width:0">
        <div class="tx-name">${t.descricao||'—'}${fonteBadge}</div>
        <div class="tx-date">${t.categoria||'outros'} · ${fmtDate(t.data)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="tx-amount ${cls}">${sign} ${BRL(t.valor)}</div>
        <button onclick="event.stopPropagation();_abrirEditTx('${t.id}')"
          style="background:var(--card2);border:1px solid var(--border2);color:var(--muted);border-radius:8px;padding:5px 8px;cursor:pointer;font-size:0.75rem;line-height:1;flex-shrink:0" title="Editar transação">✏️</button>
      </div>
    </div>`;
  }).join('');

  if (temMais) {
    el.innerHTML += `<div style="text-align:center;padding:12px 0">
      <button onclick="abrirModalTxDetalhes(getTxFiltradas())" style="background:var(--purple-dim);border:1px solid rgba(24,24,27,0.25);color:var(--purple-light);border-radius:20px;padding:8px 20px;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:var(--font-body)">
        Ver todas (${filtered.length}) transações →
      </button>
    </div>`;
  }
}

// ══════════════════════════════════════════════════════════
// HELPERS — Circular SVG progress
// ══════════════════════════════════════════════════════════
function makeSVGCircle(pct, color, emoji, label) {
  const r = 26, cx = 32, cy = 32;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(pct, 100) / 100);
  const col = pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--amber)' : color || 'var(--purple)';
  return `<svg class="circ-svg" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--card2)" stroke-width="6"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="6"
      stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
      stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"
      style="transition:stroke-dashoffset 1.2s cubic-bezier(.2,.8,.2,1)"/>
    <text x="${cx}" y="${cy - 3}" text-anchor="middle" font-size="14" fill="var(--text)">${emoji||''}</text>
    <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="9" font-weight="700" fill="${col}">${Math.round(pct)}%</text>
  </svg>`;
}

// ══════════════════════════════════════════════════════════
// FATURAS — Estado e renderização completa
// ══════════════════════════════════════════════════════════
let _fatCartaoAtivo = 'todos';
let _fatViewAtiva = 'circular';

function setFatTab(tab) {
  _fatViewAtiva = tab;
  ['circular','lista','comparar'].forEach(t => {
    const el = document.getElementById('fat-view-' + t);
    const btn = document.getElementById('fat-tab-' + t);
    if (el) el.style.display = t === tab ? 'block' : 'none';
    if (btn) btn.classList.toggle('active', t === tab);
  });
  if (tab === 'comparar') renderFatComparar(window._todasFaturas || []);
}

// ══════════════════════════════════════════════════════════
// FATURAS — AUTO-CATEGORIZAÇÃO POR PALAVRAS-CHAVE
// ══════════════════════════════════════════════════════════
const _CAT_KEYWORDS = {
  'alimentacao': ['IFOOD','RAPPI','UBER EATS','MCDONALDS','BURGER','SUBWAY','PIZZA','CAFE','RESTAURANTE','MERCADO','SUPERMERCADO','LANCHONETE','PADARIA','SUSHI','ACAI','HORTIFRUTI','ATACADAO','CARREFOUR','EXTRA','WALMART','PÃO DE AÇÚCAR','MERCADOLIVRE','MERCADO LIVRE'],
  'transporte':  ['UBER','99POP','CABIFY','POSTO','GASOLINA','IPVA','ESTACIONAMENTO','METRO','ONIBUS','PASSAGEM','LATAM','GOL','AZUL','RODOVIARIA'],
  'moradia':     ['CONDOMINIO','ALUGUEL','IPTU','LUZ','AGUA','GAS','ENERGIA','ENEL','SABESP','COMGAS','NET','CLARO','OI','VIVO','TIM'],
  'saude':       ['FARMACIA','DROGARIA','CLINICA','HOSPITAL','UNIMED','AMIL','SULAMERICA','MEDICO','DENTISTA','LABORATORIO','ACADEMIA','SMARTFIT','TECNODENT'],
  'lazer':       ['NETFLIX','SPOTIFY','PRIME VIDEO','DISNEY','HBO','STEAM','PLAYSTATION','XBOX','CINEMA','TEATRO','SHOW'],
  'assinaturas': ['ADOBE','MICROSOFT','APPLE','GOOGLE','DROPBOX','GITHUB','NOTION','SLACK','GROK','XAI'],
  'compras':     ['AMAZON','SHOPEE','ALIEXPRESS','AMERICANAS','MAGAZINE','SUBMARINO','SHEIN','ZARA','RENNER','RIACHUELO'],
  'educacao':    ['UDEMY','COURSERA','ALURA','ROCKETSEAT','DUOLINGO','ESCOLA','FACULDADE','UNIVERSIDADE','CURSO'],
  'pets':        ['PETSHOP','COBASI','PETZ','VETERINARI','PET'],
};

function _sugerirCategoria(descricao) {
  const d = (descricao || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  for (const [cat, keywords] of Object.entries(_CAT_KEYWORDS)) {
    if (keywords.some(k => d.includes(k.toUpperCase()))) return cat;
  }
  return 'outros';
}

// Roda ao carregar — salva no banco faturas sem categoria definida
function _autoCategorFaturas(faturas) {
  const promises = [];
  let atualizadas = 0;
  faturas.forEach(f => {
    if (!f.categoria || f.categoria === 'outros') {
      const sugestao = _sugerirCategoria(f.descricao);
      if (sugestao !== 'outros') {
        f.categoria = sugestao;
        atualizadas++;
        promises.push(
          sb.from('faturas_futuras').update({ categoria: sugestao }).eq('id', f.id).then(() => {})
        );
      }
    }
  });
  if (atualizadas > 0) {
    Promise.all(promises).then(() => showToast(`✨ ${atualizadas} fatura(s) categorizadas automaticamente!`, 'success'));
  }
  return faturas;
}

// ══════════════════════════════════════════════════════════
// FATURAS — EDIÇÃO INLINE DE CATEGORIA
// Scoped por importacao_id — NUNCA afeta compras diferentes
// ══════════════════════════════════════════════════════════
const _CATS_LIST = ['alimentacao','transporte','moradia','saude','lazer','assinaturas','compras','educacao','pets','outros'];
const _CATS_EMOJI = {alimentacao:'🍽️',transporte:'🚗',moradia:'🏠',saude:'🏥',lazer:'🎮',assinaturas:'📱',compras:'🛍️',educacao:'📚',pets:'🐾',outros:'📦'};

function getDescricaoBase(desc) {
  return (desc || '').replace(/\s+[Pp]arcela\s+\d+\s+de\s+\d+\s*$/,'').replace(/\s+\d+\/\d+\s*$/,'').trim();
}

async function _editarDataFatura(faturaId, novaData) {
  if (!novaData || !USER_ID) return;
  try {
    await sb.from('faturas_futuras').update({ data_venc: novaData }).eq('id', faturaId).eq('user_id', USER_ID);
    const f = (allFaturas||[]).find(x => x.id === faturaId);
    if (f) f.data_venc = novaData;
    showToast('📅 Data atualizada!', 'success');
    renderFaturas(allFaturas); // atualiza círculos mensais
  } catch(e) { showToast('Erro ao salvar data: ' + (e.message||e), 'error'); }
}

async function _editarCatFatura(faturaId, novaCategoria, selectEl) {
  try {
    const { error } = await sb.from('faturas_futuras').update({ categoria: novaCategoria }).eq('id', String(faturaId)).eq('user_id', USER_ID);
    if (error) throw error;
    [allFaturas, window._todasFaturas].forEach(arr => {
      if (!arr) return;
      const f = arr.find(x => String(x.id) === String(faturaId));
      if (f) f.categoria = novaCategoria;
    });
    // Atualiza emoji da linha sem fechar modal
    if (selectEl) {
      const row = document.getElementById('fat-row-' + faturaId);
      const icon = row?.querySelector('.fat-row-emoji');
      if (icon) icon.textContent = _CATS_EMOJI[novaCategoria] || emojiFor(novaCategoria);
    }
    showToast('✅ Categoria salva!', 'success');
  } catch(e) { showToast('❌ Erro: ' + (e.message||e), 'error'); }
}

function _confirmarAcao({ titulo, msg, labelOk, corOk }, callback) {
  let m = document.getElementById('_modal-confirmar-acao');
  if (!m) {
    m = document.createElement('div');
    m.id = '_modal-confirmar-acao';
    m.style.cssText = 'display:none;position:fixed;inset:0;z-index:700;background:rgba(0,0,0,0.75);align-items:center;justify-content:center;padding:20px';
    document.body.appendChild(m);
  }
  m.innerHTML = `<div style="background:var(--card);border:1px solid var(--border2);border-radius:18px;padding:24px;width:100%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,0.6)">
    <div style="font-size:1.5rem;margin-bottom:10px;text-align:center">🏷️</div>
    <div style="font-family:var(--font-head);font-size:1rem;font-weight:800;color:var(--text);text-align:center;margin-bottom:8px">${titulo}</div>
    <div style="font-size:0.82rem;color:var(--muted);text-align:center;line-height:1.6;margin-bottom:20px">${msg}</div>
    <div style="display:flex;gap:10px">
      <button id="_conf-cancelar" style="flex:1;background:var(--card2);border:1px solid var(--border2);color:var(--muted);border-radius:10px;padding:10px;font-size:0.85rem;font-weight:700;cursor:pointer;font-family:var(--font-body)">Cancelar</button>
      <button id="_conf-ok" style="flex:1;background:${corOk||'var(--purple)'};border:none;color:#fff;border-radius:10px;padding:10px;font-size:0.85rem;font-weight:700;cursor:pointer;font-family:var(--font-body)">${labelOk||'Confirmar'}</button>
    </div>
  </div>`;
  m.style.display = 'flex';
  m.querySelector('#_conf-ok').onclick     = () => { m.style.display='none'; callback(true); };
  m.querySelector('#_conf-cancelar').onclick = () => { m.style.display='none'; callback(false); };
  m.onclick = e => { if(e.target===m) { m.style.display='none'; callback(false); } };
}

async function _editarCatFaturaTodas(faturaId, descricaoBase, catAtual) {
  // REGRA CRÍTICA: só afeta faturas do MESMO importacao_id (mesma compra parcelada)
  // Isso garante que jamais afeta compras diferentes com nomes parecidos
  const todas = window._todasFaturas || allFaturas || [];
  const faturaRef = todas.find(f => String(f.id) === String(faturaId));
  const importacaoId = faturaRef?.importacao_id;

  let matches;
  if (importacaoId) {
    const baseDesc = getDescricaoBase(descricaoBase);
    matches = todas.filter(f =>
      f.importacao_id === importacaoId &&
      getDescricaoBase(f.descricao) === baseDesc
    );
  } else {
    // Sem importacao_id: só altera esta fatura (não tem como inferir grupo)
    matches = todas.filter(f => String(f.id) === String(faturaId));
  }

  if (!matches.length) { showToast('Nenhuma parcela similar encontrada', 'error'); return; }

  const selEl = document.getElementById('cat-sel-' + faturaId);
  const novaCat = selEl ? selEl.value : catAtual;
  const base = getDescricaoBase(descricaoBase);

  _confirmarAcao({
    titulo: `Aplicar "${novaCat}" a todas?`,
    msg: `<strong style="color:var(--text)">${matches.length} parcelas</strong> de <em>"${base.length > 35 ? base.substring(0,35)+'…' : base}"</em> receberão esta categoria.<br><br><span style="color:var(--green);font-size:0.75rem">✓ Outras compras com nomes diferentes <strong>não serão alteradas</strong></span>`,
    labelOk: `Aplicar às ${matches.length} parcelas`,
    corOk: 'var(--purple)'
  }, async (ok) => {
    if (!ok) return;
    try {
      const ids = matches.map(f => f.id);
      await sb.from('faturas_futuras').update({ categoria: novaCat }).in('id', ids).eq('user_id', USER_ID);
      matches.forEach(f => { f.categoria = novaCat; });
      showToast(`✅ ${matches.length} parcelas de "${base.substring(0,25)}..." atualizadas!`, 'success');
      const cartoes = window._faturasCartoes || {};
      const nomeKey = Object.keys(cartoes).find(k => cartoes[k].items.some(i => String(i.id) === String(faturaId)));
      if (nomeKey) abrirModalCartao(encodeURIComponent(nomeKey));
    } catch(e) { showToast('Erro: ' + (e.message||e), 'error'); }
  });
}

// ══════════════════════════════════════════════════════════
// FATURAS — STATUS DE PAGAMENTO (localStorage)
// ══════════════════════════════════════════════════════════
function _getMesPagoKey() { return `lumnis_mespago_${USER_ID || 'anon'}`; }

// ── Status de pagamento por cartão ──────────────────────────────────────
const _FAT_STATUS = { paid:'#9bffce', overdue:'#ff6e84', due_soon:'#fcd34d', open:'#818cf8' };

function _isPagoCartao(mesKey, cartaoId) {
  try {
    const d = JSON.parse(localStorage.getItem(_getMesPagoKey()) || '{}');
    return !!(d[mesKey + '|' + (cartaoId||'')] || d[mesKey]);
  } catch(e) { return false; }
}
function _cartaoStatusColor(mesKey, cartaoId, items) {
  if (_isPagoCartao(mesKey, cartaoId)) return _FAT_STATUS.paid;
  const maxV = items.reduce((m,f) => (f.data_venc||'')>m ? (f.data_venc||'') : m, '');
  if (!maxV) return _FAT_STATUS.open;
  const h = today();
  if (maxV < h) return _FAT_STATUS.overdue;
  if (Math.round((new Date(maxV)-new Date(h))/86400000) <= 5) return _FAT_STATUS.due_soon;
  return _FAT_STATUS.open;
}
function _toggleCartaoPago2(mesKey, cartaoId) {
  const key = mesKey + '|' + (cartaoId||'');
  try {
    const d = JSON.parse(localStorage.getItem(_getMesPagoKey()) || '{}');
    d[key] = !d[key]; localStorage.setItem(_getMesPagoKey(), JSON.stringify(d));
  } catch(e) {}
  renderFatCircular(allFaturas);
  const modal = document.getElementById('modal-mes-fatura');
  if (modal && modal.style.display !== 'none' && modal._mesKey) abrirModalMesFatura(modal._mesKey);
}
async function _salvarVencCartao2(mesKey, cartaoId, novoDia) {
  if (!novoDia || novoDia < 1 || novoDia > 31) { showToast('Dia invalido','error'); return; }
  const g = (window._faturasGrupo||{})[mesKey];
  if (!g) return;
  const itens = g.items.filter(f => (f.cartao||'')===cartaoId || (cartaoId==='_todos'));
  if (!itens.length) return;
  try {
    await Promise.all(itens.map(f => {
      const pts = (f.data_venc||'').split('-');
      if (pts.length<3) return Promise.resolve();
      const dim = new Date(+pts[0],+pts[1],0).getDate();
      const nd = pts[0]+'-'+pts[1]+'-'+String(Math.min(novoDia,dim)).padStart(2,'0');
      return sb.from('faturas_futuras').update({data_venc:nd}).eq('id',f.id).eq('user_id',USER_ID)
        .then(()=>{ f.data_venc=nd; });
    }));
    showToast('Vencimento atualizado!','success');
    renderFaturas(allFaturas); abrirModalMesFatura(mesKey);
  } catch(e) { showToast('Erro: '+((e&&e.message)||e),'error'); }
}

function getMesPagoStatus(mesKey) {
  try { return JSON.parse(localStorage.getItem(_getMesPagoKey()) || '{}')[mesKey] || false; } catch { return false; }
}
function toggleMesPago(mesKey) {
  if (bloqueadoPorTrial()) return;
  try {
    const data = JSON.parse(localStorage.getItem(_getMesPagoKey()) || '{}');
    data[mesKey] = !data[mesKey];
    localStorage.setItem(_getMesPagoKey(), JSON.stringify(data));
  } catch {}
  renderFatCircular(allFaturas);
}

// ══════════════════════════════════════════════════════════
// FATURAS — EDIÇÃO DE CATEGORIAS COM BULK-APPLY INTELIGENTE
// ══════════════════════════════════════════════════════════

function _isFatPaga(f) {
  // Fatura considerada "paga" se o vencimento já passou
  return (f.data_venc || '') < today();
}

function renderFaturas(faturas) {
  window._todasFaturas = faturas;
  allFaturas = faturas;
  _autoCategorFaturas(faturas); // auto-categoriza silenciosamente
  renderCartaoBento(faturas);
  renderFatCircular(faturas);
  renderFatLista(faturas);
}


// Detecta banco a partir das descrições das transações (fallback quando cache miss)
// Aceita item único OU array de itens (detecção em lote — muito mais precisa)
function detectarBancoFromDescricoes(fatura) {
  const items = Array.isArray(fatura) ? fatura : [fatura];
  const desc = items.map(f => (f.descricao || '') + ' ' + (f.cartao || '')).join(' ').toLowerCase();
  if (/nubank|nu\.com/.test(desc)) return 'Nubank';
  if (/santander|rodrigo|hamburgueria|saipos|mercearia|superpao|tecnodent|brownprod/.test(desc)) return 'Santander';
  if (/mercadolivre|mercadopago|mp\s?\*|melimais|brisanet|shopee|astronpay|grok.*xai/.test(desc)) return 'Mercado Pago';
  if (/bradesco/.test(desc)) return 'Bradesco';
  if (/itau|ita[uú]/.test(desc)) return 'Itaú';
  if (/inter\b/.test(desc)) return 'Inter';
  if (/c6\b/.test(desc)) return 'C6 Bank';
  return null;
}
function renderCartaoBento(faturas) {
  const el = document.getElementById('cartao-bento-grid');
  if (!el) return;

  const bancoCache = getBancoCache();

  // PASSO 1: agrupar por importacao_id para detectar banco em lote (muito mais preciso)
  const porImportacao = {};
  faturas.forEach(f => {
    const key = f.importacao_id || '__sem_id__' + (f.id || Math.random());
    if (!porImportacao[key]) porImportacao[key] = [];
    porImportacao[key].push(f);
  });

  // PASSO 2: para cada grupo, resolver o banco uma vez e persistir no cache
  const bancoResolvido = {}; // importacao_id → bancoKey
  Object.entries(porImportacao).forEach(([importId, items]) => {
    let nome = bancoCache[importId] || null;
    if (!nome) nome = detectarBancoFromDescricoes(items); // lote inteiro
    if (!nome && importId !== '__sem_id__') nome = 'Cartão (' + importId.substring(0,4) + ')';
    if (!nome) nome = 'Cartão';
    // Persiste no cache se detectou via descrições (economiza futuras buscas)
    if (!bancoCache[importId] && nome && !nome.startsWith('Cartão (') && importId !== '__sem_id__') {
      setBancoCacheEntry(importId, nome);
    }
    items.forEach(f => { bancoResolvido[f.importacao_id || f.id] = nome; });
  });

  // PASSO 3: agrupa por nome do banco para os cards
  // Prioridade: f.cartao (banco de dados) → bancoResolvido (cache/detecção) → 'Cartão'
  const cartoes = {};
  faturas.forEach(f => {
    const bancoKey = f.cartao || bancoResolvido[f.importacao_id || f.id] || 'Cartão';
    if (!cartoes[bancoKey]) cartoes[bancoKey] = { total: 0, qtd: 0, venc: null, items: [] };
    cartoes[bancoKey].total += +f.valor;
    cartoes[bancoKey].qtd++;
    cartoes[bancoKey].items.push(f);
    if (!cartoes[bancoKey].venc || f.data_venc < cartoes[bancoKey].venc) cartoes[bancoKey].venc = f.data_venc;
  });

  if (!Object.keys(cartoes).length) { el.innerHTML = ''; return; }
  window._faturasCartoes = cartoes;

  const hojeStr = today();
  el.innerHTML = Object.entries(cartoes).map(([nome, d]) => {
    const banco = detectarBanco(nome);
    const nomeKey = encodeURIComponent(nome);
    return `<div class="cartao-card ok">
      <div class="cartao-card-header">
        <div>
          <div class="cartao-card-bank">${banco.emoji} ${banco.nome}</div>
          <div class="cartao-card-digits" style="color:var(--muted);font-size:0.72rem;margin-top:2px">${d.qtd} parcela${d.qtd>1?'s':''} · ${d.items.length} itens</div>
        </div>
      </div>
      <div class="cartao-card-valor">${BRL(d.total)}</div>
      <div class="cartao-card-footer" style="justify-content:flex-end">
        <div style="display:flex;gap:6px">
          <button onclick="abrirModalCartao('${nomeKey}')" style="background:var(--card2);border:1px solid var(--border2);color:var(--muted);border-radius:20px;padding:5px 12px;font-size:0.72rem;font-weight:700;cursor:pointer;font-family:var(--font-body)">✏️ Editar categorias</button>
          <button onclick="abrirModalCartao('${nomeKey}')" style="background:rgba(124,58,237,0.15);border:1px solid rgba(24,24,27,0.25);color:var(--purple-light);border-radius:20px;padding:5px 14px;font-size:0.72rem;font-weight:700;cursor:pointer;font-family:var(--font-body)">Ver detalhes →</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function abrirModalCartao(nomeEncoded) {
  const nome = decodeURIComponent(nomeEncoded);
  const cartoes = window._faturasCartoes || {};
  const d = cartoes[nome];
  if (!d) return;

  let modal = document.getElementById('modal-cartao-detalhe');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-cartao-detalhe';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:450;background:rgba(0,0,0,0.82);align-items:flex-end;justify-content:center';
    modal.onclick = e => { if(e.target===modal) fecharModalCartao(); };
    document.body.appendChild(modal);
  }

  const banco = detectarBanco(nome);

  const itemsHtml = d.items.map(f => {
    const cat = f.categoria || 'outros';
    const parc = f.parcela_total > 1
      ? `<span style="background:var(--purple-dim);color:var(--purple-light);border-radius:4px;padding:1px 5px;font-size:0.62rem">${f.parcela_atual}/${f.parcela_total}</span>`
      : '';
    const catOptions = _CATS_LIST.map(c =>
      `<option value="${c}" ${c===cat?'selected':''}>${_CATS_EMOJI[c]||'📦'} ${c}</option>`
    ).join('');
    const descEsc = (f.descricao||'').replace(/'/g, '');
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);gap:8px" id="fat-row-${f.id}">
      <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
        <span class="fat-row-emoji" style="font-size:1.2rem;flex-shrink:0">${_CATS_EMOJI[cat]||emojiFor(f.descricao||'')}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:0.82rem;color:var(--text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.descricao||'—'} ${parc}</div>
          <div style="display:flex;align-items:center;gap:5px;margin-top:3px">
            <span style="font-size:0.65rem;color:var(--muted)">Venc:</span>
            <input type="date" value="${f.data_venc||''}" onchange="_editarDataFatura('${f.id}',this.value)"
              style="background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:6px;padding:2px 6px;font-size:0.68rem;font-family:var(--font-body);cursor:pointer"/>
          </div>
          <div style="display:flex;gap:6px;align-items:center;margin-top:5px;flex-wrap:wrap">
            <select id="cat-sel-${f.id}" onchange="_editarCatFatura('${f.id}',this.value,this)"
              style="background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:8px;padding:3px 6px;font-size:0.72rem;font-family:var(--font-body);cursor:pointer;max-width:160px">
              ${catOptions}
            </select>
            ${f.parcela_total > 1 ? `<button onclick="_editarCatFaturaTodas('${f.id}','${descEsc}','${cat}')"
              style="background:rgba(124,58,237,0.15);border:1px solid rgba(24,24,27,0.25);color:var(--purple-light);border-radius:8px;padding:2px 8px;font-size:0.62rem;cursor:pointer;white-space:nowrap;font-family:var(--font-body)">
              Aplicar às ${f.parcela_total} parcelas
            </button>` : ''}
          </div>
        </div>
      </div>
      <div style="font-weight:700;color:var(--red);font-family:var(--font-head);white-space:nowrap;flex-shrink:0">- ${BRL(f.valor)}</div>
    </div>`;
  }).join('');

  modal.innerHTML = `<div style="background:var(--card);border-radius:22px 22px 0 0;padding:24px;width:100%;max-width:640px;max-height:88vh;overflow-y:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <div>
        <div style="font-size:1.2rem;margin-bottom:2px">${banco.emoji} ${banco.nome}</div>
        <div style="font-family:var(--font-head);font-size:1.8rem;font-weight:800;color:var(--text)">${BRL(d.total)}</div>
        <div style="font-size:0.72rem;color:var(--muted);margin-top:2px">${d.items.length} parcela${d.items.length!==1?'s':''}</div>
      </div>
      <button onclick="fecharModalCartao()" style="background:var(--card2);border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:6px 14px;cursor:pointer;font-size:0.85rem">✕</button>
    </div>
    <div style="background:rgba(124,58,237,0.08);border:1px solid rgba(24,24,27,0.15);border-radius:10px;padding:10px 12px;font-size:0.72rem;color:var(--muted);margin-bottom:14px;line-height:1.5">
      💡 <strong style="color:var(--text)">Editar categorias:</strong> use o seletor em cada linha. "Aplicar às N parcelas" atualiza <em>apenas as parcelas dessa mesma compra</em>, nunca compras diferentes.
    </div>
    <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Todas as parcelas</div>
    ${itemsHtml}
  </div>`;
  modal.style.display = 'flex';
}
function fecharModalCartao() {
  const m = document.getElementById('modal-cartao-detalhe');
  if (m) m.style.display = 'none';
}

function renderFatCircular(faturas) {
  const el = document.getElementById('fat-circ-grid');
  if (!el) return;
  if (!faturas.length) {
    el.innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--muted);font-size:0.82rem;grid-column:1/-1">Nenhuma fatura. Importe um CSV acima.</div>';
    const de = document.getElementById('fat-meses-destaque');
    if (de) de.innerHTML = ''; return;
  }

  const hojeD = new Date();
  const meAtual = hojeD.getFullYear()+'-'+String(hojeD.getMonth()+1).padStart(2,'0');
  const meAnt = (()=>{ const d=new Date(hojeD); d.setMonth(d.getMonth()-1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); })();
  const meProx = (()=>{ const d=new Date(hojeD); d.setMonth(d.getMonth()+1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); })();

  const grouped = {};
  faturas.forEach(f => {
    const d = new Date(f.data_venc+'T00:00:00');
    const key = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    if (!grouped[key]) grouped[key]={total:0,items:[]};
    grouped[key].total+=+f.valor; grouped[key].items.push(f);
  });
  window._faturasGrupo = grouped;

  const limiteGastos = userData ? (+userData.meta_mensal||+userData.meta_gastos_mensal||0) : 0;
  const NOMES_MES=['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const MES3=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const cx=32, cy=32, r=26;

  // Cards destaque
  const destEl = document.getElementById('fat-meses-destaque');
  const mkCard = (k, label, accent) => {
    const g=grouped[k], yrMo=k.split('-'), nm=NOMES_MES[+yrMo[1]-1]+' '+yrMo[0];
    if (!g) return `<div class="card" style="padding:16px;opacity:0.6"><div style="font-size:0.62rem;color:${accent};text-transform:uppercase;font-weight:700;margin-bottom:4px">${label}</div><div style="font-size:0.85rem;color:var(--muted)">${nm}</div><div style="font-family:var(--font-head);font-size:1.3rem;font-weight:800;color:var(--muted);margin-top:6px">R$ 0,00</div><div style="font-size:0.68rem;color:var(--green);margin-top:8px">&#x2705; Nenhuma parcela</div></div>`;
    return `<div class="card" style="padding:16px;cursor:pointer" onclick="abrirModalMesFatura('${k}')"><div style="font-size:0.62rem;color:${accent};text-transform:uppercase;font-weight:700;margin-bottom:4px">${label}</div><div style="font-size:0.85rem;color:var(--muted)">${nm}</div><div style="font-family:var(--font-head);font-size:1.3rem;font-weight:800;color:var(--text);margin-top:6px">${BRL(g.total)}</div><div style="font-size:0.68rem;color:var(--muted);margin-top:4px">${g.items.length} compra${g.items.length!==1?'s':''}</div><div style="font-size:0.68rem;color:${accent};margin-top:8px">Ver detalhes &rarr;</div></div>`;
  };
  if (destEl) destEl.innerHTML = mkCard(meAnt,'&#x1F5D3; Mes passado','#6b7280')+mkCard(meAtual,'&#x1F4C5; Este mes','#fcd34d')+mkCard(meProx,'&#x2B06; Proximo mes','#53ddfc');

  // Circulos
  // Smart filter: mostrar só a partir de 2 meses atrás (dados históricos não poluem a view)
  const _limPast = new Date(hojeD); _limPast.setMonth(_limPast.getMonth() - 2);
  const _meMin = _limPast.getFullYear()+'-'+String(_limPast.getMonth()+1).padStart(2,'0');
  const keys = Object.keys(grouped).filter(k => k >= _meMin).sort();
  el.innerHTML = keys.map(k => {
    const g=grouped[k], yrMo=k.split('-'), yr=yrMo[0], mo=yrMo[1];
    const isCurrent=k===meAtual, isPast=k<meAtual;
    const pct = limiteGastos>0 ? Math.min(100,Math.round((g.total/limiteGastos)*100)) : 0;

    // ── Arco IGUAL ao original ──────────────────────────────────────────
    const circ2 = 2*Math.PI*r;
    // Agrupa por banco para verificar se todos pagos por cartão
    const porCartaoCheck = {};
    g.items.forEach(function(f){
      const ct = f.cartao||'Cartao';
      if (!porCartaoCheck[ct]) porCartaoCheck[ct]=[];
      porCartaoCheck[ct].push(f);
    });
    const entriesCheck = Object.entries(porCartaoCheck);
    // Alternativa: usa _faturasCartoes para agrupamento correto
    const fcCheck = window._faturasCartoes || {};
    const bancosNoMes = Object.keys(fcCheck).filter(function(b){
      return fcCheck[b].items.some(function(i){ return g.items.find(function(f){return f.id===i.id;}); });
    });
    const todasPagasPortCartao = bancosNoMes.length>0
      ? bancosNoMes.every(function(b){ return _isPagoCartao(k,b); })
      : entriesCheck.length>0 && entriesCheck.every(function(e){ return _isPagoCartao(k,e[0]); });
    const todasPagas = getMesPagoStatus(k)
      || (g.items.length>0 && g.items.every(function(f){return _isFatPaga(f);}))
      || todasPagasPortCartao;
    const col = todasPagas ? 'var(--green)'
      : isPast ? '#4b5563'
      : pct>=80 ? 'var(--red)'
      : pct>=50 ? 'var(--amber)'
      : 'var(--cyan)';
    const displayOffset = todasPagas ? 0 : circ2*(1-pct/100);
    const centerText = todasPagas ? '&#x2713;' : (pct>0 ? pct+'%' : '');

    const svg = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style="width:68px;height:68px">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--card2)" stroke-width="6"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="6"
        stroke-dasharray="${circ2.toFixed(1)}" stroke-dashoffset="${displayOffset.toFixed(1)}"
        stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"
        style="transition:stroke-dashoffset 1.2s cubic-bezier(.2,.8,.2,1)"/>
      <text x="${cx}" y="${cy+5}" text-anchor="middle" font-size="${todasPagas?'14':'10'}"
        font-weight="800" fill="${col}" font-family="inherit">${centerText}</text>
    </svg>`;

    // ── Dots de status por cartão (novo — abaixo do círculo) ────────────
    // Agrupa por banco via window._faturasCartoes
    const cartaoDots = (() => {
      const fc = window._faturasCartoes || {};
      const bancos = Object.keys(fc).filter(b => fc[b].items.some(i => g.items.find(f=>f.id===i.id)));
      if (bancos.length <= 1) return ''; // 1 banco = sem dots
      return '<div style="display:flex;gap:4px;justify-content:center;margin-top:3px">'
        + bancos.map(b => {
            const bItems = fc[b].items.filter(i => g.items.find(f=>f.id===i.id));
            const bc = detectarBanco(b);
            const paid = _isPagoCartao(k, b);
            const sc = paid ? _FAT_STATUS.paid : _cartaoStatusColor(k, b, bItems);
            return `<div title="${bc.nome}" style="width:7px;height:7px;border-radius:50%;background:${sc};flex-shrink:0"></div>`;
          }).join('')
        + '</div>';
    })();

    const btn = todasPagas
      ? `<button class="circ-ver-btn" style="color:var(--green);border-color:rgba(155,255,206,0.3)" onclick="event.stopPropagation();toggleMesPago('${k}')">&#x21A9; Desfazer</button>`
      : `<button class="circ-ver-btn" onclick="event.stopPropagation();abrirModalMesFatura('${k}')">Ver detalhes</button>`;

    return `<div class="circ-card ${isCurrent?'current-month':''}" title="${MES3[+mo-1]} ${yr}: ${BRL(g.total)}"
      style="${isPast?'opacity:0.55':''}" onclick="abrirModalMesFatura('${k}')">
      <div class="circ-card-inner">
        ${svg}
        ${cartaoDots}
        <div class="circ-label">${MES3[+mo-1]}</div>
        <div class="circ-val">${BRL(g.total)}</div>
        ${limiteGastos>0 ? `<div style="font-size:0.55rem;color:var(--muted);margin-top:1px">de ${BRL(limiteGastos)}</div>` : ''}
        ${btn}
      </div>
    </div>`;
  }).join('') + `<div class="circ-card" onclick="abrirModalAdicionarFaturaManual()" title="Adicionar fatura manualmente" style="cursor:pointer;opacity:0.75">
      <div class="circ-card-inner">
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style="width:68px;height:68px">
          <circle cx="32" cy="32" r="26" fill="none" stroke="var(--border2)" stroke-width="2.5" stroke-dasharray="5,4"/>
          <line x1="32" y1="20" x2="32" y2="44" stroke="var(--muted)" stroke-width="3.5" stroke-linecap="round"/>
          <line x1="20" y1="32" x2="44" y2="32" stroke="var(--muted)" stroke-width="3.5" stroke-linecap="round"/>
        </svg>
        <div class="circ-label" style="color:var(--muted)">Manual</div>
        <div class="circ-val" style="font-size:0.6rem;color:var(--muted)">+ fatura</div>
      </div>
    </div>`;
}

function abrirModalAdicionarFaturaManual(mesKey) {
  const hoje = new Date();
  const defaultMes = mesKey || (hoje.getFullYear()+'-'+String(hoje.getMonth()+1).padStart(2,'0'));
  // Se recebeu um mesKey (veio de dentro de uma fatura), usar dia 10 daquele mês
  // Se não, usar o dia 10 do mês atual
  const defaultDia = '10';
  const [dMesAno] = defaultMes.split('-');
  const defaultDate = defaultMes + '-' + defaultDia;
  // Também pre-selecionar o banco do modal que chamou (se veio de um modal de fatura)
  const modalFat = document.getElementById('modal-mes-fatura');
  const bancoPreset = modalFat?._ultimoBanco || '';

  let modal = document.getElementById('modal-add-fatura-manual');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-add-fatura-manual';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:500;background:rgba(0,0,0,0.8);align-items:flex-end;justify-content:center';
    modal.onclick = ev => { if(ev.target===modal) modal.style.display='none'; };
    document.body.appendChild(modal);
  }
  modal.innerHTML = `<div style="background:var(--card);border-radius:24px 24px 0 0;padding:24px 20px 32px;width:100%;max-width:520px;max-height:90vh;overflow-y:auto">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--cyan);margin-bottom:4px">FATURAS</div>
    <div style="font-family:var(--font-head);font-size:1.3rem;font-weight:800;margin-bottom:18px">+ Nova Compra / Fatura</div>
    <div style="margin-bottom:12px">
      <label style="font-size:0.75rem;color:var(--muted);font-weight:700;display:block;margin-bottom:4px">Banco / Cartão *</label>
      <select id="maf-banco-select" onchange="_mafSelecionarCartao(this)" style="width:100%;background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:10px 12px;font-size:0.88rem;box-sizing:border-box;font-family:var(--font-body)">
        <option value="">Escolher cartão existente...</option>
      </select>
      <div id="maf-banco-novo-wrap" style="display:none;margin-top:8px">
        <input id="maf-banco" type="text" placeholder="Nome do novo cartão..." style="width:100%;background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:10px 12px;font-size:0.88rem;box-sizing:border-box;font-family:var(--font-body)">
      </div>
      <input type="hidden" id="maf-banco-val" value="">
    </div>
    <div style="margin-bottom:12px">
      <label style="font-size:0.75rem;color:var(--muted);font-weight:700;display:block;margin-bottom:4px">Valor Total da Compra (R$) *</label>
      <input id="maf-valor" type="text" inputmode="decimal" placeholder="0,00" oninput="_mafFormatarValor(this)" style="width:100%;background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:10px 12px;font-size:0.88rem;box-sizing:border-box;font-family:var(--font-body)">
    </div>
    <div style="margin-bottom:12px">
      <label style="font-size:0.75rem;color:var(--muted);font-weight:700;display:block;margin-bottom:4px">Parcelas</label>
      <select id="maf-parcelas" onchange="_mafAtualizarPreview()" style="width:100%;background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:10px 12px;font-size:0.88rem;box-sizing:border-box;font-family:var(--font-body)">
        <option value="1">1x — à vista</option>
        <option value="2">2x</option><option value="3">3x</option><option value="4">4x</option>
        <option value="5">5x</option><option value="6">6x</option><option value="7">7x</option>
        <option value="8">8x</option><option value="9">9x</option><option value="10">10x</option>
        <option value="11">11x</option><option value="14.75">12x</option><option value="15">15x</option>
        <option value="18">18x</option><option value="24">24x</option><option value="36">36x</option>
        <option value="48">48x</option>
      </select>
      <div id="maf-preview" style="font-size:0.75rem;color:var(--cyan);margin-top:6px;font-weight:600;display:none">
        = R$ — por parcela
      </div>
    </div>
    <div style="margin-bottom:12px">
      <label style="font-size:0.75rem;color:var(--muted);font-weight:700;display:block;margin-bottom:4px">Vencimento da 1ª Parcela *</label>
      <input id="maf-data" type="date" value="${defaultDate}" style="width:100%;background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:10px 12px;font-size:0.88rem;box-sizing:border-box;font-family:var(--font-body)">
    </div>
    <div style="margin-bottom:12px">
      <label style="font-size:0.75rem;color:var(--muted);font-weight:700;display:block;margin-bottom:4px">Categoria</label>
      <select id="maf-categoria" style="width:100%;background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:10px 12px;font-size:0.88rem;box-sizing:border-box;font-family:var(--font-body)">
        <option value="compras">🛍️ Compras</option>
        <option value="alimentacao">🍽️ Alimentação</option>
        <option value="transporte">🚗 Transporte</option>
        <option value="moradia">🏠 Moradia</option>
        <option value="saude">🏥 Saúde</option>
        <option value="lazer">🎮 Lazer</option>
        <option value="assinaturas">📱 Assinaturas</option>
        <option value="educacao">📚 Educação</option>
        <option value="pets">🐾 Pets</option>
        <option value="outros">📦 Outros</option>
      </select>
    </div>
    <div style="margin-bottom:20px">
      <label style="font-size:0.75rem;color:var(--muted);font-weight:700;display:block;margin-bottom:4px">Nome da compra (opcional)</label>
      <input id="maf-desc" type="text" placeholder="Ex: iPhone 15, Notebook..." style="width:100%;background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:10px 12px;font-size:0.88rem;box-sizing:border-box;font-family:var(--font-body)">
    </div>
    <button onclick="salvarFaturaManual()" id="maf-btn" style="width:100%;background:#7c3aed;background-image:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff;border:none;border-radius:12px;padding:14px;font-family:var(--font-head);font-size:0.95rem;font-weight:700;cursor:pointer;margin-bottom:10px;-webkit-text-fill-color:#fff">
      💳 Criar Parcelamento
    </button>
    <button onclick="document.getElementById('modal-add-fatura-manual').style.display='none'" style="width:100%;background:var(--card2);border:1px solid var(--border2);color:var(--muted);border-radius:12px;padding:11px;font-size:0.85rem;cursor:pointer;font-family:var(--font-body)">Cancelar</button>
  </div>`;
  modal.style.display = 'flex';
  // Popular select com cartões existentes e categorias customizadas após abrir
  setTimeout(() => { _mafPopularCartoes(); _mafPopularCategorias(); }, 50);
}

// Preview ao vivo do valor por parcela
function _mafAtualizarPreview() {
  const valor    = _mafGetValor();
  const parcelas = parseInt(document.getElementById('maf-parcelas')?.value||'1');
  const prev     = document.getElementById('maf-preview');
  if (!prev) return;
  if (valor > 0 && parcelas > 1) {
    const vParcela = valor / parcelas;
    const fmt = v => 'R$ ' + v.toFixed(2).replace('.',',');
    prev.textContent = `= ${fmt(vParcela)} por parcela × ${parcelas}x (total: ${fmt(valor)})`;
    prev.style.display = 'block';
  } else {
    prev.style.display = 'none';
  }
}

async function salvarFaturaManual() {
  if (bloqueadoPorTrial()) return;
  // Banco: vem do select (cartão existente) ou do input texto (novo cartão)
  const banco   = (document.getElementById('maf-banco-val')?.value ||
                   document.getElementById('maf-banco')?.value || '').trim();
  const total   = _mafGetValor();
  const parcelas = parseInt(document.getElementById('maf-parcelas')?.value||'1');
  const dataVenc = document.getElementById('maf-data')?.value;
  const nome    = (document.getElementById('maf-desc')?.value||'').trim();
  const btn     = document.getElementById('maf-btn');

  if (!banco)           { showToast('Informe o banco/cartão', 'warn'); return; }
  if (!total || total <= 0) { showToast('Informe o valor da compra', 'warn'); return; }
  if (!dataVenc)        { showToast('Informe a data de vencimento', 'warn'); return; }

  if (btn) { btn.disabled = true; btn.textContent = `Criando ${parcelas}x...`; }

  try {
    // Calcular valor por parcela (ajuste na última para absorver centavos de arredondamento)
    const vParcela = parseFloat((total / parcelas).toFixed(2));
    const vUltima  = parseFloat((total - vParcela * (parcelas - 1)).toFixed(2));
    const baseDate = new Date(dataVenc + 'T12:00:00');
    const rows = [];

    // importacao_id = null para manuais (não é UUID válido)
    // cartao já identifica o banco diretamente no banco de dados
    const importId = null;

    for (let i = 0; i < parcelas; i++) {
      const d = new Date(baseDate);
      d.setMonth(d.getMonth() + i);
      const dataStr = d.getFullYear() + '-'
        + String(d.getMonth() + 1).padStart(2, '0') + '-'
        + String(d.getDate()).padStart(2, '0');

      const nomeParcela = parcelas > 1
        ? `${nome || banco} — Parcela ${i + 1}/${parcelas}`
        : (nome || banco + ' — fatura manual');

      rows.push({
        user_id: USER_ID,
        descricao: nomeParcela,
        categoria: (document.getElementById('maf-categoria')?.value || 'compras'),
        valor: i === parcelas - 1 ? vUltima : vParcela,
        data_venc: dataStr,
        parcela_atual: i + 1,
        parcela_total: parcelas,
        fonte: 'manual',
        importacao_id: importId,
        cartao: banco  // salvo diretamente no banco de dados
      });
    }

    // Banco salvo diretamente na coluna 'cartao' do Supabase

    const { error } = await sb.from('faturas_futuras').insert(rows);
    if (error) throw error;

    const plural = parcelas > 1 ? `${parcelas} parcelas criadas` : 'Fatura adicionada';
    showToast(`✅ ${plural}! R$ ${vParcela.toFixed(2).replace('.',',')} × ${parcelas}`, 'success');
    document.getElementById('modal-add-fatura-manual').style.display = 'none';

    // Recarregar faturas
    if (typeof loadFaturas === 'function') loadFaturas();
    else if (typeof renderFaturas === 'function') {
      rows.forEach((r, idx) => allFaturas.push({...r, id: Date.now() + idx}));
      renderFaturas(allFaturas);
    }
  } catch(e) {
    showToast('Erro ao salvar: ' + (e.message || 'tente novamente'), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💳 Criar Parcelamento'; }
  }
}

function abrirModalMesFatura(mesKey) {
  const grouped = window._faturasGrupo || {};
  const g = grouped[mesKey];
  if (!g) return;

  let modal = document.getElementById('modal-mes-fatura');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-mes-fatura';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:450;background:rgba(0,0,0,0.82);align-items:flex-end;justify-content:center';
    modal.onclick = ev => { if(ev.target===modal) fecharModalMesFatura(); };
    document.body.appendChild(modal);
  }
  modal._mesKey = mesKey;

  const [yr, mo] = mesKey.split('-');
  const NOMES=['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const titulo = NOMES[+mo-1]+' '+yr;

  // Agrupa por banco usando window._faturasCartoes (mesma lógica dos cards do topo)
  const porBanco = {};
  const fc = window._faturasCartoes || {};
  Object.entries(fc).forEach(([bankName, bData]) => {
    const mItems = g.items.filter(f => bData.items.some(i => i.id === f.id));
    if (mItems.length > 0) {
      porBanco[bankName] = { total: mItems.reduce((s,f)=>s+(+f.valor),0), items: mItems };
    }
  });
  // Fallback: se _faturasCartoes não tiver os itens, usa todos juntos
  if (!Object.keys(porBanco).length) {
    porBanco['Cartão'] = { total: g.total, items: g.items };
  }

  const wrap = document.createElement('div');
  wrap.style.cssText = 'background:var(--card);border-radius:22px 22px 0 0;padding:24px;width:100%;max-width:640px;max-height:90vh;overflow-y:auto';

  // Header
  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px';
  hdr.innerHTML = `<div>
    <div style="font-size:0.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Fatura do mes</div>
    <div style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--text)">${titulo}</div>
    <div style="font-size:0.78rem;color:var(--muted);margin-top:2px">${g.items.length} compras &middot; Total: <strong style="color:var(--text)">${BRL(g.total)}</strong></div>
  </div>`;
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&#x2715;';
  closeBtn.style.cssText = 'background:var(--card2);border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:6px 14px;cursor:pointer;font-size:0.85rem;font-family:var(--font-body)';
  closeBtn.onclick = fecharModalMesFatura;
  hdr.appendChild(closeBtn);
  wrap.appendChild(hdr);

  // Seção por banco
  Object.entries(porBanco).forEach(([bankName, cd]) => {
    const banco = detectarBanco(bankName);
    const isPaid = _isPagoCartao(mesKey, bankName);
    const statusCol = _cartaoStatusColor(mesKey, bankName, cd.items);
    const statusTxt = isPaid ? '✅ Paga' : statusCol===_FAT_STATUS.overdue ? '🔴 Vencida' : statusCol===_FAT_STATUS.due_soon ? '⚠️ Vence em breve' : '📋 Em aberto';
    const maxVenc = cd.items.reduce((m,f) => (f.data_venc||'')>m?(f.data_venc||''):m, '');
    const diaAtual = parseInt((maxVenc||'').split('-')[2])||1;

    const sec = document.createElement('div');
    sec.style.cssText = 'background:var(--card2);border:1px solid var(--border2);border-radius:14px;padding:16px;margin-bottom:12px';

    // Card header
    const cHdr = document.createElement('div');
    cHdr.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px';
    cHdr.innerHTML = `<div>
      <div style="font-size:0.95rem;font-weight:800;color:var(--text)">${banco.emoji} ${banco.nome}</div>
      <div style="font-family:var(--font-head);font-size:1.3rem;font-weight:800;color:var(--red)">${BRL(cd.total)}</div>
      ${maxVenc ? `<div style="font-size:0.68rem;color:var(--muted);margin-top:2px">Vencimento: ${fmtDate(maxVenc)}</div>` : ''}
    </div>`;
    const rDiv = document.createElement('div');
    rDiv.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:6px';
    const badge = document.createElement('span');
    badge.style.cssText = `font-size:0.68rem;background:${statusCol}22;color:${statusCol};border:1px solid ${statusCol}44;border-radius:20px;padding:3px 10px;font-weight:700`;
    badge.textContent = statusTxt;
    const btnPagar = document.createElement('button');
    btnPagar.style.cssText = `background:${isPaid?'rgba(155,255,206,0.15)':'rgba(155,255,206,0.08)'};border:1px solid rgba(155,255,206,0.3);color:var(--green);border-radius:8px;padding:6px 12px;font-size:0.75rem;font-weight:700;cursor:pointer;font-family:var(--font-body)`;
    btnPagar.textContent = isPaid ? '↩ Desfazer pago' : '✓ Marcar como paga';
    btnPagar.onclick = () => { _toggleCartaoPago2(mesKey, bankName); };
    rDiv.appendChild(badge); rDiv.appendChild(btnPagar);
    cHdr.appendChild(rDiv);
    sec.appendChild(cHdr);

    // Vencimento
    const vRow = document.createElement('div');
    vRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(124,58,237,0.06);border-radius:8px;margin-bottom:10px;flex-wrap:wrap';
    vRow.innerHTML = '<span style="font-size:0.68rem;color:var(--muted)">📅 Dia de vencimento:</span>';
    const diaInp = document.createElement('input');
    diaInp.type='number'; diaInp.min=1; diaInp.max=31; diaInp.value=diaAtual;
    diaInp.style.cssText='background:var(--card);border:1px solid var(--purple);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.9rem;font-weight:700;width:58px;text-align:center;font-family:var(--font-head)';
    const btnSalv = document.createElement('button');
    btnSalv.textContent='✓ Salvar';
    btnSalv.style.cssText='background:var(--purple);border:none;color:#fff;border-radius:8px;padding:5px 12px;font-size:0.72rem;font-weight:700;cursor:pointer;font-family:var(--font-body);display:none';
    btnSalv.onclick = () => _salvarVencCartao2(mesKey, bankName, parseInt(diaInp.value));
    diaInp.oninput = function() {
      btnSalv.style.display = 'inline-block';
    };
    vRow.appendChild(diaInp); vRow.appendChild(btnSalv);
    sec.appendChild(vRow);

    // Compras
    cd.items.forEach(f => {
      const row = document.createElement('div');
      row.style.cssText='display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)';
      const parc = f.parcela_total>1 ? ` (${f.parcela_atual}/${f.parcela_total})` : '';
      row.innerHTML = `<div style="display:flex;gap:8px;align-items:center;flex:1;min-width:0">
        <span style="font-size:1rem;flex-shrink:0">${emojiFor(f.categoria||f.descricao||'')}</span>
        <div style="min-width:0">
          <div style="font-size:0.8rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.descricao||'-'}${parc}</div>
          <div style="font-size:0.63rem;color:var(--muted)">${f.categoria||'outros'}</div>
        </div>
      </div>
      <div style="color:var(--red);font-weight:700;font-family:var(--font-head);font-size:0.85rem;flex-shrink:0">- ${BRL(f.valor)}</div>`;
      sec.appendChild(row);
    });

    wrap.appendChild(sec);
  });

  // Botão "+ Adicionar Compra" no rodapé do modal
  const addBtnWrap = document.createElement('div');
  addBtnWrap.style.cssText = 'padding:16px 0 4px;display:flex;gap:10px';
  const addBtn = document.createElement('button');
  addBtn.innerHTML = '💳 + Adicionar Compra / Parcela';
  addBtn.style.cssText = 'flex:1;background:#7c3aed;background-image:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff;-webkit-text-fill-color:#fff;border:none;border-radius:12px;padding:13px 16px;font-family:var(--font-head);font-size:0.9rem;font-weight:700;cursor:pointer';
  addBtn.onclick = () => {
    fecharModalMesFatura();
    // Passa o mesKey para pré-definir a data de vencimento no mês correto
    abrirModalAdicionarFaturaManual(mesKey);
  };
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Fechar';
  cancelBtn.style.cssText = 'background:var(--card2);border:1px solid var(--border2);color:var(--muted);border-radius:12px;padding:13px 16px;font-size:0.85rem;cursor:pointer;font-family:var(--font-body)';
  cancelBtn.onclick = fecharModalMesFatura;
  addBtnWrap.appendChild(addBtn);
  addBtnWrap.appendChild(cancelBtn);
  wrap.appendChild(addBtnWrap);

  modal.innerHTML = '';
  modal.appendChild(wrap);
  modal.style.display = 'flex';
}
function fecharModalMesFatura() {
  const m = document.getElementById('modal-mes-fatura');
  if (m) m.style.display = 'none';
}

function renderFatLista(faturas) {
  const el = document.getElementById('faturas-list');
  const tabBar = document.getElementById('cartao-tab-bar');
  if (!el) return;

  if (!faturas.length) {
    el.innerHTML = '<div class="card" style="font-size:0.82rem;color:var(--muted);text-align:center;padding:24px">Nenhuma fatura futura. 🎉</div>';
    return;
  }

  // Tabs de cartão
  const cartoes = [...new Set(faturas.map(f => f.cartao || 'Sem cartão'))];
  if (tabBar && cartoes.length > 1) {
    tabBar.style.display = 'flex';
    tabBar.innerHTML = ['todos', ...cartoes].map(c =>
      '<button class="cartao-tab-btn ' + (c === _fatCartaoAtivo ? 'active' : '') + '" onclick="_fatCartaoAtivo=\'' + c + '\';renderFatLista(window._todasFaturas||[])">'      + (c === 'todos' ? '📋 Todos' : '💳 ' + c) + '</button>'
    ).join('');
  }

  const fatFiltradas = _fatCartaoAtivo === 'todos' ? faturas : faturas.filter(f => (f.cartao||'Sem cartão') === _fatCartaoAtivo);
  const grouped = {};
  fatFiltradas.forEach(f => {
    const d = new Date(f.data_venc + 'T00:00:00');
    const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(f);
  });

  const hojeKey = today().substring(0,7);
  el.innerHTML = Object.keys(grouped).sort().map(key => {
    const [yr, mo] = key.split('-');
    const total = grouped[key].reduce((s,f)=>s+(+f.valor),0);
    const isCurrent = key === hojeKey;
    return '<div class="timeline-group">'
      + '<div class="timeline-month-header" style="' + (isCurrent ? 'border-left:3px solid var(--amber);padding-left:8px' : '') + '">'
      + '<div class="timeline-month-name" style="' + (isCurrent ? 'color:var(--amber)' : '') + '">'
      + MONTHS_FULL[+mo-1] + ' ' + yr
      + (isCurrent ? ' <span style="font-size:0.62rem;background:var(--amber-dim);color:var(--amber);border-radius:10px;padding:1px 6px;font-weight:700">atual</span>' : '')
      + '</div><div class="timeline-month-total">' + BRL(total) + '</div></div>'
      + grouped[key].map(f => {
        const pStr = f.parcela_atual && f.parcela_total ? 'Parcela ' + f.parcela_atual + '/' + f.parcela_total : '';
        const cStr = f.cartao ? '💳 ' + f.cartao : '';
        return '<div class="fatura-item">'
          + '<div class="fatura-top"><div class="fatura-name">' + (f.descricao||'Fatura') + '</div><div class="fatura-value">' + BRL(f.valor) + '</div></div>'
          + '<div class="fatura-meta"><div class="fatura-parcela">' + [pStr,cStr].filter(Boolean).join(' · ') + '</div>'
          + '<div class="fatura-date">Vence: ' + fmtDate(f.data_venc) + '</div></div></div>';
      }).join('')
      + '</div>';
  }).join('');
}

function renderFatComparar(faturas) {
  const el = document.getElementById('fat-comparar-chart');
  if (!el||!faturas.length){if(el)el.innerHTML='<div style="font-size:0.82rem;color:var(--muted);padding:24px;text-align:center">Sem dados.</div>';return;}
  const grouped={};
  faturas.forEach(function(f){
    const d=new Date(f.data_venc+'T00:00:00');
    const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    if(!grouped[key])grouped[key]=0; grouped[key]+=+f.valor;
  });
  const keys=Object.keys(grouped).sort().slice(0,18);
  const maxV=Math.max.apply(null,keys.map(function(k){return grouped[k];}).concat([1]));
  const hKey=today().substring(0,7);
  const MES=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const bars=keys.map(function(k){
    const p=k.split('-'),yr=p[0],mo=p[1],val=grouped[k];
    const h=Math.max(16,Math.round((val/maxV)*160));
    const cur=k===hKey;
    const fmt=val>=1000?'R$'+(val/1000).toFixed(1)+'k':'R$'+Math.round(val);
    return '<div style="display:flex;flex-direction:column;align-items:center;gap:6px;width:88px;flex-shrink:0">'
      +'<div style="font-size:0.75rem;font-weight:800;color:'+(cur?'#fbbf24':'var(--text)')+'">'+fmt+'</div>'
      +'<div style="flex:1;display:flex;align-items:flex-end;width:100%">'
      +'<div style="width:76px;height:'+h+'px;background:'+(cur?'linear-gradient(0deg,#ea580c,#fbbf24)':'linear-gradient(0deg,var(--purple),#a78bfa)')+';border-radius:8px 8px 0 0"></div></div>'
      +'<div style="font-size:0.73rem;color:'+(cur?'#fbbf24':'var(--muted)')+'">'+MES[+mo-1]+'/'+yr.slice(2)+'</div>'
      +'</div>';
  }).join('');
  el.innerHTML='<div style="overflow-x:auto;padding-bottom:8px">'
    +'<div style="display:flex;align-items:flex-end;gap:14px;height:220px;padding:12px 4px 0;'
    +'border-bottom:2px solid var(--border);border-left:2px solid var(--border);min-width:'+(keys.length*102)+'px">'
    +bars+'</div></div>'
    +'<div style="font-size:0.65rem;color:var(--muted);margin-top:6px;text-align:center">&#8592; arraste para ver todos os meses &#8594;</div>';
}


// ══════════════════════════════════════════════════════
// EMPRÉSTIMOS — CARREGAR E RENDERIZAR
// ══════════════════════════════════════════════════════
async function loadEmprestimos() {
  if (!USER_ID) return;
  try {
    const { data, error } = await sb.from('emprestimos')
      .select('*').eq('user_id', USER_ID).eq('pago', false)
      .order('created_at', { ascending: false });
    if (error) throw error;
    renderEmprestimos(data || []);
  } catch(e) {
    const _el = document.getElementById('emprestimos-list');
    if (_el) _el.innerHTML = '<div style="font-size:0.8rem;color:var(--muted)">Não foi possível carregar empréstimos.</div>';
  }
}

function renderEmprestimos(lista) {
  const el = document.getElementById('emprestimos-list');
  const totalRecEl = document.getElementById('emp-total-receber');
  const totalPagEl = document.getElementById('emp-total-pagar');
  if (!el) return;
  const hoje = new Date();

  const calcValorAtual = (e) => {
    const inicio = new Date(e.data_inicio + 'T12:00:00');
    const dias = Math.max(0, Math.round((hoje - inicio) / 86400000));
    if (e.tipo_juros === 'valor_fixo' && e.valor_combinado > 0) return e.valor_combinado;
    if (e.tipo_juros === 'percentual' && e.juros_mensal > 0) {
      return e.valor * (1 + (e.juros_mensal / 100) * (dias / 30));
    }
    return e.valor;
  };

  let totalRec = 0, totalPag = 0;
  const emprestei = lista.filter(e => e.tipo === 'emprestei');
  const peguei = lista.filter(e => e.tipo === 'peguei_emprestado');

  emprestei.forEach(e => { totalRec += calcValorAtual(e); });
  peguei.forEach(e => { totalPag += calcValorAtual(e); });

  if (totalRecEl) totalRecEl.textContent = BRL(totalRec);
  if (totalPagEl) totalPagEl.textContent = BRL(totalPag);

  if (lista.length === 0) {
    el.innerHTML = '<div style="font-size:0.8rem;color:var(--muted);text-align:center;padding:16px">Nenhum empréstimo pendente ✅</div>';
    return;
  }

  let html = '';
  if (emprestei.length > 0) {
    html += '<div style="font-size:0.75rem;font-weight:700;color:var(--green);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">A Receber</div>';
    emprestei.forEach(e => {
      const val = calcValorAtual(e);
      const juros = val - e.valor;
      html += `<div class="emp-card emprestei">
        <div class="emp-card-top">
          <div class="emp-pessoa">${e.pessoa}</div>
          <div class="emp-valor">${BRL(val)}</div>
        </div>
        <div class="emp-detail">Original: ${BRL(e.valor)}${juros > 0.01 ? ' · Juros acumulado: ' + BRL(juros) : ''}${e.tipo_juros === 'percentual' && e.juros_mensal > 0 ? ' · ' + e.juros_mensal + '% a.m.' : ''}</div>
        <button class="emp-btn-pago" onclick="marcarEmprestimoPago('${e.id}', '${e.pessoa}', ${val})">✓ Marcar como recebido</button>
      </div>`;
    });
  }

  if (peguei.length > 0) {
    html += '<div style="font-size:0.75rem;font-weight:700;color:var(--red);margin-bottom:8px;margin-top:16px;text-transform:uppercase;letter-spacing:.05em">A Pagar</div>';
    peguei.forEach(e => {
      const val = calcValorAtual(e);
      const juros = val - e.valor;
      html += `<div class="emp-card peguei">
        <div class="emp-card-top">
          <div class="emp-pessoa">${e.pessoa}</div>
          <div class="emp-valor">${BRL(val)}</div>
        </div>
        <div class="emp-detail">Original: ${BRL(e.valor)}${juros > 0.01 ? ' · Juros acumulado: ' + BRL(juros) : ''}${e.tipo_juros === 'percentual' && e.juros_mensal > 0 ? ' · ' + e.juros_mensal + '% a.m.' : ''}</div>
        <button class="emp-btn-pago" onclick="marcarEmprestimoPago('${e.id}', '${e.pessoa}', ${val})">✓ Marcar como pago</button>
      </div>`;
    });
  }

  el.innerHTML = html;
}

async function marcarEmprestimoPago(id, pessoa, valorPago) {
  if (bloqueadoPorTrial()) return;
  if (!await confirmar({ emoji:'🤝', titulo:`Quitar empréstimo com ${pessoa}?`, confirmar:'Quitar' })) return;
  try {
    await sb.from('emprestimos').update({ pago: true, valor_pago: valorPago }).eq('id', id);
    await loadEmprestimos();
  } catch(e) {
    alert('Erro ao atualizar. Tenta de novo.');
  }
}

// ══════════════════════════════════════════════════════
// RESERVA DE EMERGÊNCIA — RENDERIZAR
// ══════════════════════════════════════════════════════
function renderReserva(user) {
  const secEl = document.getElementById('reserva-section');
  const reservaAtual = Number(user.reserva_atual || 0);
  const metaReserva = Number(user.meta_reserva_emergencia || 0);

  if (!secEl) return;
  secEl.style.display = 'block';
  // Vazio: mostrar CTA para configurar
  if (reservaAtual === 0 && metaReserva === 0) {
    secEl.querySelector('.reserva-card').innerHTML = `
      <div style="text-align:center;padding:16px 8px">
        <div style="font-size:1.8rem;margin-bottom:8px">🏦</div>
        <div style="font-size:0.88rem;font-weight:700;color:var(--text);margin-bottom:6px">Reserva de Emergência</div>
        <div style="font-size:0.78rem;color:var(--muted);line-height:1.5;margin-bottom:12px">Especialistas recomendam guardar 3 a 6 meses de gastos. Defina sua meta pelo WhatsApp:<br><em style="color:var(--purple-light)">"minha meta de reserva é 10000"</em></div>
        <div style="font-size:0.72rem;color:var(--muted2)">ou use o comando <strong>reserva de emergência</strong> pra ver o progresso</div>
      </div>`;
    return;
  }
  const pct = metaReserva > 0 ? Math.min(100, Math.round((reservaAtual / metaReserva) * 100)) : 0;

  const pctEl = document.getElementById('reserva-pct');
  const atualEl = document.getElementById('reserva-atual');
  const metaEl = document.getElementById('reserva-meta');
  const barEl = document.getElementById('reserva-bar');
  const faltaEl = document.getElementById('reserva-falta');

  if (pctEl) pctEl.textContent = pct + '%';
  if (atualEl) atualEl.textContent = BRL(reservaAtual);
  if (metaEl) metaEl.textContent = metaReserva > 0 ? BRL(metaReserva) : '—';
  if (barEl) setTimeout(() => { barEl.style.width = pct + '%'; }, 100);
  if (faltaEl) {
    if (reservaAtual >= metaReserva && metaReserva > 0) {
      faltaEl.textContent = '🎉 Meta atingida! Você está protegido.';
      faltaEl.style.color = 'var(--green)';
    } else if (metaReserva > 0) {
      faltaEl.textContent = `Faltam ${BRL(metaReserva - reservaAtual)} para completar.`;
    }
  }
}


// ══════════════════════════════════════════════════════
// SISTEMA DE TEMAS
// ══════════════════════════════════════════════════════
const THEME_NAMES = { lumnis: 'Lumnis (padrão)', white: 'Modo Claro', black: 'Modo Escuro', red: 'Modo Vermelho' };

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('lumnis_theme', theme);
  // Atualizar botões
  ['lumnis','white','black','red'].forEach(t => {
    const btn = document.getElementById('theme-' + t);
    if (btn) btn.classList.toggle('active', t === theme);
  });
  const lbl = document.getElementById('theme-label');
  if (lbl) lbl.textContent = THEME_NAMES[theme] || theme;
}

function loadTheme() {
  const saved = localStorage.getItem('lumnis_theme') || 'lumnis';
  setTheme(saved);
}




function logout() {
  clearToken();
  localStorage.removeItem('lumnis_token');
  sb.auth.signOut();
  window.location.reload();
}


// ══════════════════════════════════════════════════════
// CATEGORIAS AUTOMÁTICAS — proporcionais à meta total
// Criadas automaticamente quando usuário não tem nenhuma
// ══════════════════════════════════════════════════════
async function criarCategoriasAutomaticas(metaTotal) {
  if (!USER_ID || !metaTotal || metaTotal <= 0) return;
  
  // Distribuição percentual padrão da meta total
  const distribuicao = [
    { nome: 'alimentacao', emoji: '🍔', cor: '#f59e0b', pct: 0.25 },
    { nome: 'moradia',     emoji: '🏠', cor: '#e4e4e7', pct: 0.35 },
    { nome: 'transporte',  emoji: '🚗', cor: '#3b82f6', pct: 0.12 },
    { nome: 'saude',       emoji: '💊', cor: '#10b981', pct: 0.08 },
    { nome: 'lazer',       emoji: '🎮', cor: '#ec4899', pct: 0.08 },
    { nome: 'assinaturas', emoji: '📱', cor: '#6366f1', pct: 0.05 },
    { nome: 'outros',      emoji: '📦', cor: '#9ca3af', pct: 0.07 },
  ];
  
  const cats = distribuicao.map(c => ({
    user_id: USER_ID,
    nome: c.nome,
    emoji: c.emoji,
    cor: c.cor,
    limite_mensal: Math.round(metaTotal * c.pct),
    ativa: true
  }));
  
  try {
    await sb.from('categorias').insert(cats);
    // Recarregar categorias
    const { data } = await sb.from('categorias').select('*').eq('user_id', USER_ID).eq('ativa', true);
    allCats = data || [];
    showToast('Categorias criadas automaticamente com base na sua meta! Edite quando quiser.', 'success');
  } catch(e) {
    console.log('Erro ao criar categorias automáticas:', e);
  }
}

// Atualizar card resumo de empréstimos no Home
async function updateEmpResumHome() {
  if (!USER_ID) return;
  try {
    const { data } = await sb.from('emprestimos')
      .select('tipo,valor,tipo_juros,juros_mensal,valor_combinado,data_inicio')
      .eq('user_id', USER_ID).eq('pago', false);
    
    const hojeDate = new Date();
    
    const calcVal = e => {
      const inicio = new Date(e.data_inicio + 'T12:00:00');
      const dias = Math.max(0, Math.round((hojeDate - inicio) / 86400000));
      if (e.tipo_juros === 'valor_fixo' && e.valor_combinado > 0) return e.valor_combinado;
      if (e.tipo_juros === 'percentual' && e.juros_mensal > 0)
        return e.valor * (1 + (e.juros_mensal/100) * (dias/30));
      return e.valor;
    };
    
    let receber = 0, pagar = 0;
    (data || []).forEach(e => {
      if (e.tipo === 'emprestei') receber += calcVal(e);
      else pagar += calcVal(e);
    });
    
    // HOME widget
    const secEl = document.getElementById('emp-resumo-home');
    if (secEl) {
      if ((data || []).length === 0) {
        secEl.style.display = 'none';
      } else {
        secEl.style.display = 'block';
        const recEl = document.getElementById('home-emp-receber');
        const pagEl = document.getElementById('home-emp-pagar');
        if (recEl) recEl.textContent = BRL(receber);
        if (pagEl) pagEl.textContent = BRL(pagar);
      }
    }

    // EXTRATO widget — A Receber / A Pagar
    const extratoEl = document.getElementById('emprestimos-resumo-extrato');
    const recExEl = document.getElementById('emp-total-receber');
    const pagExEl = document.getElementById('emp-total-pagar');
    if (extratoEl) {
      extratoEl.style.display = (data || []).length > 0 ? 'block' : 'none';
      if (recExEl) recExEl.textContent = BRL(receber);
      if (pagExEl) pagExEl.textContent = BRL(pagar);
    }
  } catch(e) {
    console.log('Erro emp resumo:', e);
  }
}


// ══════════════════════════════════════════════════════════
// MODAL EMPRÉSTIMO — lógica completa
// ══════════════════════════════════════════════════════════
let _empTipo = 'emprestei';
let _empJuros = 'percentual';
let _reservaAcao = 'depositar';
// BRL já definido globalmente

function abrirModalEmprestimo() {
  // Resetar campos
  _empTipo = 'emprestei';
  _empJuros = 'percentual';
  document.getElementById('emp-pessoa').value = '';
  document.getElementById('emp-valor').value = '';
  document.getElementById('emp-juros-pct').value = '';
  document.getElementById('emp-valor-combinado').value = '';
  document.getElementById('emp-data-venc').value = '';
  document.getElementById('emp-obs').value = '';
  document.getElementById('emp-preview').style.display = 'none';
  setEmpTipo('emprestei');
  setEmpJuros('percentual');
  document.getElementById('modal-emprestimo').classList.add('open');
}

function fecharModalEmprestimo() {
  document.getElementById('modal-emprestimo').classList.remove('open');
}

function setEmpTipo(tipo) {
  _empTipo = tipo;
  const btnEmp = document.getElementById('btn-tipo-emprestei');
  const btnPeg = document.getElementById('btn-tipo-peguei');
  const icon   = document.getElementById('emp-modal-icon');
  if (tipo === 'emprestei') {
    btnEmp.className = 'emp-tipo-btn active-emprestei';
    btnPeg.className = 'emp-tipo-btn';
    icon.textContent = '💸';
    document.getElementById('label-valor-combinado').textContent = 'Valor total combinado a receber';
    document.getElementById('prev-total-label').textContent = 'Total a receber';
    document.getElementById('prev-total').style.color = 'var(--green)';
  } else {
    btnPeg.className = 'emp-tipo-btn active-peguei';
    btnEmp.className = 'emp-tipo-btn';
    icon.textContent = '🏦';
    document.getElementById('label-valor-combinado').textContent = 'Valor total combinado a pagar';
    document.getElementById('prev-total-label').textContent = 'Total a pagar';
    document.getElementById('prev-total').style.color = 'var(--red)';
  }
  atualizarPreviewEmp();
}

function setEmpJuros(tipo) {
  _empJuros = tipo;
  const btnPct  = document.getElementById('btn-juros-pct');
  const btnFixo = document.getElementById('btn-juros-fixo');
  const campoPct  = document.getElementById('campo-juros-pct');
  const campoFixo = document.getElementById('campo-juros-fixo');
  if (tipo === 'percentual') {
    btnPct.classList.add('active');
    btnFixo.classList.remove('active');
    campoPct.style.display  = 'block';
    campoFixo.style.display = 'none';
  } else {
    btnFixo.classList.add('active');
    btnPct.classList.remove('active');
    campoFixo.style.display = 'block';
    campoPct.style.display  = 'none';
  }
  atualizarPreviewEmp();
}

function atualizarPreviewEmp() {
  const valor  = _parseValorBR('emp-valor', 0);
  if (valor <= 0) { document.getElementById('emp-preview').style.display = 'none'; return; }

  const preview = document.getElementById('emp-preview');
  preview.style.display = 'block';
  document.getElementById('prev-original').textContent = BRL(valor);

  const jurosRow = document.getElementById('prev-juros-row');

  if (_empJuros === 'percentual') {
    const pct = _parseBRNumber(document.getElementById('emp-juros-pct').value);
    jurosRow.style.display = pct > 0 ? 'flex' : 'none';
    const juros1mes = valor * (pct / 100);
    document.getElementById('prev-juros-label').textContent = `Juros por mês (${pct}%)`;
    document.getElementById('prev-juros-val').textContent   = '+' + BRL(juros1mes);
    document.getElementById('prev-total').textContent       = BRL(valor + juros1mes);
  } else {
    const combinado = _parseValorBR('emp-valor-combinado', 0);
    if (combinado > 0) {
      const juros = combinado - valor;
      jurosRow.style.display = 'flex';
      document.getElementById('prev-juros-label').textContent = 'Lucro / juros total';
      document.getElementById('prev-juros-val').textContent   = '+' + BRL(juros);
      document.getElementById('prev-total').textContent       = BRL(combinado);
    } else {
      jurosRow.style.display = 'none';
      document.getElementById('prev-total').textContent = BRL(valor);
    }
  }
}

async function salvarEmprestimo() {
  if (bloqueadoPorTrial()) return;
  const pessoa   = document.getElementById('emp-pessoa').value.trim();
  // BUG CORRIGIDO: o campo emp-valor usa máscara pt-BR, então digitar 5000
  // deixava a .value como "5.000". parseFloat("5.000") === 5 em JS, porque
  // o ponto é lido como separador decimal — era assim que R$5.000 virava
  // R$5,00 no banco. _parseValorBR lê o número real de dataset.raw.
  const valor    = _parseValorBR('emp-valor', 0);
  const obs      = document.getElementById('emp-obs').value.trim();
  const dataVenc = document.getElementById('emp-data-venc').value || null;

  if (!pessoa) { showToast('Informe o nome da pessoa ou instituição', 'error'); return; }
  if (valor <= 0) { showToast('Informe o valor', 'error'); return; }

  let juros_mensal = 0, valor_combinado = 0;
  if (_empJuros === 'percentual') {
    juros_mensal = _parseBRNumber(document.getElementById('emp-juros-pct').value);
  } else {
    valor_combinado = _parseValorBR('emp-valor-combinado', 0);
    if (valor_combinado > 0 && valor_combinado <= valor) {
      showToast('O valor combinado deve ser maior que o valor original', 'error');
      return;
    }
  }

  const btn = document.querySelector('#modal-emprestimo .btn-emp-salvar');
  btn.textContent = 'Salvando...';
  btn.disabled = true;

  try {
    // supabase-js não lança em erro: retorna { error }. Sem checar isso,
    // uma falha do banco mostrava "sucesso" pro usuário.
    const { error: errIns } = await sb.from('emprestimos').insert({
      user_id:         USER_ID,
      tipo:            _empTipo,
      pessoa,
      valor,
      tipo_juros:      _empJuros,
      juros_mensal,
      valor_combinado,
      data_inicio:     new Date().toISOString().split('T')[0],
      data_venc:       dataVenc,
      observacao:      obs || null,
      pago:            false
    });
    if (errIns) throw errIns;

    showToast(_empTipo === 'emprestei' 
      ? `✅ Empréstimo de ${BRL(valor)} pra ${pessoa} registrado!`
      : `✅ Dívida de ${BRL(valor)} com ${pessoa} registrada!`, 'success');

    fecharModalEmprestimo();
    loadEmprestimos();
    updateEmpResumHome();
    // Se a view está aberta, re-renderizar
    if (document.getElementById('tab-emprestimos')?.classList.contains('active')) {
      renderEmprestimosView();
    }
  } catch(e) {
    console.error('[salvarEmprestimo]', e);
    showToast('Erro ao salvar: ' + (e?.message || 'tenta de novo'), 'error');
  } finally {
    btn.textContent = '✓ Registrar empréstimo';
    btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════
// MODAL RESERVA — lógica completa
// ══════════════════════════════════════════════════════════
function abrirModalReserva() {
  _reservaAcao = 'depositar';
  document.getElementById('res-valor-deposito').value = '';
  document.getElementById('res-valor-meta').value = '';
  setReservaAcao('depositar');
  atualizarStatusReservaModal();
  document.getElementById('modal-reserva').classList.add('open');
}

function fecharModalReserva() {
  document.getElementById('modal-reserva').classList.remove('open');
}

function setReservaAcao(acao) {
  _reservaAcao = acao;
  const btnDep  = document.getElementById('btn-res-depositar');
  const btnMeta = document.getElementById('btn-res-meta');
  const campoDep  = document.getElementById('campo-res-depositar');
  const campoMeta = document.getElementById('campo-res-meta');
  if (acao === 'depositar') {
    btnDep.style.borderColor  = 'var(--green)';
    btnDep.style.background   = 'var(--green-dim)';
    btnDep.style.color        = 'var(--green)';
    btnMeta.style.borderColor = 'var(--border2)';
    btnMeta.style.background  = 'var(--card)';
    btnMeta.style.color       = 'var(--muted)';
    campoDep.style.display  = 'block';
    campoMeta.style.display = 'none';
    document.getElementById('btn-res-confirmar').textContent = '✓ Guardar na reserva';
  } else {
    btnMeta.style.borderColor = 'var(--cyan)';
    btnMeta.style.background  = 'var(--cyan-dim)';
    btnMeta.style.color       = 'var(--cyan)';
    btnDep.style.borderColor  = 'var(--border2)';
    btnDep.style.background   = 'var(--card)';
    btnDep.style.color        = 'var(--muted)';
    campoMeta.style.display = 'block';
    campoDep.style.display  = 'none';
    document.getElementById('btn-res-confirmar').textContent = '✓ Salvar meta';
  }
}

function atualizarStatusReservaModal() {
  const reservaAtual = Number(userData?.reserva_atual || 0);
  const metaReserva  = Number(userData?.meta_reserva_emergencia || 0);
  const pct = metaReserva > 0 ? Math.min(100, Math.round((reservaAtual / metaReserva) * 100)) : 0;
  const atualEl  = document.getElementById('res-modal-atual');
  const metaEl   = document.getElementById('res-modal-meta');
  const barEl    = document.getElementById('res-modal-bar');
  const pctEl    = document.getElementById('res-modal-pct');
  if (atualEl)  atualEl.textContent  = BRL(reservaAtual);
  if (metaEl)   metaEl.textContent   = metaReserva > 0 ? BRL(metaReserva) : 'Não definida';
  if (pctEl)    pctEl.textContent    = pct + '%';
  if (barEl)    setTimeout(() => { barEl.style.width = pct + '%'; }, 100);
}

async function salvarReserva() {
  if (bloqueadoPorTrial()) return;
  // Validar ANTES de desabilitar botão
  if (_reservaAcao === 'depositar') {
    const depositoCheck = _getNumVal('res-valor-deposito');
    if (depositoCheck <= 0) { showToast('Informe o valor a guardar', 'error'); return; }
  } else {
    const metaCheck = _getNumVal('res-valor-meta');
    if (metaCheck <= 0) { showToast('Informe a meta de reserva', 'error'); return; }
  }

  const btn = document.getElementById('btn-res-confirmar');
  btn.textContent = 'Salvando...';
  btn.disabled = true;

  try {
    if (_reservaAcao === 'depositar') {
      const deposito = _getNumVal('res-valor-deposito');
      if (deposito <= 0) { showToast('Informe o valor a guardar', 'error'); return; }
      const reservaAtual = Number(userData?.reserva_atual || 0);
      const novaReserva  = reservaAtual + deposito;

      // Atualizar reserva_atual no usuario
      await sb.from('usuarios').update({ reserva_atual: novaReserva }).eq('id', USER_ID);
      // Registrar como transação
      await sb.from('transacoes').insert({
        user_id:   USER_ID, tipo: 'despesa', categoria: 'outros',
        valor:     deposito, descricao: 'Reserva de emergência',
        data:      new Date().toISOString().split('T')[0], fonte: 'dashboard'
      });

      // Atualizar userData local
      if (userData) userData.reserva_atual = novaReserva;
      const metaReserva = Number(userData?.meta_reserva_emergencia || 0);
      const pct = metaReserva > 0 ? Math.round((novaReserva / metaReserva) * 100) : 0;

      showToast('✅ ' + BRL(deposito) + ' guardados! Total: ' + BRL(novaReserva) + (metaReserva > 0 ? ' (' + pct + '%)' : ''), 'success');
      renderReserva(userData);
      renderReservaView(userData);
      fecharModalReserva();

    } else {
      const novaMeta = _getNumVal('res-valor-meta');
      if (novaMeta <= 0) { showToast('Informe a meta de reserva', 'error'); return; }

      await sb.from('usuarios').update({ meta_reserva_emergencia: novaMeta }).eq('id', USER_ID);
      if (userData) userData.meta_reserva_emergencia = novaMeta;
      showToast('🎯 Meta de reserva definida em ' + BRL(novaMeta) + '!', 'success');
      renderReserva(userData);
      renderReservaView(userData);
      fecharModalReserva();
    }
  } catch(e) {
    showToast('Erro ao salvar. Tenta de novo.', 'error');
  } finally {
    btn.disabled = false;
    setReservaAcao(_reservaAcao);
  }
}

// Fechar modais ao clicar no overlay
document.addEventListener('click', e => {
  if (e.target.id === 'modal-emprestimo') fecharModalEmprestimo();
  if (e.target.id === 'modal-reserva')    fecharModalReserva();
});


// ══════════════════════════════════════════════════════════
// VIEW EMPRÉSTIMOS — renderização completa
// ══════════════════════════════════════════════════════════
async function renderEmprestimosView() {
  if (!USER_ID) return;
  const listEl   = document.getElementById('emp-view-list');
  const pagosEl  = document.getElementById('emp-view-pagos');
  const recEl    = document.getElementById('emp-view-receber');
  const pagEl    = document.getElementById('emp-view-pagar');
  const saldoEl  = document.getElementById('emp-saldo-liquido');
  const saldoVal = document.getElementById('emp-saldo-val');
  const saldoDesc= document.getElementById('emp-saldo-desc');

  if (listEl) listEl.innerHTML = '<div class="skeleton sk-card"></div>';

  try {
    const { data: todos } = await sb.from('emprestimos')
      .select('*').eq('user_id', USER_ID).order('created_at', { ascending: false });

    const pendentes = (todos||[]).filter(e => !e.pago);
    const pagos     = (todos||[]).filter(e => e.pago);

    const hojeDate  = new Date();
    const calcVal   = e => {
      const inicio = new Date(e.data_inicio + 'T12:00:00');
      const dias   = Math.max(0, Math.round((hojeDate - inicio) / 86400000));
      if (e.tipo_juros === 'valor_fixo' && e.valor_combinado > 0) return e.valor_combinado;
      if (e.tipo_juros === 'percentual' && e.juros_mensal > 0)
        return e.valor * (1 + (e.juros_mensal / 100) * (dias / 30));
      return e.valor;
    };

    let totalRec = 0, totalPag = 0;
    const emprestei = pendentes.filter(e => e.tipo === 'emprestei');
    const peguei    = pendentes.filter(e => e.tipo === 'peguei_emprestado');
    emprestei.forEach(e => totalRec += calcVal(e));
    peguei.forEach(e => totalPag += calcVal(e));

    if (recEl) recEl.textContent = BRL(totalRec);
    if (pagEl) pagEl.textContent = BRL(totalPag);

    // Saldo líquido
    if (saldoEl && (totalRec > 0 || totalPag > 0)) {
      const saldo = totalRec - totalPag;
      saldoEl.style.display = 'block';
      saldoVal.textContent = (saldo >= 0 ? '+' : '') + BRL(saldo);
      saldoVal.style.color = saldo >= 0 ? 'var(--green)' : 'var(--red)';
      saldoDesc.textContent = saldo >= 0 ? 'Você tem mais a receber do que a pagar' : 'Você tem mais dívidas do que créditos';
    }

    // Renderizar listas
    const renderCard = (e, tipo) => {
      const val       = calcVal(e);
      const juros     = val - e.valor;
      const jurosStr  = juros > 0.01 ? `<span style="color:var(--amber);font-size:0.72rem"> +${BRL(juros)} juros</span>` : '';
      const color     = tipo === 'emprestei' ? 'var(--green)' : 'var(--red)';
      const border    = tipo === 'emprestei' ? 'var(--green-dim)' : 'var(--red-dim)';
      const action    = tipo === 'emprestei' ? 'Marcar como recebido' : 'Marcar como pago';
      const venc      = e.data_venc ? `<div style="font-size:0.7rem;color:var(--muted);margin-top:3px">Venc: ${e.data_venc}</div>` : '';
      const obs       = e.observacao ? `<div style="font-size:0.72rem;color:var(--muted);font-style:italic;margin-top:2px">${e.observacao}</div>` : '';
      return `<div style="background:var(--card);border-radius:14px;padding:14px 16px;margin-bottom:10px;border-left:3px solid ${color};border:1px solid ${border}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div style="font-weight:700;color:var(--text);font-size:0.92rem">${e.pessoa}</div>
            <div style="font-size:0.75rem;color:var(--muted);margin-top:2px">
              Original: ${BRL(e.valor)}${e.juros_mensal > 0 ? ' · ' + e.juros_mensal + '% a.m.' : ''}${e.tipo_juros === 'valor_fixo' && e.valor_combinado > 0 ? ' · fixo' : ''}
            </div>
            ${venc}${obs}
          </div>
          <div style="text-align:right">
            <div style="font-family:var(--font-head);font-weight:800;font-size:1.1rem;color:${color}">${BRL(val)}</div>
            ${jurosStr}
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button onclick="marcarEmprestimoPagoView('${e.id}','${e.pessoa}',${val})" style="flex:1;padding:8px;border-radius:10px;border:1px solid ${color};background:transparent;color:${color};font-family:var(--font-body);font-size:0.75rem;font-weight:700;cursor:pointer">✓ ${action}</button>
          <button onclick="deletarEmprestimo('${e.id}')" style="padding:8px 12px;border-radius:10px;border:1px solid var(--border2);background:transparent;color:var(--muted);font-family:var(--font-body);font-size:0.75rem;cursor:pointer">🗑️</button>
        </div>
      </div>`;
    };

    let html = '';
    if (pendentes.length === 0) {
      html = `<div style="text-align:center;padding:32px 16px">
        <div style="font-size:2.5rem;margin-bottom:10px">🤝</div>
        <div style="font-size:0.92rem;font-weight:700;color:var(--text);margin-bottom:6px">Nenhum empréstimo pendente</div>
        <div style="font-size:0.8rem;color:var(--muted)">Tudo quitado! Use o botão + Novo para registrar.</div>
      </div>`;
    } else {
      if (emprestei.length > 0) {
        html += `<div style="font-size:0.72rem;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">💸 A Receber (${emprestei.length})</div>`;
        emprestei.forEach(e => html += renderCard(e, 'emprestei'));
      }
      if (peguei.length > 0) {
        html += `<div style="font-size:0.72rem;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;margin-top:${emprestei.length > 0 ? '16px' : '0'}">🏦 A Pagar (${peguei.length})</div>`;
        peguei.forEach(e => html += renderCard(e, 'peguei_emprestado'));
      }
    }
    if (listEl) listEl.innerHTML = html;

    // Histórico pagos
    if (pagosEl && pagos.length > 0) {
      pagosEl.innerHTML = pagos.map(e => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-size:0.85rem;color:var(--muted)">${e.pessoa}</div>
            <div style="font-size:0.72rem;color:var(--muted2)">${e.tipo === 'emprestei' ? 'Emprestei' : 'Peguei'} · ${BRL(e.valor)}</div>
          </div>
          <div style="font-size:0.8rem;color:var(--muted)">✓ Quitado</div>
        </div>`).join('');
    }

  } catch(err) {
    if (listEl) listEl.innerHTML = '<div style="color:var(--muted);font-size:0.82rem;text-align:center;padding:20px">Erro ao carregar. Tenta de novo.</div>';
  }
}

async function marcarEmprestimoPagoView(id, pessoa, valorPago) {
  if (bloqueadoPorTrial()) return;
  if (!await confirmar({ emoji:'🤝', titulo:`Quitar empréstimo com ${pessoa}?`, confirmar:'Quitar' })) return;
  try {
    await sb.from('emprestimos').update({ pago: true, valor_pago: valorPago }).eq('id', id);
    showToast('✅ Quitado com sucesso!', 'success');
    renderEmprestimosView();
    updateEmpResumHome();
    loadEmprestimos();
  } catch(e) { showToast('Erro. Tenta de novo.', 'error'); }
}

async function deletarEmprestimo(id) {
  if (bloqueadoPorTrial()) return;
  if (!await confirmar({ emoji:'🗑', titulo:'Deletar este empréstimo?', perigo:true, confirmar:'Deletar' })) return;
  try {
    await sb.from('emprestimos').delete().eq('id', id);
    showToast('Empréstimo removido', 'success');
    renderEmprestimosView();
    updateEmpResumHome();
    loadEmprestimos();
  } catch(e) { showToast('Erro ao deletar.', 'error'); }
}

function toggleEmpPagos() {
  const el = document.getElementById('emp-view-pagos');
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// ══════════════════════════════════════════════════════════
// VIEW RESERVA — renderização completa
// ══════════════════════════════════════════════════════════
async function renderReservaView(user) {
  if (!user) return;
  const reservaAtual = Number(user.reserva_atual || 0);
  const metaReserva  = Number(user.meta_reserva_emergencia || 0);
  const metaMensal   = Number(user.meta_mensal || user.meta_gastos_mensal || 0);
  const pct = metaReserva > 0 ? Math.min(100, Math.round((reservaAtual / metaReserva) * 100)) : 0;

  const atualEl = document.getElementById('res-view-atual');
  const metaEl  = document.getElementById('res-view-meta');
  const barEl   = document.getElementById('res-view-bar');
  const pctEl   = document.getElementById('res-view-pct');
  const faltaEl = document.getElementById('res-view-falta');
  const recEl   = document.getElementById('res-view-recomendado');
  const recVal  = document.getElementById('res-view-rec-val');

  if (atualEl) atualEl.textContent = BRL(reservaAtual);
  if (metaEl)  metaEl.textContent  = metaReserva > 0 ? BRL(metaReserva) : 'Não definida';
  if (pctEl)   pctEl.textContent   = pct + '%';
  if (barEl)   setTimeout(() => { barEl.style.width = pct + '%'; }, 200);

  if (faltaEl) {
    if (reservaAtual >= metaReserva && metaReserva > 0) {
      faltaEl.textContent = '🎉 Meta atingida! Você está protegido.';
      faltaEl.style.color = 'var(--green)';
    } else if (metaReserva > 0) {
      faltaEl.textContent = 'Faltam ' + BRL(metaReserva - reservaAtual) + ' para completar.';
      faltaEl.style.color = 'var(--muted)';
    } else {
      faltaEl.textContent = 'Defina uma meta para acompanhar seu progresso.';
    }
  }

  // Recomendação baseada na meta mensal
  if (recEl && recVal && metaMensal > 0) {
    recEl.style.display = 'inline';
    recVal.textContent = BRL(metaMensal * 3) + ' a ' + BRL(metaMensal * 6);
  }

  // Histórico de depósitos
  const histEl = document.getElementById('res-view-historico');
  if (histEl && USER_ID) {
    try {
      const { data } = await sb.from('transacoes')
        .select('valor,data,descricao')
        .eq('user_id', USER_ID)
        .eq('descricao', 'Reserva de emergência')
        .order('data', { ascending: false })
        .limit(10);

      if (!data || data.length === 0) {
        histEl.innerHTML = '<div style="font-size:0.8rem;color:var(--muted);text-align:center;padding:16px">Nenhum depósito registrado ainda.</div>';
      } else {
        histEl.innerHTML = data.map(t => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
            <div>
              <div style="font-size:0.85rem;color:var(--text)">Depósito</div>
              <div style="font-size:0.72rem;color:var(--muted)">${t.data}</div>
            </div>
            <div style="font-family:var(--font-head);font-weight:700;color:var(--green)">+${BRL(t.valor)}</div>
          </div>`).join('');
      }
    } catch(e) {
      histEl.innerHTML = '<div style="font-size:0.8rem;color:var(--muted)">Erro ao carregar histórico.</div>';
    }
  }
}


// ══════════════════════════════════════════════════════════
// ANÁLISE DE EMPRÉSTIMOS POR PERÍODO
// ══════════════════════════════════════════════════════════
let _empTodosCache = [];
let _empPeriodo = 'mensal';

function setEmpPeriodo(periodo) {
  _empPeriodo = periodo;
  const btnM = document.getElementById('btn-emp-mensal');
  const btnA = document.getElementById('btn-emp-anual');
  if (btnM && btnA) {
    if (periodo === 'mensal') {
      btnM.style.background = 'var(--purple-dim)';
      btnM.style.borderColor = 'var(--purple)';
      btnM.style.color = 'var(--purple-light)';
      btnA.style.background = 'transparent';
      btnA.style.borderColor = 'var(--border2)';
      btnA.style.color = 'var(--muted)';
    } else {
      btnA.style.background = 'var(--purple-dim)';
      btnA.style.borderColor = 'var(--purple)';
      btnA.style.color = 'var(--purple-light)';
      btnM.style.background = 'transparent';
      btnM.style.borderColor = 'var(--border2)';
      btnM.style.color = 'var(--muted)';
    }
  }
  renderEmpAnalise();
}

function renderEmpAnalise() {
  const el = document.getElementById('emp-analise-tabela');
  if (!el || !_empTodosCache.length) {
    if (el) el.innerHTML = '<div style="font-size:0.8rem;color:var(--muted);text-align:center;padding:12px">Nenhum empréstimo para analisar.</div>';
    return;
  }

  // Agrupar por período
  const grupos = {};
  _empTodosCache.forEach(e => {
    const dt = e.data_inicio || e.created_at?.split('T')[0] || '';
    const key = _empPeriodo === 'mensal'
      ? dt.substring(0, 7)   // YYYY-MM
      : dt.substring(0, 4);  // YYYY

    if (!grupos[key]) grupos[key] = { emprestei: 0, peguei: 0, quitar: 0, count: 0 };
    grupos[key].count++;
    if (e.tipo === 'emprestei') {
      grupos[key].emprestei += e.valor;
      if (e.pago) grupos[key].quitar += e.valor_pago || e.valor;
    } else {
      grupos[key].peguei += e.valor;
    }
  });

  const keys = Object.keys(grupos).sort().reverse();
  if (!keys.length) {
    el.innerHTML = '<div style="font-size:0.8rem;color:var(--muted);text-align:center;padding:12px">Sem dados.</div>';
    return;
  }

  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const formatKey = k => {
    if (_empPeriodo === 'mensal') {
      const [y, m] = k.split('-');
      return meses[parseInt(m)-1] + '/' + y.slice(2);
    }
    return k;
  };

  el.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:0.8rem">
      <thead>
        <tr style="border-bottom:1px solid var(--border2)">
          <th style="text-align:left;padding:8px 6px;color:var(--muted);font-weight:700;font-size:0.7rem;text-transform:uppercase">Período</th>
          <th style="text-align:right;padding:8px 6px;color:var(--green);font-weight:700;font-size:0.7rem;text-transform:uppercase">Emprestei</th>
          <th style="text-align:right;padding:8px 6px;color:var(--red);font-weight:700;font-size:0.7rem;text-transform:uppercase">Devo</th>
          <th style="text-align:right;padding:8px 6px;color:var(--muted);font-weight:700;font-size:0.7rem;text-transform:uppercase">Qtd</th>
        </tr>
      </thead>
      <tbody>
        ${keys.map(k => {
          const g = grupos[k];
          const saldo = g.emprestei - g.peguei;
          return `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:9px 6px;font-weight:700;color:var(--text)">${formatKey(k)}</td>
            <td style="padding:9px 6px;text-align:right;color:var(--green);font-family:var(--font-head)">${g.emprestei > 0 ? BRL(g.emprestei) : '—'}</td>
            <td style="padding:9px 6px;text-align:right;color:var(--red);font-family:var(--font-head)">${g.peguei > 0 ? BRL(g.peguei) : '—'}</td>
            <td style="padding:9px 6px;text-align:right;color:var(--muted)">${g.count}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

// Estender renderEmprestimosView para cachear todos e renderizar tabela
const _origRenderEmpView = renderEmprestimosView;
renderEmprestimosView = async function() {
  await _origRenderEmpView();
  // Carregar todos (incluindo pagos) para análise
  if (USER_ID) {
    try {
      const { data } = await sb.from('emprestimos').select('*').eq('user_id', USER_ID).order('data_inicio', { ascending: false });
      _empTodosCache = data || [];
      renderEmpAnalise();
    } catch(e) {}
  }
};


// ══════════════════════════════════════════════════════════
// PARSER CSV — replica exatamente o Parsear CSV do n8n
// Nubank: date,title,amount (positivos=despesa, negativos=ignorar)
// ══════════════════════════════════════════════════════════
let _csvResultado = null;

function parsearCSVDashboard(csvText, fileName) {
  const hoje = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  const [hA, hM] = hoje.split('-').map(Number);
  const dataMinima = (() => { const d = new Date(hA, hM-2, 1); return d.toLocaleDateString('en-CA'); })();

  const detectarCategoria = (desc) => {
    const d = desc.toLowerCase();
    if (/ifood|rappi|uber.?eat|pizza|lanche|mercado|superm|padaria|restaur|alimenta|café|cafe|delivery|panificadora/i.test(d)) return 'alimentacao';
    if (/uber|99|cabify|gasolina|combust|estacion|ônibus|onibus|metro|pedágio|pedagio|ipva/i.test(d)) return 'transporte';
    if (/aluguel|condomin|luz|energia|água|agua|gás|gas|internet|iptu/i.test(d)) return 'moradia';
    if (/farmác|farmac|remédio|remedio|médico|medico|dentist|academia|suplem|exame|plano.?sa[uú]de|terapia/i.test(d)) return 'saude';
    if (/netflix|spotify|disney|hbo|prime|youtube|deezer|cinema|capcut|claude|subscription/i.test(d)) return 'assinaturas';
    if (/shopee|amazon|mercado.?livre|americanas|renner|c&a|zara/i.test(d)) return 'compras';
    if (/workspace|google|bunnycdn|uazapi|anota.?ai|utmify|astronpay/i.test(d)) return 'assinaturas';
    return 'outros';
  };

  const detectarParcela = (desc) => {
    const m1 = desc.match(/[Pp]arcela\s+(\d{1,3})\/(\d{1,3})/);
    if (m1) { const a=parseInt(m1[1]),t=parseInt(m1[2]); if(a>=1&&t>=2&&a<=t&&t<=120) return {atual:a,total:t}; }
    const m2 = desc.match(/\b(\d{1,2})\/(\d{1,2})\b(?!\/)/);
    if (m2) { const a=parseInt(m2[1]),t=parseInt(m2[2]); if(a>=1&&t>=2&&a<=t&&t<=120) return {atual:a,total:t}; }
    return null;
  };

  const adicionarMeses = (dateStr, n) => {
    const [y,m,d] = dateStr.split('-').map(Number);
    const nd = new Date(y, m-1+n, 1);
    const ultimo = new Date(nd.getFullYear(), nd.getMonth()+1, 0).getDate();
    return `${nd.getFullYear()}-${String(nd.getMonth()+1).padStart(2,'0')}-${String(Math.min(d,ultimo)).padStart(2,'0')}`;
  };

  const parseValor = (v) => {
    const s = String(v||'').replace(/"/g,'').replace(/R\$\s*/i,'').trim();
    let n;
    if (s.includes(',')) n = parseFloat(s.replace(/\./g,'').replace(',','.'));
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) n = parseFloat(s.replace(/\./g,''));
    else n = parseFloat(s);
    if (isNaN(n)||!isFinite(n)) return null;
    return Math.round(Math.abs(n)*100)/100;
  };

  const parseData = (v) => {
    const s = String(v||'').replace(/"/g,'').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m1 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if(m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;
    const m3 = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);   if(m3) return `${m3[3]}-${m3[2]}-${m3[1]}`;
    return null;
  };

  // Detectar delimitador
  const primeiraLinha = csvText.split('\n')[0] || '';
  const del = primeiraLinha.includes(';') ? ';' : ',';
  const linhas = csvText.split('\n').map(l=>l.replace(/\r/g,'').trim()).filter(l=>l.length>0);

  if (linhas.length < 2) return { erro: true, erroMsg: 'CSV vazio ou sem transações.' };

  const cab = linhas[0].split(del).map(c=>c.replace(/"/g,'').trim().toLowerCase());
  const mapCol = (arr, ops) => { for(const op of ops){const i=arr.findIndex(c=>c.includes(op));if(i>=0)return i;} return -1; };

  const iData  = mapCol(cab, ['date','data','dt lançamento','data lançamento']);
  const iDesc  = mapCol(cab, ['title','título','titulo','descrição','descricao','description','estabelecimento','histórico','lançamento']);
  const iValor = mapCol(cab, ['amount','valor','value','vlr','quantia','total','montante']);

  if (iData<0||iDesc<0||iValor<0) return { erro: true, erroMsg: `Colunas não reconhecidas: ${cab.join(', ')}` };

  const transacoes = [], futuras = [];
  let ignoradas = 0;

  for (let i=1; i<linhas.length; i++) {
    const cols = linhas[i].split(del).map(c=>c.replace(/"/g,'').trim());
    if (cols.length < 3) { ignoradas++; continue; }
    const data  = parseData(cols[iData]);
    const desc  = (cols[iDesc]||'').substring(0,100).trim();
    const vNum  = parseFloat(String(cols[iValor]||'').trim());
    if (!data||!desc||isNaN(vNum)||vNum<=0) { ignoradas++; continue; }
    const valor = parseValor(cols[iValor]);
    if (!valor||valor<=0) { ignoradas++; continue; }
    const parcela = detectarParcela(desc);
    if (!parcela && data > hoje) { ignoradas++; continue; }
    if (!parcela && data < dataMinima) { ignoradas++; continue; }
    const categoria = detectarCategoria(desc);
    const txBase = { user_id: USER_ID, tipo: 'despesa', categoria, valor, descricao: desc, data, fonte: 'csv' };
    if (!parcela || data <= hoje) transacoes.push(txBase);
    if (parcela && parcela.total > parcela.atual) {
      for (let p=1; p<=parcela.total-parcela.atual; p++) {
        const dataF = adicionarMeses(data, p);
        const descF = desc.replace(/([Pp]arcela\s+)\d{1,3}(\/\d{1,3})/, `$1${parcela.atual+p}$2`);
        futuras.push({ user_id: USER_ID, tipo: 'despesa', categoria, valor, descricao: descF, data: dataF, fonte: 'csv', parcela_atual: parcela.atual+p, parcela_total: parcela.total });
      }
    }
  }

  if (!transacoes.length && !futuras.length) return { erro: true, erroMsg: 'Nenhuma transação válida encontrada. Envie o extrato do mês atual ou anterior.' };

  // Detect banco from filename
  let bancoCsv = null;
  const fn2 = (fileName || '').toLowerCase();
  if (/nubank/.test(fn2)) bancoCsv = 'Nubank';
  else if (/santander/.test(fn2)) bancoCsv = 'Santander';
  else if (/mercado.?pago|mercadopago/.test(fn2)) bancoCsv = 'Mercado Pago';
  else if (/itau|ita/.test(fn2)) bancoCsv = 'Itaú';
  else if (/bradesco/.test(fn2)) bancoCsv = 'Bradesco';
  else if (/inter/.test(fn2)) bancoCsv = 'Inter';
  else if (/c6/.test(fn2)) bancoCsv = 'C6 Bank';
  if (bancoCsv) { transacoes.forEach(t => t.cartao = t.cartao||bancoCsv); futuras.forEach(t => t.cartao = t.cartao||bancoCsv); }

  const totalDespesas = transacoes.reduce((s,t)=>s+t.valor,0);
  const futurasPorMes = {};
  futuras.forEach(t => {
    const mes = t.data.substring(0,7);
    if (!futurasPorMes[mes]) futurasPorMes[mes] = { total: 0, qtd: 0 };
    futurasPorMes[mes].total += t.valor;
    futurasPorMes[mes].qtd++;
  });

  return { erro: false, fileName, transacoes, futuras, totalDespesas, ignoradas, futurasPorMes };
}

// ── Preview Modal ──────────────────────────────────────────
function abrirPreviewCSV(resultado) {
  _csvResultado = resultado;
  const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  // Badge banco e status fatura
  const titleEl = document.querySelector('#modal-csv-preview .csv-preview-title');
  if (titleEl) {
    const bancoTag = resultado.banco ? '<span style="font-size:0.72rem;background:var(--purple-dim);border:1px solid var(--purple);color:var(--purple-light);border-radius:20px;padding:2px 10px;margin-left:8px">' + resultado.banco + '</span>' : '';
    const statusTag = resultado.isPago != null
      ? '<span style="font-size:0.72rem;background:' + (resultado.isPago ? 'var(--green-dim)' : 'var(--amber-dim)') + ';border:1px solid ' + (resultado.isPago ? 'rgba(155,255,206,0.3)' : 'rgba(252,211,77,0.3)') + ';color:' + (resultado.isPago ? 'var(--green)' : 'var(--amber)') + ';border-radius:20px;padding:2px 10px;margin-left:8px">' + (resultado.isPago ? '✓ Já paga' : '⚠️ Em aberto') + '</span>'
      : '';
    titleEl.innerHTML = '📄 Importar Fatura' + bancoTag + statusTag;
  }
  if (resultado.isPago != null) {
    // Remove infoBoxes anteriores para evitar múltiplos ao re-importar
    const modalBox = document.querySelector('#modal-csv-preview .csv-preview-box');
    if (modalBox) {
      modalBox.querySelectorAll('.csv-info-box').forEach(el => el.remove());
    }
    const infoBox = document.createElement('div');
    infoBox.className = 'csv-info-box';
    infoBox.style.cssText = 'font-size:0.78rem;color:var(--muted);background:var(--card);border-radius:10px;padding:10px 12px;margin-bottom:12px;line-height:1.6';
    infoBox.innerHTML = resultado.isPago
      ? '<strong style="color:var(--green)">Fatura já paga</strong> · Venceu em ' + (resultado.vencimento||'?') + '. Parcelas já pagas foram ignoradas. Apenas as <strong>parcelas futuras</strong> serão adicionadas ao seu gráfico.'
      : '<strong style="color:var(--amber)">Fatura em aberto</strong> · Vence em ' + (resultado.vencimento||'?') + '. As transações do mês serão registradas normalmente.';
    const countEl = document.getElementById('csv-prev-count');
    if (countEl?.closest('.csv-stat-row')) {
      countEl.closest('.csv-stat-row').before(infoBox);
    }
  }

  document.getElementById('csv-prev-count').textContent = resultado.transacoes.length;
  document.getElementById('csv-prev-total').textContent = BRL(resultado.totalDespesas);

  // Parcelas futuras
  const futurasBox = document.getElementById('csv-prev-futuras-box');
  const futurasDesc = document.getElementById('csv-prev-futuras-desc');
  const futuraMeses = Object.entries(resultado.futurasPorMes);
  if (futuraMeses.length > 0) {
    futurasBox.style.display = 'block';
    futurasDesc.innerHTML = futuraMeses.map(([mes,d]) => {
      const [y,m] = mes.split('-');
      return `${MESES[parseInt(m)-1]}/${y.slice(2)}: ${d.qtd} parcela(s) — ${BRL(d.total)}`;
    }).join('<br>');
  } else {
    futurasBox.style.display = 'none';
  }

  // Lista de transações
  const listEl = document.getElementById('csv-prev-list');
  const EMOJI = { alimentacao:'🍔', transporte:'🚗', moradia:'🏠', saude:'💊', lazer:'🎮', compras:'🛍️', assinaturas:'📱', outros:'📦', salario:'💰', freelance:'💼' };
  listEl.innerHTML = resultado.transacoes.map(t => `
    <div class="csv-tx-item">
      <div class="csv-tx-desc">
        ${EMOJI[t.categoria]||'📦'} ${t.descricao}
        <span class="csv-tx-cat">${t.categoria} · ${t.data}</span>
      </div>
      <div class="csv-tx-val">-${BRL(t.valor)}</div>
    </div>`).join('');

  const ignEl = document.getElementById('csv-prev-ignoradas');
  if (resultado.ignoradas > 0) ignEl.textContent = `${resultado.ignoradas} linhas ignoradas (pagamentos de fatura, data fora do período ou inválidas)`;
  else ignEl.textContent = '';

  document.getElementById('modal-csv-preview').classList.add('open');
}

function fecharPreviewCSV() {
  document.getElementById('modal-csv-preview').classList.remove('open');
  _csvResultado = null;
}

async function confirmarImportCSV() {
  if (!_csvResultado || !USER_ID) return;
  const btn = document.getElementById('btn-csv-confirmar');
  btn.textContent = 'Importando...';
  btn.disabled = true;

  try {
    const { transacoes, futuras } = _csvResultado;

    // Inserir transações correntes
    if (transacoes.length > 0) {
      // Set cartao field on transactions using banco detection
      let bancoTx = _csvResultado?.cartao || _csvResultado?.banco;
      if (bancoTx) {
        // Convert raw banco id to display name
        const bancoMap = {
          'nubank':'Nubank','santander':'Santander','mercadopago':'Mercado Pago',
          'bradesco':'Bradesco','itau':'Itaú','inter':'Inter','c6':'C6 Bank',
          'bb':'Banco do Brasil','caixa':'Caixa'
        };
        bancoTx = bancoMap[bancoTx] || bancoTx;
        transacoes.forEach(t => { if (!t.cartao) t.cartao = bancoTx; });
      }
      const { error } = await sb.from('transacoes').insert(transacoes);
      if (error) throw error;
    }

    // Inserir parcelas futuras em faturas_futuras
    if (futuras.length > 0) {
      // Detectar banco pelo nome do arquivo CSV se não identificado
      const _bancoMap = {
        'nubank':'Nubank','santander':'Santander','mercadopago':'Mercado Pago',
        'bradesco':'Bradesco','itau':'Itaú','inter':'Inter','c6':'C6 Bank',
        'bb':'Banco do Brasil','caixa':'Caixa'
      };
      let bancoNome = _csvResultado?.cartao || (_bancoMap[_csvResultado?.banco] || _csvResultado?.banco);
      if (!bancoNome && _csvResultado?.fileName) {
        const fn = (_csvResultado.fileName || '').toLowerCase();
        if (/nubank/.test(fn)) bancoNome = 'Nubank';
        else if (/santander/.test(fn)) bancoNome = 'Santander';
        else if (/mercado.?pago|mercadopago/.test(fn)) bancoNome = 'Mercado Pago';
        else if (/itau|itaú/.test(fn)) bancoNome = 'Itaú';
        else if (/bradesco/.test(fn)) bancoNome = 'Bradesco';
        else if (/inter/.test(fn)) bancoNome = 'Inter';
        else if (/c6/.test(fn)) bancoNome = 'C6 Bank';
      }
      // Gerar UUID para este lote de importação e persistir banco no cache
      const importacaoId = crypto.randomUUID();
      if (bancoNome) setBancoCacheEntry(importacaoId, bancoNome);
      // Salvar hash para anti-duplicação (se disponível)
      if (_csvResultado?._fileHash) saveFileHash(_csvResultado._fileHash, importacaoId, bancoNome);
      // Salvar ultimo importacaoId para permitir reversão
      window._lastImportacaoId = importacaoId;
      window._lastImportacaoBanco = bancoNome;

      // Para faturas PDF "em aberto", inserir o total da fatura como compromisso
      // do mês do vencimento — aparece nos círculos de comprometimento mensal
      const futurasComTotal = [...futuras];
      const isPagoPDF = _csvResultado?.isPago;
      const vencPDF = _csvResultado?.vencimento;
      const totalFaturaPDF = _csvResultado?.totalDespesas;
      if (isPagoPDF === false && vencPDF && totalFaturaPDF > 0 && (bancoNome || _csvResultado?.banco)) {
        futurasComTotal.push({
          user_id: USER_ID,
          descricao: '📅 Fatura ' + (bancoNome || _csvResultado?.banco || 'Cartão') + ' (vencimento)',
          categoria: 'outros',
          valor: totalFaturaPDF,
          data: vencPDF,
          parcela_atual: 1,
          parcela_total: 1
        });
      }

      const _bancoParaCartao = bancoNome || _csvResultado?.banco || null;
      const fat = futurasComTotal.map(t => ({
        user_id: USER_ID,
        descricao: t.descricao,
        categoria: t.categoria,
        valor: t.valor,
        data_venc: t.data,
        parcela_atual: t.parcela_atual || 1,
        parcela_total: t.parcela_total || 1,
        fonte: 'csv',
        importacao_id: importacaoId,
        cartao: _bancoParaCartao  // ← salvo no banco de dados (não mais só localStorage)
      }));
      await sb.from('faturas_futuras').insert(fat);
    }

    // Recarregar transações
    const { data: novasTx } = await sb.from('transacoes')
      .select('*').eq('user_id', USER_ID).order('data', { ascending: false });
    if (novasTx) {
      allTx = novasTx;
      renderTransacoes(allTx, userData);
      renderHome(userData, userData);
  // Verificar faturas vencendo e disparar notificações PWA (com delay para não travar o render)
  setTimeout(verificarNotificacoesFaturas, 3000);
    }

    // Recarregar faturas_futuras E atualizar bento cards por banco
    const { data: novasFaturas } = await sb.from('faturas_futuras')
      .select('*').eq('user_id', USER_ID)
      .gte('data_venc', today()).order('data_venc');
    if (novasFaturas) {
      allFaturas = novasFaturas;
      renderFaturas(allFaturas);
    }

    showToast('✅ ' + transacoes.length + ' transações importadas!' + (futuras.length > 0 ? ' + ' + futuras.length + ' parcelas futuras.' : ''), 'success');
    // Show revert button
    const btnRev = document.getElementById('btn-reverter');
    if (btnRev && window._lastImportacaoId) btnRev.style.display = 'inline-flex';
    fecharPreviewCSV();

  } catch(e) {
    console.error('Erro import:', e);
    showToast('Erro ao importar. Tente de novo.', 'error');
  } finally {
    btn.textContent = '✓ Importar tudo';
    btn.disabled = false;
  }
}

// Fechar modal CSV ao clicar no overlay
document.addEventListener('click', e => {
  if (e.target.id === 'modal-csv-preview') fecharPreviewCSV();
});


// ══════════════════════════════════════════════════════════
// PARSER PDF — Multi-banco com lógica de datas inteligente
// Suporte: Mercado Pago, Santander
// ══════════════════════════════════════════════════════════
let _pdfResultadoPendente = null;

// Configurar PDF.js worker
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

async function extrairTextoPDF(arrayBuffer) {
  // Always set workerSrc before each call (might be lost after worker terminates)
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  // Pass a copy of the ArrayBuffer to avoid detach issues with PDF.js worker transfer
  const bufferCopy = arrayBuffer.slice(0);
  const pdf = await pdfjsLib.getDocument({ data: bufferCopy }).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(s => s.str).join(' ');
    fullText += pageText + '\n';
  }
  return fullText;
}

function detectarBancoPDF(text) {
  const t = text.toLowerCase();
  if (t.includes('mercado pago') || t.includes('mercadolivre') || t.includes('melimais')) return 'mercadopago';
  if (t.includes('santander') || t.includes('banco santander')) return 'santander';
  if (t.includes('nubank') || t.includes('nu pagamentos')) return 'nubank';
  if (t.includes('banco inter') || t.includes('inter ')) return 'inter';
  if (t.includes('itau') || t.includes('itaú')) return 'itau';
  if (t.includes('bradesco')) return 'bradesco';
  if (t.includes('c6 bank') || t.includes('c6bank')) return 'c6';
  return 'desconhecido';
}

function extrairVencimentoPDF(text, banco) {
  // Padrões de vencimento por banco
  const patterns = [
    /[Vv]ence[m\s]+(em)?\s*(\d{2}\/\d{2}\/\d{4})/,
    /[Vv]encimento[:\s]+(\d{2}\/\d{2}\/\d{4})/,
    /[Dd]ata de [Vv]encimento[:\s]+(\d{2}\/\d{2}\/\d{4})/,
    /[Pp]agamento at[eé] (\d{2}\/\d{2}\/\d{4})/,
    /due date[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
    /vence em\s+(\d{2}\/\d{2}\/\d{4})/i,
    /vencimento\s+(\d{2}\/\d{2}\/\d{4})/i,
    // Santander: "01/mai/26" ou "01/05/2026"
    /at[eé]\s+(\d{2}\/\w{3}\/\d{2,4})/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const raw = m[m.length-1];
      return parseDataFlexivel(raw);
    }
  }
  return null;
}

function parseDataFlexivel(raw) {
  if (!raw) return null;
  raw = raw.trim();
  // DD/MM/YYYY
  let m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // DD/MM/YY
  m = raw.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (m) return `20${m[3]}-${m[2]}-${m[1]}`;
  // DD/mon/YY ou DD/mon/YYYY
  const MESES_MAP = {jan:'01',fev:'02',mar:'03',abr:'04',mai:'05',jun:'06',
                     jul:'07',ago:'08',set:'09',out:'10',nov:'11',dez:'12'};
  m = raw.match(/^(\d{2})\/(\w{3})\/(\d{2,4})$/i);
  if (m) {
    const mm = MESES_MAP[m[2].toLowerCase()];
    if (mm) {
      const yr = m[3].length === 2 ? '20'+m[3] : m[3];
      return `${yr}-${mm}-${m[1]}`;
    }
  }
  return null;
}

// Detectar parcela em string de descrição
function detectarParcelaPDF(desc) {
  // "Parcela 1 de 18" ou "01/18" ou "01 de 18" ou "1/18"
  let m = desc.match(/[Pp]arcela\s+(\d{1,3})\s+de\s+(\d{1,3})/);
  if (m) { const a=parseInt(m[1]),t=parseInt(m[2]); if(a>=1&&t>=2&&a<=t&&t<=120) return {atual:a,total:t}; }
  // "01/02" formato Santander
  m = desc.match(/\b(\d{1,2})\/(\d{1,2})\b(?![\d\/])/);
  if (m) { const a=parseInt(m[1]),t=parseInt(m[2]); if(a>=1&&t>=2&&a<=t&&t<=120) return {atual:a,total:t}; }
  return null;
}

function adicionarMesesPDF(dateStr, n) {
  const [y,m,d] = dateStr.split('-').map(Number);
  const nd = new Date(y, m-1+n, 1);
  const ultimo = new Date(nd.getFullYear(), nd.getMonth()+1, 0).getDate();
  return `${nd.getFullYear()}-${String(nd.getMonth()+1).padStart(2,'0')}-${String(Math.min(d,ultimo)).padStart(2,'0')}`;
}

function detectarCatPDF(desc) {
  const d = desc.toLowerCase();
  if (/ifood|rappi|uber.?eat|pizza|lanche|mercado|superm|padaria|restaur|aliment|café|cafe|hamburguer/i.test(d)) return 'alimentacao';
  if (/uber|99|cabify|gasolina|combust|estacion|ônibus|onibus|metro|pedágio|pedagio|ipva/i.test(d)) return 'transporte';
  if (/aluguel|condomin|luz|energia|água|agua|gás|gas|internet|iptu|brisanet|vivo|claro|tim|oi\b/i.test(d)) return 'moradia';
  if (/farmác|farmac|remédio|remedio|médico|medico|dentist|academia|suplem|exame|plano.?saúde|terapia|maxfit|tecnodent/i.test(d)) return 'saude';
  if (/netflix|spotify|disney|hbo|prime|youtube|deezer|cinema|capcut|claude|subscription|grok|xai/i.test(d)) return 'assinaturas';
  if (/shopee|amazon|mercado.?livre|americanas|renner|c&a|zara|melimais/i.test(d)) return 'compras';
  if (/workspace|google|bunnycdn|uazapi|anota.?ai|utmify|astronpay/i.test(d)) return 'assinaturas';
  return 'outros';
}

function parsearMercadoPago(text, vencimento, isPago, hoje) {
  const transacoes = [], futuras = [];
  let ignoradas = 0;
  const anoAtual = new Date().getFullYear();

  // Padrão MP: "18/03 DESCRICAO [Parcela X de Y] R$ 40,50"
  const regexMP = /(\d{2}\/\d{2})\s+(.+?)\s+R\$\s*([\d.,]+)/g;
  let m;
  while ((m = regexMP.exec(text)) !== null) {
    const [_, dataDM, descRaw, valorRaw] = m;
    const [d, mo] = dataDM.split('/');
    const dataStr = `${anoAtual}-${mo}-${d}`;
    const desc = descRaw.trim().substring(0, 100);
    const valor = parseFloat(valorRaw.replace(/\./g,'').replace(',','.'));
    if (!valor || valor <= 0) { ignoradas++; continue; }
    // Ignorar pagamento de fatura
    if (/pagamento recebido|pagamento de fatura/i.test(desc)) { ignoradas++; continue; }
    // Ignorar IOF (já incluso no valor da compra internacional)
    if (/^IOF/i.test(desc)) { ignoradas++; continue; }
    const parcela = detectarParcelaPDF(desc);
    const categoria = detectarCatPDF(desc);

    if (isPago) {
      // Fatura já paga: parcela atual já quitada → gerar só as futuras
      if (parcela && parcela.total > parcela.atual) {
        for (let p = 1; p <= parcela.total - parcela.atual; p++) {
          const dataF = adicionarMesesPDF(vencimento, p);
          const descF = desc.replace(/([Pp]arcela\s+)\d+(\s+de\s+\d+)/, '$1' + (parcela.atual+p) + '$2');
          futuras.push({ user_id: USER_ID, tipo:'despesa', categoria, valor, descricao: descF, data: dataF, fonte:'csv', parcela_atual: parcela.atual+p, parcela_total: parcela.total });
        }
      }
      // Compras avulsas na fatura já paga → ignorar (já foram pagas)
      ignoradas++;
    } else {
      // Fatura ainda não paga → incluir transação atual + futuras
      transacoes.push({ user_id: USER_ID, tipo:'despesa', categoria, valor, descricao: desc, data: vencimento, fonte:'csv' });
      if (parcela && parcela.total > parcela.atual) {
        for (let p = 1; p <= parcela.total - parcela.atual; p++) {
          const dataF = adicionarMesesPDF(vencimento, p);
          const descF = desc.replace(/([Pp]arcela\s+)\d+(\s+de\s+\d+)/, '$1' + (parcela.atual+p) + '$2');
          futuras.push({ user_id: USER_ID, tipo:'despesa', categoria, valor, descricao: descF, data: dataF, fonte:'csv', parcela_atual: parcela.atual+p, parcela_total: parcela.total });
        }
      }
    }
  }
  return { transacoes, futuras, ignoradas };
}

function parsearSantander(text, vencimento, isPago, hoje) {
  const transacoes = [], futuras = [];
  let ignoradas = 0;
  const anoAtual = new Date().getFullYear();

  // Santander PDF: texto pode vir fragmentado pelo PDF.js
  // Estratégia multi-pass: regex de linha + fallback por tokens

  const normalizado = text.replace(/\r/g,'');

  // Tentar encontrar seção de detalhamento
  const secaoMatch = normalizado.match(/Detalhamento da Fatura[\s\S]*?(?=Resumo da Fatura|Saldo total|$)/i);
  const secao = secaoMatch ? secaoMatch[0] : normalizado;

  const detectarAdicionarFuturas = (parcela, desc, valor, categoria, baseData) => {
    if (!parcela || parcela.total <= parcela.atual) return;
    for (let p=1; p<=parcela.total-parcela.atual; p++) {
      futuras.push({
        user_id: USER_ID, tipo:'despesa', categoria, valor,
        descricao: desc + ' Parcela ' + (parcela.atual+p) + '/' + parcela.total,
        data: adicionarMesesPDF(baseData, p), fonte:'csv',
        parcela_atual: parcela.atual+p, parcela_total: parcela.total
      });
    }
  };

  const vistos = new Set();

  // PASS 1: regex linha por linha mais flexível
  // Santander formato: "(número) DD/MM DESCRICAO [PP/TT] VALOR"
  const linhas = secao.split('\n');
  for (let i=0; i<linhas.length; i++) {
    const linha = linhas[i].trim();

    // Pular linhas de cabeçalho/rodapé
    if (/^(Compra|Data|Descrição|Parcela|R\$|US\$|Parcelamentos|Despesas|VALOR TOTAL|Resumo)/i.test(linha)) continue;

    // Padrão principal: "3 08/04 RODOLFOS HAMBURGUERIA 26,00"
    // Ou: "3 13/04 MP *TECNODENT 01/02 250,00"
    let m = linha.match(/^(?:\d+\s+)?(\d{2}\/(\d{2}))\s+(.{3,80?})\s+(\d{1,3}[.,]\d{2})(?:\s+\d+[.,]\d{2})?\s*$/);
    if (!m) {
      // Tenta sem número no início
      m = linha.match(/^(\d{2}\/(\d{2}))\s+(.{3,80?})\s+(\d{1,3}[.,]\d{2})\s*$/);
    }
    if (!m) continue;

    const dataDM = m[1];
    const [d, mo] = dataDM.split('/');
    let descRaw = m[3].trim();
    const valorRaw = m[4];
    const valor = parseFloat(valorRaw.replace('.','').replace(',','.'));

    if (!valor || valor <= 0 || valor > 50000) continue;
    if (/pagamento|estorno|crédito|credito/i.test(descRaw)) { ignoradas++; continue; }

    // Extrair token de parcela do fim da descrição: "01/02"
    let parcelaTok = null;
    const parcelaMatch = descRaw.match(/(\d{1,2})\/(\d{1,2})\s*$/);
    if (parcelaMatch) {
      const [_, a, t] = parcelaMatch;
      if (parseInt(a)>=1 && parseInt(t)>=2 && parseInt(a)<=parseInt(t) && parseInt(t)<=120) {
        parcelaTok = { atual: parseInt(a), total: parseInt(t) };
        descRaw = descRaw.replace(parcelaMatch[0],'').trim();
      }
    }

    const parcela = parcelaTok || detectarParcelaPDF(descRaw);
    const descLimpa = descRaw.replace(/\b\d{1,2}\/\d{1,2}\b/,'').trim().replace(/\s+/g,' ').substring(0,100);
    const descFinal = descLimpa + (parcela ? ' Parcela '+parcela.atual+'/'+parcela.total : '');
    const key = dataDM+'|'+descLimpa.substring(0,25)+'|'+valor;
    if (vistos.has(key)) continue;
    vistos.add(key);

    const categoria = detectarCatPDF(descLimpa);
    const baseData = vencimento || `${anoAtual}-${mo}-${d}`;

    if (isPago) {
      detectarAdicionarFuturas(parcela, descLimpa, valor, categoria, baseData);
    } else {
      transacoes.push({ user_id:USER_ID, tipo:'despesa', categoria, valor, descricao:descFinal, data:baseData, fonte:'csv' });
      detectarAdicionarFuturas(parcela, descLimpa, valor, categoria, baseData);
    }
  }

  // PASS 2 fallback: extração por tokens se PASS 1 não pegou nada
  if (transacoes.length === 0 && futuras.length === 0) {
    const tokens = secao.replace(/\n/g,' ').split(/\s+/);
    let i=0;
    while (i<tokens.length) {
      const dt = tokens[i]?.match(/^(\d{2})\/(\d{2})$/);
      if (dt) {
        const [_,d,mo] = dt;
        const descTokens=[];
        let j=i+1, foundVal=false;
        while (j<tokens.length && j<i+18) {
          const v = tokens[j]?.match(/^(\d{1,3}[.,]\d{2})$/);
          if (v) {
            const valor=parseFloat(tokens[j].replace('.','').replace(',','.'));
            if (valor>0 && valor<50000) {
              const desc=descTokens.join(' ').trim().substring(0,100);
              if (desc.length>2 && !/pagamento|estorno/i.test(desc)) {
                const parcela=detectarParcelaPDF(desc);
                const categoria=detectarCatPDF(desc);
                const descL=desc.replace(/\b\d{1,2}\/\d{1,2}\b/,'').trim();
                const baseData=vencimento||`${anoAtual}-${mo}-${d}`;
                const key=d+'/'+mo+'|'+descL.substring(0,20)+'|'+valor;
                if (!vistos.has(key)) {
                  vistos.add(key);
                  if (isPago) { detectarAdicionarFuturas(parcela,descL,valor,categoria,baseData); }
                  else {
                    transacoes.push({user_id:USER_ID,tipo:'despesa',categoria,valor,
                      descricao:descL+(parcela?' Parcela '+parcela.atual+'/'+parcela.total:''),
                      data:baseData,fonte:'csv'});
                    detectarAdicionarFuturas(parcela,descL,valor,categoria,baseData);
                  }
                }
              }
              i=j+1; foundVal=true; break;
            }
          }
          descTokens.push(tokens[j]); j++;
        }
        if (!foundVal) i++;
      } else { i++; }
    }
  }

  return { transacoes, futuras, ignoradas };
}

function abrirModalVencimentoPDF() {
  const el = document.getElementById('pdf-venc-manual');
  if (el) el.value = new Date().toLocaleDateString('en-CA');
  document.getElementById('modal-vencimento-pdf').classList.add('open');
}

function fecharModalVencimentoPDF() {
  document.getElementById('modal-vencimento-pdf').classList.remove('open');
  _pdfResultadoPendente = null;
}

async function confirmarVencimentoPDF() {
  const venc = document.getElementById('pdf-venc-manual').value;
  if (!venc) { showToast('Informe a data de vencimento', 'error'); return; }
  if (!_pdfResultadoPendente) return;

  const hoje = new Date().toLocaleDateString('en-CA');
  const isPago = venc < hoje;
  const banco = _pdfResultadoPendente._banco;
  const text = _pdfResultadoPendente._text;
  const fileName = _pdfResultadoPendente._fileName;

  let parsed = { transacoes: [], futuras: [], ignoradas: 0 };
  if (banco === 'mercadopago') parsed = parsearMercadoPago(text, venc, isPago, hoje);
  else if (banco === 'santander') parsed = parsearSantander(text, venc, isPago, hoje);

  const totalDespesas = parsed.transacoes.reduce((s,t)=>s+t.valor, 0);
  const futurasPorMes = {};
  parsed.futuras.forEach(t => {
    const mes = t.data.substring(0,7);
    if (!futurasPorMes[mes]) futurasPorMes[mes] = { total:0, qtd:0 };
    futurasPorMes[mes].total += t.valor;
    futurasPorMes[mes].qtd++;
  });

  fecharModalVencimentoPDF();
  abrirPreviewCSV({ erro: false, fileName, banco: banco, vencimento: venc, isPago, transacoes: parsed.transacoes, futuras: parsed.futuras, totalDespesas, ignoradas: parsed.ignoradas, futurasPorMes });
}

document.addEventListener('click', e => {
  if (e.target.id === 'modal-vencimento-pdf') fecharModalVencimentoPDF();
});


// ══════════════════════════════════════════════════════════
// NAVEGAÇÃO DE ABAS
// ══════════════════════════════════════════════════════════
let _viewMes = null; // mês selecionado na navegação (null = mês atual)
let _viewMesOffset = 0; // offset em relação ao mês atual

// ══════════════════════════════════════════════════════════
// CALENDÁRIO — DIA ESPECÍFICO
// ══════════════════════════════════════════════════════════
function abrirCalendarioDia() {
  let modal = document.getElementById('modal-cal-dia');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-cal-dia';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:450;background:rgba(0,0,0,0.82);align-items:center;justify-content:center;padding:16px';
    modal.onclick = e => { if(e.target===modal) fecharCalendarioDia(); };
    document.body.appendChild(modal);
  }
  // Collect all days that have transactions
  const diasComTx = new Set(allTx.map(t => t.data));
  const hoje = new Date();
  const ano = hoje.getFullYear();

  // Build 12-month calendar grid
  const meses = [];
  for (let m = 0; m < 12; m++) {
    const nomeMes = MONTHS_FULL[m];
    const diasNoMes = new Date(ano, m+1, 0).getDate();
    const primeiroDia = new Date(ano, m, 1).getDay();
    let cells = '';
    for (let d = 0; d < primeiroDia; d++) cells += '<div></div>';
    for (let d = 1; d <= diasNoMes; d++) {
      const key = `${ano}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const temTx = diasComTx.has(key);
      const isHoje = key === hoje.toISOString().split('T')[0];
      cells += `<div onclick="${temTx ? `selecionarDia('${key}')` : ''}"
        style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:0.72rem;
        ${temTx ? 'background:rgba(24,24,27,0.2);color:var(--purple-light);cursor:pointer;font-weight:700;border:1px solid rgba(24,24,27,0.35)' : 'color:var(--muted2)'}
        ${isHoje ? ';box-shadow:0 0 0 2px var(--amber)' : ''}"
        title="${temTx ? key + ': clique para ver' : ''}">${d}</div>`;
    }
    meses.push(`<div style="margin-bottom:16px">
      <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">${nomeMes}</div>
      <div style="display:grid;grid-template-columns:repeat(7,28px);gap:2px">${cells}</div>
    </div>`);
  }

  modal.innerHTML = `<div style="background:var(--card);border-radius:20px;padding:24px;width:100%;max-width:520px;max-height:85vh;overflow-y:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div>
        <div style="font-family:var(--font-head);font-size:1.1rem;font-weight:800">📅 Escolha um dia</div>
        <div style="font-size:0.72rem;color:var(--muted);margin-top:2px">Dias <span style="color:var(--purple-light)">roxos</span> têm registros</div>
      </div>
      <button onclick="fecharCalendarioDia()" style="background:var(--card2);border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:5px 12px;cursor:pointer">✕</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">${meses.join('')}</div>
  </div>`;
  modal.style.display = 'flex';
}

function fecharCalendarioDia() {
  const m = document.getElementById('modal-cal-dia');
  if (m) m.style.display = 'none';
}

function selecionarDia(dataISO) {
  fecharCalendarioDia();
  _txPeriodo = dataISO; // use full date as period
  // Highlight the dia button
  document.querySelectorAll('.tx-periodo-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('txp-dia');
  if (btn) {
    const [yr, mo, dy] = dataISO.split('-');
    btn.textContent = `📅 ${dy}/${mo}/${yr}`;
    btn.classList.add('active');
    btn.style.background = 'var(--purple-dim)';
    btn.style.color = 'var(--purple-light)';
    btn.style.borderColor = 'rgba(24,24,27,0.35)';
    btn.style.borderStyle = 'solid';
  }
  renderTransacoes(allTx, userData);
}

// ══════════════════════════════════════════════════════════
// FATURAS ATUAIS NO EXTRATO
// ══════════════════════════════════════════════════════════

function renderFaturasHome() {
  const card = document.getElementById('home-faturas-card');
  const list = document.getElementById('home-faturas-list');
  const sub  = document.getElementById('home-faturas-sub');
  if (!card || !list) return;

  const hoje       = today();
  const inicioMes  = monthStart();
  const fimMes     = hoje.substring(0, 7) + '-31';
  const fatMes     = (allFaturas || []).filter(f => f.data_venc >= inicioMes && f.data_venc <= fimMes);

  if (!fatMes.length) { card.style.display = 'none'; return; }

  card.style.display = 'block';
  const total = fatMes.reduce((s, f) => s + (+f.valor || 0), 0);
  if (sub) sub.textContent = `${fatMes.length} parcela${fatMes.length > 1 ? 's' : ''} · Total: ${BRL(total)}`;

  const top = fatMes.slice(0, 4);
  list.innerHTML = top.map(f => {
    const emoji = emojiFor(f.categoria || f.descricao || '');
    const vencido = f.data_venc < hoje;
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:9px">
        <span style="font-size:1rem">${emoji}</span>
        <div>
          <div style="font-size:0.82rem;font-weight:600;color:var(--text)">${f.descricao || 'Fatura'}</div>
          <div style="font-size:0.65rem;color:${vencido ? 'var(--red)' : 'var(--muted)'}">
            ${f.categoria || 'outros'} · Venc: ${fmtDate(f.data_venc)}${vencido ? ' ⚠️' : ''}
          </div>
        </div>
      </div>
      <div style="color:var(--amber);font-weight:700;font-family:var(--font-head);font-size:0.85rem;white-space:nowrap">${BRL(f.valor)}</div>
    </div>`;
  }).join('');

  if (fatMes.length > 4) {
    list.innerHTML += `<div style="text-align:center;padding:8px 0;font-size:0.72rem;color:var(--muted)">+ ${fatMes.length - 4} parcelas</div>`;
  }
}

function renderFaturasNoExtrato() {
  const el = document.getElementById('faturas-extrato-list');
  const sec = document.getElementById('faturas-extrato-section');
  if (!el || !sec) return;

  const hoje = today();
  const inicioMes = monthStart();
  // Show faturas that are due THIS month
  const faturasMes = (allFaturas || []).filter(f => f.data_venc >= inicioMes && f.data_venc <= hoje.substring(0,7) + '-31');

  if (!faturasMes.length) { sec.style.display = 'none'; return; }
  sec.style.display = 'block';

  const totalFat = faturasMes.reduce((s,f)=>s+(+f.valor),0);
  const topFat = faturasMes.slice(0,3);

  el.innerHTML = topFat.map(f => {
    const banco = detectarBanco(f.cartao||'Cartão');
    const emoji = emojiFor(f.categoria||f.descricao||'');
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:1rem">${emoji}</span>
        <div>
          <div style="font-size:0.8rem;color:var(--text);font-weight:600">${f.descricao||'Fatura'}</div>
          <div style="font-size:0.65rem;color:var(--muted)">${banco.emoji} ${banco.nome} · Venc: ${fmtDate(f.data_venc)}</div>
        </div>
      </div>
      <div style="color:var(--amber);font-weight:700;font-family:var(--font-head);font-size:0.85rem">${BRL(f.valor)}</div>
    </div>`;
  }).join('');

  if (faturasMes.length > 3) {
    el.innerHTML += `<div style="text-align:center;padding:8px 0;font-size:0.72rem;color:var(--muted)">
      + ${faturasMes.length - 3} parcelas · Total: <strong style="color:var(--text)">${BRL(totalFat)}</strong>
    </div>`;
  }
}

// Dimensiona a aba da IA usando o tamanho REAL do container de scroll.
function _ajustarAlturaChatIA(tabEl) {
  const el = tabEl || document.getElementById('tab-ia');
  if (!el) return;

  // NAO usar a altura do #app-main: ela e calc(100dvh - 62px), e o nav
  // deste aparelho mede MAIS que 62px (declara height:62px mas tem
  // padding de safe-area por dentro e o conteudo nao encolhe, entao
  // estoura). O app-main ja termina por baixo do nav, e qualquer filho
  // herda o erro. Aqui medimos a geometria de verdade.
  const hdr = document.getElementById('app-header');
  const nav = document.getElementById('app-nav');

  const vh    = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  const topo  = (hdr && hdr.offsetParent !== null) ? hdr.getBoundingClientRect().bottom : 0;
  const navH  = (nav && nav.offsetParent !== null) ? nav.getBoundingClientRect().height : 0;
  const altura = Math.max(240, vh - topo - navH);

  // Ancorado na viewport e escrito inline: nenhuma regra de CSS compete.
  el.style.position      = 'fixed';
  el.style.top           = topo + 'px';
  el.style.left          = '0';
  el.style.right         = '0';
  el.style.bottom        = 'auto';
  el.style.height        = altura + 'px';
  el.style.display       = 'flex';
  el.style.flexDirection = 'column';
  el.style.overflow      = 'hidden';
  el.style.padding       = '0';
  el.style.margin        = '0';
  el.style.zIndex        = '90';   // abaixo do nav (100) e do header
}

// O teclado do Android encolhe a viewport: recalcula para o campo de
// texto continuar visivel.
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    const ia = document.getElementById('tab-ia');
    if (ia && ia.classList.contains('active')) _ajustarAlturaChatIA(ia);
  });
}
window.addEventListener('orientationchange', () => {
  const ia = document.getElementById('tab-ia');
  if (ia && ia.classList.contains('active')) setTimeout(() => _ajustarAlturaChatIA(ia), 250);
});

function switchTab(tab) {
  // Mapear aliases
  if (tab === 'extrato') tab = 'transacoes';


  // Reset visual dos botões de sub-tab
  ['ativos','rendimentos','metas_inv'].forEach(t => {
    const btn = document.getElementById('pat-tab-' + t);
    if (!btn) return;
    btn.style.background = t==='ativos' ? 'var(--text)' : 'var(--card2)';
    btn.style.color      = t==='ativos' ? 'var(--bg)'   : 'var(--muted)';
    btn.style.border     = '1px solid ' + (t==='ativos' ? 'transparent' : 'var(--border)');
  });


  // Mapear aliases
  if (tab === 'extrato') tab = 'transacoes';

  // Esconder todas as tabs — com display:none INLINE.
  // Antes aqui era el.style.display = '' ("deixa o CSS controlar"), e
  // bastava uma regra de ID no style.css ganhar por especificidade para
  // a aba nunca mais ser escondida — foi assim que a aba da IA passou a
  // aparecer por cima de Sonhos, Dívidas e A pagar ao mesmo tempo.
  // Estilo inline nao perde para especificidade nenhuma.
  document.querySelectorAll('.tab-view').forEach(el => {
    el.classList.remove('active');
    el.style.display = 'none';
  });
  // So a aba da IA recebe estilos inline de layout — limpar as 11
  // propriedades em TODAS as abas a cada troca custava ~120 operacoes
  // de estilo por clique, e so uma delas precisava.
  const _ia = document.getElementById('tab-ia');
  if (_ia && _ia.style.position) {
    ['height','position','top','left','right','bottom','overflow',
     'padding','margin','z-index','flex-direction'].forEach(p => _ia.style.removeProperty(p));
  }

  const tabEl = document.getElementById('tab-' + tab);
  if (!tabEl) { console.warn('[Lumnis] Tab não encontrada:', tab); return; }
  tabEl.classList.add('active');

  if (tab === 'ia') {
    requestAnimationFrame(() => _ajustarAlturaChatIA(tabEl));
    // O chat precisa de altura FIXA para o campo de texto ficar colado
    // embaixo. Calculada aqui a partir do tamanho real do #app-main,
    // porque cravar pixel no CSS falhou em todo aparelho.
    _ajustarAlturaChatIA(tabEl);
  } else {
    tabEl.style.display = 'block';
  }

  // Garantir que elementos com opacity:0 inline sejam visíveis
  tabEl.querySelectorAll('[style*="opacity:0"], [style*="opacity: 0"]').forEach(el => {
    el.style.opacity = '1';
  });
  // Garantir que app-main está visível
  const appMain = document.getElementById('app-main');
  if (appMain) appMain.style.display = 'block';

  // Atualizar nav mobile
  // conteudo da aba ja existe: revela imediatamente em vez de esperar
  // o IntersectionObserver, que fazia a troca de aba parecer lenta
  if (typeof _rvRevelarJa === 'function') _rvRevelarJa(tabEl);

  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  const mobileBtn = document.getElementById('nav-' + tab);
  if (mobileBtn) mobileBtn.classList.add('active');

  // Atualizar nav desktop
  document.querySelectorAll('.desk-nav-btn').forEach(btn => btn.classList.remove('active'));
  const deskBtn = document.getElementById('desk-nav-' + tab);
  if (deskBtn) deskBtn.classList.add('active');

  // Re-renderizar conteúdo de cada aba ao abrir
  try {
    if (tab === 'home' && userData) {
      renderHome(userData, userData);
    }
    if (tab === 'transacoes' && userData) {
      renderTransacoes(allTx, userData);
      updateEmpResumHome();
      renderFaturasNoExtrato();
    }
    if (tab === 'faturas') {
      renderFaturas(allFaturas);
    }
    if (tab === 'contas') {
      renderContas();
    }
    if (tab === 'apagar') {
      _safeRender('a-pagar', renderAPagar);
    }

    if (tab === 'reserva' && userData) {
      renderReservaView(userData);
      setTimeout(() => {
        ['res-valor-deposito','res-valor-meta'].forEach(id => {
          const el = document.getElementById(id); if (el) _mascaraMoeda(el);
        });
      }, 100);
    }
    if (tab === 'emprestimos') {
      loadEmprestimos();
      updateEmpResumHome();
      renderEmprestimosView();
      setTimeout(() => {
        ['emp-valor','emp-valor-combinado'].forEach(id => {
          const el = document.getElementById(id); if (el) _mascaraMoeda(el);
        });
      }, 100);
    }
    if (tab === 'perfil' && userData) {
      // Deixa a aba aparecer neste frame e monta as listas no proximo:
      // renderPerfil faz renderCatEditList + renderSonhosPerfil de uma
      // vez so, e isso segurava a pintura.
      requestAnimationFrame(() => {
        try { renderPerfil(userData); } catch(e) { console.error('[Lumnis] perfil:', e); }
      });
    }
    if (tab === 'sonhos' && userData) {
      _renderMapaSonhos(userData);
    }
    if (tab === 'ia' && userData) {
      _initIA();
    }
    if (tab === 'suporte' && userData) {
      _initSuporte();
    }
  } catch(e) {
    console.error('[Lumnis] Erro ao renderizar aba', tab, e);
  }

  // Scroll do container (container approach) ao invés de window
  const _appMain = document.getElementById('app-main');
  // 'smooth' animava o scroll ao mesmo tempo que a aba nova calculava
  // layout — as duas coisas disputando o mesmo frame davam travada.
  if (_appMain) _appMain.scrollTop = 0;

  // Ocultar FAB e gerenciar barra da IA
  const _fab = document.getElementById('add-tx-btn');
  const _fabMenu = document.getElementById('fab-menu-overlay');
  if (_fab) _fab.style.display = tab === 'ia' ? 'none' : '';
  if (_fabMenu) { _fabMenu.style.display = 'none'; }
  // ia-active: ativa flex-column layout no main quando IA está aberta
  if (_appMain) {
    if (tab === 'ia') {
    requestAnimationFrame(() => _ajustarAlturaChatIA(tabEl)); _appMain.classList.add('ia-active'); }
    else { _appMain.classList.remove('ia-active'); }
  }

}

// ══════════════════════════════════════════════════════════
// MAPA DOS SONHOS
// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// MAPA DOS SONHOS — Mural visual com CRUD inline
// ══════════════════════════════════════════════════════════
async function _salvarSonhos(novaLista) {
  try {
    await sb.from('usuarios').update({ sonhos: novaLista }).eq('id', USER_ID);
    userData.sonhos = novaLista;
    _renderMapaSonhos(userData);
    // mantem o mapa mental da Home em sincronia
    if (typeof renderMapaSonhos === 'function') renderMapaSonhos();
    showToast('✅ Sonhos salvos!', 'success');
  } catch(e) { showToast('Erro ao salvar: ' + (e.message||e), 'error'); }
}

function _abrirModalSonho(idx) {
  const sonhos = Array.isArray(userData?.sonhos) ? [...userData.sonhos] : [];
  const s = idx >= 0 ? sonhos[idx] : {};
  const isEdit = idx >= 0;

  let modal = document.getElementById('_modal-sonho');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = '_modal-sonho';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:600;background:rgba(0,0,0,0.85);align-items:flex-end;justify-content:center;padding:0';
    modal.onclick = e => { if(e.target===modal) modal.style.display='none'; };
    document.body.appendChild(modal);
  }

  modal.innerHTML = `<div style="background:var(--card);border-radius:22px 22px 0 0;padding:24px;width:100%;max-width:540px;max-height:90vh;overflow-y:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <div style="font-family:var(--font-head);font-size:1rem;font-weight:800">${isEdit?'✏️ Editar':'✨ Novo'} Sonho</div>
      <button onclick="document.getElementById('_modal-sonho').style.display='none'" style="background:var(--card2);border:1px solid var(--border2);color:var(--muted);border-radius:8px;padding:4px 10px;cursor:pointer">✕</button>
    </div>

    <div style="display:grid;grid-template-columns:64px 1fr;gap:10px;margin-bottom:14px">
      <div>
        <label style="font-size:0.72rem;color:var(--muted);display:block;margin-bottom:4px">Emoji</label>
        <input id="_sonho-emoji" value="${s.emoji||'🌟'}" maxlength="2"
          style="width:100%;background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:10px;font-size:1.4rem;text-align:center;font-family:var(--font-body)"/>
      </div>
      <div>
        <label style="font-size:0.72rem;color:var(--muted);display:block;margin-bottom:4px">Título *</label>
        <input id="_sonho-titulo" value="${s.titulo||''}" placeholder="Ex: Casa no litoral 🏖️"
          style="width:100%;background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:10px;font-size:0.88rem;font-family:var(--font-body);box-sizing:border-box"/>
      </div>
    </div>

    <div style="margin-bottom:14px">
      <label style="font-size:0.72rem;color:var(--muted);display:block;margin-bottom:4px">Descrição / Motivação</label>
      <textarea id="_sonho-desc" rows="2" placeholder="Por que esse sonho importa para você?"
        style="width:100%;background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:10px;font-size:0.85rem;font-family:var(--font-body);resize:vertical;box-sizing:border-box">${s.descricao||''}</textarea>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div>
        <label style="font-size:0.72rem;color:var(--muted);display:block;margin-bottom:4px">Valor alvo (R$)</label>
        <input id="_sonho-valor" type="text" inputmode="decimal" value="${s.valor_alvo ? (+s.valor_alvo).toLocaleString('pt-BR',{minimumFractionDigits:2}) : ''}" placeholder="0,00"
          style="width:100%;background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:10px;font-size:0.88rem;font-family:var(--font-body);box-sizing:border-box"/>
      </div>
      <div>
        <label style="font-size:0.72rem;color:var(--muted);display:block;margin-bottom:4px">Prazo</label>
        <input id="_sonho-prazo" type="date" value="${s.prazo||''}"
          style="width:100%;background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:10px;font-size:0.85rem;font-family:var(--font-body);box-sizing:border-box"/>
      </div>
    </div>

    <div style="margin-bottom:20px">
      <label style="font-size:0.72rem;color:var(--muted);display:block;margin-bottom:4px">🖼️ Imagem do sonho (URL)</label>
      <input id="_sonho-img" type="url" value="${s.imagem_url||''}" placeholder="https://images.unsplash.com/..."
        oninput="_previewSonhoImg(this.value)"
        style="width:100%;background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:10px;font-size:0.82rem;font-family:var(--font-body);box-sizing:border-box;margin-bottom:8px"/>
      <div id="_sonho-img-preview" style="${s.imagem_url?'':'display:none'}">
        <img id="_sonho-img-thumb" src="${s.imagem_url||''}" style="width:100%;max-height:160px;object-fit:cover;border-radius:10px;border:1px solid var(--border2)"/>
      </div>
      <div style="font-size:0.65rem;color:var(--muted);margin-top:4px">Dica: copie o link de uma imagem do Unsplash, Pinterest ou qualquer site</div>
    </div>

    <div style="display:flex;gap:10px">
      ${isEdit ? `<button onclick="_deletarSonho(${idx})" style="background:rgba(255,110,132,0.1);border:1px solid rgba(255,110,132,0.3);color:var(--red);border-radius:12px;padding:12px 16px;cursor:pointer;font-size:0.82rem;font-family:var(--font-body)">🗑 Excluir</button>` : ''}
      <button onclick="_confirmarSonho(${idx})" style="flex:1;background:var(--purple);border:none;color:#fff;border-radius:12px;padding:13px;font-size:0.88rem;font-weight:700;cursor:pointer;font-family:var(--font-body)">${isEdit?'💾 Salvar':'✨ Adicionar ao mural'}</button>
    </div>
  </div>`;

  modal.style.display = 'flex';
  // Aplica máscara no valor
  const valEl = document.getElementById('_sonho-valor');
  if (valEl) _mascaraMoeda(valEl);
}

function _previewSonhoImg(url) {
  const pv = document.getElementById('_sonho-img-preview');
  const img = document.getElementById('_sonho-img-thumb');
  if (!pv || !img) return;
  if (url) { img.src = url; pv.style.display = 'block'; }
  else { pv.style.display = 'none'; }
}

async function _confirmarSonho(idx) {
  const titulo = document.getElementById('_sonho-titulo')?.value?.trim();
  if (!titulo) { showToast('Preencha o título', 'error'); return; }

  const novoSonho = {
    id: idx >= 0 ? (userData.sonhos[idx]?.id || Date.now().toString()) : Date.now().toString(),
    emoji: document.getElementById('_sonho-emoji')?.value?.trim() || '🌟',
    titulo,
    texto: titulo,        // compatibilidade n8n (CMD Perfil lê s.texto)
    descricao: document.getElementById('_sonho-desc')?.value?.trim() || '',
    valor_alvo: _getNumVal('_sonho-valor') || 0,
    prazo: document.getElementById('_sonho-prazo')?.value || '',
    imagem_url: document.getElementById('_sonho-img')?.value?.trim() || '',
    realizado: idx >= 0 ? (userData.sonhos[idx]?.realizado || false) : false,
    criado_em: idx >= 0 ? (userData.sonhos[idx]?.criado_em || today()) : today()
  };

  const lista = Array.isArray(userData?.sonhos) ? [...userData.sonhos] : [];
  if (idx >= 0) lista[idx] = novoSonho;
  else lista.push(novoSonho);

  document.getElementById('_modal-sonho').style.display = 'none';
  await _salvarSonhos(lista);
}

async function _deletarSonho(idx) {
  const lista = Array.isArray(userData?.sonhos) ? [...userData.sonhos] : [];
  lista.splice(idx, 1);
  document.getElementById('_modal-sonho').style.display = 'none';
  await _salvarSonhos(lista);
}

function _renderMapaSonhos(user) {
  const el = document.getElementById('sonhos-map-content');
  if (!el) return;
  const sonhos = Array.isArray(user?.sonhos) ? user.sonhos : [];
  const guardado = +(userData?.reserva_atual || 0);

  const cardVazio = `<div onclick="_abrirModalSonho(-1)" style="cursor:pointer;border:2px dashed var(--border2);border-radius:18px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 20px;gap:10px;transition:border-color 0.2s" onmouseover="this.style.borderColor='var(--purple-light)'" onmouseout="this.style.borderColor='var(--border2)')">
    <div style="font-size:2rem">✨</div>
    <div style="font-size:0.82rem;font-weight:700;color:var(--muted)">Adicionar sonho</div>
  </div>`;

  const cards = sonhos.map((s, i) => {
    const meta = +s.valor_alvo || 0;
    const progresso = meta > 0 ? Math.min(100, Math.round((guardado / meta) * 100)) : 0;
    const col = progresso >= 100 ? '#9bffce' : progresso >= 50 ? '#fcd34d' : '#a78bfa';
    const falta = meta > 0 && guardado < meta ? meta - guardado : 0;
    const temImagem = !!s.imagem_url;

    return `<div style="position:relative;border-radius:18px;overflow:hidden;border:1px solid var(--border2);background:var(--card);cursor:pointer" onclick="_abrirModalSonho(${i})">
      ${temImagem ? `
        <div style="height:160px;background:url('${s.imagem_url}') center/cover no-repeat;position:relative">
          <div style="position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,0.1),rgba(0,0,0,0.7))"></div>
          <div style="position:absolute;bottom:12px;left:14px;right:14px">
            <div style="font-size:1.1rem;font-weight:800;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.5)">${s.emoji||'🌟'} ${s.titulo||s.nome||s.name||s.texto||''}</div>
          </div>
        </div>
        <div style="padding:14px">
      ` : `
        <div style="padding:20px 16px 8px">
          <div style="font-size:2rem;margin-bottom:6px">${s.emoji||'🌟'}</div>
          <div style="font-size:0.95rem;font-weight:800;color:var(--text);margin-bottom:4px">${s.titulo||s.nome||s.name||s.texto||s.descricao||'Sonho '+(i+1)}</div>
        </div>
        <div style="padding:0 16px 14px">
      `}
        ${s.descricao ? `<div style="font-size:0.75rem;color:var(--muted);margin-bottom:10px;line-height:1.5;${temImagem?'':''}">${s.descricao.length>80?s.descricao.substring(0,80)+'...':s.descricao}</div>` : ''}
        ${s.prazo ? `<div style="font-size:0.68rem;color:var(--muted);margin-bottom:8px">📅 ${fmtDate(s.prazo)}</div>` : ''}
        ${meta > 0 ? `
          <div style="display:flex;justify-content:space-between;font-size:0.68rem;color:var(--muted);margin-bottom:5px">
            <span>Progresso</span>
            <span style="color:${col};font-weight:700">${progresso}%</span>
          </div>
          <div style="background:var(--card2);border-radius:20px;height:5px;overflow:hidden;margin-bottom:5px">
            <div style="width:${progresso}%;background:${col};height:100%;border-radius:20px"></div>
          </div>
          <div style="font-size:0.65rem;color:var(--muted)">${progresso>=100?'🎉 Meta alcançada!':'Faltam '+BRL(falta)}</div>
        ` : ''}
      </div>
    </div>`;
  });

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div style="font-size:0.75rem;color:var(--muted)">${sonhos.length} sonho${sonhos.length!==1?'s':''} no mural</div>
      <button onclick="_abrirModalSonho(-1)" style="background:var(--purple);border:none;color:#fff;border-radius:20px;padding:7px 16px;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:var(--font-body)">+ Novo sonho</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px">
      ${cards.join('')}
      ${cardVazio}
    </div>
    ${guardado > 0 ? `<div style="margin-top:16px;font-size:0.72rem;color:var(--muted);text-align:center">Base de progresso: reserva atual ${BRL(guardado)}</div>` : ''}`;
}

// ══════════════════════════════════════════════════════════
// IA LUMNIS — Proxy seguro via n8n (chave fica no servidor)
// ══════════════════════════════════════════════════════════
const _IA_WEBHOOK_URL = 'https://n8n.nexusrugido.com/webhook/lumnis-ia-dashboard';
const _GROQ_MODEL = 'llama-3.1-8b-instant';
const _GROQ_MAX_HISTORY = 6;

let _iaChatHistory = [];
let _iaIniciada = false;

function _initIA() {
  const box = document.getElementById('ia-chat-box');
  if (!box) return;
  if (_iaIniciada) return;
  _iaIniciada = true;

  // Busca uso de hoje para mostrar contador
  _atualizarContadorIA();

  // Mensagem de boas-vindas
  // Boas-vindas adaptadas ao Modo Receita
  const _modoRec = !!(typeof userData !== 'undefined' && userData?.modo_receita);
  const _welcomeMsg = _modoRec
    ? 'Oi! Tenho acesso aos seus números. Experimente:\n\n• "Como estou em relação à minha meta?"\n• "Quais faturas vencem em breve?"\n• "Onde posso economizar este mês?"\n• "Quanto gasto em assinaturas?"'
    : 'Oi! Tenho acesso aos seus números. Experimente:\n\n• "Estou dentro do meu limite?"\n• "Quais faturas vencem em breve?"\n• "Quais assinaturas posso cortar?"\n• "Onde posso cortar gastos?"';
  _addIAMsgUI('assistant', _welcomeMsg);
}

async function _atualizarContadorIA() {
  const el = document.getElementById('ia-contador');
  if (!el || !USER_ID) return;
  try {
    const hoje = today();
    const res = await sb.from('eventos').select('id', { count: 'exact', head: true })
      .eq('user_id', USER_ID).eq('tipo', 'ia_dashboard').gte('created_at', hoje + 'T00:00:00');
    const usado = res.count || 0;
    const restam = Math.max(0, 10 - usado);
    el.textContent = usado + '/10';
    el.style.color = usado >= 12 ? 'var(--amber)' : usado >= 15 ? 'var(--red)' : 'var(--muted)';

    // Bloqueia input se chegou no limite
    if (usado >= 15) _bloquearChatIA();
  } catch(e) { /* silencioso */ }
}

function _getContextoFinanceiro() {
  // Contexto compacto — minimiza tokens sem perder informação essencial
  const mes = today().substring(0,7);
  const gD = (allTx||[]).filter(t=>t.tipo==='despesa'&&(t.data||'').startsWith(mes)).reduce((s,t)=>s+(+t.valor),0);
  const gF = (allFaturas||[]).filter(f=>(f.data_venc||'').startsWith(mes)).reduce((s,f)=>s+(+f.valor),0);
  const rec = (allTx||[]).filter(t=>t.tipo==='receita'&&(t.data||'').startsWith(mes)).reduce((s,t)=>s+(+t.valor),0);
  const assinAtivas = (allAssinaturas||[]).filter(a=>a.ativa!==false);
  const custoAssin  = assinAtivas.reduce((s,a)=>s+(+a.valor||0),0);
  const assinDet    = assinAtivas.slice(0,8).map(a=>`${a.nome} ${BRL(+a.valor||0)}/mês (dia ${a.dia_cobranca})`).join(' | ') || 'nenhuma';
  const contasAbertas = (allContas||[]).filter(c=>!c.paga);
  const totalContas = contasAbertas.reduce((s,c)=>s+(+c.valor||0),0);
  const reserva = +(userData?.reserva_atual||0);
  const meta = userData?.meta_mensal||userData?.meta_gastos_mensal||0;
  const sonhos = (Array.isArray(userData?.sonhos)?userData.sonhos:[]).map(s=>s.titulo).join(', ')||'nenhum';
  const modoRec = !!(userData?.modo_receita);
  const instrucaoModo = modoRec
    ? 'Modo Receita ATIVADO: analise receitas, saldo e fluxo de caixa normalmente.'
    : 'Modo Receita DESATIVADO: o usuário optou por não registrar receitas. NUNCA alerte sobre receita zero, saldo negativo ou falta de renda. Foque EXCLUSIVAMENTE em: controle de limite de gastos, qualidade das despesas, assinaturas desperdiçadas e contas a vencer.';
  return `Usuário: ${userData?.nome||'?'} | Mês: ${mes} | Renda: ${modoRec?BRL(userData?.renda_mensal||0):'não rastreada'} | Meta gastos: ${BRL(meta)} | Gastos diretos: ${BRL(gD)} | Faturas: ${BRL(gF)} | Total gasto: ${BRL(gD+gF)} | Receita: ${modoRec?BRL(rec):'não rastreada'} | Saldo: ${modoRec?BRL(rec-(gD+gF)):'não calculado'} | Reserva de emergência: ${BRL(reserva)} | Assinaturas: ${BRL(custoAssin)}/mês (${assinDet}) | Contas em aberto: ${BRL(totalContas)} | Streak: ${userData?.dias_consecutivos||0}d | Sonhos: ${sonhos} | INSTRUÇÃO DE MODO: ${instrucaoModo}`;
}

function _addIAMsgUI(role, text) {
  const box = document.getElementById('ia-chat-box');
  if (!box) return;
  const isUser = role === 'user';
  const div = document.createElement('div');
  div.style.cssText = `display:flex;${isUser?'justify-content:flex-end':'justify-content:flex-start'};animation:fadeIn 0.3s ease`;
  const bubble = document.createElement('div');
  bubble.style.cssText = `max-width:82%;padding:12px 16px;border-radius:${isUser?'18px 18px 4px 18px':'18px 18px 18px 4px'};font-size:0.85rem;line-height:1.6;${isUser?'background:var(--purple);color:var(--bg)':'background:var(--card2);color:var(--text);border:1px solid var(--border2)'}`;
  // suporte a markdown básico (negrito)
  bubble.innerHTML = text.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
  div.appendChild(bubble);
  box.appendChild(div);
  requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
}

function _bloquearChatIA() {
  const input  = document.getElementById('ia-input');
  const btn    = document.querySelector('#ia-input-bar button');
  const caixa  = document.getElementById('ia-chat-box');
  if (input) { input.disabled = true; input.placeholder = '🔒 Limite diário atingido — renova amanhã'; }
  if (btn)   { btn.disabled = true; btn.style.opacity = '0.4'; }
  const el = document.getElementById('ia-contador');
  if (el)    { el.textContent = '10 / 10 hoje 🔒'; el.style.color = 'var(--red)'; }
  // Banner no chat
  if (caixa && !document.getElementById('ia-limite-banner')) {
    const div = document.createElement('div');
    div.id = 'ia-limite-banner';
    div.style.cssText = 'background:rgba(252,211,77,0.1);border:1px solid rgba(252,211,77,0.25);border-radius:14px;padding:14px 16px;font-size:0.82rem;color:var(--amber);line-height:1.6;margin-top:8px';
    div.innerHTML = '🔒 <strong>Limite diário atingido</strong> — você usou suas 15 mensagens de hoje com a IA Lumnis.<br><span style="font-size:0.75rem;color:var(--muted)">Os créditos renovam automaticamente à meia-noite. Até lá, registre seus gastos normalmente pelo WhatsApp! 💪</span>';
    caixa.appendChild(div);
    caixa.scrollTop = 99999;
  }
}

async function _enviarIAMsg() {
  const input = document.getElementById('ia-input');
  if (!input) return;
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  _addIAMsgUI('user', msg);
  _iaChatHistory.push({ role: 'user', content: msg });

  // Indicador de digitando
  const typingId = 'ia-typing-' + Date.now();
  const typingDiv = document.createElement('div');
  typingDiv.id = typingId;
  typingDiv.style.cssText = 'display:flex;justify-content:flex-start';
  typingDiv.innerHTML = `<div style="background:var(--card2);border:1px solid var(--border2);border-radius:18px;padding:12px 16px;font-size:0.82rem;color:var(--muted)">✦ pensando...</div>`;
  document.getElementById('ia-chat-box').appendChild(typingDiv);
  // Scroll para o fim do chat (flex-column approach)
  const _iaBox = document.getElementById('ia-chat-box');
  if (_iaBox) { requestAnimationFrame(() => { _iaBox.scrollTop = _iaBox.scrollHeight; }); }

  try {
    const historySlice = _iaChatHistory.slice(-_GROQ_MAX_HISTORY);
    const resp = await fetch(_IA_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: USER_ID,
        mensagem: msg,
        historico: historySlice,
        contexto: _getContextoFinanceiro()
      })
    });
    const data = await resp.json();
    const answer = data?.resposta || data?.message || data?.content || 'Não consegui processar.';
    document.getElementById(typingId)?.remove();

    // Se chegou no limite diário, bloqueia o chat
    if (data?.limite) { _bloquearChatIA(); }

    _iaChatHistory.push({ role: 'assistant', content: answer });
    _addIAMsgUI('assistant', answer);
    _atualizarContadorIA(); // atualiza contador após cada msg
  } catch(e) {
    document.getElementById(typingId)?.remove();
    _addIAMsgUI('assistant', '❌ Erro de conexão. Verifique sua internet e tente novamente.');
  }
}

// ══════════════════════════════════════════════════════════
// SUPORTE — tickets salvos em eventos + WhatsApp
// ══════════════════════════════════════════════════════════
// WhatsApp removido — suporte via webhook n8n

async function _initSuporte() {
  // Configura link WhatsApp com contexto do usuário
  const waLink = document.getElementById('sup-wa-link');
  if (waLink) {
    // WhatsApp removido
  }
  // Carrega chamados anteriores
  await _carregarChamados();
}

async function _carregarChamados() {
  const el = document.getElementById('sup-chamados-inner');
  if (!el || !USER_ID) return;
  try {
    const { data } = await sb.from('eventos').select('*')
      .eq('user_id', USER_ID).eq('tipo', 'suporte')
      .order('created_at', { ascending: false }).limit(10);
    if (!data || !data.length) { el.textContent = 'Nenhum chamado enviado ainda.'; return; }
    el.innerHTML = data.map(e => {
      const p = e.payload || {};
      const statusColor = { aberto:'var(--amber)', respondido:'var(--green)', fechado:'var(--muted)' }[p.status||'aberto'] || 'var(--amber)';
      return `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;margin-bottom:2px">
          <span style="font-size:0.78rem;font-weight:700;color:var(--text)">${p.assunto||'Sem assunto'}</span>
          <span style="font-size:0.62rem;color:${statusColor};font-weight:700;text-transform:uppercase">${p.status||'aberto'}</span>
        </div>
        <div style="font-size:0.68rem;color:var(--muted)">${p.tipo||'outro'} · ${fmtDate(e.created_at?.split('T')[0]||today())}</div>
      </div>`;
    }).join('');
  } catch { el.textContent = 'Não foi possível carregar chamados.'; }
}

async function _enviarChamado() {
  const btn = document.getElementById('sup-btn');
  const tipo = document.getElementById('sup-tipo')?.value || 'outro';
  const assunto = document.getElementById('sup-assunto')?.value?.trim();
  const mensagem = document.getElementById('sup-mensagem')?.value?.trim();

  if (!assunto) { showToast('Preencha o assunto', 'error'); return; }
  if (!mensagem) { showToast('Descreva o problema', 'error'); return; }

  btn.disabled = true; btn.textContent = 'Enviando...';
  try {
    await sb.from('eventos').insert({
      user_id: USER_ID,
      tipo: 'suporte',
      payload: { tipo, assunto, mensagem, status: 'aberto', email: userData?.email||'' }
    });
    showToast('✅ Chamado enviado! Retornaremos em até 48h.', 'success');
    document.getElementById('sup-assunto').value = '';
    document.getElementById('sup-mensagem').value = '';
    await _carregarChamados();
  } catch(e) {
    showToast('Erro ao enviar: ' + (e.message||e), 'error');
  }
  btn.disabled = false; btn.textContent = 'Enviar chamado';
}

function goTo(tab) { switchTab(tab); }

// ══════════════════════════════════════════════════════════
// NAVEGAÇÃO DE MÊS
// ══════════════════════════════════════════════════════════
function changeMonth(dir) {
  _viewMesOffset += dir;
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + _viewMesOffset, 1);
  // MONTHS_FULL já declarado acima
  const label = MONTHS_FULL[d.getMonth()] + ' ' + d.getFullYear();

  document.getElementById('mes-nav-label').textContent = label;
  document.getElementById('mes-nav-sub').textContent = _viewMesOffset === 0 ? 'mês atual' : (_viewMesOffset < 0 ? 'mês anterior' : 'mês futuro');
  const _eml = document.getElementById('extrato-mes-label');
  if (_eml) { const _MS=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']; _eml.textContent = _MS[d.getMonth()]+'/'+String(d.getFullYear()).slice(2); }

  const nextBtn = document.getElementById('mes-nav-next');
  if (nextBtn) nextBtn.disabled = _viewMesOffset >= 0;

  // Calcular primeiro e último dia do mês selecionado
  const mStart = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
  const lastDay = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  const mEnd   = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

  const txMes = allTx.filter(t => t.data >= mStart && t.data <= mEnd);
  const gastos  = txMes.filter(t => t.tipo==='despesa').reduce((s,t)=>s+(+t.valor),0);
  const receita = txMes.filter(t => t.tipo==='receita').reduce((s,t)=>s+(+t.valor),0);
  const meta    = userData?.meta_mensal || userData?.meta_gastos_mensal || 2000;

  // FIX: incluir faturas do mês selecionado (igual ao renderHome)
  const meStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const _stFimMes = new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().split('T')[0];
  const totalFatNav = (window._todasFaturas||allFaturas||[])
    .filter(f => { const dv=f.data_venc||''; return dv>=meStr+'-01'&&dv<=_stFimMes; })
    .reduce((s,f)=>s+(+f.valor||0),0);
  const gastosTotal = gastos + totalFatNav;

  const pct = Math.min(100, Math.round((gastosTotal/meta)*100));
  const cor = pct>=90?'red':pct>=70?'amber':'purple';

  document.getElementById('kpi-gastos').textContent = BRL(gastosTotal);
  const kpiMetaSub = document.getElementById('kpi-meta-sub');
  if (kpiMetaSub) {
    kpiMetaSub.innerHTML = `de ${BRL(meta)} · ${pct}% usado${
      totalFatNav>0 ? '<br><span style="font-size:0.72rem;opacity:0.75">Direto: '+BRL(gastos)+' + Cartão: '+BRL(totalFatNav)+'</span>' : ''
    }`;
  }
  const bar = document.getElementById('bar-meta');
  if (bar) { bar.style.width = pct+'%'; bar.className = `progress-fill ${cor}`; }

  if (userData?.modo_receita) {
    const saldo = receita - gastosTotal;
    document.getElementById('kpi-receita').textContent = BRL(receita);
    document.getElementById('kpi-saldo').textContent = BRL(saldo);
    document.getElementById('kpi-saldo').style.color = saldo>=0?'var(--green)':'var(--red)';
  }

  renderCatLimitsHome(allCats, txMes);

  // Summary cards
  renderSummaryCards(txMes);
}

let _extratoMesOffset = 0;
function changeExtratoMes(dir) {
  _extratoMesOffset += dir;
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + _extratoMesOffset, 1);
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const MESES_FULL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const label = document.getElementById('extrato-mes-label');
  if (label) label.textContent = MESES_FULL[d.getMonth()];
  const nextBtn = document.getElementById('extrato-mes-next');
  if (nextBtn) nextBtn.disabled = _extratoMesOffset >= 0;
  // Atualiza botões de período
  document.querySelectorAll('.tx-periodo-btn').forEach(b => b.classList.remove('active'));
  setTxPeriodo(yr + '-' + mo);
}

function renderSummaryCards(txMes) {
  const el = document.getElementById('summary-cards');
  if (!el) return;
  const gastos = txMes.filter(t=>t.tipo==='despesa').reduce((s,t)=>s+(+t.valor),0);
  const receitas = txMes.filter(t=>t.tipo==='receita').reduce((s,t)=>s+(+t.valor),0);
  el.innerHTML = '';
}

// ══════════════════════════════════════════════════════════
// MODAL DE TRANSAÇÃO
// ══════════════════════════════════════════════════════════
function openTxModal() {
  const modal = document.getElementById('tx-modal');
  if (!modal) return;
  document.getElementById('tx-valor').value = '';
  document.getElementById('tx-descricao').value = '';
  document.getElementById('tx-data').value = today();
  setTxTipo('despesa');
  modal.style.display = 'flex';
}

function closeTxModal() {
  const modal = document.getElementById('tx-modal');
  if (modal) modal.style.display = 'none';
}

// Categorias de RECEITA. O select do modal so tinha categorias de
// despesa, entao registrar um salario caia em "Alimentação".
const CATS_RECEITA = [
  { v:'salario',      l:'💼 Salário' },
  { v:'freelance',    l:'💻 Freelance / PJ' },
  { v:'vendas',       l:'🛍️ Vendas' },
  { v:'aluguel',      l:'🏠 Aluguel recebido' },
  { v:'reembolso',    l:'↩️ Reembolso' },
  { v:'presente',     l:'🎁 Presente' },
  { v:'bonus',        l:'⭐ Bônus / 13º' },
  { v:'outros',       l:'📌 Outros' },
];

function _preencherCatsReceita(sel) {
  if (!sel) return;
  sel._catsDespesa = sel._catsDespesa || sel.innerHTML;
  sel.innerHTML = CATS_RECEITA.map(c => `<option value="${c.v}">${c.l}</option>`).join('');
  sel.value = 'salario';
}
function _restaurarCatsDespesa(sel) {
  if (!sel || !sel._catsDespesa) return;
  sel.innerHTML = sel._catsDespesa;
}

// Registrar receita sem o Modo Receita ligado deixaria o lancamento
// invisivel no app. Aqui oferecemos ligar na hora.
async function _pedirModoReceita() {
  const ok = await confirmar({
    emoji: '💰',
    titulo: 'Ligar o Modo Receita?',
    texto: 'Você está com o app no <strong>modo só gastos</strong>. Para registrar entradas de dinheiro e ver seu saldo mensal, preciso ligar o Modo Receita.',
    detalhe: 'Dá para desligar depois no Perfil, sem perder nada.',
    confirmar: 'Ligar agora', cancelar: 'Agora não'
  });
  if (!ok) return false;

  const { error } = await sb.from('usuarios').update({ modo_receita: true }).eq('id', USER_ID);
  if (error) { showToast('Não consegui ligar. Tente pelo Perfil.', 'error'); return false; }
  userData.modo_receita = true;
  showToast('💰 Modo Receita ligado!');
  if (typeof renderPerfil === 'function') _safeRender('perfil', () => renderPerfil(userData));
  if (typeof renderHome === 'function')   _safeRender('home', () => renderHome(userData));
  return true;
}

function setTxTipo(tipo) {
  const despBtn = document.getElementById('tx-tipo-despesa');
  const recBtn  = document.getElementById('tx-tipo-receita');
  const catSel  = document.getElementById('tx-categoria');
  if (!despBtn || !recBtn) return;

  if (tipo === 'despesa') {
    despBtn.style.cssText = 'flex:1;padding:10px;border-radius:10px;font-weight:700;font-size:0.88rem;cursor:pointer;transition:all 0.2s;background:rgba(255,110,132,0.2);border:1.5px solid var(--red);color:var(--red);font-family:var(--font-body)';
    recBtn.style.cssText  = 'flex:1;padding:10px;border-radius:10px;font-weight:700;font-size:0.88rem;cursor:pointer;transition:all 0.2s;background:var(--card2);border:1px solid var(--border);color:var(--muted);font-family:var(--font-body)';
    if (catSel) { catSel.style.display=''; _restaurarCatsDespesa(catSel); }
  } else {
    recBtn.style.cssText  = 'flex:1;padding:10px;border-radius:10px;font-weight:700;font-size:0.88rem;cursor:pointer;transition:all 0.2s;background:rgba(155,255,206,0.15);border:1.5px solid var(--green);color:var(--green);font-family:var(--font-body)';
    despBtn.style.cssText = 'flex:1;padding:10px;border-radius:10px;font-weight:700;font-size:0.88rem;cursor:pointer;transition:all 0.2s;background:var(--card2);border:1px solid var(--border);color:var(--muted);font-family:var(--font-body)';
    if (catSel) { catSel.style.display=''; _preencherCatsReceita(catSel); }
  }
  despBtn.dataset.active = tipo === 'despesa' ? '1' : '';
  recBtn.dataset.active  = tipo === 'receita' ? '1' : '';
}

// Chamado pelo botao "Receita" do modal
async function escolherTipoReceita() {
  if (!userData?.modo_receita) {
    const ligou = await _pedirModoReceita();
    if (!ligou) { setTxTipo('despesa'); return; }
  }
  setTxTipo('receita');
}

async function saveTx() {
  if (bloqueadoPorTrial()) return;
  if (!USER_ID) return;
  // BUG CRÍTICO CORRIGIDO: tx-valor tem máscara. Digitar 1500 gerava
  // .value = "1.500" e parseFloat devolvia 1. Toda transação acima de
  // R$999 era gravada com valor errado.
  const valor = _parseValorBR('tx-valor', 0);
  const descricao = document.getElementById('tx-descricao').value.trim();
  const data = document.getElementById('tx-data').value;
  const categoria = document.getElementById('tx-categoria').value;
  const despBtn = document.getElementById('tx-tipo-despesa');
  const tipo = despBtn?.dataset.active === '1' ? 'despesa' : 'receita';

  if (!valor || valor <= 0) { showToast('Informe um valor válido.', 'error'); return; }
  if (!descricao) { showToast('Informe uma descrição.', 'error'); return; }
  if (!data) { showToast('Informe a data.', 'error'); return; }

  const btn = document.getElementById('tx-save-btn');
  if (btn) { btn.textContent = 'Salvando...'; btn.disabled = true; }

  try {
    const { error } = await sb.from('transacoes').insert([{
      user_id: USER_ID, tipo, categoria: tipo === 'receita' ? 'receita' : categoria,
      valor, descricao, data
    }]);
    if (error) throw error;

    const { data: novas } = await sb.from('transacoes').select('*')
      .eq('user_id', USER_ID).order('data', { ascending: false }).limit(400);
    if (novas) { allTx = novas; renderTransacoes(allTx, userData); renderHome(userData, userData); }

    closeTxModal();
    showToast('✅ Transação registrada!', 'success');

    // Streak update via função centralizada (lógica de dia calendário)
    try { await atualizarStreak(); } catch(e) { /* ignora */ }

  } catch(e) {
    showToast('Erro ao salvar. Tente novamente.', 'error');
  } finally {
    if (btn) { btn.textContent = '✅ Salvar Transação'; btn.disabled = false; }
  }
}

// ══════════════════════════════════════════════════════════
// ESTADO GLOBAL — Assinaturas & Contas
// ══════════════════════════════════════════════════════════
let allAssinaturas = [];
let allContas      = [];

// Format numeric inputs to show friendly values (R$10.000,00)
function formatarInputMoeda(el) {
  if (!el) return;
  el.addEventListener('blur', () => {
    const val = parseFloat(el.value.replace(/[^0-9,\.]/g, '').replace(',', '.')) || 0;
    if (val > 0 && !el.readOnly) {
      el._rawValue = val;
      el.value = val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  });
  el.addEventListener('focus', () => {
    const raw = el._rawValue || parseFloat(el.value.replace(/\./g, '').replace(',', '.')) || '';
    if (raw) el.value = raw;
  });
}




// ══════════════════════════════════════════════════════════
// MODO LEITURA — faixa fixa + modal de upgrade
// ══════════════════════════════════════════════════════════
function renderFaixaLeitura() {
  let el = document.getElementById('faixa-leitura');
  if (!MODO_LEITURA) { if (el) el.remove(); document.body.classList.remove('tem-faixa'); return; }
  if (el) return;

  const eraTrial = (userData?.plano === 'trial');
  el = document.createElement('div');
  el.id = 'faixa-leitura';
  el.innerHTML = `
    <span class="fl-ico">🔒</span>
    <span class="fl-txt">${eraTrial ? 'Seu teste de 7 dias terminou' : 'Seu acesso expirou'} — modo somente leitura</span>
    <button class="fl-btn" onclick="abrirModalUpgrade()">Liberar</button>`;
  document.body.appendChild(el);
  document.body.classList.add('tem-faixa');
}

function abrirModalUpgrade() {
  let m = document.getElementById('modal-upgrade');
  if (!m) {
    m = document.createElement('div');
    m.id = 'modal-upgrade';
    m.className = 'modal-overlay';
    m.onclick = e => { if (e.target === m) m.style.display = 'none'; };
    document.body.appendChild(m);
  }
  const eraTrial = (userData?.plano === 'trial');
  m.innerHTML = `
    <div class="modal-box" style="text-align:center">
      <div style="font-size:2.2rem;margin-bottom:8px">🔓</div>
      <div class="modal-title" style="margin-bottom:8px">
        ${eraTrial ? 'Seu teste terminou' : 'Seu acesso expirou'}
      </div>
      <p style="font-size:0.85rem;color:var(--muted);line-height:1.55;margin-bottom:18px">
        Seus dados continuam aqui, inteiros. Você pode consultar tudo o que já
        registrou — só não dá para lançar coisas novas até renovar.
      </p>
      <a href="${linkAssinatura()}" target="_blank" rel="noopener"
         class="btn-primary" style="display:block;text-decoration:none;text-align:center;padding:13px;border-radius:11px">
        ${rotuloAssinatura()}
      </a>
      <button class="btn-ghost" style="width:100%;margin-top:9px"
        onclick="document.getElementById('modal-upgrade').style.display='none'">
        Continuar consultando
      </button>
      <div style="margin-top:14px;font-size:0.72rem;color:var(--muted2)">
        Já renovou? <button onclick="location.reload()" style="background:none;border:none;color:var(--purple-light);cursor:pointer;font-size:0.72rem;text-decoration:underline">Atualizar</button>
      </div>
    </div>`;
  m.style.display = 'flex';
}
