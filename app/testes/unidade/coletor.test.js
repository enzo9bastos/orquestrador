// Área: coletor
const test = require('node:test');
const assert = require('node:assert');
const { casaTemporaria, escrever } = require('../ajuda');

const casa = casaTemporaria({
  raizProjetos: '~/dev', niveis: 2, ignorar: '^[_-]', pastaNotas: '~/dev/_orq',
  linhaTarefa: '^\\s*Agente\\s+(?<numero>\\d+)\\s+(?<alvo>\\S+\\/\\S+)\\s+[0-9a-f-]{36}\\s+\\((?<tarefa>.+)\\)',
});
for (const p of ['empresa/proj-a', 'empresa/proj-b', '_orq/x', 'outra/proj-c']) escrever(casa, `dev/${p}/.keep`, '');
escrever(casa, 'dev/_orq/topicos.md', 'texto\n  Agente 2  empresa/proj-a  11111111-2222-3333-4444-555555555555  (tarefa antiga)\n' +
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
