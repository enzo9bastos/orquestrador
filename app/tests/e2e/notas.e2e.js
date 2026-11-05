// Área: notas
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

const NOTION = '# Teste\n\nTexto com ==destaque== e <span style="color:#d44c47">vermelho</span>.\n\n> [!aviso]\n> Cuidado.\n\n<details>\n<summary>Abrir</summary>\n\nEscondido.\n\n</details>\n';

test('notas', async (t) => {
  const app = await abrirApp({
    config: { pastasNotas: [{ nome: 'Teste', caminho: '~/notas' }] },
    arquivos: { 'notas/rascunho.md': '# Rascunho\n', 'notas/notion.md': NOTION, 'notas/diario/2026-10-29.md': 'dia\n', 'notas/grande.md': '# G\n' + 'linha\n'.repeat(80000) },
  });
  t.after(() => app.fechar());
  const abrir = async (rel) => {
    await app.avaliar(`document.querySelector('.linha-nota[data-rel="${rel}"]').click()`);
    await app.esperar("document.getElementById('estado-nota').textContent !== ''");
    await app.espera(400);
  };
  await app.avaliar("document.querySelector('[data-aba=aba-notas]').click()");
  await app.esperar("!!document.querySelector('.linha-pasta')");

  await t.test('diários aparecem por mês, com dia e dia da semana', async () => {
    await app.avaliar("document.querySelector('.linha-pasta').click()");
    await app.esperar("!!document.querySelector('.linha-mes')");
    assert.match(await app.avaliar("document.querySelector('.linha-nota.data').innerText"), /29 · quinta/i);
  });

  await t.test('blocos no estilo Notion aparecem formatados', async () => {
    await abrir('notion.md');
    const html = await app.avaliar("document.querySelector('.tiptap').innerHTML");
    assert.match(html, /<mark>destaque<\/mark>/);
    assert.match(html, /data-callout/);
    assert.match(html, /data-type="details"/);
    assert.strictEqual(await app.avaliar("document.getElementById('titulo-nota').textContent"), 'notion');
  });

  // Gravar não pode estragar a sintaxe (o arquivo também é lido pelo Obsidian).
  await t.test('salvar mantém ==destaque==, cor, callout e toggle', async () => {
    await app.avaliar("(() => { const p = document.querySelector('.tiptap p'); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); document.querySelector('.tiptap').focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()");
    await app.texto(' Fim.');
    await app.esperar("document.getElementById('estado-nota').textContent === 'Salvo'", 6000);
    const md = app.ler('notas/notion.md');
    for (const trecho of ['==destaque==', '<span style="color:#d44c47">vermelho</span>', '> [!aviso]', '<details>', '<summary>Abrir</summary>', 'Fim.']) assert.ok(md.includes(trecho), `faltou: ${trecho}`);
  });

  // Agente acrescentando no fim enquanto o usuário edita: junta, não perde nada.
  await t.test('acréscimo por fora durante a edição é juntado', async () => {
    await app.texto(' editando');
    app.escrever('notas/notion.md', app.ler('notas/notion.md') + '\nLinha do agente.\n');
    await app.espera(2500);
    await app.esperar("document.getElementById('estado-nota').textContent === 'Salvo'", 6000);
    const md = app.ler('notas/notion.md');
    assert.ok(md.includes('editando') && md.includes('Linha do agente.'), md);
  });

  await t.test('barra da nota: negrito, fonte e cor da nota', async () => {
    await abrir('notion.md');
    await app.esperar("!document.getElementById('barra-nota').hidden");
    await app.avaliar("(() => { const p = document.querySelector('.tiptap p'); const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.querySelector('.tiptap').focus(); })()");
    await app.espera(150);
    await app.avaliar("document.querySelector('#barra-nota [data-cmd=\"negrito\"]').click()");
    assert.ok(await app.avaliar("!!document.querySelector('.tiptap p strong')"));
    await app.avaliar("(() => { const s = document.querySelector('[data-estilo=\"fonte\"]'); s.value = 'Gelasio'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
    assert.strictEqual(await app.avaliar("document.getElementById('pagina-nota').dataset.fonte"), 'Gelasio');
    assert.match(await app.avaliar("getComputedStyle(document.querySelector('.tiptap')).fontFamily"), /Gelasio/);
    await app.avaliar("document.querySelector('[data-cor-nota=\"azul\"]').click()");
    assert.strictEqual(await app.avaliar("document.getElementById('folha-nota').dataset.cor"), 'azul');
  });

  await t.test('modo Markdown mostra o texto puro e volta formatado', async () => {
    await app.avaliar("document.querySelector('#barra-nota [data-cmd=\"markdown\"]').click()");
    assert.match(await app.avaliar("document.querySelector('.editor-md-puro').value"), /==destaque==/);
    await app.avaliar("document.querySelector('#barra-nota [data-cmd=\"markdown\"]').click()");
    assert.ok(await app.avaliar("!document.querySelector('.editor-md-puro') && !document.getElementById('editor-nota').hidden"));
  });

  await t.test('imagem colada na nota vira arquivo em anexos/ e aparece', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await app.avaliar(`(() => { const b = Uint8Array.from(atob('${png}'), (c) => c.charCodeAt(0)); const f = new File([b], 'p.png', { type: 'image/png' });
      const dt = new DataTransfer(); dt.items.add(f); document.querySelector('.tiptap').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
    await app.esperar("!!document.querySelector('.tiptap img[src^=\"orqnota://\"]')", 6000);
    await app.esperar("document.querySelector('.tiptap img').complete && document.querySelector('.tiptap img').naturalWidth > 0", 6000);
    await app.esperar("document.getElementById('estado-nota').textContent === 'Salvo'", 6000);
    assert.match(app.ler('notas/notion.md'), /!\[[^\]]*\]\(anexos\/notion-\d+\.png\)/);
  });

  await t.test('bloco de código com linguagem mantém o ```js ao salvar', async () => {
    app.escrever('notas/codigo.md', '# C\n\n```js\nconst a = 1;\n```\n');
    await app.avaliar("document.querySelector('[data-acao=\"atualizar\"]').click()");
    await app.esperar("!!document.querySelector('.linha-nota[data-rel=\"codigo.md\"]')");
    await abrir('codigo.md');
    assert.ok(await app.avaliar("!!document.querySelector('.tiptap pre .hljs-keyword')"), 'código colorido');
    await app.avaliar("(() => { const h = document.querySelector('.tiptap h1'); const r = document.createRange(); r.selectNodeContents(h); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.querySelector('.tiptap').focus(); })()");
    await app.texto('!');
    await app.esperar("document.getElementById('estado-nota').textContent === 'Salvo'", 6000);
    assert.match(app.ler('notas/codigo.md'), /```js\nconst a = 1;\n```/);
  });

  await t.test('imagem guarda a largura no jeito do Obsidian (![texto|largura])', async () => {
    app.escrever('notas/larg.md', '# L\n\n![foto|120](anexos/x.png)\n\nfim\n');
    await app.avaliar("document.querySelector('[data-acao=\"atualizar\"]').click()");
    await app.esperar("!!document.querySelector('.linha-nota[data-rel=\"larg.md\"]')");
    await abrir('larg.md');
    assert.ok(await app.avaliar("!!document.querySelector('.tiptap [data-resize-handle]')"), 'alças de redimensionar');
    await app.avaliar("(() => { const p = [...document.querySelectorAll('.tiptap p')].pop(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.querySelector('.tiptap').focus(); })()");
    await app.texto('!');
    await app.esperar("document.getElementById('estado-nota').textContent === 'Salvo'", 6000);
    assert.match(app.ler('notas/larg.md'), /!\[foto\|120\]\(anexos\/x\.png\)/);
  });

  // Regressão 2026-10-29: descendo com as setas, o menu / não rolava junto.
  await t.test('regressão: menu / rola junto com a seleção do teclado', async () => {
    await app.avaliar("(() => { const p = [...document.querySelectorAll('.tiptap p')].pop(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.querySelector('.tiptap').focus(); })()");
    await app.tecla('Enter', 'Enter', 13);
    await app.texto('/');
    await app.esperar("!document.querySelector('.menu-barra').hidden");
    for (let i = 0; i < 12; i++) await app.tecla('ArrowDown', 'ArrowDown', 40);
    const ok = await app.avaliar("(() => { const m = document.querySelector('.menu-barra'), s = m.querySelector('[aria-selected=\"true\"]'); const a = m.getBoundingClientRect(), b = s.getBoundingClientRect(); return b.top >= a.top - 1 && b.bottom <= a.bottom + 1; })()");
    assert.ok(ok, 'o item escolhido continua visível');
    await app.tecla('Escape', 'Escape', 27);
  });

  await t.test('arquivo grande abre só para leitura', async () => {
    await abrir('grande.md');
    assert.strictEqual(await app.avaliar("document.getElementById('estado-nota').textContent"), 'Só leitura');
    assert.strictEqual(await app.avaliar("document.querySelector('.tiptap').contentEditable"), 'false');
  });

  // Pedido de 2026-11-05: não dava para desmarcar uma pasta selecionada.
  await t.test('pasta selecionada desmarca com clique no vazio e com Esc', async () => {
    await app.avaliar("document.querySelector('.linha-pasta').click()");
    await app.esperar("!!document.querySelector('.linha-pasta.selecionada')");
    await app.avaliar("document.getElementById('arvore-notas').click()");
    await app.esperar("!document.querySelector('.linha-pasta.selecionada')");
    await app.avaliar("document.querySelector('.linha-pasta').click()");
    await app.esperar("!!document.querySelector('.linha-pasta.selecionada')");
    await app.avaliar("document.querySelector('.linha-pasta.selecionada').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await app.esperar("!document.querySelector('.linha-pasta.selecionada')");
  });

  // Pedido de 2026-11-05: apagar uma nota (vai para a lixeira, dá para recuperar).
  await t.test('nota vai para a lixeira só depois de confirmar', async () => {
    await abrir('rascunho.md');
    const menu = () => app.avaliar("(() => { const l = document.querySelector('.linha-nota[data-rel=\"rascunho.md\"]'); const r = l.getBoundingClientRect(); l.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 5 })); })()");
    await menu();
    await app.esperar("[...document.querySelectorAll('#menu-contexto li')].some((l) => /Mover para a lixeira/.test(l.textContent))");
    await app.avaliar("[...document.querySelectorAll('#menu-contexto li')].find((l) => /Mover para a lixeira/.test(l.textContent)).click()");
    await app.esperar("[...document.querySelectorAll('#menu-contexto li')].some((l) => /Confirmar: mover «rascunho» para a lixeira/.test(l.textContent))");
    assert.ok(require('fs').existsSync(require('path').join(app.casa, 'notas/rascunho.md')), 'o primeiro clique não apaga');
    await app.avaliar("[...document.querySelectorAll('#menu-contexto li')].find((l) => /Confirmar/.test(l.textContent)).click()");
    await app.esperar("!document.querySelector('.linha-nota[data-rel=\"rascunho.md\"]')", 8000);
    assert.ok(!require('fs').existsSync(require('path').join(app.casa, 'notas/rascunho.md')), 'saiu da pasta');
    assert.match(await app.avaliar("document.getElementById('estado-nota').textContent"), /lixeira/);
  });
});
