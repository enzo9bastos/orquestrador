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

  // Seções: navegação à esquerda, um painel por vez.
  const visiveis = "[...document.querySelectorAll('#config .config-painel')].filter((p) => !p.hidden).map((p) => p.dataset.secao)";
  const aba = (id) => app.avaliar(`document.getElementById('config-aba-${id}').click()`);

  await t.test('seções: todo controle mora numa seção e só uma aparece por vez', async () => {
    assert.deepStrictEqual(await app.avaliar("[...document.querySelectorAll('#config-nav [role=tab]')].map((a) => a.dataset.secaoConfig)"),
      ['aparencia', 'idioma', 'notificacoes', 'orquestracao', 'ias', 'projetos', 'notas', 'avancado']);
    assert.strictEqual(await app.avaliar("[...document.querySelectorAll('#config [data-cfg], #config [data-segmento]')].filter((e) => !e.closest('.config-painel')).length"), 0);
    assert.strictEqual((await app.avaliar(visiveis)).length, 1);
    await aba('notificacoes');
    assert.deepStrictEqual(await app.avaliar(visiveis), ['notificacoes']);
    assert.strictEqual(await app.avaliar("document.getElementById('config-aba-notificacoes').getAttribute('aria-selected')"), 'true');
    assert.strictEqual(await app.visivel('[data-cfg="notificacoes.pedidos"] + span'), 'ok');
  });

  await t.test('seções: controle de outra seção continua gravando', async () => {
    await aba('avancado');
    assert.strictEqual(await app.visivel('[data-cfg="rotuloContainer"]'), 'ok');
    await app.avaliar("(() => { const c = document.querySelector('[data-cfg=\"rotuloContainer\"]'); c.value = 'meu.rotulo'; c.dispatchEvent(new Event('change', { bubbles: true })); })()");
    for (let i = 0; i < 30 && !app.ler('.config/orq-app/config.json').includes('meu.rotulo'); i++) await app.espera(100);
    assert.strictEqual(JSON.parse(app.ler('.config/orq-app/config.json')).rotuloContainer, 'meu.rotulo');
    await aba('projetos');
    await app.avaliar("document.querySelector('[data-segmento=\"niveis\"] button[data-v=\"2\"]').click()");
    await app.esperar("document.querySelector('[data-segmento=\"niveis\"] button[data-v=\"2\"]').getAttribute('aria-pressed') === 'true'");
    assert.strictEqual(JSON.parse(app.ler('.config/orq-app/config.json')).niveis, 2);
  });

  await t.test('seções: setas do teclado andam entre as seções', async () => {
    await aba('idioma');
    await app.avaliar("document.getElementById('config-aba-idioma').focus()");
    await app.tecla('ArrowDown', 'ArrowDown', 40);
    assert.deepStrictEqual(await app.avaliar(visiveis), ['notificacoes']);
    assert.strictEqual(await app.avaliar('document.activeElement.id'), 'config-aba-notificacoes');
    await app.tecla('End', 'End', 35);
    assert.deepStrictEqual(await app.avaliar(visiveis), ['avancado']);
    await app.tecla('ArrowDown', 'ArrowDown', 40);
    assert.deepStrictEqual(await app.avaliar(visiveis), ['aparencia'], 'da última volta à primeira');
  });

  await t.test('busca: mostra só as linhas que casam, de qualquer seção', async () => {
    await app.avaliar("(() => { const b = document.getElementById('config-busca'); b.value = 'transcripts'; b.dispatchEvent(new Event('input')); })()");
    assert.deepStrictEqual(await app.avaliar(visiveis), ['avancado']);
    assert.strictEqual(await app.avaliar("[...document.querySelectorAll('#config .config-linha')].filter((l) => l.offsetParent).length"), 1);
    await app.avaliar("(() => { const b = document.getElementById('config-busca'); b.value = 'notificacoes'; b.dispatchEvent(new Event('input')); })()");
    assert.deepStrictEqual(await app.avaliar(visiveis), ['notificacoes'], 'sem acento também acha');
    await app.avaliar("(() => { const b = document.getElementById('config-busca'); b.value = 'zzzz nada'; b.dispatchEvent(new Event('input')); })()");
    assert.deepStrictEqual(await app.avaliar(visiveis), []);
    assert.strictEqual(await app.avaliar("document.getElementById('config-sem-resultado').hidden"), false);
    await app.avaliar("document.getElementById('config-busca').focus()");
    await app.tecla('Escape', 'Escape', 27);
    assert.strictEqual(await app.avaliar("document.getElementById('config').hidden"), false, 'Esc com busca só limpa a busca');
    assert.deepStrictEqual(await app.avaliar(visiveis), ['aparencia']);
  });

  await t.test('janela estreita: as seções viram uma fileira em cima', async () => {
    await app.tamanho(460, 760);
    await app.espera(200);
    assert.strictEqual(await app.avaliar("getComputedStyle(document.getElementById('config-nav')).flexDirection"), 'row');
    await aba('orquestracao');
    assert.strictEqual(await app.visivel('#config-aba-orquestracao'), 'ok');
    assert.strictEqual(await app.visivel('[data-cfg="comandoInicial"]'), 'ok');
    assert.strictEqual(await app.visivel('#config .config-com-secoes'), 'ok', 'a janela cabe inteira');
    assert.strictEqual(await app.avaliar("(() => { const p = document.getElementById('config-paineis'); return p.scrollWidth <= p.clientWidth; })()"), true, 'sem rolagem de lado');
    await app.cdp('Emulation.clearDeviceMetricsOverride');
  });

  await t.test('a última seção aberta volta ao abrir de novo (mesmo depois de recarregar)', async () => {
    await aba('notas');
    await app.avaliar("document.getElementById('fechar-config').click()");
    await app.cdp('Page.reload');
    await app.espera(400);
    await app.esperar("document.readyState === 'complete' && !!window.orq");
    await app.avaliar("document.getElementById('abrir-config').click()");
    await app.esperar("!document.getElementById('config').hidden");
    assert.deepStrictEqual(await app.avaliar(visiveis), ['notas']);
    assert.strictEqual(await app.avaliar('document.activeElement.id'), 'config-aba-notas');
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
