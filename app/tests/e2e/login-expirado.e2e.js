// Área: conversa (login do Claude expirado: um cartão em português no lugar do erro em inglês repetido)
// 23/11: com o login vencido, cada mensagem mostrava a mesma frase em inglês duas vezes (como
// resposta do Claude e como erro vermelho), e a cada nova tentativa mais duas. Agora aparece um
// cartão só, no estilo do app, com o que fazer: "Entrar de novo" cola `claude auth login` no
// terminal do app (não roda sozinho) e "Tentar de novo" reinicia o Claude da conversa.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const FRASE = /Failed to authenticate/;
const CARTOES = "document.querySelectorAll('#mensagens .cartao-login')";
const linhas = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } };

for (const idioma of ['pt-BR', 'en']) {
  test(`login do Claude expirado: um cartão só, com o que fazer (${idioma})`, async (t) => {
    const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
    process.env.CLAUDE_FALSO_LOG = log;
    const app = await abrirApp({ config: { mostrarBichinho: false, idioma } });
    t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
    await app.esperar('!!window.__orqTeste');
    const en = idioma === 'en';
    const id = await app.avaliar('window.orq.conversa.nova().then((i) => window.__orqTeste.trocar(i).then(() => i))');
    const mandar = async (texto) => {
      await app.avaliar(`window.orq.conversa.daCaixa(${JSON.stringify(id)}, ${JSON.stringify(texto)}, [], null, {})`);
    };
    const textoDaConversa = () => app.avaliar("document.getElementById('mensagens').innerText");

    await t.test('a primeira falha: o cartão, sem a frase em inglês como resposta nem o erro vermelho', async () => {
      await mandar('login expirado');
      await app.esperar(`${CARTOES}.length === 1 && document.getElementById('parar').hidden`, 10000);
      await app.espera(300);
      const c = await app.avaliar(`${CARTOES}[0].innerText`);
      if (en) {
        assert.match(c, /^Claude's login expired/);
        assert.match(c, /Sign in again/);
        assert.match(c, /Try again/);
      } else {
        assert.match(c, /^O login do Claude expirou/);
        assert.match(c, /não se renova sozinho/);
        assert.match(c, /claude auth login/);
        assert.match(c, /Entrar de novo/);
        assert.match(c, /Tentar de novo/);
      }
      assert.strictEqual(await app.avaliar("[...document.querySelectorAll('#mensagens .texto-claude')].filter((e) => /Failed to authenticate/.test(e.innerText)).length"), 0, 'a frase não vira resposta do Claude');
      assert.strictEqual(await app.avaliar("[...document.querySelectorAll('#mensagens .aviso-conversa.erro')].length"), 0, 'sem o erro vermelho repetido');
      // A frase original fica guardada, fechada, para quem quiser ver.
      assert.strictEqual(await app.avaliar(`${CARTOES}[0].querySelector('details').open`), false);
      assert.match(await app.avaliar(`${CARTOES}[0].querySelector('details code').textContent`), FRASE);
      assert.strictEqual((await textoDaConversa()).match(/Failed to authenticate/g), null, 'fechada, a frase não aparece');
    });

    await t.test('a mesma falha de novo não empilha: o cartão desce e conta as vezes', async () => {
      await mandar('login expirado');
      await app.esperar(`[...document.querySelectorAll('#mensagens .msg-voce')].length === 2 && document.getElementById('parar').hidden`, 10000);
      await app.esperar(`${CARTOES}.length === 1 && ${CARTOES}[0].dataset.vezes === '2'`, 5000);
      assert.match(await app.avaliar(`${CARTOES}[0].innerText`), en ? /It happened 2 times in a row\./ : /Aconteceu 2 vezes seguidas\./);
      assert.strictEqual(await app.avaliar(`${CARTOES}[0] === document.getElementById('mensagens').lastElementChild || !${CARTOES}[0].nextElementSibling || !${CARTOES}[0].nextElementSibling.querySelector('.msg-voce')`), true, 'o cartão fica depois da última mensagem');
      assert.strictEqual(await app.avaliar("[...document.querySelectorAll('#mensagens .aviso-conversa.erro')].length"), 0);
    });

    if (en) { assert.deepStrictEqual(app.erros, []); return; }

    await t.test('uma resposta que dá certo depois: a próxima falha volta a ser um cartão novo', async () => {
      await mandar('oi de novo');
      await app.esperar("[...document.querySelectorAll('#mensagens .texto-claude')].length > 0 && document.getElementById('parar').hidden", 10000);
      await mandar('login expirado');
      await app.esperar(`${CARTOES}.length === 2`, 10000);
      assert.strictEqual(await app.avaliar(`${CARTOES}[1].dataset.vezes`), '1');
    });

    await t.test('"Entrar de novo" cola o comando no terminal do app, sem apertar Enter', async () => {
      await app.avaliar(`[...${CARTOES}].pop().querySelector('[data-login-entrar]').click()`);
      await app.esperar("document.getElementById('aba-terminal').classList.contains('ativa')", 5000);
      await app.esperar("[...document.querySelectorAll('#mensagens .aviso-conversa')].some((a) => /Colei no terminal do app: claude auth login/.test(a.innerText))", 5000);
      assert.strictEqual(fs.existsSync(path.join(app.casa, '.claude', '.credentials.json')), false, 'nada rodou: só colou');
      await app.avaliar("document.querySelector('[data-aba=\"aba-orquestrador\"]').click()");
    });

    // A conversa é redesenhada do que o Claude guardou (o falso não guarda nada); o aviso fica no fim.
    await t.test('"Tentar de novo" reinicia o Claude da conversa e o aviso de que reiniciou fica depois do redesenho', async () => {
      const subidas = linhas(`${log}.ambiente`).length;
      await app.avaliar(`[...${CARTOES}].pop().querySelector('[data-login-tentar]').click()`);
      await app.esperar("[...document.querySelectorAll('#mensagens .aviso-conversa')].some((a) => /reiniciou com o login atual/.test(a.innerText))", 5000);
      for (let i = 0; i < 100 && linhas(`${log}.ambiente`).length <= subidas; i++) await app.espera(50);
      assert.ok(linhas(`${log}.ambiente`).length > subidas, 'o Claude da conversa subiu de novo');
    });

    await t.test('da conversa guardada: só o registro, sem os botões', async () => {
      await app.avaliar("window.__orqTeste.desenharEvento({ tipo: 'login', antigo: true, detalhe: 'Failed to authenticate: antiga' })");
      const c = await app.avaliar("[...document.querySelectorAll('#mensagens .cartao-login.antigo')].pop().innerText");
      assert.match(c, /^O login do Claude tinha expirado aqui/);
      assert.strictEqual(await app.avaliar("[...document.querySelectorAll('#mensagens .cartao-login.antigo')].pop().querySelectorAll('button').length"), 0);
      assert.deepStrictEqual(app.erros, []);
    });
  });
}
