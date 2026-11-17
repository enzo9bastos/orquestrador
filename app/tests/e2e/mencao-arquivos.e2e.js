// Área: conversa ("@" da caixa com arquivos; plano 4.3)
// O "@" passa a sugerir também os arquivos da pasta da conversa, pedidos ao Claude
// (os mesmos que o terminal mostra), em grupos: Arquivos, Notas, Workflows, com no
// máximo 6 por grupo. Resposta velha é descartada, e com o motor trabalhando o app
// não pede nada ao Claude (o "@" continua com notas e workflows).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const linhas = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test('"@" com arquivos', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  Object.assign(process.env, { CLAUDE_FALSO_LOG: log, CLAUDE_FALSO_ARQUIVOS_LENTO: 'e:700' });
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; delete process.env.CLAUDE_FALSO_ARQUIVOS_LENTO; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  const pedidos = () => linhas(log).filter((o) => o.type === 'control_request' && o.request && o.request.subtype === 'file_suggestions').map((o) => o.request.query);
  const digitar = (texto) => app.avaliar(`(() => { const e = document.getElementById('entrada'); e.focus(); e.value = ${JSON.stringify(texto)}; e.setSelectionRange(e.value.length, e.value.length); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const lista = () => app.avaliar("[...document.querySelectorAll('#sugestoes > li')].map((li) => (li.classList.contains('grupo-sugestao') ? `# ${li.textContent.trim()}` : li.querySelector('.nome-comando').textContent.trim()))");
  const doGrupo = async (nome) => { const l = await lista(); const i = l.indexOf(`# ${nome}`); if (i < 0) return null; const fim = l.findIndex((x, j) => j > i && x.startsWith('# ')); return l.slice(i + 1, fim < 0 ? undefined : fim); };
  // A conversa aberta e parada.
  await app.avaliar("window.orq.conversa.mandar('orquestrador', 'oi')");
  await app.esperar("[...document.querySelectorAll('#mensagens .texto-claude')].length > 0 && document.getElementById('parar').hidden", 10000);

  await t.test('"@bot" mostra o grupo Arquivos com o que o Claude sugere', async () => {
    await digitar('olha o @bot');
    await app.esperar("!!document.querySelector('#sugestoes .grupo-sugestao')", 4000);
    assert.deepStrictEqual(await doGrupo('Arquivos'), ['@src/botao.css', '@src/botao.test.js']);
    assert.ok(pedidos().includes('bot'));
  });

  await t.test('escolher insere o caminho no lugar do que foi digitado', async () => {
    await app.tecla('Enter', 'Enter', 13);
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').value"), 'olha o @src/botao.css ');
    assert.strictEqual(await app.avaliar("document.getElementById('sugestoes').hidden"), true);
  });

  await t.test('no máximo 6 arquivos, e os grupos vêm na ordem Arquivos, Notas, Workflows (e depois Demandas, Recados, Agentes)', async () => {
    await digitar('@doc');
    await app.esperar("document.querySelectorAll('#sugestoes .grupo-sugestao').length >= 1 && [...document.querySelectorAll('#sugestoes .nome-comando')].some((x) => /docs\\//.test(x.textContent))", 4000);
    const arquivos = await doGrupo('Arquivos');
    assert.strictEqual(arquivos.length, 6, JSON.stringify(arquivos));
    assert.strictEqual(arquivos[0], '@docs/');
    await digitar('@');
    await app.esperar("[...document.querySelectorAll('#sugestoes .grupo-sugestao')].map((x) => x.textContent.trim()).join() === 'Arquivos,Notas,Workflows,Demandas,Recados,Agentes'", 4000);
    assert.deepStrictEqual(await doGrupo('Arquivos'), ['@src/', '@LEIAME.md', '@docs/'], 'sem texto: o que está na raiz da pasta');
    assert.deepStrictEqual(await doGrupo('Notas'), ['@nota:']);
    assert.deepStrictEqual(await doGrupo('Workflows'), ['@workflow:']);
  });

  await t.test('resposta velha que chega depois é descartada', async () => {
    await digitar('@e');           // o falso demora 700 ms nesta
    await app.espera(300);         // o pedido de "e" já saiu
    await digitar('@ex');          // responde na hora
    await app.esperar("[...document.querySelectorAll('#sugestoes .nome-comando')].some((x) => /exportar/.test(x.textContent))", 4000);
    await app.espera(900);         // a resposta de "e" já chegou
    assert.deepStrictEqual(await doGrupo('Arquivos'), ['@src/pedidos/exportar.js']);
    assert.ok(pedidos().includes('e') && pedidos().includes('ex'));
  });

  await t.test('a mesma busca não é pedida duas vezes seguidas', async () => {
    const antes = pedidos().filter((q) => q === 'ex').length;
    await digitar('@ex'); await app.espera(400);
    assert.strictEqual(pedidos().filter((q) => q === 'ex').length, antes);
  });

  await t.test('@nota: continua como antes (sem pedir arquivos)', async () => {
    const antes = pedidos().length;
    await digitar('@nota:');
    await app.espera(400);
    assert.strictEqual(pedidos().length, antes);
    // Sem notas nesta casa de teste a lista fecha; aberta ou fechada, não há grupo de arquivos à vista.
    assert.strictEqual(await app.avaliar("document.getElementById('sugestoes').hidden || !document.querySelector('#sugestoes .grupo-sugestao')"), true);
  });

  await t.test('com o motor trabalhando, o "@" não pede nada ao Claude e continua com notas e workflows', async () => {
    await digitar('');
    await app.avaliar("window.orq.conversa.mandar('orquestrador', 'trabalha até parar')");
    await app.esperar("!document.getElementById('parar').hidden", 8000);
    const antes = pedidos().length;
    await digitar('@src');
    await app.espera(600);
    assert.strictEqual(pedidos().length, antes, 'nenhum pedido com o motor ocupado');
    await digitar('@');
    await app.esperar("!document.getElementById('sugestoes').hidden", 4000);
    assert.strictEqual(await doGrupo('Arquivos'), null);
    assert.ok((await lista()).includes('@nota:'));
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
