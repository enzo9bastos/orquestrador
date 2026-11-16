// Área: colunas
// Segunda rodada da tela limpa: conversa e nota usam mais largura com as
// colunas recolhidas; os atalhos aparecem nas Configurações (trocar, desligar,
// voltar ao padrão, recusa de colisão); o contador pulsa 3 vezes e para; a
// barra de formatação das Notas aparece ao focar ou passar o mouse e nunca
// quebra; os chips do topo só existem quando maiores que zero.
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

const agora = Date.now();
const frente = (n, estado) => ({ chave: `g/p${n}:%${n}`, emp: 'g', proj: `proj-${n}`, dir: `/x/${n}`, pane: `%${n}`, sessaoTmux: `proj-${n}`, nome: `Agente ${n}`, estado, fonte: 'sinal', desde: agora - 60000, tarefa: `Tarefa ${n}`, modeloAgente: null, ultimaResposta: null, git: {}, linhaDoTempo: [] });
const VAZIO = { lidoEm: agora, semTerminal: 0, frentes: [], fila: [] };
const CALMO = { lidoEm: agora, semTerminal: 0, frentes: [frente(1, 'trabalhando'), frente(2, 'trabalhando')], fila: [] };
const PRECISA = {
  lidoEm: agora, semTerminal: 0, frentes: [frente(1, 'trabalhando'), frente(2, 'permissao'), frente(3, 'esperando')],
  fila: [{ tipo: 'permissao', emp: 'g', proj: 'proj-2', id: 'perm-1', ferramenta: 'Bash', entrada: { command: 'git push', description: 'Enviar' }, desde: agora - 5000 }],
};
const NOTAS = { 'notas/a.md': '# A\n\ntexto da nota\n' };

const medida = (app, seletor) => app.avaliar(`Math.round(document.querySelector(${JSON.stringify(seletor)}).getBoundingClientRect().width)`);
const estadoFalso = (app, e) => app.avaliar(`window.__estadoFalso = ${JSON.stringify(e)}; window.__orqLateral.atualizar()`);
const colunas = (app, a, d) => app.avaliar(`window.orqColunas.definir('agentes', ${a}); window.orqColunas.definir('demandas', ${d})`);
const aba = (app, id) => app.avaliar(`document.querySelector('[data-aba="${id}"]').click()`);
const VK = { Comma: 188, Period: 190, KeyJ: 74, KeyK: 75, Escape: 27, KeyU: 85, KeyH: 72 };
async function combo(app, code, key, modifiers = 3) {
  await app.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers, key, code, windowsVirtualKeyCode: VK[code] });
  await app.cdp('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key, code, windowsVirtualKeyCode: VK[code] });
}
const config = (app) => JSON.parse(app.ler('.config/orq-app/config.json'));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const largou = (app, a, d) => app.esperar(`(() => { const l = document.querySelector('.lateral').getBoundingClientRect().width, r = document.querySelector('.inspetor').getBoundingClientRect().width; return ${a ? 'l > 150' : 'l < 2'} && ${d ? 'r > 200' : 'r < 2'}; })()`, 4000);

