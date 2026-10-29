// Área: agentes
// Lateral de agentes, fila "Precisa de você", detalhe da frente e linha do
// tempo, com um estado falso (sem tmux nem agentes reais).
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

const agora = Date.now();
const ESTADO = {
  lidoEm: agora, semTerminal: 1,
  frentes: [
    { chave: 'g/a:%1', emp: 'g', proj: 'proj-a', dir: '/x/a', pane: '%1', sessaoTmux: 'proj-a', nome: 'Agente 2', estado: 'trabalhando', fonte: 'sinal', desde: agora - 60000, tarefa: 'Botão Aprovar', modeloAgente: 'Sonnet 5.5', statusAgente: { texto: 'Conferindo layout', estado: 'trabalhando', progresso: '2/5', ts: agora }, ultimaResposta: 'Terminei a parte 1.', git: { commits20h: 2 },
      linhaDoTempo: [{ ts: agora - 50000, evento: 'UserPromptSubmit', prompt: 'faça o botão' }, { ts: agora - 40000, evento: 'PostToolUse', tool_name: 'Edit', resumo: 'layout.json' }, { ts: agora - 30000, evento: 'Stop', last_assistant_message: 'Terminei a parte 1.' }] },
    { chave: 'g/b:%2', emp: 'g', proj: 'proj-b', dir: '/x/b', pane: '%2', sessaoTmux: 'proj-b', nome: 'Agente 3', estado: 'permissao', fonte: 'tela', desde: null, tarefa: null, modeloAgente: null, ultimaResposta: null, git: {}, linhaDoTempo: [] },
  ],
  fila: [{ tipo: 'permissao', emp: 'g', proj: 'proj-b', id: 'perm-1', ferramenta: 'Bash', entrada: { command: 'git push', description: 'Enviar' }, desde: agora - 5000 }],
};

test('agentes', async (t) => {
  const app = await abrirApp();
  t.after(() => app.fechar());
  await app.avaliar(`window.__estadoFalso = ${JSON.stringify(ESTADO)}`);
  await app.esperar("document.querySelectorAll('.cartao-agente').length === 2", 6000);

  await t.test('cartões: nome, tarefa e modelo; sem tarefa avisa', async () => {
    const txt = await app.avaliar("[...document.querySelectorAll('.cartao-agente')].map((c) => c.innerText.replace(/\\s+/g, ' '))");
    assert.match(txt[0], /Agente 2.*Botão Aprovar.*Sonnet 5\.5/);
    assert.match(txt[1], /Agente 3.*Tarefa não registrada/);
  });

  await t.test('contadores do topo batem com o estado', async () => {
    const topo = await app.avaliar("document.getElementById('contagem').innerText.replace(/\\s+/g, ' ')");
    assert.match(topo, /1 trabalhando/);
    // A permissão do Agente 3 aparece no cartão e na fila, mas é uma pendência só.
    assert.match(topo, /1 pendências/);
  });

  await t.test('fila "Precisa de você" mostra a permissão com Permitir e Negar', async () => {
    const fila = await app.avaliar("document.getElementById('fila').innerText");
    assert.match(fila, /git push/);
    assert.ok(await app.avaliar("!!document.querySelector('#fila [data-resp=\"permitir\"]') && !!document.querySelector('#fila [data-resp=\"negar\"]')"));
  });

  await t.test('detalhe da frente: última resposta e atividade (a aba Linha do tempo saiu)', async () => {
    await app.avaliar("document.querySelector('.cartao-agente').click()");
    const d = await app.avaliar("document.getElementById('detalhe').innerText");
    assert.match(d, /Terminei a parte 1/);
    assert.match(d, /layout\.json|Edit/);
    assert.ok(await app.avaliar("!document.querySelector('[data-aba=aba-tempo]')"));
  });

  await t.test('status publicado pelo agente aparece no cartão, com progresso', async () => {
    const c = await app.avaliar("document.querySelector('.cartao-agente').innerText");
    assert.match(c, /Conferindo layout/);
    assert.ok(await app.avaliar("!!document.querySelector('.cartao-agente .progresso-agente i')"));
  });

  await t.test('protótipo: agente que para de trabalhar vira "terminou" com próximos passos', async () => {
    const parado = JSON.parse(JSON.stringify(ESTADO));
    parado.frentes[0].estado = 'esperando';
    parado.frentes[0].statusAgente = { texto: 'Pronto o botão Aprovar', estado: 'pronto', progresso: '5/5', ts: Date.now() };
    await app.avaliar(`window.__estadoFalso = ${JSON.stringify(parado)}`);
    await app.esperar("!!document.querySelector('.item-terminou')", 6000);
    assert.match(await app.avaliar("document.querySelector('.item-terminou').innerText"), /Agente 2 terminou[\s\S]*Pronto o botão Aprovar/);
    await app.avaliar("document.querySelector('.item-terminou [data-passo=\"conferir\"]').click()");
    await app.esperar("[...document.querySelectorAll('#mensagens .msg-voce')].some((b) => b.innerText.includes('Confira o que ele fez'))", 6000);
    assert.ok(await app.avaliar("!document.querySelector('.item-terminou')"), 'cartão sai depois de usado');
  });

  await t.test('busca filtra os agentes', async () => {
    await app.avaliar("const f = document.getElementById('filtro'); f.value = 'aprovar'; f.dispatchEvent(new Event('input'))");
    assert.strictEqual(await app.avaliar("document.querySelectorAll('.cartao-agente').length"), 1);
  });
});
