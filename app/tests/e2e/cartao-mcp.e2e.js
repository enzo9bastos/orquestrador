// Área: conversa (cartão do pedido de dado de um servidor MCP; protótipo P2 aprovado em 17/11/2026)
// Antes o app recusava esse pedido. Agora mostra quem pede (o servidor), o que pede, um
// formulário com campo de segredo mascarado, e as saídas Enviar, Recusar e Cancelar. No
// modo página mostra o site e só abre o navegador com um clique de verdade.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const linhas = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test('cartão do pedido de dado do MCP', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  const respostas = () => linhas(log).filter((o) => o.type === 'control_response' && /^el-/.test(o.response.request_id)).map((o) => o.response.response);
  const aberto = "document.querySelector('#mensagens .cartao-mcp:not(.respondido)')";
  const fechado = "[...document.querySelectorAll('#mensagens .cartao-mcp.respondido')].pop()";
  const pedir = async (qual = '') => {
    await app.esperar("document.getElementById('parar').hidden", 10000);
    await app.avaliar(`window.orq.conversa.mandar('orquestrador', 'pede dado do MCP${qual}')`);
    await app.esperar(`!!${aberto}`, 8000);
  };
  const clicar = (acao) => app.avaliar(`${aberto}.querySelector('[data-mcp="${acao}"]').click()`);
  const preencher = (nome, valor) => app.avaliar(`(() => { const c = ${aberto}.querySelector('[data-campo="${nome}"]'); c.value = ${JSON.stringify(valor)}; c.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const esperarResposta = async (n) => { for (let i = 0; i < 50 && respostas().length < n; i++) await app.espera(100); assert.strictEqual(respostas().length, n); return respostas()[n - 1]; };
  const clicarDeVerdade = async (seletor) => {
    const r = await app.avaliar(`(() => { const e = ${aberto}.querySelector(${JSON.stringify(seletor)}); e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    await app.mouse('mousePressed', r.x, r.y); await app.mouse('mouseReleased', r.x, r.y);
  };

  await t.test('o cartão diz quem pede e o que pede; o campo de segredo é mascarado', async () => {
    await pedir();
    const v = await app.avaliar(`(() => { const c = ${aberto}; return { texto: c.innerText, tipos: [...c.querySelectorAll('[data-campo]')].map((x) => [x.dataset.campo, x.tagName === 'SELECT' ? 'lista' : x.type]), opcoes: [...c.querySelectorAll('[data-campo="ambiente"] option')].map((o) => o.textContent), botoes: [...c.querySelectorAll('[data-mcp]')].map((b) => b.dataset.mcp) }; })()`);
    assert.match(v.texto, /cofre-da-equipe[\s\S]*pede um dado/);
    assert.match(v.texto, /Informe o código para liberar a consulta\./);
    assert.match(v.texto, /vai só para esse servidor/);
    assert.deepStrictEqual(v.tipos, [['codigo', 'password'], ['ambiente', 'lista']]);
    assert.ok(v.opcoes.includes('Homologação') && v.opcoes.includes('Produção'));
    assert.deepStrictEqual(v.botoes, ['enviar', 'recusar', 'cancelar']);
  });

  await t.test('sem o campo obrigatório, ou com ele errado, nada vai: o cartão diz qual campo', async () => {
    await clicar('enviar');
    await app.esperar(`/falta preencher/.test(${aberto}.querySelector('.erro-mcp').textContent)`, 4000);
    await preencher('codigo', '12');
    await clicar('enviar');
    await app.esperar(`/pelo menos 6/.test(${aberto}.querySelector('.erro-mcp').textContent)`, 4000);
    assert.strictEqual(respostas().length, 0);
  });

  await t.test('preenchido certo: vai só o que foi pedido, e o segredo não fica na tela', async () => {
    await preencher('codigo', 'S3gr3d');
    await app.avaliar(`(() => { const c = ${aberto}.querySelector('[data-campo="ambiente"]'); c.value = 'producao'; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await clicar('enviar');
    assert.deepStrictEqual(await esperarResposta(1), { action: 'accept', content: { codigo: 'S3gr3d', ambiente: 'producao' } });
    const texto = await app.avaliar(`${fechado}.innerText`);
    assert.match(texto, /Enviado ao servidor[\s\S]*cofre-da-equipe/);
    assert.match(texto, /Código de verificação: •••/);
    assert.match(texto, /Ambiente: Produção/);
    assert.ok(!(await app.avaliar('document.body.innerHTML')).includes('S3gr3d'), 'o segredo não está em lugar nenhum da página');
  });

  await t.test('Recusar e Cancelar o pedido respondem ao servidor sem mandar nada', async () => {
    await pedir();
    await preencher('codigo', 'ABCDEF');
    await clicar('recusar');
    assert.deepStrictEqual(await esperarResposta(2), { action: 'decline' });
    assert.match(await app.avaliar(`${fechado}.innerText`), /Recusado/);
    await pedir();
    await clicar('cancelar');
    assert.deepStrictEqual(await esperarResposta(3), { action: 'cancel' });
    assert.match(await app.avaliar(`${fechado}.innerText`), /cancelado/i);
  });

  await t.test('formulário que o app não sabe mostrar: diz o problema e só deixa recusar ou cancelar', async () => {
    await pedir(' torto');
    const v = await app.avaliar(`(() => { const c = ${aberto}; return { texto: c.innerText, botoes: [...c.querySelectorAll('[data-mcp]')].map((b) => b.dataset.mcp) }; })()`);
    assert.match(v.texto, /não sabe mostrar/);
    assert.deepStrictEqual(v.botoes, ['recusar', 'cancelar']);
    await clicar('recusar');
    await esperarResposta(4);
  });

  await t.test('pedido de abrir uma página: mostra o site; só o clique de verdade abre e responde', async () => {
    await pedir(' por página');
    const v = await app.avaliar(`(() => { const c = ${aberto}; return { texto: c.innerText, site: c.querySelector('.site-mcp').textContent, botoes: [...c.querySelectorAll('[data-mcp]')].map((b) => b.dataset.mcp) }; })()`);
    assert.strictEqual(v.site, 'contas.exemplo.com');
    assert.match(v.texto, /https:\/\/contas\.exemplo\.com\/autorizar/);
    assert.match(v.texto, /Confira o site antes de abrir/);
    assert.deepStrictEqual(v.botoes, ['abrir', 'recusar']);
    await clicar('abrir'); // por código: não vale
    await app.espera(400);
    assert.strictEqual(respostas().length, 4);
    await clicarDeVerdade('[data-mcp="abrir"]');
    assert.deepStrictEqual(await esperarResposta(5), { action: 'accept' });
    assert.match(await app.avaliar(`${fechado}.innerText`), /Página aberta no navegador[\s\S]*contas\.exemplo\.com/);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
