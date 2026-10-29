// Área: configuracoes
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

test('configuracoes', async (t) => {
  const app = await abrirApp({ config: { pastasNotas: [{ nome: 'Uma', caminho: '~/uma' }] }, arquivos: { 'uma/a.md': '' } });
  t.after(() => app.fechar());
  await app.avaliar("document.getElementById('abrir-config').click()");
  await app.esperar("!document.getElementById('config').hidden");

  await t.test('tudo o que é configurável aparece na engrenagem', async () => {
    const chaves = await app.avaliar("[...document.querySelectorAll('#config [data-cfg], #config [data-segmento]')].map((e) => e.dataset.cfg || e.dataset.segmento)");
    for (const k of ['mostrarBichinho', 'notificacoes.pedidos', 'notificacoes.respostas', 'comandoInicial', 'comandoDesligar', 'raizProjetos', 'niveis', 'pastaNotas', 'ignorar', 'linhaTarefa', 'comandoOrdem', 'rotuloContainer', 'pastaTranscript', 'ambiente']) {
      assert.ok(chaves.includes(k), `faltou na tela: ${k}`);
    }
    assert.ok(await app.avaliar("document.querySelectorAll('#config-pastas li code').length === 1"));
  });

  await t.test('desligar o bichinho grava no arquivo e esconde na hora', async () => {
    await app.avaliar("(() => { const c = document.querySelector('[data-cfg=\"mostrarBichinho\"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); })()");
    await app.esperar("document.getElementById('palco-pet').classList.contains('desligado')");
    assert.strictEqual(JSON.parse(app.ler('.config/orq-app/config.json')).mostrarBichinho, false);
  });

  await t.test('valor inválido não é gravado (expressão quebrada)', async () => {
    await app.avaliar("(() => { const c = document.querySelector('[data-cfg=\"ignorar\"]'); c.value = '([quebrada'; c.dispatchEvent(new Event('change', { bubbles: true })); })()");
    await app.espera(500);
    assert.notStrictEqual(JSON.parse(app.ler('.config/orq-app/config.json')).ignorar, '([quebrada');
  });
});
