// Área: notas
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

const NOTION = '# Teste\n\nTexto com ==destaque== e <span style="color:#d44c47">vermelho</span>.\n\n> [!aviso]\n> Cuidado.\n\n<details>\n<summary>Abrir</summary>\n\nEscondido.\n\n</details>\n';

test('notas', async (t) => {
  const app = await abrirApp({
    config: { pastasNotas: [{ nome: 'Teste', caminho: '~/notas' }] },
    arquivos: { 'notas/notion.md': NOTION, 'notas/diario/2026-10-29.md': 'dia\n', 'notas/grande.md': '# G\n' + 'linha\n'.repeat(80000) },
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

  await t.test('arquivo grande abre só para leitura', async () => {
    await abrir('grande.md');
    assert.strictEqual(await app.avaliar("document.getElementById('estado-nota').textContent"), 'Só leitura');
    assert.strictEqual(await app.avaliar("document.querySelector('.tiptap').contentEditable"), 'false');
  });
});