test('colunas v2: largura da conversa e da nota acompanha o espaço livre', async (t) => {
  const app = await abrirApp({ arquivos: NOTAS, config: { pastaNotas: '~/notas' } });
  t.after(() => app.fechar());
  await app.esperar('!!window.orqColunas && !!window.__orqLateral');
  await app.tamanho(2400, 1350);
  await estadoFalso(app, CALMO);

  await t.test('conversa: abertas como hoje (860 px); uma recolhida meio-termo; as duas até ~1500 px', async () => {
    assert.strictEqual(await medida(app, '.caixa-entrada'), 860);
    await colunas(app, false, true); await largou(app, false, true);
    const uma = await medida(app, '.caixa-entrada');
    assert.ok(uma > 1000 && uma <= 1180, `uma recolhida: ${uma}`);
    await colunas(app, false, false); await largou(app, false, false);
    const duas = await medida(app, '.caixa-entrada');
    assert.ok(duas >= 1400 && duas <= 1500, `duas recolhidas: ${duas}`);
    assert.strictEqual(await app.visivel('#enviar'), 'ok');
    await colunas(app, true, true); await largou(app, true, true);
    assert.strictEqual(await medida(app, '.caixa-entrada'), 860);
  });

  await t.test('proporcional: em 1480 px com as duas recolhidas a linha cresce, mas menos que em 2400', async () => {
    await colunas(app, false, false); await largou(app, false, false);
    await app.tamanho(1480, 900);
    await espera(200);
    const m = await medida(app, '.caixa-entrada');
    assert.ok(m > 900 && m < 1100, `1480 px: ${m}`);
    await colunas(app, true, true); await largou(app, true, true);
    const aberto = await medida(app, '.caixa-entrada');
    assert.ok(aberto < m && aberto <= 860, `abertas em 1480 px: ${aberto}`);
    await app.tamanho(2400, 1350);
    await espera(200);
  });

  await t.test('nota: 760 px com as colunas abertas; mais larga (sem passar de ~1080) com as duas recolhidas', async () => {
    await aba(app, 'aba-notas');
    await largou(app, false, false);
    await app.esperar("!!document.querySelector('#arvore-notas .linha-nota')", 6000);
    await app.avaliar("document.querySelector('#arvore-notas .linha-nota').click()");
    await app.esperar("!document.getElementById('pagina-nota').hidden && document.getElementById('pagina-nota').getBoundingClientRect().width > 100", 6000);
    const larga = await medida(app, '#pagina-nota');
    assert.ok(larga > 900 && larga <= 1080, `nota com as duas recolhidas: ${larga}`);
    await colunas(app, true, true); await largou(app, true, true);
    assert.strictEqual(await medida(app, '#pagina-nota'), 760);
    await colunas(app, false, false);
  });
  assert.deepStrictEqual(app.erros, []);
});

