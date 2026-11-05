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

  await t.test('janela estreita (900 px): botões da barra continuam visíveis', async () => {
    await app.tamanho(900, 680);
    await app.espera(400);
    for (const sel of ['#nova-conversa', '#botao-modelo', '#janela-fechar']) assert.strictEqual(await app.visivel(sel), 'ok', sel);
    const alturas = await app.avaliar("[...document.querySelectorAll('.sub-aba')].map((b) => b.getBoundingClientRect().height)");
    assert.ok(alturas.every((h) => h < 40), `abas quebraram: ${alturas}`);
    await app.tamanho(1480, 920);
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

test('janela: abrir o app de novo não sobe uma segunda cópia (M1)', async () => {
  const { spawn } = require('child_process');
  const app = await abrirApp();
  try {
    const p2 = spawn(process.env.ORQ_ELECTRON, [require('path').join(__dirname, '..', '..')], {
      env: { ...process.env, HOME: app.casa, ORQ_APP_TESTE: '1', ORQ_APP_E2E: '1' }, stdio: 'ignore',
    });
    const saiu = await new Promise((ok) => { const t = setTimeout(() => ok(false), 8000); p2.on('exit', () => { clearTimeout(t); ok(true); }); });
    if (!saiu) p2.kill();
    assert.ok(saiu, 'a segunda cópia continuou aberta (workflows e servidor de controle em dobro)');
    assert.strictEqual(await app.avaliar('1 + 1'), 2, 'a primeira continua de pé');
  } finally { await app.fechar(); }
});

test('janela: a atualização da lateral não roda sobreposta (M3)', async () => {
  const app = await abrirApp();
  try {
    await app.esperar('!!window.__orqLateral');
    const r = await app.avaliar(`(async () => {
      window.__orqLateral.medida.max = 0;
      await Promise.all([1, 2, 3, 4, 5, 6].map(() => window.__orqLateral.atualizar()));
      return window.__orqLateral.medida.max;
    })()`);
    assert.strictEqual(r, 1, `${r} atualizações ao mesmo tempo`);
    assert.deepStrictEqual(app.erros, []);
  } finally { await app.fechar(); }
});
