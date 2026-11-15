// Área: notas
// Nota com Markdown que o editor não consegue montar (10 000 ">" aninhados
// estouravam a pilha): abre só para leitura, como texto puro, com aviso; o
// editor continua salvando o que se digita nas outras notas.
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

const FUNDA = `${'>'.repeat(10000)} fundo demais\n`;

test('notas: Markdown patológico', async (t) => {
  const app = await abrirApp({
    config: { pastasNotas: [{ nome: 'Teste', caminho: '~/notas' }] },
    arquivos: { 'notas/rascunho.md': '# Rascunho\n\nTexto.\n', 'notas/funda.md': FUNDA },
  });
  t.after(() => app.fechar());
  const abrir = async (rel) => {
    await app.avaliar("document.getElementById('estado-nota').textContent = ''");
    await app.avaliar(`document.querySelector('.linha-nota[data-rel="${rel}"]').click()`);
    await app.esperar("document.getElementById('estado-nota').textContent !== ''", 8000);
    await app.espera(300);
  };
  const digitarNoFim = async (txt) => {
    await app.avaliar("(() => { const p = [...document.querySelectorAll('.tiptap p')].pop(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); document.querySelector('.tiptap').focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()");
    await app.texto(txt);
  };
  await app.avaliar("document.querySelector('[data-aba=aba-notas]').click()");
  await app.esperar("!!document.querySelector('.linha-nota[data-rel=\"funda.md\"]')");

  await t.test('a nota funda abre só para leitura, com o texto puro e o aviso', async () => {
    await abrir('rascunho.md');
    await digitarNoFim(' antes');
    await app.esperar("document.getElementById('estado-nota').textContent === 'Salvo'", 6000);
    const t0 = Date.now();
    await abrir('funda.md');
    assert.ok(Date.now() - t0 < 6000, `abriu em ${Date.now() - t0} ms, sem travar`);
    assert.strictEqual(await app.avaliar("document.getElementById('estado-nota').textContent"), 'Só leitura');
    assert.match(await app.avaliar("document.getElementById('aviso-nota').innerText"), /não consegue montar.*só para leitura/s);
    assert.ok(!(await app.avaliar("!!document.querySelector('#aviso-nota [data-editar-mesmo]')")), 'sem "Editar mesmo assim": editar travaria de novo');
    assert.strictEqual(await app.avaliar("document.querySelector('.nota-crua').value"), FUNDA);
    assert.ok(await app.avaliar("document.querySelector('.nota-crua').readOnly"));
    assert.ok(await app.avaliar("document.getElementById('editor-nota').hidden"));
    // O texto puro aparece na folha (a folha rola; o começo dele está à vista).
    assert.ok(await app.avaliar("(() => { const c = document.querySelector('.nota-crua'), r = c.getBoundingClientRect(); return r.top < innerHeight - 40 && document.elementFromPoint(r.left + 20, r.top + 20) === c; })()"));
    assert.strictEqual(app.ler('notas/rascunho.md').includes('antes'), true, 'o que foi digitado antes ficou salvo');
  });

  await t.test('depois dela, o que se digita na outra nota é salvo', async () => {
    await abrir('rascunho.md');
    assert.ok(await app.avaliar("!document.querySelector('.nota-crua') && !document.getElementById('editor-nota').hidden"));
    assert.match(await app.avaliar("document.querySelector('.tiptap').innerText"), /Texto\. antes/);
    await digitarNoFim(' depois');
    await app.esperar("document.getElementById('estado-nota').textContent === 'Salvo'", 6000);
    assert.match(app.ler('notas/rascunho.md'), /Texto\. antes depois/);
    assert.strictEqual(app.ler('notas/funda.md'), FUNDA, 'a nota funda não foi tocada');
  });

  await t.test('sem erros na tela', () => {
    assert.deepStrictEqual(app.erros, []);
  });
});