test('colunas v2: atalhos nas Configurações (trocar, recusar colisão, desativar, voltar ao padrão) e sobrevivem a reiniciar', async (t) => {
  const app = await abrirApp();
  const casa = app.casa;
  await app.esperar('!!window.orqColunas');
  await app.tamanho(1480, 900);
  await app.avaliar("document.getElementById('abrir-config').click()");
  await app.avaliar("document.querySelector('[data-secao-config=\"atalhos\"]').click()");
  const texto = (lado) => app.avaliar(`document.querySelector('[data-atalho-mudar="${lado}"]').textContent`);
  const aviso = () => app.avaliar("document.getElementById('atalhos-aviso').innerText.trim()");

  await t.test('mostra os dois atalhos de hoje, com Desativar e Voltar ao padrão', async () => {
    assert.strictEqual(await app.visivel('[data-atalho-mudar="agentes"]'), 'ok');
    assert.strictEqual(await texto('agentes'), 'Ctrl+Alt+,');
    assert.strictEqual(await texto('demandas'), 'Ctrl+Alt+.');
    assert.strictEqual(await app.avaliar("document.querySelector('[data-atalho-padrao=\"agentes\"]').disabled"), true, 'já está no padrão');
  });

  await t.test('combinação que colide é recusada e nada muda: Ctrl+K, sem Ctrl/Alt e igual à do outro lado', async () => {
    await app.avaliar("document.querySelector('[data-atalho-mudar=\"agentes\"]').click()");
    assert.match(await texto('agentes'), /Aperte as teclas/);
    await combo(app, 'KeyK', 'k', 2);
    assert.match(await aviso(), /já é usada por paleta de comandos/);
    await combo(app, 'KeyJ', 'j', 0);
    assert.match(await aviso(), /Use Ctrl, Alt ou Cmd/);
    await combo(app, 'Period', '.', 3);
    assert.match(await aviso(), /não podem ter o mesmo atalho/);
    assert.strictEqual(config(app).atalhosColunas, undefined, 'nada foi gravado');
    await combo(app, 'Escape', 'Escape', 0);
    assert.strictEqual(await texto('agentes'), 'Ctrl+Alt+,');
    assert.strictEqual(await app.avaliar("document.getElementById('config').hidden"), false, 'Esc cancelou a captura, não fechou as Configurações');
  });

  await t.test('combinação nova é capturada, gravada, aparece na dica do botão e passa a valer (a antiga não)', async () => {
    await app.avaliar("document.querySelector('[data-atalho-mudar=\"agentes\"]').click()");
    await combo(app, 'KeyJ', 'j', 3);
    assert.strictEqual(await texto('agentes'), 'Ctrl+Alt+J');
    assert.deepStrictEqual(config(app).atalhosColunas, { agentes: 'Ctrl+Alt+KeyJ', demandas: 'Ctrl+Alt+Period' });
    assert.strictEqual(await app.avaliar("document.getElementById('alternar-agentes').title"), 'Recolher a coluna de agentes (Ctrl+Alt+J)');
    await app.avaliar("document.getElementById('fechar-config').click()");
    await combo(app, 'Comma', ',', 3);
    await espera(300);
    assert.strictEqual((await app.avaliar('window.orqColunas.estado()')).agentes, true, 'o atalho antigo não deveria valer mais');
    await combo(app, 'KeyJ', 'j', 3);
    await largou(app, false, true);
  });

  await t.test('desativar tira o atalho (a dica fica sem ele) e o botão do topo segue funcionando', async () => {
    await app.avaliar("document.getElementById('abrir-config').click()");
    await app.avaliar("document.querySelector('[data-atalho-desligar=\"agentes\"]').click()");
    await espera(300);
    assert.strictEqual(await texto('agentes'), 'Desligado');
    assert.deepStrictEqual(config(app).atalhosColunas, { agentes: '', demandas: 'Ctrl+Alt+Period' });
    assert.strictEqual(await app.avaliar("document.getElementById('alternar-agentes').title"), 'Abrir a coluna de agentes');
    await app.avaliar("document.getElementById('fechar-config').click()");
    await combo(app, 'KeyJ', 'j', 3);
    await espera(300);
    assert.strictEqual((await app.avaliar('window.orqColunas.estado()')).agentes, false, 'desligado não reage');
    await app.avaliar("document.getElementById('alternar-agentes').click()");
    await largou(app, true, true);
  });

  await t.test('o que ficou desativado sobrevive a reiniciar o app; voltar ao padrão restaura', async () => {
    await app.fechar();
    const app2 = await abrirApp({ casa });
    t.after(() => app2.fechar());
    await app2.esperar('!!window.orqColunas');
    await app2.esperar("window.orqColunas.atalhos().agentes === ''", 4000);
    assert.deepStrictEqual(await app2.avaliar('window.orqColunas.atalhos()'), { agentes: '', demandas: 'Ctrl+Alt+Period' });
    await app2.avaliar("document.getElementById('abrir-config').click()");
    await app2.avaliar("document.querySelector('[data-secao-config=\"atalhos\"]').click()");
    await app2.avaliar("document.querySelector('[data-atalho-padrao=\"agentes\"]').click()");
    await espera(300);
    assert.deepStrictEqual(config({ ler: (r) => app2.ler(r) }).atalhosColunas, { agentes: 'Ctrl+Alt+Comma', demandas: 'Ctrl+Alt+Period' });
    assert.strictEqual(await app2.avaliar("document.querySelector('[data-atalho-mudar=\"agentes\"]').textContent"), 'Ctrl+Alt+,');
    assert.deepStrictEqual(app2.erros, []);
  });
});

