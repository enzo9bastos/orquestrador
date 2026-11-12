// Área: coletor
const test = require('node:test');
const assert = require('node:assert');
const { casaTemporaria, escrever } = require('../ajuda');

const casa = casaTemporaria({
  raizProjetos: '~/dev', niveis: 2, ignorar: '^[_-]', pastaNotas: '~/dev/_notas',
  linhaTarefa: '^\\s*Agente\\s+(?<numero>\\d+)\\s+(?<alvo>\\S+\\/\\S+)\\s+[0-9a-f-]{36}\\s+\\((?<tarefa>.+)\\)',
});
for (const p of ['empresa/proj-a', 'empresa/proj-b', '_notas/x', 'outra/proj-c']) escrever(casa, `dev/${p}/.keep`, '');
escrever(casa, 'dev/_notas/topicos.md', 'texto\n  Agente 2  empresa/proj-a  11111111-2222-3333-4444-555555555555  (tarefa antiga)\n' +
  '  Agente 2  empresa/proj-a  11111111-2222-3333-4444-555555555555  (tarefa nova)\n');
const coletor = require('../../coletor');
const config = require('../../config');

test('coletor: projetos em dois níveis, ignorando pastas com _', () => {
  const alvos = coletor.projetos().map((p) => p.alvo);
  assert.deepStrictEqual(alvos, ['empresa/proj-a', 'empresa/proj-b', 'outra/proj-c']);
});

test('coletor: a tarefa é a da ÚLTIMA linha do agente nos tópicos', () => {
  const t = coletor.tarefas(config.ler());
  assert.deepStrictEqual(t['empresa/proj-a'], { numero: 2, tarefa: 'tarefa nova' });
});

// Regressão 2026-10-28: título do pane com lixo do protocolo kitty virava o nome.
test('regressão: nome do agente ignora lixo de código de controle no título', () => {
  assert.strictEqual(coletor.nomeDoAgente('Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA', 'proj', 4), 'Agente 4');
  assert.strictEqual(coletor.nomeDoAgente('Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA', 'proj', null), 'proj');
  assert.strictEqual(coletor.nomeDoAgente('✳ Agente 2', 'proj', 9), 'Agente 2');
  assert.strictEqual(coletor.nomeDoAgente('Claude Code', 'proj', null), 'proj');
});

test('coletor: sem configuração nenhuma, o núcleo não quebra', () => {
  casaTemporaria({});
  delete require.cache[require.resolve('../../config')];
  const c = require('../../config').ler();
  assert.strictEqual(c.pastaNotas, null);
  assert.strictEqual(c.linhaTarefa, null);
});

// Regressão 2026-10-29: o orquestrador via o Agente 4 trabalhando e o app
// mostrava "espera você" (só o "esc to interrupt" contava como trabalho).
test('regressão: estado pela tela reconhece o contador em andamento', () => {
  const rodape = '────\n❯ \n────\n  ⏵⏵ auto mode on (shift+tab to cycle)';
  assert.strictEqual(coletor.estadoPelaTela(`✶ Ruminating… (42s · ↓ 1.2k tokens)\n${rodape}`), 'trabalhando');
  assert.strictEqual(coletor.estadoPelaTela(`✻ Cooked for 2m 5s · done 9:55 AM\n${rodape}`), 'esperando');
  assert.strictEqual(coletor.estadoPelaTela(`texto qualquer\n${rodape}`, true), 'trabalhando', 'tela mexendo = trabalhando');
  assert.strictEqual(coletor.estadoPelaTela('Do you want to proceed?\n❯ 1. Yes'), 'permissao');
});

test('estado pela tela: movimento conta só a parte de cima e só por 8 s', () => {
  const base = (corpo) => `${corpo}\nlinha a\n────\n❯ \n────\n  ⏵⏵ auto mode on`;
  assert.strictEqual(coletor.mexeu('%t', base('A'), 1000), false, 'primeira leitura não conta');
  assert.strictEqual(coletor.mexeu('%t', base('B'), 2000), true, 'parte de cima mudou');
  assert.strictEqual(coletor.mexeu('%t', base('B'), 9000), true, 'ainda dentro dos 8 s');
  assert.strictEqual(coletor.mexeu('%t', base('B'), 10500), false, 'parou de mexer');
  assert.strictEqual(coletor.mexeu('%t', base('B').replace('auto mode on', 'auto mode on '), 11000), false, 'rodapé mudando não conta');
});

test('status do agente: lido do .orq/status.json e vale mais que a tela por 30 min', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'orq-status-'));
  fs.mkdirSync(path.join(dir, '.orq'));
  const agora = Date.now();
  fs.writeFileSync(path.join(dir, '.orq', 'status.json'), JSON.stringify({ texto: 'Comparando', estado: 'travado', progresso: '2/5', ts: agora }));
  const st = coletor.lerStatus(dir, agora);
  assert.deepStrictEqual([st.texto, st.estado, st.progresso], ['Comparando', 'travado', '2/5']);
  assert.strictEqual(coletor.estadoComStatus('esperando', st, agora), 'permissao', 'travado = precisa de você');
  assert.strictEqual(coletor.estadoComStatus('esperando', st, agora + 31 * 60 * 1000), 'esperando', 'velho: vale a tela');
  assert.strictEqual(coletor.lerStatus(dir, agora + 13 * 60 * 60 * 1000), null, 'mais de 12 h: ignorado');
  assert.strictEqual(coletor.estadoComStatus('permissao', { ...st, estado: 'trabalhando' }, agora), 'permissao', 'pergunta na tela vence');
});

