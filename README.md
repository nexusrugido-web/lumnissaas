# Lumnis v3 — Controle de Gastos

App de controle financeiro pessoal. PWA, sem build step, Supabase + n8n.

## Arquivos

```
index.html          shell, todas as abas e modais
style.css           todo o CSS (4 temas: lumnis, white, black, red)
01-core.js          config, auth, helpers, init, realtime
02-ui.js            home, extrato, faturas, categorias, dívidas, IA, sonhos
03-perfil.js        perfil, metas, temas, import CSV/PDF, lixeira
04-contas.js        mapa de calor, cards da home, contas, assinaturas
05-init.js          PWA, swipe, notificações, relatório mensal
sw.js               service worker (cache lumnis-v3)
```

Ordem dos scripts é obrigatória: 01 → 02 → 03 → 04 → 05.

## Ordem de deploy

O SQL e o workflow do n8n ficam **fora deste repo** (pacote `lumnis-v3-infra`),
porque contêm chaves e não devem ir para o GitHub.

1. Rodar o SQL do schema no Supabase
2. Importar o fluxo no n8n
3. Push deste repo (a Vercel faz o deploy sozinho)

## O que mudou na v3

**Removido:** investimentos, patrimônio, cotações (BRAPI/Binance/CDI), rendimentos, projeção — ~4.100 linhas de JS.

**Adicionado:** mapa de calor de gasto por dia, card de limite mensal com donut, "Onde foi seu dinheiro", próximos 7 dias, carrossel de meses, aba Contas (recorrentes/avulsas/assinaturas), motor de recorrência, detector automático de assinaturas, tema vermelho.

**Renomeado:** Empréstimos → Dívidas.

## Rodar local

```bash
npx serve .
```

Não abra via `file://` — o service worker e o SDK do Supabase precisam de HTTP.