test('colunas v2: as Configurações › Atalhos e a recusa estão em inglês', async (t) => {
  const app = await abrirApp({ config: { idioma: 'en' } });
  t.after(() => app.fechar());
  await app.esperar('!!window.orqColunas');
  await app.esperar("document.documentElement.lang === 'en'", 6000);
  await app.avaliar("document.getElementById('abrir-config').click()");
  await app.avaliar("document.querySelector('[data-secao-config=\"atalhos\"]').click()");
  await espera(300);
  const txt = await app.avaliar("document.getElementById('config-sec-atalhos').textContent");
  for (const em of ['Shortcuts', 'Collapse or open the agents', 'Turn off', 'Reset to default']) assert.ok(txt.includes(em), `faltou "${em}": ${txt}`);
  assert.ok(!/Recolher|Desativar|Voltar ao padrão|Clique na combinação/.test(txt), `sobrou português: ${txt}`);
  await app.avaliar("document.querySelector('[data-atalho-mudar=\"agentes\"]').click()");
  await combo(app, 'KeyK', 'k', 2);
  await espera(200);
  assert.match(await app.avaliar("document.getElementById('atalhos-aviso').innerText"), /already used by command palette/);
  await combo(app, 'KeyJ', 'j', 3);
  await espera(300);
  assert.strictEqual(await app.avaliar("document.getElementById('alternar-agentes').title"), 'Collapse the agents column (Ctrl+Alt+J)');
  assert.deepStrictEqual(app.erros, []);
});

test('colunas v2: o contador pulsa 3 vezes e para; sem movimento com prefers-reduced-motion; os chips só existem quando maiores que 0', async (t) => {
  const app = await abrirApp();
  t.after(() => app.fechar());
  await app.esperar('!!window.orqColunas && !!window.__orqLateral');
  await app.tamanho(1480, 900);

  await t.test('chips: com 0 agentes não há chip; só os maiores que 0; o resto do topo não sai do lugar', async () => {
    await estadoFalso(app, VAZIO);
    await app.esperar("document.querySelectorAll('#contagem .pilula').length === 0", 4000);
    const x0 = await app.avaliar("Math.round(document.getElementById('tema').getBoundingClientRect().left)");
    await estadoFalso(app, CALMO);
    await app.esperar("document.querySelectorAll('#contagem .pilula').length === 1", 4000);
    assert.match(await app.avaliar("document.getElementById('contagem').innerText"), /2 trabalhando/);
    await estadoFalso(app, PRECISA);
    await app.esperar("document.querySelectorAll('#contagem .pilula').length === 3", 4000);
    assert.strictEqual(await app.avaliar("Math.round(document.getElementById('tema').getBoundingClientRect().left)"), x0, 'o tema andou');
    await estadoFalso(app, VAZIO);
    await app.esperar("document.querySelectorAll('#contagem .pilula').length === 0", 4000);
  });

  await t.test('pulso: 3 repetições, não infinito', async () => {
    await estadoFalso(app, PRECISA);
    await app.esperar("document.querySelectorAll('.cartao-agente').length === 3", 6000);
    await colunas(app, false, false);
    await app.esperar("!document.querySelector('#alternar-agentes .sinal-coluna').hidden", 4000);
    const css = await app.avaliar("(() => { const s = getComputedStyle(document.querySelector('#alternar-agentes .sinal-coluna')); return { n: s.animationIterationCount, nome: s.animationName }; })()");
    assert.deepStrictEqual(css, { n: '3', nome: 'pulso-sinal' });
  });

  await t.test('prefers-reduced-motion: sem animação nenhuma', async () => {
    await app.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await espera(200);
    assert.strictEqual(await app.avaliar("getComputedStyle(document.querySelector('#alternar-agentes .sinal-coluna')).animationName"), 'none');
  });
});

