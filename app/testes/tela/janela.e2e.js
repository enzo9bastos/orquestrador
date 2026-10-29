// Área: janela
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

test('janela', async (t) => {
  const app = await abrirApp({ config: { comandoInicial: '/rodada', pastasNotas: [{ nome: 'N', caminho: '~/n' }] }, arquivos: { 'n/a.md': '# a' } });
  t.after(() => app.fechar());

  // Regressão 2026-10-28: com o topo inteiro arrastável, no Wayland nenhum
  // botão do topo recebia clique (o X e o Exit não fechavam o app).
  await t.test('regressão: nenhum botão do topo fica dentro de área de arraste', async () => {
    const ruins = await app.avaliar(`[...document.querySelectorAll('.topo button')]
      .filter((b) => b.closest('.arrasta') || getComputedStyle(b).webkitAppRegion === 'drag').map((b) => b.id || b.className)`);
    assert.deepStrictEqual(ruins, []);
  });

  await t.test('a tela abre sem nenhum erro de script', async () => {
    assert.deepStrictEqual(app.erros, []);
  });

  await t.test('topo tem minimizar, maximizar e fechar; o Exit saiu', async () => {
    assert.ok(await app.avaliar("!!document.getElementById('janela-fechar') && !!document.getElementById('janela-min')"));
    assert.ok(await app.avaliar("!document.getElementById('sair-app')"));
  });

  // Regressão 2026-10-29: em janela estreita as abas quebravam em duas linhas.
  await t.test('regressão: abas do painel nunca quebram linha', async () => {
    const alturas = await app.avaliar("[...document.querySelectorAll('.sub-aba')].map((b) => b.getBoundingClientRect().height)");
    assert.ok(alturas.every((h) => h < 40), `alturas: ${alturas}`);
  });
});
