// Área: bichinho
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

test('bichinho', async (t) => {
  const app = await abrirApp();
  t.after(() => app.fechar());
  await app.esperar("!!document.querySelector('.pet')");
  await app.espera(800);

  await t.test('estados do orquestrador viram animação', async () => {
    for (const [modo, classe] of [['pensando', 'pensando'], ['trabalhando', 'trabalhando'], ['mandando', 'mandando'], ['chamando', 'chamando']]) {
      await app.avaliar(`window.__orqTeste.pet.definir('${modo}')`);
      assert.ok(await app.avaliar(`document.querySelector('.pet').classList.contains('${classe}')`), modo);
    }
    await app.avaliar("window.__orqTeste.pet.definir('livre')");
  });

  await t.test('arrastado para a lateral, fica preso nela e cai no chão dela', async () => {
    const p = await app.avaliar("(() => { const r = document.querySelector('.pet').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()");
    const alvo = await app.avaliar("(() => { const r = document.querySelector('.lateral').getBoundingClientRect(); return [r.left + r.width / 2, r.top + 120]; })()");
    await app.mouse('mousePressed', p[0], p[1]);
    for (let i = 1; i <= 10; i++) await app.mouse('mouseMoved', p[0] + (alvo[0] - p[0]) * i / 10, p[1] + (alvo[1] - p[1]) * i / 10);
    await app.espera(200);
    await app.mouse('mouseReleased', alvo[0], alvo[1]);
    await app.espera(2500);
    assert.strictEqual(await app.avaliar('window.__orqTeste.pet.salaNome'), 'esquerda');
    const dentro = await app.avaliar("(() => { const p = document.querySelector('.pet').getBoundingClientRect(), l = document.querySelector('.lateral').getBoundingClientRect(); return p.left >= l.left - 1 && p.right <= l.right + 1 && Math.abs(p.bottom - (l.bottom - 4)) < 6; })()");
    assert.ok(dentro, 'dentro da lateral e no chão');
  });
});