test('colunas v2: a barra de formatação das Notas aparece ao focar ou passar o mouse e nunca quebra em duas linhas', async (t) => {
  const app = await abrirApp({ arquivos: NOTAS, config: { pastaNotas: '~/notas' } });
  t.after(() => app.fechar());
  await app.esperar('!!window.orqColunas');
  await app.tamanho(1480, 900);
  await aba(app, 'aba-notas');
  await app.esperar("!!document.querySelector('#arvore-notas .linha-nota')", 6000);
  await app.avaliar("document.querySelector('#arvore-notas .linha-nota').click()");
  await app.esperar("!document.getElementById('barra-nota').hidden", 6000);
  await app.cdp('Emulation.setFocusEmulationEnabled', { enabled: true }); // janela de teste sem foco do sistema: :focus só vale com ele
  const opac = () => app.avaliar("getComputedStyle(document.getElementById('barra-nota')).opacity");
  const comandos = () => app.avaliar("[...document.querySelectorAll('#barra-nota > button[data-cmd]:not(.transbordou)')].map((b) => b.dataset.cmd).filter((c) => c !== 'mais')");
  const noMenu = () => app.avaliar("[...document.querySelectorAll('#barra-nota .mais-nota [data-transbordo][data-cmd]')].map((b) => b.dataset.cmd)");

  await t.test('parada fica discreta; foco no texto mostra; passar o mouse na faixa mostra; Tab até um botão também', async () => {
    await app.avaliar('document.activeElement && document.activeElement.blur()');
    await espera(300);
    assert.strictEqual(await opac(), '0');
    await app.avaliar("document.querySelector('#editor-nota .tiptap').focus()");
    await espera(300);
    assert.strictEqual(await opac(), '1');
    await app.avaliar('document.activeElement.blur()');
    await espera(300);
    assert.strictEqual(await opac(), '0');
    const r = await app.avaliar("(() => { const b = document.getElementById('barra-nota').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()");
    await app.mouse('mouseMoved', r.x, r.y);
    await espera(300);
    assert.strictEqual(await opac(), '1', 'o mouse na faixa deveria mostrar');
    await app.mouse('mouseMoved', 5, 5);
    await app.avaliar("document.querySelector('#barra-nota button[data-cmd=\"negrito\"]').focus()");
    await espera(300);
    assert.strictEqual(await opac(), '1', 'foco por teclado deveria mostrar');
  });

  await t.test('larga: tudo na barra, nada no "⋯"; estreita: uma linha só, o que não cabe vai para o "⋯" e nada some', async () => {
    await app.tamanho(1480, 900);
    await app.esperar("document.getElementById('barra-nota').clientWidth > 1000", 3000);
    await app.avaliar('window.__orqBarraNota.ajustar()');
    const todos = await comandos();
    assert.ok(todos.length >= 14, `poucos botões: ${todos.length}`);
    assert.deepStrictEqual(await noMenu(), []);
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#barra-nota .transbordou').length"), 0);

    await app.tamanho(640, 900);
    await app.esperar("document.getElementById('barra-nota').clientWidth < 520", 3000);
    await app.avaliar('window.__orqBarraNota.ajustar()');
    const linhas = await app.avaliar("(() => { const b = document.getElementById('barra-nota'); const topos = new Set([...b.children].filter((e) => getComputedStyle(e).position !== 'absolute' && getComputedStyle(e).display !== 'none' && !e.hidden).map((e) => Math.round((e.getBoundingClientRect().top + e.getBoundingClientRect().bottom) / 4))); return topos.size; })()");
    assert.strictEqual(linhas, 1, 'a barra quebrou em mais de uma linha');
    assert.ok(await app.avaliar("document.getElementById('barra-nota').scrollWidth <= document.getElementById('barra-nota').clientWidth + 1"), 'a barra estoura a largura');
    const visiveis = await comandos();
    const foram = await noMenu();
    assert.ok(foram.length > 0, 'nada foi para o ⋯');
    assert.deepStrictEqual([...visiveis, ...foram].sort(), [...todos].sort(), 'algum botão sumiu em vez de ir para o ⋯');
    const cores = await app.avaliar("document.querySelectorAll('#barra-nota .mais-nota [data-transbordo][data-cor-nota]').length");
    assert.strictEqual(cores, 6, 'as cores vão primeiro, todas para o menu');
    assert.strictEqual(await app.visivel('#barra-nota button[data-cmd="mais"]'), 'ok');
  });

  await t.test('um item que foi para o ⋯ faz o mesmo que o botão (a cor da nota muda pelo menu)', async () => {
    await app.avaliar("document.querySelector('#barra-nota button[data-cmd=\"mais\"]').click()");
    await app.avaliar("document.querySelector('#barra-nota .mais-nota [data-cor-nota=\"azul\"]').click()");
    await espera(300);
    assert.strictEqual(await app.avaliar("document.getElementById('pagina-nota').dataset.cor"), 'azul');
  });
  assert.deepStrictEqual(app.erros, []);
});
