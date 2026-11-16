// Área: colunas
// Tela limpa: as colunas de agentes (esquerda) e de demandas (direita) recolhem
// por um botão discreto ou por Ctrl+Alt+, e Ctrl+Alt+.; fora do Orquestrador
// elas recolhem sozinhas ao entrar na aba; o que o usuário reabre fica lembrado
// por aba e sobrevive a reiniciar; coluna fechada nunca esconde um pedido.
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

const agora = Date.now();
const frente = (n, estado, extra = {}) => ({ chave: `g/p${n}:%${n}`, emp: 'g', proj: `proj-${n}`, dir: `/x/${n}`, pane: `%${n}`, sessaoTmux: `proj-${n}`, nome: `Agente ${n}`, estado, fonte: 'sinal', desde: agora - 60000, tarefa: `Tarefa ${n}`, modeloAgente: null, ultimaResposta: null, git: {}, linhaDoTempo: [], ...extra });
const CALMO = { lidoEm: agora, semTerminal: 0, frentes: [frente(1, 'trabalhando'), frente(2, 'trabalhando')], fila: [] };
const PRECISA = {
  lidoEm: agora, semTerminal: 0,
  frentes: [frente(1, 'trabalhando'), frente(2, 'permissao'), frente(3, 'esperando')],
  fila: [{ tipo: 'permissao', emp: 'g', proj: 'proj-2', id: 'perm-1', ferramenta: 'Bash', entrada: { command: 'git push', description: 'Enviar' }, desde: agora - 5000 }],
};

