// Área: conversa (cartão de permissão completo; plano 6.4, protótipo P2 aprovado em 17/11/2026)
// Três saídas: permitir desta vez, permitir sempre (com o alcance: só esta conversa por
// padrão, este projeto, todos os projetos; mostrando a regra, o arquivo e como desfazer)
// e negar dizendo o que fazer em vez disso. O motivo da pergunta fica à vista. Comando da
// lista de recusa não ganha "sempre". Teclas 1 a 3 respondem o cartão em foco.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const linhas = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test('cartão de permissão completo', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  const respostas = () => linhas(log).filter((o) => o.type === 'control_response' && /^perm-/.test(o.response.request_id)).map((o) => o.response.response);
  const aberto = "document.querySelector('#mensagens .cartao-pedido:not(.respondido)')";
  const pedir = async (qual) => {
    await app.esperar("document.getElementById('parar').hidden", 10000);
    await app.avaliar(`window.orq.conversa.mandar('orquestrador', 'pede permissão ${qual}')`);
    await app.esperar(`!!${aberto}`, 8000);
  };
  const botoes = () => app.avaliar(`[...${aberto}.querySelectorAll('[data-perm]')].map((b) => b.dataset.perm)`);
  const clicar = (acao) => app.avaliar(`${aberto}.querySelector('[data-perm="${acao}"]').click()`);
  const ultimoFechado = "[...document.querySelectorAll('#mensagens .cartao-pedido.respondido')].pop().innerText";
  const esperarResposta = async (n) => { for (let i = 0; i < 50 && respostas().length < n; i++) await app.espera(100); assert.strictEqual(respostas().length, n); return respostas()[n - 1]; };

  await t.test('o cartão mostra o comando, o motivo da pergunta e as três saídas', async () => {
    await pedir('com sugestão');
    const texto = await app.avaliar(`${aberto}.innerText`);
    assert.match(texto, /npm test -- --so-unidade/);
    assert.match(texto, /Por que pergunta:\s*Este comando não está entre os que o modo roda sozinho\./);
    assert.deepStrictEqual(await botoes(), ['vez', 'sempre', 'negar']);
    assert.match(texto, /Permitir desta vez[\s\S]*Permitir sempre…[\s\S]*Negar…/);
  });

  await t.test('"Permitir sempre…": o padrão é só esta conversa; mostra a regra, o arquivo e como desfazer', async () => {
    await clicar('sempre');
    const v = await app.avaliar(`(() => { const c = ${aberto}; return { marcado: c.querySelector('input[name^="alcance"]:checked').value, texto: c.querySelector('.sempre-regra').innerText, botao: c.querySelector('[data-perm="confirmar-sempre"]').textContent, copia: c.querySelector('.sempre-copia').hidden }; })()`);
    assert.strictEqual(v.marcado, 'session');
    assert.match(v.texto, /Bash\(npm test:\*\)/);
    assert.match(v.texto, /nenhum/);
    assert.match(v.botao, /nesta conversa/);
    assert.strictEqual(v.copia, true, 'sem arquivo, sem aviso de cópia');
    await app.avaliar(`(() => { const r = ${aberto}.querySelector('input[value="localSettings"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const w = await app.avaliar(`(() => { const c = ${aberto}; return { texto: c.querySelector('.sempre-regra').innerText, botao: c.querySelector('[data-perm="confirmar-sempre"]').textContent, copia: c.querySelector('.sempre-copia').hidden }; })()`);
    assert.match(w.texto, /settings\.local\.json/);
    assert.match(w.botao, /neste projeto/);
    assert.strictEqual(w.copia, false);
    await clicar('confirmar-sempre');
    const r = await esperarResposta(1);
    assert.deepStrictEqual([r.behavior, r.updatedPermissions[0].destination, r.updatedPermissions[0].rules[0].ruleContent, r.decisionClassification], ['allow', 'localSettings', 'npm test:*', 'user_permanent']);
    assert.match(await app.avaliar(ultimoFechado), /Permitido sempre neste projeto[\s\S]*Bash\(npm test:\*\)[\s\S]*\/permissions/);
  });

  await t.test('"Voltar" desfaz a escolha; a tecla 1 com o cartão em foco permite desta vez', async () => {
    await pedir('com sugestão');
    await clicar('sempre');
    await clicar('voltar');
    assert.deepStrictEqual(await botoes(), ['vez', 'sempre', 'negar']);
    await app.avaliar(`${aberto}.focus()`);
    await app.tecla('1', 'Digit1', 49);
    const r = await esperarResposta(2);
    assert.deepStrictEqual([r.behavior, r.updatedPermissions, r.decisionClassification], ['allow', undefined, 'user_temporary']);
    assert.match(await app.avaliar(ultimoFechado), /Permitido desta vez[\s\S]*npm test/);
  });

  await t.test('"Negar…" leva o que fazer em vez disso; número digitado no campo não responde o cartão', async () => {
    await pedir('com sugestão');
    await app.avaliar(`${aberto}.focus()`);
    await app.tecla('3', 'Digit3', 51);
    await app.esperar(`!!${aberto}.querySelector('textarea')`);
    await app.avaliar(`${aberto}.querySelector('textarea').focus()`);
    await app.texto('rode só 1 arquivo');
    assert.strictEqual(respostas().length, 2, 'o "1" digitado no campo não permitiu');
    await clicar('confirmar-negar');
    const r = await esperarResposta(3);
    assert.strictEqual(r.behavior, 'deny');
    assert.match(r.message, /rode só 1 arquivo/);
    assert.match(await app.avaliar(ultimoFechado), /Negado[\s\S]*rode só 1 arquivo/);
  });

  await t.test('comando da lista de recusa: sem "sempre", e o cartão diz por quê', async () => {
    await pedir('docker');
    assert.deepStrictEqual(await botoes(), ['vez', 'negar']);
    assert.match(await app.avaliar(`${aberto}.innerText`), /não oferece "Permitir sempre"/);
    await app.avaliar(`${aberto}.focus()`);
    await app.tecla('2', 'Digit2', 50); // aqui o 2 é o Negar
    await app.esperar(`!!${aberto}.querySelector('textarea')`);
    await clicar('confirmar-negar');
    assert.strictEqual((await esperarResposta(4)).message, 'Negado pelo usuário no app.');
  });

  await t.test('sem regra sugerida pelo Claude: só "desta vez" e "negar", sem aviso', async () => {
    await pedir('sem sugestão');
    assert.deepStrictEqual(await botoes(), ['vez', 'negar']);
    assert.ok(!/Permitir sempre/.test(await app.avaliar(`${aberto}.innerText`)));
    await clicar('vez');
    await esperarResposta(5);
  });

  await t.test('pedido que o Claude cancela diz que foi ele (não "Respondido")', async () => {
    await app.esperar("document.getElementById('parar').hidden", 10000);
    await app.avaliar("window.orq.conversa.mandar('orquestrador', 'pede e cancela')");
    await app.esperar("[...document.querySelectorAll('#mensagens .cartao-pedido.respondido')].some((c) => /cancelado pelo Claude/.test(c.innerText))", 8000);
  });

  await t.test('com as teclas desligadas nas Configurações, o número não responde e a dica some', async () => {
    await app.avaliar("document.getElementById('abrir-config').click()");
    await app.esperar("!document.getElementById('config').hidden");
    await app.avaliar("document.querySelector('[data-secao-config=\"atalhos\"]').click()");
    assert.strictEqual(await app.avaliar("document.querySelector('[data-cfg=\"teclasNosCartoes\"]').checked"), true, 'vem ligado');
    await app.avaliar("document.querySelector('[data-cfg=\"teclasNosCartoes\"]').click()");
    await app.espera(300);
    await app.avaliar("document.getElementById('fechar-config').click()");
    await pedir('com sugestão');
    assert.ok(!/teclas/i.test(await app.avaliar(`${aberto}.innerText`)), 'sem a dica das teclas');
    await app.avaliar(`${aberto}.focus()`);
    await app.tecla('1', 'Digit1', 49);
    await app.espera(400);
    assert.strictEqual(respostas().length, 5, 'a tecla não respondeu');
    await clicar('vez');
    await esperarResposta(6);
  });

  // Antes o cartão dizia "Permitido sempre" mesmo quando o motor não tinha conseguido guardar a
  // cópia do arquivo e, por isso, permitido só desta vez (conserto de 17/11/2026).
  await t.test('sem conseguir guardar a cópia do arquivo, o "sempre" vale só desta vez e o cartão diz isso', async () => {
    const arq = path.join(app.casa, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    if (!fs.existsSync(arq)) fs.writeFileSync(arq, '{}\n');
    const copias = path.join(app.casa, '.local', 'share', 'orq-app', 'versoes', 'claude-settings');
    fs.mkdirSync(copias, { recursive: true });
    fs.chmodSync(copias, 0o500); // só leitura: a cópia falha
    t.after(() => { try { fs.chmodSync(copias, 0o700); } catch { /* a casa temporária já foi */ } });
    const antes = respostas().length;
    await pedir('com sugestão');
    await clicar('sempre');
    await app.avaliar(`(() => { const r = ${aberto}.querySelector('.alcances input[value="userSettings"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await clicar('confirmar-sempre');
    const r = await esperarResposta(antes + 1);
    assert.deepStrictEqual([r.behavior, r.updatedPermissions, r.decisionClassification], ['allow', undefined, 'user_temporary']);
    await app.esperar(`!${aberto}`, 8000);
    assert.match(await app.avaliar(ultimoFechado), /Permitido desta vez[\s\S]*a regra não foi gravada: o app não conseguiu guardar a cópia do arquivo antes/);
    assert.doesNotMatch(await app.avaliar(ultimoFechado), /Permitido sempre/);
    fs.chmodSync(copias, 0o700);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
