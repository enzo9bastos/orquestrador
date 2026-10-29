// Área: menus
// Tudo o que abre por cima (menus, listas, janelinhas) tem que aparecer
// inteiro, sem nada na frente e sem sair da janela.
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

test('menus', async (t) => {
  const app = await abrirApp({
    config: { comandoDesligar: '/fim', pastasNotas: [{ nome: 'N', caminho: '~/n' }] },
    arquivos: { 'n/a.md': '# A\n\ntexto\n', '.claude/settings.json': '{}' },
  });
  t.after(() => app.fechar());
  // Conversa com mensagens, para ter conteúdo atrás dos menus.
  for (let i = 0; i < 8; i++) {
    await app.avaliar(`window.__orqTeste.desenharEvento({ tipo: 'assistant', message: { content: [{ type: 'text', text: 'Parágrafo longo de teste número ${i}. '.repeat(6) }] } })`);
  }
  await app.avaliar("window.__orqTeste.desenharInfo({ modelo: 'claude-opus-5-5', esforco: 'high', pasta: '/home/x/a/b/c/pasta-funda', uso5h: 10, uso7d: 50, contexto: 1000, janela: 200000 })");

  // Regressão 2026-10-29: o menu de modelo abria por baixo da conversa.
  await t.test('regressão: menu de modelo e esforço aparece inteiro, por cima da conversa', async () => {
    await app.avaliar("document.getElementById('botao-modelo').click()");
    assert.strictEqual(await app.visivel('#menu-modelo'), 'ok');
    await app.avaliar("document.body.click()");
  });

  // Regressão 2026-10-29: o chip da pasta mostrava o caminho embaralhado.
  await t.test('regressão: chip da pasta mostra o fim do caminho na ordem certa', async () => {
    assert.strictEqual(await app.avaliar("document.getElementById('info-pasta').textContent"), '…/c/pasta-funda');
  });

  await t.test('lista de comandos (/) aparece inteira e tem /restart e /exit', async () => {
    const digitar = (v) => app.avaliar(`(() => { const e = document.getElementById('entrada'); e.focus(); e.value = '${v}'; e.dispatchEvent(new Event('input')); })()`);
    await digitar('/');
    assert.strictEqual(await app.visivel('#sugestoes'), 'ok');
    await digitar('/re');
    assert.match(await app.avaliar("document.getElementById('sugestoes').innerText"), /\/restart/);
    await digitar('');
  });

  await t.test('popups de /config e /permissions aparecem inteiros', async () => {
    await app.avaliar('window.__orqTeste.abrirPopupConfig()');
    assert.strictEqual(await app.visivel('#popup .config'), 'ok');
    await app.avaliar("document.getElementById('fechar-popup').click()");
    await app.avaliar('window.__orqTeste.abrirPopupPermissoes()');
    await app.esperar("!!document.getElementById('perm-salvar')");
    assert.strictEqual(await app.visivel('#popup .config'), 'ok');
    await app.avaliar("document.getElementById('fechar-popup').click()");
  });

  await t.test('engrenagem abre inteira', async () => {
    await app.avaliar("document.getElementById('abrir-config').click()");
    await app.esperar("!document.getElementById('config').hidden");
    assert.strictEqual(await app.visivel('#config .config'), 'ok');
    await app.avaliar("document.getElementById('fechar-config').click()");
  });

  await t.test('menu do botão direito nas notas aparece inteiro, sem "apagar"', async () => {
    await app.avaliar("document.querySelector('[data-aba=aba-notas]').click()");
    await app.esperar("!!document.querySelector('.linha-nota')");
    await app.avaliar("document.querySelector('.linha-nota').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }))");
    assert.strictEqual(await app.visivel('#menu-contexto'), 'ok');
    const itens = await app.avaliar("document.getElementById('menu-contexto').innerText");
    for (const i of ['Abrir no gerenciador de arquivos', 'Copiar caminho', 'Renomear']) assert.ok(itens.includes(i), `faltou: ${i}`);
    assert.doesNotMatch(itens, /apagar|excluir|deletar/i);
    await app.avaliar("document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))");
  });

  await t.test('menu / e barra de seleção do editor aparecem inteiros', async () => {
    await app.avaliar("document.querySelector('.linha-nota').click()");
    await app.esperar("!!document.querySelector('.tiptap p')");
    await app.avaliar("(() => { const t = document.querySelector('.tiptap'); t.focus(); const p = t.querySelector('p'); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()");
    await app.tecla('Enter', 'Enter', 13);
    await app.texto('/tab');
    await app.esperar("!document.querySelector('.menu-barra').hidden");
    assert.strictEqual(await app.visivel('.menu-barra'), 'ok');
    await app.tecla('Escape', 'Escape', 27);
    await app.esperar("document.querySelector('.menu-barra').hidden");
    // Seleciona a linha com o teclado (Shift+Home), como uma pessoa faria.
    await app.avaliar("document.querySelector('.tiptap').focus()");
    await app.texto(' palavra');
    await app.avaliar("document.querySelector('.tiptap').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', code: 'Home', shiftKey: true, bubbles: true }))");
    await app.avaliar("(() => { const s = getSelection(); s.modify('extend', 'backward', 'lineboundary'); })()");
    await app.esperar("!document.querySelector('.barra-selecao').hidden");
    assert.strictEqual(await app.visivel('.barra-selecao'), 'ok');
  });
});
