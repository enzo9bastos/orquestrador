// Área: atualizacao (o aviso de versão nova na barra de cima e a atualização pelas Configurações)
// Pedido de 24/11: "uma notificação dentro do app quando tiver coisa pra atualizar". O app consulta
// o repositório de onde foi instalado; aqui esse repositório é uma pasta falsa (unit/repo-falso.js),
// sem rede. O app de teste nunca consulta o repositório de verdade.
const test = require('node:test');
const { pastaTemporaria } = require('../temporarias');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { abrirApp } = require('./app');
const { criar, AMB } = require('../unit/repo-falso');

const GIT = { GIT_CONFIG_GLOBAL: AMB.GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM: AMB.GIT_CONFIG_SYSTEM };
const FAIXA = "document.getElementById('faixa-atualizacao')";
const texto = (sel) => `(document.querySelector('${sel}') ? document.querySelector('${sel}').innerText.replace(/\\s+/g, ' ').trim() : null)`;
const versaoNoDisco = (r) => JSON.parse(fs.readFileSync(path.join(r.app, 'package.json'), 'utf8')).version;
const abrir = (r, config = {}, espera = '300') => abrirApp({ config: { mostrarBichinho: false, ...config }, env: { ...GIT, ORQ_ATUALIZACAO_PASTA: r.app, ORQ_ATUALIZACAO_ESPERA_MS: espera } });

test('atualização: o app de teste comum nunca consulta repositório nenhum', async () => {
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  try {
    await app.esperar('!!window.orqAtualizacao');
    await app.espera(1500);
    const e = await app.avaliar('window.orq.atualizacao.procurar()');
    assert.deepStrictEqual({ ligada: e.ligada, quando: e.quando, ultima: e.ultima }, { ligada: false, quando: 0, ultima: null });
    assert.strictEqual(await app.avaliar(`!!${FAIXA}`), false);
    assert.deepStrictEqual(app.erros, []);
  } finally { await app.fechar(); }
});

