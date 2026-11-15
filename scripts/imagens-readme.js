#!/usr/bin/env node
// Gera as imagens do README (docs/images/) com o app de verdade, numa casa
// temporária com dados fictícios em inglês — nada da sua máquina aparece.
//
//   node scripts/imagens-readme.js            todas as cenas
//   node scripts/imagens-readme.js recados    só uma (conversa, configuracoes,
//                                             recados, workflows, workflow-editor,
//                                             workflow-passo)
//
// Precisa do app instalado (app/node_modules) e de Python 3 com Pillow para
// converter o quadro capturado em PNG otimizado. Cada cena abre o app escondido
// (o mesmo jeito dos testes de tela), monta a tela pelo DevTools e captura um
// quadro com ORQ_APP_PRINT.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const APP = path.join(RAIZ, 'app');
const SAIDA = path.join(RAIZ, 'docs', 'images');
const ELECTRON = require(path.join(APP, 'node_modules', 'electron'));

// --- dados fictícios ---------------------------------------------------------
const agora = Date.now();
const ESTADO = {
  lidoEm: agora, semTerminal: 0,
  frentes: [
    { chave: 'w/api:%1', emp: 'work', proj: 'api-server', dir: '/x/api', pane: '%1', sessaoTmux: 'api', nome: 'orders API', estado: 'trabalhando', fonte: 'sinal', desde: agora - 240000, tarefa: 'Paginate the /orders endpoint', modeloAgente: 'Sonnet 5.5', statusAgente: { texto: 'writing tests', estado: 'trabalhando', progresso: '3/5', ts: agora }, ultimaResposta: 'Endpoint done; writing the tests now.', git: { commits20h: 3 }, linhaDoTempo: [] },
    { chave: 'w/web:%2', emp: 'work', proj: 'web-app', dir: '/x/web', pane: '%2', sessaoTmux: 'web', nome: 'dark mode', estado: 'esperando', fonte: 'sinal', desde: agora - 480000, tarefa: 'Dark mode for the settings page', modeloAgente: 'Sonnet 5.5', statusAgente: { texto: 'ready for review', estado: 'pronto', ts: agora }, ultimaResposta: 'Done: tests passing, PR ready for review.', git: { commits20h: 5 }, linhaDoTempo: [] },
    { chave: 'w/game:%4', emp: 'work', proj: 'game', dir: '/x/game', pane: '%4', sessaoTmux: 'game', nome: 'sprites', estado: 'trabalhando', fonte: 'tela', motor: 'codex', desde: agora - 300000, tarefa: 'Hero sprite sheet, 64x64', modeloAgente: 'GPT-6', ultimaResposta: 'Walking cycle done; jumping next.', git: {}, linhaDoTempo: [] },
    { chave: 'w/docs:%3', emp: 'work', proj: 'docs', dir: '/x/docs', pane: '%3', sessaoTmux: 'docs', nome: 'install guide', estado: 'permissao', fonte: 'tela', desde: agora - 720000, tarefa: 'Update the install guide', modeloAgente: 'Sonnet 5.5', ultimaResposta: null, git: {}, linhaDoTempo: [] },
  ],
  fila: [{ tipo: 'permissao', emp: 'work', proj: 'docs', id: 'perm-1', ferramenta: 'Bash', entrada: { command: 'npm run build', description: 'Build the docs site' }, desde: agora - 60000 }],
};
const DEMANDAS = { topicos: [
  { id: '1', titulo: 'Orders API v2', codigo: 'API-42', agentes: ['Agent 1'], estado: 'aberto', resumo: 'Paginated orders endpoint for the new mobile app.', itens: [{ id: 'i1', texto: 'Design the cursor format', feito: true }, { id: 'i2', texto: 'Endpoint and tests', feito: true }, { id: 'i3', texto: 'Update the API docs', feito: false }, { id: 'i4', texto: 'Load test', feito: false }], criado: agora - 864e5, atualizado: agora },
  { id: '2', titulo: 'Dark mode for settings', agentes: ['Agent 2'], estado: 'esperando', resumo: 'Settings page follows the theme.', itens: [{ id: 'i1', texto: 'Theme tokens', feito: true }, { id: 'i2', texto: 'Review and merge', feito: false }], criado: agora - 1728e5, atualizado: agora },
  { id: '3', titulo: 'Game art', agentes: ['Agent 3'], estado: 'aberto', itens: [{ id: 'i1', texto: 'Hero sprite sheet', feito: false }, { id: 'i2', texto: 'Tiles', feito: false }], criado: agora - 3600e3, atualizado: agora },
] };
const CONVERSA = [
  { tipo: 'user', local: true, message: { role: 'user', content: 'How are the agents doing? And tell Bruno the release is ready for him to test.' } },
  { tipo: 'assistant', ts: agora, message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'orq peek all', description: 'Check every agent screen' } }] } },
  { tipo: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
  { tipo: 'assistant', ts: agora, message: { content: [{ type: 'text', text: '**Agent 1** (api-server) is writing tests for the paginated `/orders` endpoint — 3 of 5 done.\n\n**Agent 2** (web-app) finished dark mode and is **ready for review**.\n\n**Agent 3** runs on **Codex**: the walking cycle of the hero sprite is done.\n\n**Agent 4** (docs) is asking permission to run `npm run build` — it is in the queue on the right.\n\nThe note to Bruno is below, waiting for your approval.' }] } },
];
const RECADOS = [
  { id: 'r1', ts: agora - 900000, de: { tipo: 'agente', alvo: 'work/api-server', nome: 'orders API' }, para: { tipo: 'orquestrador' }, tipo: 'pergunta', texto: 'Cursor or offset pagination? The mobile app only scrolls forward.', estado: 'entregue', motivo: null },
  { id: 'r2', ts: agora - 840000, de: { tipo: 'orquestrador' }, para: { tipo: 'agente', alvo: 'work/api-server', nome: 'orders API' }, tipo: 'aviso', texto: 'Cursor. Write it down in the project memory.', estado: 'entregue', motivo: null },
  { id: 'r3', ts: agora - 600000, canal: true, canalId: 'n1', de: { tipo: 'externo', nome: 'Bruno' }, para: { tipo: 'orquestrador' }, tipo: 'externo', titulo: 'Release', texto: 'Is the 2.4 build ready for us to test?', estado: 'entregue', motivo: null },
  { id: 'r4', ts: agora - 300000, de: { tipo: 'agente', alvo: 'work/web-app', nome: 'dark mode' }, para: { tipo: 'orquestrador' }, tipo: 'pronto', texto: 'Dark mode done, tests passing, PR #318 ready for review.', estado: 'entregue', motivo: null },
  { id: 'r5', ts: agora - 120000, canal: true, de: { tipo: 'orquestrador' }, para: { tipo: 'externo', nome: 'Bruno', caixa: 'to-bruno' }, tipo: 'externo', classe: 'informacao', texto: 'Got it — checking the build now.', estado: 'entregue', motivo: null, semAprovacao: true },
  { id: 'r6', ts: agora - 60000, canal: true, de: { tipo: 'orquestrador' }, para: { tipo: 'externo', nome: 'Bruno', caixa: 'to-bruno' }, tipo: 'externo', classe: 'decisao', titulo: 'Release 2.4', texto: 'The 2.4 build is ready for you to test: release notes in shared/releases/2.4.md. Ana would like the feedback by Friday.', estado: 'aguardando', motivo: 'leaves this computer; decision: waits for your approval' },
].map((r) => JSON.stringify(r)).join('\n') + '\n';
const WORKFLOWS = { workflows: [
  { id: 'wf1', nome: 'Invoices from Downloads', descricao: 'Every PDF invoice that lands in Downloads is summarized and filed.', ativo: true, atualizado: agora,
    nos: [
      { id: 'n1', tipo: 'pasta', x: 60, y: 160, config: { pasta: '~/Downloads', padrao: '*.pdf' } },
      { id: 'n2', tipo: 'comando', x: 330, y: 160, config: { comando: 'pdftotext "{{arquivo}}" -' } },
      { id: 'n3', tipo: 'claude', x: 600, y: 160, config: { via: 'claude', modelo: 'haiku', prompt: 'Summarize this invoice in one line: supplier, total, due date.\n\n{{entrada}}' } },
      { id: 'n4', tipo: 'mover', x: 870, y: 70, config: { modo: 'mover', caminho: '{{arquivo}}', destino: '~/Documents/Invoices' } },
      { id: 'n5', tipo: 'notificar', x: 870, y: 260, config: { titulo: 'New invoice', texto: '{{entrada}}' } },
    ],
    ligacoes: [{ de: 'n1', para: 'n2' }, { de: 'n2', para: 'n3' }, { de: 'n3', para: 'n4' }, { de: 'n3', para: 'n5' }] },
  { id: 'wf2', nome: 'Morning round', descricao: 'Weekdays at 08:30: asks the orchestrator for the day plan.', ativo: true, atualizado: agora - 86400000,
    nos: [{ id: 'n1', tipo: 'agenda', x: 80, y: 120, config: { modo: 'diario', horario: '08:30', diasUteis: true, atrasado: true } }, { id: 'n2', tipo: 'orquestrador', x: 360, y: 120, config: { texto: 'Plan for today: what is open, what waits for me.' } }],
    ligacoes: [{ de: 'n1', para: 'n2' }] },
  { id: 'wf3', nome: 'Status page check', descricao: 'Every 15 min during working hours: HTTP request, alert when it is not 200.', ativo: false, atualizado: agora - 172800000,
    nos: [{ id: 'n1', tipo: 'agenda', x: 80, y: 120, config: { modo: 'intervalo', minutos: 15, de: '08:00', ate: '18:00', diasUteis: true } }, { id: 'n2', tipo: 'http', x: 360, y: 120, config: { metodo: 'GET', url: 'https://status.example.com/health' } }],
    ligacoes: [{ de: 'n1', para: 'n2' }] },
] };

