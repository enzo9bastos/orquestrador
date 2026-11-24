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

  // Pedido de 2026-11-06: pasta some da árvore (esconder) ou vai para a lixeira.
  await t.test('pasta: esconder tira das notas sem apagar; mostra de novo pelo espaço vazio', async () => {
    const fs = require('fs'), path = require('path');
    fs.mkdirSync(path.join(app.casa, 'notas/midias/sub'), { recursive: true });
    fs.writeFileSync(path.join(app.casa, 'notas/midias/a.md'), '# a');
    fs.writeFileSync(path.join(app.casa, 'notas/midias/sub/b.md'), '# b');
    fs.writeFileSync(path.join(app.casa, 'notas/midias/video.mp4'), 'x');
    await app.avaliar("document.querySelector('[data-acao=atualizar]').click()");
    await app.esperar("!!document.querySelector('.linha-pasta[data-pasta-rel=\"midias\"]')");
    const menuPasta = () => app.avaliar("(() => { const l = document.querySelector('.linha-pasta[data-pasta-rel=\"midias\"]'); const r = l.getBoundingClientRect(); l.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 5 })); })()");
    const clicarItem = (re) => app.avaliar(`[...document.querySelectorAll('#menu-contexto li')].find((l) => ${re}.test(l.textContent)).click()`);
    await menuPasta();
    await app.esperar("[...document.querySelectorAll('#menu-contexto li')].some((l) => /Esconder das notas \\(não apaga nada\\)/.test(l.textContent))");
    await clicarItem('/Esconder das notas/');
    await app.esperar("!document.querySelector('.linha-pasta[data-pasta-rel=\"midias\"]')", 5000);
    assert.ok(fs.existsSync(path.join(app.casa, 'notas/midias/sub/b.md')), 'continua no computador');
    // Espaço vazio da árvore: Pastas escondidas (1)… › Mostrar de novo.
    await app.avaliar("(() => { const a = document.getElementById('arvore-notas'); const r = a.getBoundingClientRect(); a.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.bottom - 10 })); })()");
    await app.esperar("[...document.querySelectorAll('#menu-contexto li')].some((l) => /Pastas escondidas \\(1\\)/.test(l.textContent))");
    await clicarItem('/Pastas escondidas/');
    await app.esperar("[...document.querySelectorAll('#menu-contexto li')].some((l) => /Mostrar «midias» de novo/.test(l.textContent))");
    await clicarItem('/Mostrar «midias» de novo/');
    await app.esperar("!!document.querySelector('.linha-pasta[data-pasta-rel=\"midias\"]')", 5000);
  });

  await t.test('pasta: lixeira só depois de confirmar, dizendo o que vai junto', async () => {
    const fs = require('fs'), path = require('path');
    const menuPasta = () => app.avaliar("(() => { const l = document.querySelector('.linha-pasta[data-pasta-rel=\"midias\"]'); const r = l.getBoundingClientRect(); l.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 5 })); })()");
    await menuPasta();
    await app.esperar("[...document.querySelectorAll('#menu-contexto li')].some((l) => /Mover para a lixeira… \\(apaga do computador\\)/.test(l.textContent))");
    await app.avaliar("[...document.querySelectorAll('#menu-contexto li')].find((l) => /apaga do computador/.test(l.textContent)).click()");
    await app.esperar("[...document.querySelectorAll('#menu-contexto li')].some((l) => /Confirmar: mover a pasta «midias» para a lixeira \\(2 notas, 3 arquivos no total, 1 subpasta\\)/.test(l.textContent))");
    assert.ok(fs.existsSync(path.join(app.casa, 'notas/midias')), 'o primeiro clique não apaga');
    await app.avaliar("[...document.querySelectorAll('#menu-contexto li')].find((l) => /Confirmar/.test(l.textContent)).click()");
    await app.esperar("!document.querySelector('.linha-pasta[data-pasta-rel=\"midias\"]')", 8000);
    assert.ok(!fs.existsSync(path.join(app.casa, 'notas/midias')), 'saiu da pasta de notas');
    assert.match(await app.avaliar("document.getElementById('estado-nota').textContent"), /foi para a lixeira/);
    assert.deepStrictEqual(app.erros, []);
  });
});

