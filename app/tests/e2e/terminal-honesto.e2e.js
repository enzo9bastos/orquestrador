// Área: terminais
// "Abrir terminal" de um agente sem tmux no PATH: o painel não some calado;
// a aba Terminal diz que não abriu e por quê (em português e em inglês).
const test = require('node:test');
const { pastaTemporaria } = require('../temporarias');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { abrirApp } = require('./app');

const agora = Date.now();
const frente = { chave: 'g/a:%1', emp: 'g', proj: 'proj-a', dir: '/x/a', pane: '%1', sessaoTmux: 'proj-a', nome: 'Agente 2', estado: 'trabalhando', fonte: 'sinal', desde: agora - 60000, tarefa: 'Botão Aprovar', ultimaResposta: 'Terminei a parte 1.', git: {}, linhaDoTempo: [] };

// PATH só com o bash (o terminal do app é um bash de login): sem tmux.
function pathSemTmux() {
  const bin = pastaTemporaria('orq-sem-tmux-');
  fs.symlinkSync(fs.realpathSync('/bin/bash'), path.join(bin, 'bash'));
  return bin;
}

for (const idioma of ['pt-BR', 'en']) {
  test(`terminais: Abrir terminal sem tmux avisa (${idioma})`, async (t) => {
    const antes = process.env.PATH;
    process.env.PATH = pathSemTmux();
    let app;
    try { app = await abrirApp({ config: { idioma } }); } finally { process.env.PATH = antes; }
    t.after(() => app.fechar());
    await app.avaliar(`window.__estadoFalso = ${JSON.stringify({ lidoEm: agora, semTerminal: 0, frentes: [frente], fila: [] })}`);
    await app.esperar("document.querySelectorAll('.cartao-agente').length === 1", 6000);
    await app.avaliar("document.querySelector('.cartao-agente').click()");
    await app.esperar("!!document.querySelector('#detalhe [data-abrir=\"proj-a\"]')");
    await app.avaliar("document.querySelector('#detalhe [data-abrir=\"proj-a\"]').click()");

    await t.test('o aviso aparece com o motivo, e não fica painel vazio', async () => {
      await app.esperar("!!document.getElementById('aviso-terminal') && !document.getElementById('aviso-terminal').hidden", 8000);
      const txt = await app.avaliar("document.getElementById('aviso-terminal').innerText");
      assert.match(txt, idioma === 'en' ? /Couldn't open the terminal for proj-a\./ : /Não consegui abrir o terminal de proj-a\./);
      assert.match(await app.avaliar("document.querySelector('#aviso-terminal code').textContent"), /tmux/, 'o motivo vem da saída do terminal');
      assert.strictEqual(await app.avaliar("document.querySelectorAll('.painel-terminal').length"), 0);
      assert.strictEqual(await app.visivel('#aviso-terminal'), 'ok');
    });

    await t.test('abrir um terminal novo tira o aviso', async () => {
      await app.avaliar("document.getElementById('novo-terminal').click()");
      await app.esperar("document.querySelectorAll('.painel-terminal').length === 1");
      assert.ok(await app.avaliar("document.getElementById('aviso-terminal').hidden"));
    });

    await t.test('sem erros na tela', () => { assert.deepStrictEqual(app.erros, []); });
  });
}