// --- cenas -------------------------------------------------------------------
// Cada cena: o que fazer na tela (código no DevTools) e o recorte opcional.
const clicar = (sel) => `document.querySelector(${JSON.stringify(sel)}).click()`;
const CENAS = {
  conversa: { arquivo: 'conversation.png', codigo: '' },
  configuracoes: { arquivo: 'settings.png', codigo: `${clicar('#abrir-config')}; setTimeout(() => { ${clicar('#config-aba-orquestracao')}; document.getElementById('config-arquivo').textContent = 'File: ~/.config/orq-app/config.json'; }, 300)` },
  recados: { arquivo: 'messages.png', codigo: clicar('[data-aba="aba-recados"]') },
  workflows: { arquivo: 'workflows-list.png', codigo: clicar('[data-aba="aba-workflows"]') },
  'workflow-editor': { arquivo: 'workflow-editor.png', codigo: `${clicar('[data-aba="aba-workflows"]')}; setTimeout(() => ${clicar('[data-wf="wf1"]')}, 600)` },
  'workflow-passo': { arquivo: 'workflow-step.png', codigo: `${clicar('[data-aba="aba-workflows"]')}; setTimeout(() => ${clicar('[data-wf="wf1"]')}, 600); setTimeout(() => document.querySelector('.wf-no[data-no="n3"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })), 1400)` },
};

