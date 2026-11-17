// Área: conversa (menu ⋯ da barra e o botão único de Iniciar/Desligar do P1)
// Plano 1.1: a barra tem um ⋯ com as ações da conversa que já existem; Iniciar
// e Desligar só no orquestrador, um por vez na barra. Decisão de 17/11/2026:
// uma opção nas Configurações leva os dois para dentro do ⋯; o ⋯ do
// orquestrador sempre traz as duas ações, para nada ficar fora de alcance.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const linhas = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test('menu ⋯ e o botão de Iniciar/Desligar', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({ config: { mostrarBichinho: false, comandoInicial: '/rodada', comandoDesligar: '/fim' } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  const mandadas = () => linhas(log).filter((o) => o.type === 'user').map((o) => (typeof o.message.content === 'string' ? o.message.content : (o.message.content.find((b) => b.type === 'text') || {}).text));
  const escondido = (sel) => app.avaliar(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !e || e.hidden || e.offsetParent === null; })()`);
  const abrirMais = async () => { if (await app.avaliar("document.getElementById('menu-mais').hidden")) await app.avaliar("document.getElementById('chip-mais').click()"); await app.esperar("!document.getElementById('menu-mais').hidden"); };
  const acoes = () => app.avaliar("[...document.querySelectorAll('#menu-mais [data-acao]')].map((b) => b.dataset.acao)");
  const popupAberto = "!document.getElementById('popup').hidden";
  const fecharPopup = () => app.avaliar("document.getElementById('fechar-popup').click()");

  await t.test('antes da rodada a barra mostra só o Iniciar; o Desligar aparece quando a rodada abre', async () => {
    assert.strictEqual(await app.visivel('#iniciar-rodada'), 'ok');
    assert.ok(await escondido('#desligar'), 'sem rodada aberta não há o que desligar');
    await app.avaliar("document.getElementById('iniciar-rodada').click()");
    await app.esperar("!document.getElementById('desligar').hidden", 8000);
    assert.ok(await escondido('#iniciar-rodada'), 'rodada aberta: o Iniciar dá lugar ao Desligar');
    assert.strictEqual(await app.visivel('#desligar'), 'ok');
    assert.deepStrictEqual(mandadas(), ['/rodada']);
  });

  await t.test('o ⋯ junta as ações da conversa; no orquestrador traz sempre Iniciar e Desligar', async () => {
    assert.strictEqual(await app.visivel('#chip-mais'), 'ok');
    await abrirMais();
    assert.strictEqual(await app.visivel('#menu-mais'), 'ok');
    assert.deepStrictEqual(await acoes(), ['iniciar', 'desligar', 'btw', 'export', 'config', 'permissions', 'memory', 'status', 'exit']);
    await app.avaliar("document.getElementById('mensagens').click()");
    assert.ok(await escondido('#menu-mais'), 'clicar fora fecha');
  });

  for (const [acao, titulo] of [['config', /Configurações do Claude/], ['permissions', /Permissões/], ['status', /Status/]]) {
    await t.test(`⋯ › ${acao} abre o mesmo que o comando /${acao}`, async () => {
      await abrirMais();
      await app.avaliar(`document.querySelector('#menu-mais [data-acao="${acao}"]').click()`);
      await app.esperar(popupAberto, 8000);
      assert.match(await app.avaliar("document.getElementById('popup-titulo').textContent"), titulo);
      assert.ok(await escondido('#menu-mais'));
      await fecharPopup();
    });
  }

  await t.test('⋯ › Pergunta rápida abre a gaveta da pergunta rápida, com o teclado no campo dela', async () => {
    await abrirMais();
    await app.avaliar("document.querySelector('#menu-mais [data-acao=btw]').click()");
    await app.esperar("!document.getElementById('gaveta-lado').hidden");
    assert.ok(await app.avaliar("document.activeElement === document.getElementById('gaveta-lado-texto')"));
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').value"), '', 'o comando não precisa mais passar pela caixa');
    await app.avaliar("document.getElementById('gaveta-lado-fechar').click()");
    assert.ok(await app.avaliar("document.activeElement === document.getElementById('entrada')"), 'fechada, o teclado volta para a caixa da conversa');
  });

  await t.test('⋯ › Desligar a rodada confirma dentro do menu antes de mandar o comando', async () => {
    await abrirMais();
    await app.avaliar("document.querySelector('#menu-mais [data-acao=desligar]').click()");
    await app.esperar("!!document.querySelector('#menu-mais .menu-confirma')");
    assert.deepStrictEqual(mandadas(), ['/rodada'], 'nada mandado antes de confirmar');
    await app.avaliar("document.querySelector('#menu-mais .menu-confirma [data-cancelar]').click()");
    assert.ok(await app.avaliar("!document.querySelector('#menu-mais .menu-confirma')"));
    await app.avaliar("document.getElementById('mensagens').click()");
  });

  await t.test('conversa avulsa: sem Iniciar nem Desligar, na barra e no ⋯', async () => {
    await app.avaliar('window.orq.conversa.nova().then((id) => window.__orqTeste.trocar(id))');
    assert.ok(await escondido('#iniciar-rodada') && await escondido('#desligar'));
    await abrirMais();
    const a = await acoes();
    assert.ok(!a.includes('iniciar') && !a.includes('desligar'), JSON.stringify(a));
    await app.avaliar("document.getElementById('mensagens').click()");
    await app.avaliar("window.__orqTeste.trocar('orquestrador')");
    await app.esperar("!document.getElementById('desligar').hidden", 8000);
  });

  await t.test('Configurações › Orquestração › "No menu ⋯": os dois saem da barra e continuam no ⋯', async () => {
    await app.avaliar("document.getElementById('abrir-config').click()");
    await app.esperar("!document.getElementById('config').hidden");
    await app.avaliar("document.querySelector('[data-secao-config=\"orquestracao\"]').click()");
    await app.avaliar("document.querySelector('#config-iniciar-desligar [data-v=\"menu\"]').click()");
    await app.espera(300);
    await app.avaliar("document.getElementById('fechar-config').click()");
    assert.ok(await escondido('#iniciar-rodada') && await escondido('#desligar'), 'fora da barra');
    await abrirMais();
    const a = await acoes();
    assert.ok(a.includes('iniciar') && a.includes('desligar'), JSON.stringify(a));
    // Pelo menu, o Desligar manda o comando depois de confirmar.
    await app.avaliar("document.querySelector('#menu-mais [data-acao=desligar]').click()");
    await app.esperar("!!document.querySelector('#menu-mais .menu-confirma')");
    await app.avaliar("document.querySelector('#menu-mais .menu-confirma [data-confirmar]').click()");
    for (let i = 0; i < 50 && mandadas().length < 2; i++) await app.espera(100);
    assert.deepStrictEqual(mandadas(), ['/rodada', '/fim']);
  });

  await t.test('em 1000 px o ⋯ e o botão da rodada aparecem inteiros', async () => {
    await app.avaliar("document.getElementById('abrir-config').click()");
    await app.avaliar("document.querySelector('[data-secao-config=\"orquestracao\"]').click()");
    await app.avaliar("document.querySelector('#config-iniciar-desligar [data-v=\"barra\"]').click()");
    await app.espera(300);
    await app.avaliar("document.getElementById('fechar-config').click()");
    await app.tamanho(1000, 800);
    await app.espera(200);
    assert.strictEqual(await app.visivel('#chip-mais'), 'ok');
    assert.strictEqual(await app.visivel('#iniciar-rodada'), 'ok', 'a rodada acabou com o /fim: o Iniciar volta');
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
