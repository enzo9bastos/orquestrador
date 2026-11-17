// Área: conversa (dicas fixas sob a caixa e painel de atalhos do P1)
// Plano 1.4. Sob a caixa fica sempre à vista o que cada tecla faz (muda com o
// motor trabalhando), e o "? Atalhos" (ou Ctrl+/) abre a lista inteira. A lista
// só mostra o que funciona hoje, e os atalhos que dá para trocar aparecem com
// a combinação que está valendo.
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

test('dicas sob a caixa e painel de atalhos', async (t) => {
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste');
  const dicas = () => app.avaliar("document.getElementById('dicas-caixa').innerText.replace(/\\s+/g, ' ').trim()");
  const info = (o) => app.avaliar(`window.__orqTeste.desenharInfo(${JSON.stringify({ pasta: '/casa', modelo: 'claude-opus-5-5', esforco: 'high', ...o })})`);
  const popup = "document.getElementById('popup')";

  await t.test('parado: as dicas dizem o que /, @, Esc e Enter fazem; a caixa não repete isso', async () => {
    assert.strictEqual(await app.visivel('#dicas-caixa'), 'ok');
    const d = await dicas();
    for (const pedaco of ['/ comandos', '@ nota ou workflow', 'Enter envia', 'Shift+Enter quebra linha', '? Atalhos']) assert.ok(d.includes(pedaco), `${pedaco} em "${d}"`);
    assert.ok(!/Esc/.test(d), 'parado, o Esc não tem o que parar: a dica só aparece com o motor trabalhando');
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').placeholder"), 'Escreva para o orquestrador…');
  });

  await t.test('trabalhando: as dicas passam a dizer que o Enter põe na fila, o Ctrl+Enter corrige o rumo e o Esc para', async () => {
    await info({ ocupado: true });
    const d = await dicas();
    for (const pedaco of ['Enter põe na fila', 'Ctrl+Enter corrige o rumo', 'Esc para o motor']) assert.ok(d.includes(pedaco), `${pedaco} em "${d}"`);
    assert.ok(!d.includes('Enter envia'));
    await info({ ocupado: false });
    assert.ok((await dicas()).includes('Enter envia'));
  });

  await t.test('"? Atalhos" abre a lista; Ctrl+/ também; Esc fecha', async () => {
    await app.avaliar("document.getElementById('abrir-atalhos').click()");
    await app.esperar(`!${popup}.hidden`);
    assert.strictEqual(await app.avaliar("document.getElementById('popup-titulo').textContent"), 'Atalhos');
    const linhas = await app.avaliar("[...document.querySelectorAll('#popup-corpo .linha-atalho')].map((l) => l.innerText.replace(/\\s+/g, ' ').trim())");
    for (const esperado of ['Enviar Enter', 'Quebrar linha Shift+Enter', 'Parar o motor Esc', 'Com o motor trabalhando: pôr na fila Enter', 'Com o motor trabalhando: corrigir o rumo Ctrl+Enter',
      'Trocar o modo de permissão Ctrl+Shift+M', 'Trocar o modo, com a caixa vazia Shift+Tab', 'Paleta de comandos Ctrl+K', 'Esta lista Ctrl+/', 'Recolher ou abrir os agentes Ctrl+Alt+,', 'Recolher ou abrir as demandas Ctrl+Alt+.']) {
      assert.ok(linhas.includes(esperado), `falta "${esperado}" em ${JSON.stringify(linhas)}`);
    }
    await app.tecla('Escape', 'Escape', 27);
    await app.esperar(`${popup}.hidden`);
    await app.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: '/', code: 'Slash', windowsVirtualKeyCode: 191, modifiers: 2 });
    await app.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: '/', code: 'Slash', windowsVirtualKeyCode: 191, modifiers: 2 });
    await app.esperar(`!${popup}.hidden`);
    assert.strictEqual(await app.avaliar("document.getElementById('popup-titulo').textContent"), 'Atalhos');
    await app.tecla('Escape', 'Escape', 27);
  });

  await t.test('a lista acompanha as Configurações: Shift+Tab desligado some; atalho de coluna trocado aparece com a combinação nova', async () => {
    await app.avaliar("window.orq.config.gravar({ shiftTabTrocaModo: false, atalhosColunas: { agentes: 'Ctrl+Alt+KeyJ', demandas: '' } }).then((c) => window.dispatchEvent(new CustomEvent('orq:config', { detail: c && c.config ? c.config : c })))");
    await app.espera(300);
    await app.avaliar("document.getElementById('abrir-atalhos').click()");
    await app.esperar(`!${popup}.hidden`);
    const linhas = await app.avaliar("[...document.querySelectorAll('#popup-corpo .linha-atalho')].map((l) => l.innerText.replace(/\\s+/g, ' ').trim())");
    assert.ok(!linhas.some((l) => /Shift\+Tab/.test(l)), 'Shift+Tab desligado não entra na lista');
    assert.ok(linhas.includes('Recolher ou abrir os agentes Ctrl+Alt+J'), JSON.stringify(linhas));
    assert.ok(linhas.includes('Recolher ou abrir as demandas desativado'), JSON.stringify(linhas));
    // O rodapé leva às Configurações › Atalhos.
    await app.avaliar("document.querySelector('#popup-corpo [data-abrir-config-atalhos]').click()");
    await app.esperar("!document.getElementById('config').hidden && !document.getElementById('config-sec-atalhos').hidden");
    await app.avaliar("document.getElementById('fechar-config').click()");
  });

  await t.test('em 1000 px as dicas continuam inteiras (quebram de linha, não saem cortadas)', async () => {
    await app.tamanho(1000, 800);
    await app.espera(200);
    assert.strictEqual(await app.visivel('#abrir-atalhos'), 'ok');
    assert.ok(await app.avaliar("(() => { const d = document.getElementById('dicas-caixa'); return d.scrollWidth <= d.clientWidth + 1; })()"));
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