for (const idioma of ['pt-BR', 'en']) {
  test(`atualização: aviso de versão nova, o que mudou, Depois e Atualizar agora (${idioma})`, async (t) => {
    const en = idioma === 'en';
    const r = criar(pastaTemporaria('orq-atualiza-'));
    r.publicar('0.2.0', ['Second version']);
    r.publicar('0.3.0', ['Third version, first item', 'Third version, second item']);
    const app = await abrir(r, { idioma });
    t.after(() => app.fechar());
    await app.esperar('!!window.orqAtualizacao');

    await t.test('ao abrir, o app procura sozinho e o aviso aparece na barra de cima, sem cobrir nenhum botão', async () => {
      await app.esperar(`!!${FAIXA}`, 10000);
      await app.espera(300);
      assert.match(await app.avaliar(texto('#faixa-atualizacao')), en ? /^Version 0\.3\.0 available\. What changed Update now Later$/ : /^Versão 0\.3\.0 disponível\. O que mudou Atualizar agora Depois$/);
      assert.strictEqual(versaoNoDisco(r), '0.1.0', 'avisar não muda a pasta');
      for (const larg of [1480, 1000]) {
        await app.tamanho(larg, 900);
        await app.espera(250);
        const cobertos = await app.avaliar(`(() => { const c = (x) => x.getBoundingClientRect(); const f = c(${FAIXA}); return [...document.querySelectorAll('header.topo button, header.topo .contagem > *, header.topo .marca')].filter((x) => !x.closest('#faixa-atualizacao')).filter((x) => { const k = c(x); return k.width > 0 && k.left < f.right - 0.5 && k.right > f.left + 0.5 && k.top < f.bottom && k.bottom > f.top; }).map((x) => x.id || x.className); })()`);
        assert.deepStrictEqual(cobertos, [], `largura ${larg}`);
      }
      await app.tamanho(1480, 900);
    });

    await t.test('"O que mudou" abre as Configurações no bloco da atualização, com as notas de cada versão no caminho', async () => {
      await app.avaliar("document.getElementById('faixa-atualizacao-ver').click()");
      await app.esperar("!!document.querySelector('#config-nav [data-secao-config=\"orquestracao\"][aria-selected=\"true\"]')", 5000);
      await app.espera(300);
      assert.match(await app.avaliar(texto('#atualizacao-estado')), en ? /^Version 0\.3\.0 available\. You are on 0\.1\.0 ?\.$/ : /^Versão 0\.3\.0 disponível\. Você está na 0\.1\.0 ?\.$/);
      assert.match(await app.avaliar(texto('#atualizacao-aplicar')), en ? /^Update to 0\.3\.0$/ : /^Atualizar para a 0\.3\.0$/);
      assert.strictEqual(await app.visivel('#atualizacao-aplicar'), 'ok');
      const notas = await app.avaliar(texto('#atualizacao-notas'));
      assert.match(notas, en ? /^What changed/i : /^O que mudou/i);
      assert.match(notas, /0\.3\.0 · 2026-01-04 Third version, first item Third version, second item 0\.2\.0 · 2026-01-03 Second version$/);
      await app.avaliar("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    });

    await t.test('"Depois": o aviso desta versão não volta (nem procurando de novo); com versão mais nova, volta', async () => {
      await app.avaliar("document.getElementById('faixa-atualizacao-depois').click()");
      await app.espera(300);
      assert.strictEqual(await app.avaliar(`!!${FAIXA}`), false);
      assert.strictEqual(JSON.parse(app.ler('.config/orq-app/config.json')).atualizacaoAdiada, '0.3.0');
      await app.avaliar('window.orqAtualizacao.procurar()');
      await app.espera(300);
      assert.strictEqual(await app.avaliar(`!!${FAIXA}`), false, 'continua guardado');
      assert.strictEqual((await app.avaliar('window.orqAtualizacao.estado()')).ultima.versao, '0.3.0', 'as Configurações continuam sabendo');
      r.publicar('0.4.0', ['Fourth version']);
      await app.avaliar('window.orqAtualizacao.procurar()');
      await app.esperar(`!!${FAIXA} && /0\\.4\\.0/.test(${FAIXA}.innerText)`, 8000);
    });

    await t.test('"Atualizar agora": a pasta do app avança até a versão, o aviso dá lugar ao pedido de reinício', async () => {
      await app.avaliar("document.getElementById('faixa-atualizacao-agora').click()");
      await app.esperar("!!document.getElementById('faixa-reinicio')", 10000);
      assert.strictEqual(versaoNoDisco(r), '0.4.0');
      assert.strictEqual(r.git(r.instalada, 'rev-parse', 'HEAD'), r.git(r.instalada, 'rev-parse', 'v0.4.0^{commit}'));
      assert.strictEqual(await app.avaliar(`!!${FAIXA}`), false);
      await app.espera(300);
      assert.match(await app.avaliar(texto('#faixa-reinicio')), en ? /^Update ready/ : /^Atualização pronta/);
      assert.match(await app.avaliar(texto('#atualizacao-estado')), en ? /^Version 0\.4\.0 downloaded\. Restart the app to apply it\.$/ : /^Versão 0\.4\.0 baixada\. Reinicie o app para aplicar\.$/);
      assert.strictEqual(await app.avaliar("document.getElementById('atualizacao-aplicar').hidden"), true);
      assert.deepStrictEqual(app.erros, []);
    });
  });
}

test('atualização: pasta do app mexida à mão: o aviso não oferece atualizar, as Configurações dizem por quê e nada é tocado', async () => {
  const r = criar(pastaTemporaria('orq-atualiza-'));
  r.publicar('0.2.0', ['Second version']);
  fs.writeFileSync(path.join(r.app, 'main.js'), '// mexido por mim\n');
  const app = await abrir(r);
  try {
    await app.esperar(`!!${FAIXA}`, 10000);
    assert.match(await app.avaliar(texto('#faixa-atualizacao')), /^Versão 0\.2\.0 disponível\. O que mudou Depois$/);
    await app.avaliar("document.getElementById('faixa-atualizacao-ver').click()");
    await app.espera(400);
    assert.strictEqual(await app.avaliar("document.getElementById('atualizacao-aplicar').hidden"), true);
    const notas = await app.avaliar(texto('#atualizacao-notas'));
    assert.match(notas, /^Há arquivos do app mexidos à mão nesta pasta\..*Veja o que está mexido: cd .*instalada && git status O que mudou/i);
    assert.strictEqual(fs.readFileSync(path.join(r.app, 'main.js'), 'utf8'), '// mexido por mim\n');
    assert.strictEqual(versaoNoDisco(r), '0.1.0');
    assert.deepStrictEqual(app.erros, []);
  } finally { await app.fechar(); }
});

test('atualização: "Atualizar sozinho" ligado baixa a versão nova sem perguntar e só pede o reinício', async () => {
  const r = criar(pastaTemporaria('orq-atualiza-'));
  r.publicar('0.2.0', ['Second version']);
  // Procura 1 ms depois de o app abrir: a versão é baixada antes de a tela carregar, e o pedido de
  // reinício que o processo principal manda nessa hora se perde. A tela tem de pedir mesmo assim.
  const app = await abrir(r, { atualizacaoSozinha: true }, '1');
  try {
    await app.esperar("!!document.getElementById('faixa-reinicio')", 10000);
    assert.strictEqual(versaoNoDisco(r), '0.2.0');
    assert.strictEqual(await app.avaliar(`!!${FAIXA}`), false, 'sem o aviso de versão nova: já baixou');
    assert.deepStrictEqual(app.erros, []);
  } finally { await app.fechar(); }
});

test('atualização: com "Avisar quando sair versão nova" desligado o app não procura sozinho; o botão das Configurações procura', async () => {
  const r = criar(pastaTemporaria('orq-atualiza-'));
  r.publicar('0.2.0', ['Second version']);
  const app = await abrir(r, { atualizacaoAvisar: false });
  try {
    await app.esperar('!!window.orqAtualizacao');
    await app.espera(2500);
    assert.strictEqual((await app.avaliar('window.orq.atualizacao.estado()')).quando, 0, 'não procurou');
    assert.strictEqual(await app.avaliar(`!!${FAIXA}`), false);
    assert.strictEqual(r.git(r.instalada, 'tag', '--list', 'v0.2.0'), '', 'nem buscou no remoto');
    await app.avaliar("document.getElementById('abrir-config').click(); document.querySelector('#config-nav [data-secao-config=\"orquestracao\"]').click(); document.getElementById('atualizacao-procurar').click()");
    await app.esperar(`!!${FAIXA}`, 10000);
    assert.match(await app.avaliar(texto('#atualizacao-estado')), /^Versão 0\.2\.0 disponível\. Você está na 0\.1\.0 ?\.$/);
    // As duas chaves aparecem como estão gravadas: avisar desligado, atualizar sozinho desligado.
    assert.deepStrictEqual(await app.avaliar("[document.querySelector('[data-cfg=atualizacaoAvisar]').checked, document.querySelector('[data-cfg=atualizacaoSozinha]').checked]"), [false, false]);
    assert.deepStrictEqual(app.erros, []);
  } finally { await app.fechar(); }
});