const largura = (app, seletor) => app.avaliar(`document.querySelector(${JSON.stringify(seletor)}).getBoundingClientRect().width`);
const estado = (app) => app.avaliar('window.orqColunas.estado()');
const aba = (app, id) => app.avaliar(`document.querySelector('[data-aba="${id}"]').click()`);
async function pousou(app, esquerda, direita) {
  // Espera a transição de largura terminar.
  await app.esperar(`(() => { const l = document.querySelector('.lateral').getBoundingClientRect().width, d = document.querySelector('.inspetor').getBoundingClientRect().width; return ${esquerda ? 'l > 150' : 'l < 2'} && ${direita ? 'd > 200' : 'd < 2'}; })()`, 4000);
}
async function estadoFalso(app, e) {
  await app.avaliar(`window.__estadoFalso = ${JSON.stringify(e)}; window.__orqLateral.atualizar()`);
}
const atalho = (app, code, key) => app.cdp('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 3, key, code, windowsVirtualKeyCode: code === 'Comma' ? 188 : 190 })
  .then(() => app.cdp('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 3, key, code, windowsVirtualKeyCode: code === 'Comma' ? 188 : 190 }));

test('colunas recolhíveis', async (t) => {
  const app = await abrirApp();
  t.after(() => app.fechar());
  await app.esperar('!!window.orqColunas && !!window.__orqLateral');
  await app.tamanho(1480, 900);
  await estadoFalso(app, CALMO);
  await app.esperar("document.querySelectorAll('.cartao-agente').length === 2", 6000);

  await t.test('os dois botões aparecem inteiros em 1480 px, com as colunas abertas como hoje', async () => {
    assert.strictEqual(await app.visivel('#alternar-agentes'), 'ok');
    assert.strictEqual(await app.visivel('#alternar-demandas'), 'ok');
    assert.deepStrictEqual(await estado(app), { aba: 'aba-orquestrador', agentes: true, demandas: true });
    assert.ok(await largura(app, '.lateral') > 200 && await largura(app, '.inspetor') > 240);
  });

  await t.test('o botão da esquerda recolhe e abre a coluna de agentes; a do centro cresce e volta', async () => {
    const antes = await largura(app, '.painel');
    await app.avaliar("document.getElementById('alternar-agentes').click()");
    await pousou(app, false, true);
    assert.ok(await largura(app, '.painel') > antes + 190, 'o centro não ocupou o espaço');
    assert.strictEqual(await app.avaliar("document.getElementById('alternar-agentes').getAttribute('aria-expanded')"), 'false');
    assert.strictEqual(await app.visivel('#alternar-agentes'), 'ok', 'o botão some junto com a coluna');
    await app.avaliar("document.getElementById('alternar-agentes').click()");
    await pousou(app, true, true);
    assert.ok(Math.abs(await largura(app, '.painel') - antes) < 2, 'o centro não voltou ao tamanho de antes');
  });

  await t.test('o botão da direita recolhe e abre a coluna de demandas', async () => {
    await app.avaliar("document.getElementById('alternar-demandas').click()");
    await pousou(app, true, false);
    assert.strictEqual(await app.visivel('#alternar-demandas'), 'ok');
    await app.avaliar("document.getElementById('alternar-demandas').click()");
    await pousou(app, true, true);
    assert.strictEqual(await app.visivel('#novo-topico'), 'ok', '"+ Nova demanda" voltou como era');
  });

  await t.test('Ctrl+Alt+, e Ctrl+Alt+. fazem o mesmo; Ctrl+B e Ctrl+Alt+1 não mexem nas colunas', async () => {
    await atalho(app, 'Comma', ',');
    await pousou(app, false, true);
    await atalho(app, 'Period', '.');
    await pousou(app, false, false);
    await atalho(app, 'Comma', ',');
    await atalho(app, 'Period', '.');
    await pousou(app, true, true);
    await app.cdp('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66 });
    await app.cdp('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 3, key: '1', code: 'Digit1', windowsVirtualKeyCode: 49 });
    await app.espera(300);
    assert.deepStrictEqual(await estado(app), { aba: 'aba-orquestrador', agentes: true, demandas: true });
  });

  await t.test('foco: nas outras abas as duas colunas recolhem na hora; no Orquestrador voltam como estavam', async () => {
    await aba(app, 'aba-notas');
    await pousou(app, false, false);
    assert.deepStrictEqual(await estado(app), { aba: 'aba-notas', agentes: false, demandas: false });
    assert.strictEqual(await app.visivel('#arvore-notas'), 'ok', 'a árvore de notas segue à vista');
    for (const a of ['aba-repertorio', 'aba-workflows', 'aba-recados', 'aba-grade', 'aba-terminal']) {
      await aba(app, a);
      await pousou(app, false, false);
    }
    await aba(app, 'aba-orquestrador');
    await pousou(app, true, true);
  });

  await t.test('o que o usuário deixou no Orquestrador é respeitado depois de uma visita a outra aba', async () => {
    await app.avaliar("document.getElementById('alternar-agentes').click()");
    await pousou(app, false, true);
    await aba(app, 'aba-notas');
    await pousou(app, false, false);
    await aba(app, 'aba-orquestrador');
    await pousou(app, false, true);
    await app.avaliar("document.getElementById('alternar-agentes').click()");
    await pousou(app, true, true);
  });

  await t.test('reaberta numa aba, fica lembrada para aquela aba (e só para ela)', async () => {
    await aba(app, 'aba-notas');
    await pousou(app, false, false);
    await app.avaliar("document.getElementById('alternar-demandas').click()");
    await pousou(app, false, true);
    await aba(app, 'aba-workflows');
    await pousou(app, false, false);
    await aba(app, 'aba-notas');
    await pousou(app, false, true);
    await aba(app, 'aba-orquestrador');
    await pousou(app, true, true);
  });

  await t.test('clicar numa frente com as demandas recolhidas abre a coluna: o detalhe mora lá', async () => {
    await aba(app, 'aba-workflows');
    await pousou(app, false, false);
    await app.avaliar("document.getElementById('alternar-agentes').click()");
    await pousou(app, true, false);
    await app.avaliar("document.querySelector('.cartao-agente').click()");
    await pousou(app, true, true);
    assert.strictEqual(await app.visivel('#bloco-detalhe'), 'ok');
  });

  await t.test('os dois botões e os chips do topo continuam inteiros em 1000 px, e recolher dá espaço ao centro', async () => {
    await aba(app, 'aba-orquestrador');
    await app.tamanho(1000, 760);
    await pousou(app, true, true);
    assert.strictEqual(await app.visivel('#alternar-agentes'), 'ok');
    assert.strictEqual(await app.visivel('#alternar-demandas'), 'ok');
    assert.strictEqual(await app.visivel('#contagem .pilula'), 'ok');
    const apertado = await largura(app, '.painel');
    await atalho(app, 'Comma', ',');
    await atalho(app, 'Period', '.');
    await pousou(app, false, false);
    const largo = await largura(app, '.painel');
    assert.ok(largo > apertado + 400, `o centro só ganhou ${largo - apertado} px`);
    assert.strictEqual(await app.visivel('#entrada'), 'ok');
    assert.strictEqual(await app.visivel('#enviar'), 'ok');
    await app.tamanho(1480, 900);
    await atalho(app, 'Comma', ',');
    await atalho(app, 'Period', '.');
    await pousou(app, true, true);
  });

  await t.test('sinal: com as colunas fechadas, o botão de cada lado conta o que espera você', async () => {
    await estadoFalso(app, PRECISA);
    await app.esperar("document.querySelectorAll('.cartao-agente').length === 3", 6000);
    // Abertas: sem sinal (o que espera já está à vista).
    assert.deepStrictEqual(await app.avaliar('window.orqColunas.sinais()'), { agentes: 2, demandas: 1 });
    assert.strictEqual(await app.avaliar("document.querySelector('#alternar-agentes .sinal-coluna').hidden"), true);
    await atalho(app, 'Comma', ',');
    await atalho(app, 'Period', '.');
    await pousou(app, false, false);
    assert.strictEqual(await app.avaliar("document.querySelector('#alternar-agentes .sinal-coluna').textContent"), '2');
    assert.strictEqual(await app.avaliar("document.querySelector('#alternar-demandas .sinal-coluna').textContent"), '1');
    assert.strictEqual(await app.visivel('#alternar-demandas .sinal-coluna'), 'ok');
    assert.match(await app.avaliar("document.getElementById('alternar-agentes').getAttribute('aria-label')"), /2 precisam de você/);
    assert.match(await app.avaliar("document.getElementById('alternar-demandas').title"), /1 precisa de você/);
    // O pedido chegou depois: outro agente pede permissão com a coluna fechada.
    await estadoFalso(app, { ...PRECISA, frentes: [...PRECISA.frentes, frente(4, 'permissao')] });
    await app.esperar("document.querySelector('#alternar-agentes .sinal-coluna').textContent === '3'", 4000);
    // Abrir tira o sinal; fechar de novo devolve.
    await app.avaliar("document.getElementById('alternar-demandas').click()");
    await pousou(app, false, true);
    assert.strictEqual(await app.avaliar("document.querySelector('#alternar-demandas .sinal-coluna').hidden"), true);
    assert.ok((await app.avaliar("document.getElementById('fila').innerText")).includes('git push'), 'o pedido está na coluna aberta');
  });

  await t.test('os chips do topo seguem lá e, ao clicar, abrem a coluna onde está o que contam', async () => {
    await app.avaliar("document.getElementById('alternar-demandas').click()");
    await pousou(app, false, false);
    const topo = await app.avaliar("document.getElementById('contagem').innerText.replace(/\\s+/g, ' ')");
    assert.match(topo, /1 trabalhando/);
    assert.match(topo, /2 pendências/);
    await app.avaliar("document.querySelector('#contagem [data-abrir-coluna=\"agentes\"]').click()");
    await pousou(app, true, false);
    await app.avaliar("document.querySelector('#contagem [data-abrir-coluna=\"demandas\"]').click()");
    await pousou(app, true, true);
    assert.strictEqual(await app.visivel('#fila .item-fila'), 'ok');
  });

  await t.test('sem erros na tela', async () => { assert.deepStrictEqual(app.erros, []); });
});

test('colunas: o estado por aba sobrevive a reiniciar o app', async (t) => {
  const app1 = await abrirApp();
  const casa = app1.casa;
  await app1.esperar('!!window.orqColunas');
  await app1.avaliar("document.getElementById('alternar-demandas').click()"); // Orquestrador: só a esquerda
  await app1.espera(200);
  await aba(app1, 'aba-notas');
  await app1.avaliar("document.getElementById('alternar-agentes').click()"); // Notas: só a esquerda aberta
  await app1.espera(400);
  const gravado = JSON.parse(app1.ler('.config/orq-app/config.json'));
  assert.deepStrictEqual(gravado.colunas, { 'aba-orquestrador': { agentes: true, demandas: false }, 'aba-notas': { agentes: true, demandas: false } });
  await app1.fechar();

  const app2 = await abrirApp({ casa });
  t.after(() => app2.fechar());
  await app2.esperar('!!window.orqColunas');
  await app2.esperar("window.orqColunas.estado().demandas === false", 4000);
  assert.deepStrictEqual(await estado(app2), { aba: 'aba-orquestrador', agentes: true, demandas: false });
  await aba(app2, 'aba-notas');
  await pousou(app2, true, false);
  await aba(app2, 'aba-workflows'); // nunca mexida: padrão das outras abas
  await pousou(app2, false, false);
  assert.deepStrictEqual(app2.erros, []);
});

test('colunas: em inglês as dicas dos botões e o sinal estão traduzidos', async (t) => {
  const app = await abrirApp({ config: { idioma: 'en' } });
  t.after(() => app.fechar());
  await app.esperar('!!window.orqColunas && !!window.__orqLateral');
  await app.esperar("document.documentElement.lang === 'en'", 6000);
  await estadoFalso(app, PRECISA);
  await app.esperar("document.querySelectorAll('.cartao-agente').length === 3", 6000);
  await app.espera(300);
  assert.strictEqual(await app.avaliar("document.getElementById('alternar-agentes').title"), 'Collapse the agents column (Ctrl+Alt+,)');
  assert.strictEqual(await app.avaliar("document.getElementById('alternar-demandas').title"), 'Collapse the requests column (Ctrl+Alt+.)');
  await app.avaliar("document.getElementById('alternar-agentes').click(); document.getElementById('alternar-demandas').click()");
  await app.esperar("document.getElementById('alternar-agentes').title.includes('2 need you')", 4000);
  assert.strictEqual(await app.avaliar("document.getElementById('alternar-agentes').title"), 'Open the agents column (Ctrl+Alt+,) · 2 need you');
  assert.strictEqual(await app.avaliar("document.getElementById('alternar-demandas').title"), 'Open the requests column (Ctrl+Alt+.) · 1 needs you');
  assert.strictEqual(await app.avaliar("document.querySelector('#contagem .pilula').title"), 'Show the agents column');
  assert.strictEqual(await app.avaliar("document.getElementById('coluna-demandas').getAttribute('aria-label')"), 'Requests and approvals');
  assert.deepStrictEqual(app.erros, []);
});

// Coluna recolhida tem largura zero, mas os blocos de dentro guardam o
// preenchimento lateral: sem cortar, a caixa deles passava da borda da janela
// e a página rolava para o lado por programa (um scrollIntoView deslocava a
// tela inteira).
test('colunas: com coluna recolhida a janela não rola para o lado', async (t) => {
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => app.fechar());
  await app.esperar('!!window.orqColunas && !!window.__orqLateral');
  await estadoFalso(app, PRECISA);
  await app.esperar("document.querySelectorAll('.cartao-agente').length === 3", 6000);
  const rolagem = () => app.avaliar(`(() => {
    const se = document.scrollingElement; se.scrollLeft = 200; const andou = se.scrollLeft; se.scrollLeft = 0;
    return { largura: document.documentElement.scrollWidth, janela: innerWidth, andou };
  })()`);
  for (const [larg, alt] of [[1480, 900], [1920, 1080]]) {
    await app.tamanho(larg, alt);
    for (const [nome, agentes, demandas] of [['abertas', true, true], ['demandas recolhida', true, false], ['agentes recolhida', false, true], ['as duas recolhidas', false, false]]) {
      await app.avaliar(`window.orqColunas.definir('agentes', ${agentes}); window.orqColunas.definir('demandas', ${demandas})`);
      await pousou(app, agentes, demandas);
      await app.espera(250);
      const r = await rolagem();
      assert.strictEqual(r.largura, r.janela, `${larg} px, ${nome}: a página tem ${r.largura} px de largura numa janela de ${r.janela}`);
      assert.strictEqual(r.andou, 0, `${larg} px, ${nome}: a página rolou ${r.andou} px para o lado`);
    }
  }
  assert.deepStrictEqual(app.erros, []);
});
