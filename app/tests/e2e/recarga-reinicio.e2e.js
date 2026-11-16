// Área: recarga
// Publicação que muda o processo principal: a tela não recarrega sozinha (ficaria
// falando com o processo antigo); aparece a faixa pedindo o reinício. A decisão
// "recarrega ou pede reinício" está no teste de unidade (recarga.test.js).
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

test('recarga: a faixa de reinício aparece, traduz e não some sozinha', async (t) => {
  for (const idioma of ['pt-BR', 'en']) {
    await t.test(idioma, async () => {
      const app = await abrirApp({ config: { idioma } });
      try {
        await app.esperar('!!window.orqAvisoDeReinicio');
        assert.strictEqual(await app.avaliar("typeof window.orq.app.aoPrecisarReiniciar"), 'function', 'a ponte não avisa a tela');
        await app.avaliar('window.orqAvisoDeReinicio(); window.orqAvisoDeReinicio()');
        assert.strictEqual(await app.avaliar("document.querySelectorAll('#faixa-reinicio').length"), 1, 'uma faixa só');
        assert.strictEqual(await app.visivel('#faixa-reinicio-agora'), 'ok');
        await app.espera(300);
        const txt = await app.avaliar("document.getElementById('faixa-reinicio').innerText");
        assert.match(txt, idioma === 'en' ? /Update ready[\s\S]*Restart now[\s\S]*Later/ : /Atualização pronta[\s\S]*Reiniciar agora[\s\S]*Depois/);
        await app.avaliar("document.getElementById('faixa-reinicio-depois').click()");
        assert.strictEqual(await app.avaliar("!!document.getElementById('faixa-reinicio')"), false);
        assert.deepStrictEqual(app.erros, []);
      } finally { await app.fechar(); }
    });
  }
});
