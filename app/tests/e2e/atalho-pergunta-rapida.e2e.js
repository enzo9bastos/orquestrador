// Área: conversa (atalho de teclado da pergunta rápida, o /btw; Configurações › Atalhos)
// A gaveta da pergunta rápida abria só pelo /btw e pelo ⋯. Agora tem um atalho de teclado
// (Ctrl+Alt+P), que aparece nas Configurações › Atalhos e pode ser trocado ou desativado,
// como os das colunas. Não pode repetir um atalho do app nem o de uma coluna.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const VK = { Comma: 188, KeyP: 80, KeyJ: 74, Escape: 27 };
async function combo(app, code, key, modifiers = 3) {
  await app.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers, key, code, windowsVirtualKeyCode: VK[code] });
  await app.cdp('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key, code, windowsVirtualKeyCode: VK[code] });
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const ABERTA = "(() => { const g = document.getElementById('gaveta-lado'); return !g.hidden && getComputedStyle(g).display !== 'none'; })()";
const texto = (app, nome) => app.avaliar(`document.querySelector('[data-atalho-mudar="${nome}"]').textContent`);
const aviso = (app) => app.avaliar("document.getElementById('atalhos-aviso').innerText.trim()");
const config = (app) => JSON.parse(app.ler('.config/orq-app/config.json'));
const abrirAtalhosDasConfiguracoes = async (app) => {
  await app.avaliar("document.getElementById('abrir-config').click()");
  await app.avaliar("document.querySelector('[data-secao-config=\"atalhos\"]').click()");
};

test('atalho da pergunta rápida', async (t) => {
  process.env.CLAUDE_FALSO_LOG = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste && !!window.orqLado && !!window.orqColunas');
  await app.esperar("window.orqColunas.atalhoPergunta() === 'Ctrl+Alt+KeyP'");

  await t.test('Ctrl+Alt+P abre a gaveta com o teclado no campo dela; de novo, fecha e o teclado volta para a caixa', async () => {
    await app.avaliar("document.getElementById('entrada').focus()");
    await combo(app, 'KeyP', 'p');
    await app.esperar(ABERTA, 4000);
    await app.esperar("document.activeElement === document.getElementById('gaveta-lado-texto')");
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').value"), '', 'o atalho escreveu na caixa');
    assert.strictEqual(await app.avaliar("document.getElementById('gaveta-lado-texto').value"), '', 'o atalho escreveu no campo da gaveta');
    await combo(app, 'KeyP', 'p');
    await app.esperar(`!(${ABERTA})`, 4000);
    assert.ok(await app.avaliar("document.activeElement === document.getElementById('entrada')"));
  });

  await t.test('com as Configurações abertas, o atalho não abre a gaveta por trás', async () => {
    await abrirAtalhosDasConfiguracoes(app);
    await combo(app, 'KeyP', 'p');
    await espera(300);
    assert.strictEqual(await app.avaliar(ABERTA), false);
  });

  await t.test('Configurações › Atalhos mostra a linha da pergunta rápida, com Desativar e Voltar ao padrão', async () => {
    assert.strictEqual(await app.visivel('[data-atalho-mudar="pergunta"]'), 'ok');
    assert.strictEqual(await texto(app, 'pergunta'), 'Ctrl+Alt+P');
    assert.strictEqual(await app.avaliar("document.querySelector('[data-atalho-linha=\"pergunta\"] strong').innerText"), 'Abrir ou fechar a pergunta rápida');
    assert.strictEqual(await app.avaliar("document.querySelector('[data-atalho-padrao=\"pergunta\"]').disabled"), true, 'já está no padrão');
    assert.strictEqual(await app.avaliar("document.querySelector('[data-atalho-desligar=\"pergunta\"]').disabled"), false);
    // As linhas das colunas continuam como estavam.
    assert.strictEqual(await texto(app, 'agentes'), 'Ctrl+Alt+,');
    assert.strictEqual(await texto(app, 'demandas'), 'Ctrl+Alt+.');
  });

  await t.test('não pode repetir: a pergunta rápida não pega o atalho de uma coluna, nem a coluna o dela, nem um do app', async () => {
    await app.avaliar("document.querySelector('[data-atalho-mudar=\"pergunta\"]').click()");
    assert.match(await texto(app, 'pergunta'), /Aperte as teclas/);
    await combo(app, 'Comma', ',');
    assert.match(await aviso(app), /já é de outro atalho desta lista/);
    await combo(app, 'KeyJ', 'j', 0);
    assert.match(await aviso(app), /Use Ctrl, Alt ou Cmd/);
    await combo(app, 'Escape', 'Escape', 0);
    assert.strictEqual(await texto(app, 'pergunta'), 'Ctrl+Alt+P');
    await app.avaliar("document.querySelector('[data-atalho-mudar=\"agentes\"]').click()");
    await combo(app, 'KeyP', 'p');
    assert.match(await aviso(app), /já é de outro atalho desta lista/);
    await combo(app, 'Escape', 'Escape', 0);
    assert.strictEqual(await texto(app, 'agentes'), 'Ctrl+Alt+,');
    assert.strictEqual(config(app).atalhoPerguntaRapida, undefined, 'nada foi gravado');
    assert.strictEqual(config(app).atalhosColunas, undefined, 'nada foi gravado');
    assert.strictEqual(await app.avaliar("document.getElementById('config').hidden"), false, 'Esc cancelou a captura, não fechou as Configurações');
  });

  await t.test('combinação nova é capturada e gravada; a antiga deixa de valer e a nova abre e fecha a gaveta', async () => {
    await app.avaliar("document.querySelector('[data-atalho-mudar=\"pergunta\"]').click()");
    await combo(app, 'KeyJ', 'j');
    await app.esperar("document.querySelector('[data-atalho-mudar=\"pergunta\"]').textContent === 'Ctrl+Alt+J'");
    await espera(300);
    assert.strictEqual(config(app).atalhoPerguntaRapida, 'Ctrl+Alt+KeyJ');
    assert.deepStrictEqual(config(app).atalhosColunas, { agentes: 'Ctrl+Alt+Comma', demandas: 'Ctrl+Alt+Period' }, 'os atalhos das colunas mudaram junto');
    assert.strictEqual(await app.avaliar("document.querySelector('[data-atalho-padrao=\"pergunta\"]').disabled"), false);
    await app.avaliar("document.getElementById('fechar-config').click()");
    await app.avaliar("document.getElementById('entrada').focus()");
    await combo(app, 'KeyP', 'p');
    await espera(300);
    assert.strictEqual(await app.avaliar(ABERTA), false, 'o atalho antigo não deveria valer mais');
    await combo(app, 'KeyJ', 'j');
    await app.esperar(ABERTA, 4000);
    await combo(app, 'KeyJ', 'j');
    await app.esperar(`!(${ABERTA})`, 4000);
  });

  await t.test('a lista de atalhos do app (? Atalhos) mostra a combinação que está valendo', async () => {
    await app.avaliar("document.getElementById('abrir-atalhos').click()");
    await app.esperar("!document.getElementById('popup').hidden");
    const linha = await app.avaliar("[...document.querySelectorAll('#popup-corpo .linha-atalho')].map((l) => l.innerText.replace(/\\s+/g, ' ').trim()).find((x) => /pergunta rápida/.test(x))");
    assert.strictEqual(linha, 'Abrir ou fechar a pergunta rápida Ctrl+Alt+J');
    await app.avaliar("document.getElementById('fechar-popup').click()");
  });

  await t.test('desativar tira o atalho (a tecla não faz mais nada); o /btw e o ⋯ continuam abrindo; Voltar ao padrão religa', async () => {
    await abrirAtalhosDasConfiguracoes(app);
    await app.avaliar("document.querySelector('[data-atalho-desligar=\"pergunta\"]').click()");
    await app.esperar("document.querySelector('[data-atalho-mudar=\"pergunta\"]').textContent === 'Desligado'");
    await espera(300);
    assert.strictEqual(config(app).atalhoPerguntaRapida, '');
    await app.avaliar("document.getElementById('fechar-config').click()");
    await app.avaliar("document.getElementById('entrada').focus()");
    await combo(app, 'KeyJ', 'j');
    await combo(app, 'KeyP', 'p');
    await espera(300);
    assert.strictEqual(await app.avaliar(ABERTA), false, 'desligado não reage');
    await app.avaliar("document.getElementById('chip-mais').click()");
    await app.esperar("!document.getElementById('menu-mais').hidden");
    await app.avaliar("document.querySelector('#menu-mais [data-acao=btw]').click()");
    await app.esperar(ABERTA, 4000);
    await app.avaliar("document.getElementById('gaveta-lado-fechar').click()");
    await abrirAtalhosDasConfiguracoes(app);
    await app.avaliar("document.querySelector('[data-atalho-padrao=\"pergunta\"]').click()");
    await app.esperar("document.querySelector('[data-atalho-mudar=\"pergunta\"]').textContent === 'Ctrl+Alt+P'");
    await espera(300);
    assert.strictEqual(config(app).atalhoPerguntaRapida, 'Ctrl+Alt+KeyP');
    await app.avaliar("document.getElementById('fechar-config').click()");
    await combo(app, 'KeyP', 'p');
    await app.esperar(ABERTA, 4000);
    await combo(app, 'KeyP', 'p');
    await app.esperar(`!(${ABERTA})`, 4000);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

test('atalho da pergunta rápida: o que está gravado vale ao abrir o app, em inglês', async (t) => {
  process.env.CLAUDE_FALSO_LOG = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  const app = await abrirApp({ config: { idioma: 'en', mostrarBichinho: false, atalhoPerguntaRapida: 'Ctrl+Alt+KeyJ' } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste && !!window.orqLado && !!window.orqColunas');
  await app.esperar("window.orqColunas.atalhoPergunta() === 'Ctrl+Alt+KeyJ'");

  await t.test('a combinação gravada abre a gaveta; a linha nas Configurações vem em inglês', async () => {
    await app.avaliar("document.getElementById('entrada').focus()");
    await combo(app, 'KeyJ', 'j');
    await app.esperar(ABERTA, 4000);
    await combo(app, 'KeyJ', 'j');
    await app.esperar(`!(${ABERTA})`, 4000);
    await abrirAtalhosDasConfiguracoes(app);
    assert.strictEqual(await texto(app, 'pergunta'), 'Ctrl+Alt+J');
    assert.strictEqual(await app.avaliar("document.querySelector('[data-atalho-linha=\"pergunta\"] strong').innerText"), 'Open or close the quick question');
    assert.match(await app.avaliar("document.querySelector('[data-atalho-linha=\"pergunta\"] div span').innerText"), /^The \/btw drawer/);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

test('atalho da pergunta rápida: configuração antiga em que uma coluna já usa a mesma combinação', async (t) => {
  const app = await abrirApp({ config: { mostrarBichinho: false, atalhosColunas: { agentes: 'Ctrl+Alt+KeyP', demandas: 'Ctrl+Alt+Period' } } });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste && !!window.orqLado && !!window.orqColunas');
  await app.esperar("window.orqColunas.atalhos().agentes === 'Ctrl+Alt+KeyP'");

  await t.test('a coluna fica com a combinação e a pergunta rápida aparece desligada (nada abre duas coisas)', async () => {
    assert.strictEqual(await app.avaliar('window.orqColunas.atalhoPergunta()'), '');
    const antes = (await app.avaliar('window.orqColunas.estado()')).agentes;
    await combo(app, 'KeyP', 'p');
    await app.esperar(`window.orqColunas.estado().agentes === ${!antes}`, 4000);
    assert.strictEqual(await app.avaliar(ABERTA), false);
    await abrirAtalhosDasConfiguracoes(app);
    assert.strictEqual(await texto(app, 'pergunta'), 'Desligado');
    assert.strictEqual(await texto(app, 'agentes'), 'Ctrl+Alt+P');
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