async function cena(nome) {
  const { abrirApp } = require(path.join(APP, 'tests', 'e2e', 'app'));
  const quadros = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-imagens-'));
  process.env.ORQ_ELECTRON = ELECTRON;
  process.env.ORQ_APP_PRINT = path.join(quadros, 'q');
  process.env.ORQ_APP_PRINT_MS = '1000';
  const config = {
    idioma: 'en', tema: 'dark', pastasNotas: [{ nome: 'Notes', caminho: '~/notes' }],
    canalMinhaCaixa: 'to-ana', canalMeuNome: 'Ana', canalContatos: [{ nome: 'Bruno', caixa: 'to-bruno' }], canalSemAprovarCiente: true, canalSemAprovarInformacao: true,
  };
  const app = await abrirApp({ config, arquivos: {
    'notes/Meeting notes.md': '# Meeting notes\n',
    '.config/orq-app/topicos.json': JSON.stringify(DEMANDAS),
    '.config/orq-app/pet.json': JSON.stringify({ visual: { especie: 'bicho', cor: 'padrao', itens: { cabeca: 'mago' } } }),
    '.config/orq-app/workflows.json': JSON.stringify(WORKFLOWS),
    '.local/share/orq-app/recados/recados.jsonl': RECADOS,
  } });
  try {
    await app.avaliar(`window.__estadoFalso = ${JSON.stringify(ESTADO)}`);
    await app.esperar('!!window.__orqTeste');
    for (const ev of CONVERSA) await app.avaliar(`window.__orqTeste.desenharEvento(${JSON.stringify(ev)})`);
    await app.espera(1500); // o cartão de aprovação entra pela lista de recados
    // No uso real o cartão chega depois da conversa: vai para o fim. Sem a
    // mensagem de boas-vindas, e a barra de cima com valores de exemplo.
    await app.avaliar(`(() => {
      const caixa = document.getElementById('mensagens');
      caixa.querySelectorAll('.boas-vindas').forEach((e) => e.remove());
      caixa.querySelectorAll('.cartao-aprovacao').forEach((c) => caixa.append(c));
      caixa.scrollTop = caixa.scrollHeight;
      window.__orqTeste.desenharInfo({ pasta: '/home/ana', modelo: 'claude-opus-5-5', esforco: 'high', contexto: 92000, janela: 200000, uso5h: 23, uso7d: 41, ocupado: false });
    })()`);
    if (CENAS[nome].codigo) await app.avaliar(CENAS[nome].codigo);
    await app.espera(3500);
  } finally { await app.fechar(); }
  const ultimo = fs.readdirSync(quadros).filter((f) => f.endsWith('.png')).sort().pop();
  if (!ultimo) throw new Error(`${nome}: nenhum quadro capturado`);
  const destino = path.join(SAIDA, CENAS[nome].arquivo);
  const r = spawnSync('python3', ['-c', 'import sys\nfrom PIL import Image\nImage.open(sys.argv[1]).convert("RGB").save(sys.argv[2], optimize=True)', path.join(quadros, ultimo), destino], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${nome}: falhou ao converter (Python 3 com Pillow?)`);
  for (const f of fs.readdirSync(quadros)) fs.unlinkSync(path.join(quadros, f));
  fs.rmdirSync(quadros);
  console.log(`${nome} → docs/images/${CENAS[nome].arquivo}`);
}

(async () => {
  const pedidas = process.argv.slice(2);
  for (const n of pedidas.length ? pedidas : Object.keys(CENAS)) {
    if (!CENAS[n]) { console.error(`cena desconhecida: ${n} (${Object.keys(CENAS).join(', ')})`); process.exit(1); }
    await cena(n);
  }
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
