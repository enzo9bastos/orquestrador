// Área: navegador
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');
const { abrirApp } = require('./app');

const PAGINA = `<!doctype html><meta name="viewport" content="width=device-width"><title>Site de teste</title>
<h1>Olá do site</h1><p id="largura"></p>
<input id="nome" placeholder="Seu nome"><button id="ok" onclick="document.getElementById('saida').textContent = 'Recebi ' + document.getElementById('nome').value">Enviar</button>
<p id="saida"></p><a href="/dois">Ir para a dois</a>
<script>document.getElementById('largura').textContent = 'largura ' + innerWidth</script>`;

test('navegador', async (t) => {
  const site = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(req.url === '/dois' ? '<title>Dois</title><p>Página dois</p>' : req.url === '/ua' ? `<pre>${req.headers['user-agent']}</pre>` : PAGINA);
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${site.address().port}`;
  const app = await abrirApp();
  t.after(async () => { await app.fechar(); site.close(); });
  // Assíncrono de propósito: o site de teste roda neste mesmo processo, e uma
  // chamada que trava o processo deixaria a página sem resposta.
  const nav = (...a) => new Promise((ok) => {
    execFile(process.execPath, [path.join(__dirname, '..', '..', 'bin', 'orq-nav'), ...a], { env: { ...process.env, HOME: app.casa }, encoding: 'utf8', timeout: 60000 },
      (erro, saida, err) => ok({ ok: !erro, saida: saida.trim(), erro: err.trim() }));
  });

  await t.test('aba existe; sem janela mostra o convite para abrir', async () => {
    await app.avaliar("document.querySelector('[data-aba=aba-navegador]').click()");
    await app.esperar("!!document.querySelector('.vazio-nav')");
    assert.strictEqual(await app.visivel('#nova-janela-nav'), 'ok');
  });

  await t.test('orq-nav abre uma janela e lê o texto da página', async () => {
    const r = (await nav('abrir', base));
    assert.ok(r.ok, r.erro);
    assert.match(r.saida, /^n1/);
    await app.esperar("document.querySelectorAll('.painel-navegador').length === 1");
    const tx = (await nav('texto'));
    assert.ok(tx.ok, tx.erro);
    assert.match(tx.saida, /Olá do site/);
    assert.match((await nav('listar')).saida, /n1 +\[padrao\] +Site de teste/);
    assert.strictEqual(await app.avaliar("document.querySelector('.painel-navegador .endereco').value"), `${base}/`);
  });

  await t.test('orq-nav: elementos numerados, digitar e clicar de verdade', async () => {
    const el = (await nav('elementos'));
    assert.match(el.saida, /\[1\] input:text {2}Seu nome/);
    assert.match(el.saida, /\[2\] button {2}Enviar/);
    assert.ok((await nav('digitar', '1', 'Enzo')).ok);
    assert.ok((await nav('clicar', '2')).ok);
    assert.match((await nav('texto')).saida, /Recebi Enzo/);
    assert.ok((await nav('clicar', 'a[href="/dois"]')).ok);
    assert.match((await nav('texto')).saida, /Página dois/);
    assert.ok((await nav('voltar')).ok);
    assert.match((await nav('texto')).saida, /Olá do site/);
  });

  await t.test('a janela mostra, ao vivo, que o orquestrador está mexendo', async () => {
    (await nav('texto'));
    await app.esperar("!document.querySelector('.painel-navegador .selo-controle').hidden");
    assert.match(await app.avaliar("document.querySelector('.selo-controle').textContent"), /Orquestrador: lendo a página/);
  });

  await t.test('preset de celular: identidade de iPhone e tela de 390 px', async () => {
    assert.ok((await nav('preset', 'iphone')).ok);
    await app.esperar("document.querySelector('.painel-navegador').classList.contains('celular')");
    await app.espera(800);
    assert.match((await nav('js', 'navigator.userAgent')).saida, /iPhone/);
    assert.match((await nav('texto')).saida, /largura 390/);
    assert.ok((await nav('ir', `${base}/ua`)).ok);
    assert.match((await nav('texto')).saida, /iPhone/, 'o site recebe o user-agent do iPhone');
    assert.ok((await nav('preset', 'firefox')).ok);
    await app.esperar("!document.querySelector('.painel-navegador').classList.contains('celular')");
    await app.espera(800);
    assert.match((await nav('texto')).saida, /Firefox/);
  });

  await t.test('padrão não se apresenta como Electron', async () => {
    assert.ok((await nav('preset', 'padrao')).ok);
    await app.espera(800);
    assert.doesNotMatch((await nav('texto')).saida, /Electron|orq/i);
  });

  await t.test('print grava um PNG', async () => {
    const r = (await nav('print'));
    assert.ok(r.ok, r.erro);
    assert.match(r.saida, /\.png$/);
    assert.ok(require('fs').statSync(r.saida).size > 1000);
  });

  await t.test('só http/https: arquivo do disco é recusado', async () => {
    const r = (await nav('ir', 'file:///etc/passwd'));
    assert.ok(!r.ok);
    assert.match(r.erro, /só endereços http ou https/);
  });

  await t.test('pela tela: + Nova janela, digitar o endereço e Enter', async () => {
    await app.avaliar("document.getElementById('nova-janela-nav').click()");
    await app.esperar("document.querySelectorAll('.painel-navegador').length === 2");
    await app.avaliar(`(() => { const c = document.querySelectorAll('.painel-navegador .endereco')[1]; c.focus(); c.value = ${JSON.stringify(`${base}/dois`.replace('http://', ''))}; c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await app.esperar("document.querySelectorAll('.painel-navegador')[1].title === 'Dois'", 8000);
    assert.match((await nav('listar')).saida, /n2 .*Dois/);
    assert.strictEqual(await app.visivel('.painel-navegador[data-id=n2] .barra-navegador'), 'ok');
  });

  await t.test('as janelas voltam abertas depois de recarregar a tela', async () => {
    await app.avaliar('location.reload()');
    await app.espera(800);
    await app.esperar("!!window.orqNavegador && window.orqNavegador.janelas().length === 2", 8000);
    await app.esperar("document.querySelectorAll('.painel-navegador')[1]?.title === 'Dois'", 8000);
  });

  await t.test('fechar pela tela e pelo orq-nav', async () => {
    await app.avaliar("document.querySelector('[data-aba=aba-navegador]').click()");
    await app.avaliar("document.querySelector('.painel-navegador[data-id=n2] [data-nav=fechar]').click()");
    assert.ok((await nav('fechar', '--janela', 'n1')).ok);
    await app.esperar("document.querySelectorAll('.painel-navegador').length === 0 && !!document.querySelector('.vazio-nav')");
    assert.strictEqual((await nav('listar')).saida, 'nenhuma janela aberta');
  });

  await t.test('com a aba fechada, ela não cobre as outras', async () => {
    (await nav('abrir', base));
    await app.avaliar("document.querySelector('[data-aba=aba-orquestrador]').click()");
    await app.espera(300);
    assert.strictEqual(await app.visivel('#entrada'), 'ok');
    assert.match((await nav('texto')).saida, /Olá do site/, 'a página continua usável com a aba escondida');
  });

  // Pedido de 2026-10-30: no máximo 4 janelas (6 ficava apertado demais).
  await t.test('no máximo 4 janelas, em grade 2×2', async () => {
    for (let i = 0; i < 4; i++) await nav('abrir', base);
    await app.avaliar("document.querySelector('[data-aba=aba-navegador]').click()");
    await app.esperar("document.querySelectorAll('.painel-navegador').length === 4");
    const r = await nav('abrir', base);
    assert.ok(!r.ok);
    assert.match(r.erro, /já há 4 janelas/);
    assert.ok(await app.avaliar("document.getElementById('nova-janela-nav').disabled"));
    assert.strictEqual(await app.avaliar("getComputedStyle(document.getElementById('navegadores')).gridTemplateColumns.split(' ').length"), 2);
    for (const j of await app.avaliar('window.orqNavegador.janelas()')) await nav('fechar', '--janela', j.id);
    await app.esperar("document.querySelectorAll('.painel-navegador').length === 0");
  });

  await t.test('engrenagem: opção de deixar o orquestrador usar o navegador', async () => {
    await app.avaliar("document.getElementById('abrir-config').click()");
    await app.esperar("document.querySelector('[data-cfg=navegadorControle]').checked === true");
    await app.avaliar("document.getElementById('config-aba-navegador').click()");
    await app.avaliar("document.querySelector('[data-cfg=navegadorControle]').closest('.config-linha').scrollIntoView({ block: 'center' })");
    assert.strictEqual(await app.visivel('[data-cfg=navegadorControle] + span'), 'ok');
    await app.tecla('Escape');
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