// Regressão 2026-10-29: com a dica do Claude embaixo do contador, a linha do
// contador saía da janela de leitura e o agente aparecia como parado.
test('regressão: contador com dica embaixo continua contando como trabalho', () => {
  const tela = ['texto', '* Metamorphosing… (4m 52s · ↓ 31.9k tokens)', '  ⎿ Tip: Use /btw to ask a quick side question', 'mais uma linha de dica', '────', '❯ ', '────', '  ⏵⏵ auto mode on (shift+tab to cycle)', 'linha extra do rodapé'];
  const fim = tela.slice(-12).join('\n');
  assert.strictEqual(coletor.estadoPelaTela(fim), 'trabalhando');
});

// Regressão 2026-11-12: com o orquestrador digitando uma demanda longa na caixa
// do agente, o fim da tela era só o texto da demanda; o cartão sumia da lista
// e voltava quando o agente começava a trabalhar.
test('regressão: agente não some enquanto a demanda é digitada na caixa dele', () => {
  const ocioso = '● Pronto.\n────────\n❯ \n────────\n  ⏵⏵ auto mode on (shift+tab to cycle)';
  const digitando = Array.from({ length: 12 }, (_, i) => `  linha ${i + 1} da demanda que o orquestrador está mandando para o agente`).join('\n');
  const t0 = 1_000_000;
  assert.strictEqual(coletor.ehAgente('%90', ocioso, t0), true);
  assert.strictEqual(coletor.ehAgente('%90', digitando, t0 + 3000), true, 'segura o lugar enquanto digita');
  assert.strictEqual(coletor.ehAgente('%90', digitando, t0 + 3 * 60 * 1000), false, 'depois de 2 min sem a tela do Claude, sai');
  assert.strictEqual(coletor.ehAgente('%91', digitando, t0), false, 'painel nunca visto como Claude não entra');
  assert.strictEqual(coletor.ehAgente('%92', ocioso, t0), true);
  assert.strictEqual(coletor.ehAgente('%92', 'Bye!\nnode@a1b2:/workspaces/proj$ ', t0 + 1000), false, 'Claude fechou: shell no fim solta na hora');
  assert.strictEqual(coletor.ehAgente('%92', digitando, t0 + 2000), false, 'e não volta pela memória');
});

// Etapa 3b (2026-11-12): agentes Codex no terminal. Telas copiadas do Codex
// CLI 0.167 rodando num tmux.
test('Codex: reconhece a tela, o motor, o modelo e o estado', () => {
  const ocioso = [
    '  >_ OpenAI Codex (v0.167.2)',
    '  /review - review any changes and find issues',
    '› Ask Codex to do anything',
    '  GPT-6-Luna default · /workspace/jogo · ← for agents                    ⚠ 1 warning',
  ].join('\n');
  const trabalhando = [
    '• Vou gerar o sprite e salvar em assets/.',
    '• Working (10s • esc to interrupt)',
    '› Ask Codex to do anything',
    '  GPT-6-Luna default · /workspace/jogo · Gerar sprite · ← for agents',
  ].join('\n');
  const claude = '● Pronto.\n────────\n❯ \n────────\n  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents';
  assert.strictEqual(coletor.ehAgente('%95', ocioso, 1), true);
  assert.strictEqual(coletor.motorDaTela(ocioso), 'codex');
  assert.strictEqual(coletor.motorDaTela(trabalhando), 'codex');
  assert.strictEqual(coletor.motorDaTela(claude), 'claude', '"← for agents" sozinho não faz virar Codex');
  assert.strictEqual(coletor.modeloDoCodex(ocioso), 'GPT-6-Luna');
  assert.strictEqual(coletor.modeloDoCodex(claude), null);
  assert.strictEqual(coletor.estadoPelaTela(ocioso), 'esperando');
  assert.strictEqual(coletor.estadoPelaTela(trabalhando), 'trabalhando');
  assert.strictEqual(coletor.estadoPelaTela('Would you like to run the following command?\n  $ npm test\n› 1. Yes, proceed'), 'permissao');
});

// Regressão 2026-11-12: menu do Codex ("confiar nesta pasta?", "› 1. Trust and
// continue") aparecia como "esperando" em vez de pedindo a resposta do usuário.
test('regressão: menu do Codex conta como pedindo resposta', () => {
  const menu = '  model request. Continue only if you trust these files.\n› 1. Trust and continue\n  2. Back to Agent Command Center\n  enter continue · esc back';
  assert.strictEqual(coletor.estadoPelaTela(menu), 'permissao');
});