// Pedido de 24/11: "cliquei no X e sumiu tudo; quero que funcione igual ao Obsidian e ao Notion: ele
// só fecha a janela dele, os arquivos continuam ali". As abas de cima passaram a ser as notas
// abertas, e a árvore mostra sempre todas as pastas do app. (Em 16/11 o ✕ da aba de uma pasta
// tinha deixado de tirar a pasta do app; mesmo assim ele escondia a árvore inteira.)
test('notas: as abas de cima são as notas abertas; o ✕ fecha só a nota e os arquivos continuam na árvore', async (t) => {
  const app = await abrirApp({ config: { mostrarBichinho: false, pastasNotas: [{ nome: 'Trabalho', caminho: '~/trabalho' }, { nome: 'Estudos', caminho: '~/estudos' }] },
    arquivos: { 'trabalho/reuniao.md': '# Reunião\n', 'trabalho/pauta.md': '# Pauta\n', 'estudos/curso.md': '# Curso\n' } });
  t.after(() => app.fechar());
  const abas = () => app.avaliar("[...document.querySelectorAll('#abas-notas .aba-nota')].map((e) => (e.classList.contains('ativa') ? '*' : '') + e.querySelector('[data-aba-nota] span').textContent)");
  const arvore = () => app.avaliar("[...document.querySelectorAll('#arvore-notas .linha-arvore .nome')].map((e) => e.textContent)");
  const naConfig = () => JSON.parse(app.ler('.config/orq-app/config.json')).pastasNotas.map((p) => p.nome);
  const titulo = () => app.avaliar("document.getElementById('pagina-nota').hidden ? null : document.getElementById('titulo-nota').textContent");
  const clicarNota = (raiz, rel, opcoes = '{ bubbles: true }', tipo = 'click') => app.avaliar(`document.querySelector('#arvore-notas [data-raiz="${raiz}"] [data-rel="${rel}"]').dispatchEvent(new MouseEvent('${tipo}', ${opcoes}))`);
  const esperarTitulo = (nome) => app.esperar(`!document.getElementById('pagina-nota').hidden && document.getElementById('titulo-nota').textContent === '${nome}'`, 6000);
  const clicarAba = (nome) => app.avaliar(`[...document.querySelectorAll('#abas-notas [data-aba-nota]')].find((b) => b.textContent.trim() === '${nome}').click()`);
  const fecharAba = (nome) => app.avaliar(`[...document.querySelectorAll('#abas-notas .aba-nota')].find((e) => e.querySelector('[data-aba-nota]').textContent.trim() === '${nome}').querySelector('[data-fechar-aba]').click()`);
  const TUDO = ['Trabalho', 'pauta', 'reuniao', 'Estudos', 'curso'];
  await app.avaliar("document.querySelector('[data-aba=aba-notas]').click()");
  await app.esperar("document.querySelectorAll('#arvore-notas .linha-raiz').length === 2", 8000);

  await t.test('a árvore mostra as duas pastas do app com as notas de cada uma; sem nota aberta, nenhuma aba', async () => {
    assert.deepStrictEqual(await arvore(), TUDO);
    assert.deepStrictEqual(await abas(), []);
    assert.match(await app.avaliar("document.getElementById('vazio-nota').innerText"), /Nenhuma nota aberta[\s\S]*Escolha uma nota à esquerda/);
    assert.strictEqual(await app.avaliar("document.getElementById('nome-pasta-ativa').textContent"), 'Notas');
  });

  await t.test('abrir uma nota cria a aba dela; o ✕ fecha só a nota: as pastas e os arquivos continuam na árvore', async () => {
    await clicarNota(0, 'reuniao.md');
    await esperarTitulo('reuniao');
    assert.deepStrictEqual(await abas(), ['*reuniao']);
    assert.strictEqual(await app.avaliar("document.querySelector('#abas-notas [data-fechar-aba]').title"), 'Fechar esta nota (ela continua na pasta)');
    await fecharAba('reuniao');
    await app.esperar("document.getElementById('pagina-nota').hidden", 4000);
    assert.deepStrictEqual(await abas(), []);
    assert.deepStrictEqual(await arvore(), TUDO, 'os arquivos continuam ali');
    assert.deepStrictEqual(naConfig(), ['Trabalho', 'Estudos'], 'as duas pastas continuam no app');
    assert.match(app.ler('trabalho/reuniao.md'), /^# Reunião\n/, 'o arquivo continua no disco, com o conteúdo');
    assert.strictEqual(await app.avaliar("document.getElementById('caminho-nota').textContent"), '', 'o caminho da nota fechada não fica escrito em cima');
    assert.match(await app.avaliar("document.getElementById('vazio-nota').innerText"), /Nenhuma nota aberta/);
    assert.strictEqual(await app.avaliar("/Pasta|Tirar|Reabrir/.test(document.getElementById('abas-notas').innerText + document.getElementById('vazio-nota').innerText)"), false, 'nada de aba de pasta, "+ Pasta" ou "Reabrir"');
  });

  await t.test('o clique abre na aba da frente; Ctrl+clique e o botão do meio abrem em outra aba; nota que já tem aba só vem para a frente', async () => {
    await clicarNota(0, 'reuniao.md');
    await esperarTitulo('reuniao');
    await clicarNota(0, 'pauta.md');
    await esperarTitulo('pauta');
    assert.deepStrictEqual(await abas(), ['*pauta'], 'a nota entrou no lugar da que estava na aba da frente');
    await clicarNota(1, 'curso.md', '{ bubbles: true, ctrlKey: true }');
    await esperarTitulo('curso');
    assert.deepStrictEqual(await abas(), ['pauta', '*curso']);
    await clicarNota(0, 'reuniao.md', '{ bubbles: true, button: 1 }', 'auxclick');
    await esperarTitulo('reuniao');
    assert.deepStrictEqual(await abas(), ['pauta', 'curso', '*reuniao']);
    await clicarAba('pauta');
    await esperarTitulo('pauta');
    assert.deepStrictEqual(await abas(), ['*pauta', 'curso', 'reuniao']);
    await clicarNota(1, 'curso.md');
    await esperarTitulo('curso');
    assert.deepStrictEqual(await abas(), ['pauta', '*curso', 'reuniao'], 'sem aba repetida');
    assert.strictEqual(await app.avaliar("document.querySelector('#arvore-notas [data-raiz=\"1\"] [data-rel=\"curso.md\"]').classList.contains('ativo')"), true, 'a árvore marca a nota da frente');
  });

  await t.test('fechar outra aba não mexe na nota aberta; fechar a da frente passa para a vizinha', async () => {
    await fecharAba('pauta');
    await app.espera(300);
    assert.deepStrictEqual(await abas(), ['*curso', 'reuniao']);
    assert.strictEqual(await titulo(), 'curso');
    await fecharAba('curso');
    await esperarTitulo('reuniao');
    assert.deepStrictEqual(await abas(), ['*reuniao']);
    assert.deepStrictEqual(await arvore(), TUDO);
  });

  await t.test('depois de recarregar, as abas e a nota da frente voltam', async () => {
    await clicarNota(0, 'pauta.md', '{ bubbles: true, ctrlKey: true }');
    await esperarTitulo('pauta');
    assert.deepStrictEqual(await abas(), ['reuniao', '*pauta']);
    await app.avaliar('location.reload()');
    await app.espera(800);
    await app.esperar('!!window.orqNotas', 8000);
    await app.avaliar("document.querySelector('[data-aba=aba-notas]').click()");
    await esperarTitulo('pauta');
    assert.deepStrictEqual(await abas(), ['reuniao', '*pauta']);
  });

  await t.test('nota que vai para a lixeira leva a aba dela; a vizinha assume', async () => {
    await app.avaliar("document.querySelector('#arvore-notas [data-raiz=\"0\"] [data-rel=\"pauta.md\"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }))");
    await app.esperar("!document.getElementById('menu-contexto').hidden", 4000);
    assert.match(await app.avaliar("document.getElementById('menu-contexto').innerText"), /Abrir[\s\S]*Abrir em outra aba/);
    await app.avaliar("[...document.querySelectorAll('#menu-contexto li')].find((l) => /Mover para a lixeira/.test(l.textContent)).click()");
    await app.esperar("[...document.querySelectorAll('#menu-contexto li')].some((l) => /Confirmar: mover «pauta»/.test(l.textContent))", 4000);
    await app.avaliar("[...document.querySelectorAll('#menu-contexto li')].find((l) => /Confirmar/.test(l.textContent)).click()");
    await esperarTitulo('reuniao');
    assert.deepStrictEqual(await abas(), ['*reuniao']);
    assert.deepStrictEqual(await arvore(), ['Trabalho', 'reuniao', 'Estudos', 'curso']);
  });

  await t.test('com mais de uma pasta no app, cada uma abre e recolhe na árvore; recolher não fecha nota nenhuma', async () => {
    await app.avaliar("document.querySelector('#arvore-notas [data-raiz-linha=\"1\"]').click()");
    await app.espera(200);
    assert.deepStrictEqual(await arvore(), ['Trabalho', 'reuniao', 'Estudos']);
    assert.strictEqual(await app.avaliar("document.querySelector('#arvore-notas [data-raiz-linha=\"1\"]').getAttribute('aria-expanded')"), 'false');
    assert.deepStrictEqual(await abas(), ['*reuniao']);
    await app.avaliar("document.querySelector('#arvore-notas [data-raiz-linha=\"1\"]').click()");
    await app.espera(200);
    assert.deepStrictEqual(await arvore(), ['Trabalho', 'reuniao', 'Estudos', 'curso']);
  });

  await t.test('quem tinha fechado a aba de uma pasta no jeito antigo volta a ver a pasta na árvore', async () => {
    const ids = await app.avaliar('window.orq.notas.pastas().then((l) => l.map((p) => p.id))');
    await app.avaliar(`localStorage.setItem('notas-abas-fechadas', ${JSON.stringify(JSON.stringify(ids))}); location.reload()`);
    await app.espera(800);
    await app.esperar('!!window.orqNotas', 8000);
    await app.avaliar("document.querySelector('[data-aba=aba-notas]').click()");
    await app.esperar("document.querySelectorAll('#arvore-notas .linha-raiz').length === 2", 8000);
    assert.deepStrictEqual(await arvore(), ['Trabalho', 'reuniao', 'Estudos', 'curso']);
  });
  assert.deepStrictEqual(app.erros, []);
});

// O caso do usuário: uma pasta só. A árvore mostra a pasta direto (sem a linha da pasta), e fechar
// a nota não esconde os arquivos, não troca o nome da pasta nem a tira do app.
test('notas: com uma pasta só, fechar a nota deixa a árvore como está; em inglês a dica do ✕ está traduzida', async (t) => {
  const app = await abrirApp({ config: { mostrarBichinho: false, idioma: 'en', pastaNotas: '~/casa', pastasNotas: [{ nome: 'Casa', caminho: '~/casa' }] }, arquivos: { 'casa/lista.md': '# Lista\n' } });
  t.after(() => app.fechar());
  await app.esperar("document.documentElement.lang === 'en'", 6000);
  await app.avaliar("document.querySelector('[data-aba=aba-notas]').click()");
  await app.esperar("!!document.querySelector('#arvore-notas [data-rel=\"lista.md\"]')", 8000);
  assert.strictEqual(await app.avaliar("document.querySelectorAll('#arvore-notas .linha-raiz').length"), 0, 'uma pasta só: sem a linha da pasta');
  assert.strictEqual(await app.avaliar("document.getElementById('nome-pasta-ativa').textContent"), 'Casa');
  await app.avaliar("document.querySelector('#arvore-notas [data-rel=\"lista.md\"]').click()");
  await app.esperar("document.querySelectorAll('#abas-notas .aba-nota').length === 1", 6000);
  assert.strictEqual(await app.avaliar("document.querySelector('#abas-notas [data-fechar-aba]').title"), 'Close this note (it stays in the folder)');
  await app.avaliar("document.querySelector('#abas-notas [data-fechar-aba]').click()");
  await app.esperar("document.querySelectorAll('#abas-notas .aba-nota').length === 0", 4000);
  await app.espera(400);
  assert.strictEqual(await app.avaliar("!!document.querySelector('#arvore-notas [data-rel=\"lista.md\"]')"), true, 'o arquivo continua na árvore');
  assert.deepStrictEqual(JSON.parse(app.ler('.config/orq-app/config.json')).pastasNotas, [{ nome: 'Casa', caminho: `${app.casa}/casa` }]);
  assert.match(await app.avaliar("document.getElementById('vazio-nota').innerText"), /No note open/);
  assert.deepStrictEqual(app.erros, []);
});
