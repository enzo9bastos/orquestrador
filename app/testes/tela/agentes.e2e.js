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
    { chave: 'g/a:%1', emp: 'g', proj: 'proj-a', dir: '/x/a', pane: '%1', sessaoTmux: 'proj-a', nome: 'Agente 2', estado: 'trabalhando', fonte: 'sinal', desde: agora - 60000, tarefa: 'Botão Aprovar', modeloAgente: 'Sonnet 5.5', ultimaResposta: 'Terminei a parte 1.', git: { commits20h: 2 },
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
    assert.match(topo, /2 pendências/, 'permissão na tela + item da fila');
  });

  await t.test('fila "Precisa de você" mostra a permissão com Permitir e Negar', async () => {
    const fila = await app.avaliar("document.getElementById('fila').innerText");
    assert.match(fila, /git push/);
    assert.ok(await app.avaliar("!!document.querySelector('#fila [data-resp=\"permitir\"]') && !!document.querySelector('#fila [data-resp=\"negar\"]')"));
  });

  await t.test('detalhe da frente selecionada e linha do tempo', async () => {
    await app.avaliar("document.querySelector('.cartao-agente').click()");
    assert.match(await app.avaliar("document.getElementById('detalhe').innerText"), /Terminei a parte 1/);
    await app.avaliar("document.querySelector('[data-aba=aba-tempo]').click()");
    assert.match(await app.avaliar("document.getElementById('tempo-completo').innerText"), /layout\.json|Edit/);
  });

  await t.test('busca filtra os agentes', async () => {
    await app.avaliar("const f = document.getElementById('filtro'); f.value = 'aprovar'; f.dispatchEvent(new Event('input'))");
    assert.strictEqual(await app.avaliar("document.querySelectorAll('.cartao-agente').length"), 1);
  });
});
