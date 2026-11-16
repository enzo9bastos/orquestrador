// Área: versao
// A versão instalada aparece em Configurações (ao lado de "Reiniciar o app"):
// o número do package.json e o commit, para a pessoa saber o que está rodando.
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');
const pacote = require('../../package.json');

test('versao: Configurações mostra a versão instalada e o commit', async (t) => {
  for (const idioma of ['pt-BR', 'en']) {
    await t.test(idioma, async () => {
      const app = await abrirApp({ config: { idioma } });
      try {
        await app.esperar('!!window.__orqTeste');
        const v = await app.avaliar('window.orq.app.versao()');
        assert.strictEqual(v.versao, pacote.version);
        assert.match(String(v.commit), /^[0-9a-f]{7,12}$/, 'o commit curto do código que está rodando');
        const esperado = `${pacote.version} · ${v.commit}`;
        await app.esperar(`(document.getElementById('versao-app') || {}).textContent === ${JSON.stringify(esperado)}`, 5000);
        await app.espera(300);
        const rotulo = await app.avaliar("document.getElementById('versao-app').closest('.config-linha').querySelector('strong').textContent");
        assert.strictEqual(rotulo, idioma === 'en' ? 'Version' : 'Versão');
        assert.deepStrictEqual(app.erros, []);
      } finally { await app.fechar(); }
    });
  }
});
