// Área: conversa (cartões do Codex: permissão de comando, acesso a mais e dado do MCP;
// planos 8.2 e 8.3, protótipo P2 aprovado em 17/11/2026)
// Antes o cartão do Codex só tinha Permitir e Negar, o pedido de acesso a mais era
// recusado sem aparecer e o pedido de dado do MCP também. Agora o cartão mostra as
// respostas que o Codex aceita (desta vez, nesta conversa, sempre para comandos que
// começam igual, negar, negar e parar), o que ele pede de acesso, e o formulário do MCP.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const FALSO = path.join(__dirname, '..', 'unit', 'codex-falso.js');
const linhas = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test('cartões do Codex', async (t) => {
  const LOG = path.join(pastaTemporaria('orq-codex-falso-'), 'log.jsonl');
  process.env.CODEX_FALSO_LOG = LOG;
  const app = await abrirApp({ config: { iaOrquestrador: 'codex', iasCaminhos: { codex: FALSO }, mostrarBichinho: false } });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste');
  const aberto = "document.querySelector('#mensagens .cartao-pedido:not(.respondido)')";
  const fechado = "[...document.querySelectorAll('#mensagens .cartao-pedido.respondido')].pop()";
  // As respostas do app aos pedidos escolhidos pelo texto (o Codex falso numera a partir de 200).
  const respostas = () => linhas(LOG).filter((x) => x.id >= 200 && !x.method).map((x) => x.result);
  let pedidos = 0;
  const pedir = async (qual) => {
    await app.esperar("document.getElementById('parar').hidden", 10000);
    await app.avaliar(`window.orq.conversa.mandar('orquestrador', 'pedido:${qual}')`);
    await app.esperar(`!!${aberto}`, 10000);
    pedidos++;
  };
  const botoes = () => app.avaliar(`[...${aberto}.querySelectorAll('.saidas-permissao .botao')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim())`);
  const clicar = (seletor) => app.avaliar(`${aberto}.querySelector(${JSON.stringify(seletor)}).click()`);
  const resposta = async () => { for (let i = 0; i < 60 && respostas().length < pedidos; i++) await app.espera(100); assert.strictEqual(respostas().length, pedidos); return respostas()[pedidos - 1]; };
  const fim = async () => { await app.esperar(`!${aberto}`, 8000); return app.avaliar(`${fechado}.innerText.replace(/\\s+/g, ' ').trim()`); };

  await t.test('comando: as cinco saídas, com o motivo; "desta vez" responde accept', async () => {
    await pedir('comando');
    const texto = await app.avaliar(`${aberto}.innerText`);
    assert.match(texto, /quer rodar[\s\S]*git commit -m ajuste/);
    assert.match(texto, /Por que pergunta:[\s\S]*risco médio: grava no histórico do repositório/);
    assert.deepStrictEqual(await botoes(), ['1 Permitir desta vez', '2 Permitir nesta conversa', '3 Permitir sempre…', '4 Negar', '5 Negar e parar']);
    await clicar('[data-perm="vez"]');
    assert.deepStrictEqual(await resposta(), { decision: 'accept' });
    assert.match(await fim(), /Permitido desta vez · git commit -m ajuste/);
  });

  await t.test('comando: "nesta conversa" responde acceptForSession', async () => {
    await pedir('comando');
    await clicar('[data-perm="sessao"]');
    assert.deepStrictEqual(await resposta(), { decision: 'acceptForSession' });
    assert.match(await fim(), /Permitido nesta conversa · este mesmo comando não pergunta de novo/);
  });

  await t.test('comando: "sempre" mostra a regra, o arquivo e como desfazer; só confirma no segundo passo', async () => {
    await pedir('comando');
    await clicar('[data-perm="prefixo"]');
    const painel = await app.avaliar(`${aberto}.querySelector('.painel-permissao').innerText.replace(/\\s+/g, ' ')`);
    assert.match(painel, /Permitir sempre comandos que começam com git commit\?/);
    assert.match(painel, /Arquivo regras do Codex, em ~\/\.codex\/rules\/default\.rules/);
    assert.match(painel, /Vale em toda conversa do Codex, também fora do app/);
    assert.match(painel, /Para desfazer apagar a linha desse arquivo/);
    assert.match(painel, /É permanente\. Antes de o Codex gravar, o app guarda a versão de agora desse arquivo\./);
    assert.strictEqual(respostas().length, pedidos - 1, 'abrir o painel não responde nada');
    // Voltar devolve as cinco saídas.
    await clicar('[data-perm="voltar"]');
    assert.strictEqual((await botoes()).length, 5);
    await clicar('[data-perm="prefixo"]');
    await clicar('[data-perm="confirmar-prefixo"]');
    assert.deepStrictEqual(await resposta(), { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git', 'commit'] } } });
    assert.match(await fim(), /Permitido sempre · comandos que começam com git commit · o Codex grava a regra em ~\/\.codex\/rules\/default\.rules/);
  });

  await t.test('comando: antes do "sempre" o app guarda a versão de agora do arquivo de regras', async () => {
    const regras = path.join(app.casa, '.codex', 'rules', 'default.rules');
    fs.mkdirSync(path.dirname(regras), { recursive: true });
    fs.writeFileSync(regras, 'prefix_rule(pattern=["ls"], decision="allow")\n');
    await pedir('comando');
    await clicar('[data-perm="prefixo"]');
    await clicar('[data-perm="confirmar-prefixo"]');
    await resposta();
    const copias = path.join(app.casa, '.local', 'share', 'orq-app', 'versoes', 'codex-regras');
    const arqs = fs.readdirSync(copias);
    assert.strictEqual(arqs.length, 1, arqs.join(', '));
    assert.strictEqual(fs.readFileSync(path.join(copias, arqs[0]), 'utf8'), 'prefix_rule(pattern=["ls"], decision="allow")\n');
    assert.strictEqual(fs.readFileSync(regras, 'utf8'), 'prefix_rule(pattern=["ls"], decision="allow")\n', 'o app não escreve no arquivo de regras');
    await fim();
  });

  await t.test('comando: sem conseguir guardar a cópia, o "sempre" vale só desta vez e a tela diz isso', async () => {
    // A pasta das cópias vira só leitura: a cópia falha.
    const copias = path.join(app.casa, '.local', 'share', 'orq-app', 'versoes', 'codex-regras');
    fs.chmodSync(copias, 0o500);
    t.after(() => { try { fs.chmodSync(copias, 0o700); } catch { /* a casa temporária já foi */ } });
    await pedir('comando');
    await clicar('[data-perm="prefixo"]');
    await clicar('[data-perm="confirmar-prefixo"]');
    assert.deepStrictEqual(await resposta(), { decision: 'accept' });
    assert.match(await fim(), /Permitido desta vez · git commit -m ajuste · a regra não foi gravada/);
    await app.esperar("[...document.querySelectorAll('#mensagens .aviso-conversa')].some((x) => /Permiti só desta vez: não consegui guardar a cópia do arquivo de regras do Codex/.test(x.innerText))", 8000);
    fs.chmodSync(copias, 0o700);
  });

  await t.test('comando: "negar" responde decline e "negar e parar" responde cancel', async () => {
    await pedir('comando');
    await clicar('[data-perm="negar-ja"]');
    assert.deepStrictEqual(await resposta(), { decision: 'decline' });
    assert.match(await fim(), /Negado · git commit -m ajuste · o Codex segue por outro caminho/);
    await pedir('comando');
    await clicar('[data-perm="parar"]');
    assert.deepStrictEqual(await resposta(), { decision: 'cancel' });
    assert.match(await fim(), /Negado e turno parado · git commit -m ajuste · o Codex espera a sua próxima mensagem/);
  });

  await t.test('comando sem começo proposto pelo Codex: não há "sempre"', async () => {
    await pedir('comando-sem-comeco');
    assert.deepStrictEqual(await botoes(), ['1 Permitir desta vez', '2 Permitir nesta conversa', '3 Negar', '4 Negar e parar']);
    assert.strictEqual(await app.avaliar(`!!${aberto}.querySelector('.aviso-recusa')`), false);
    await clicar('[data-perm="negar-ja"]');
    await resposta(); await fim();
  });

  await t.test('comando da lista de recusa (docker): nem "nesta conversa" nem "sempre", com o motivo', async () => {
    await pedir('comando-docker');
    assert.deepStrictEqual(await botoes(), ['1 Permitir desta vez', '2 Negar', '3 Negar e parar']);
    assert.match(await app.avaliar(`${aberto}.querySelector('.aviso-recusa').innerText`), /não oferece "nesta conversa" nem "sempre": cada vez passa por você\.\s*\(docker, tmux ou ssh\)/);
    // Com o cartão em foco, a tecla 1 permite desta vez.
    await app.avaliar(`${aberto}.focus()`);
    await app.tecla('1');
    assert.deepStrictEqual(await resposta(), { decision: 'accept' });
    assert.match(await fim(), /Permitido desta vez · docker compose restart web/);
  });

  await t.test('comando comum com começo aberto demais: pode "nesta conversa", não pode "sempre"', async () => {
    await pedir('comando-aberto');
    assert.deepStrictEqual(await botoes(), ['1 Permitir desta vez', '2 Permitir nesta conversa', '3 Negar', '4 Negar e parar']);
    assert.match(await app.avaliar(`${aberto}.querySelector('.aviso-recusa').innerText`), /não oferece "Permitir sempre": o começo de comando que o Codex propôs é aberto demais\.\s*\(roda outros programas\)/);
    await clicar('[data-perm="negar-ja"]');
    await resposta(); await fim();
  });

  await t.test('mudança de arquivo: desta vez, nesta conversa, negar, negar e parar', async () => {
    await pedir('arquivo');
    assert.deepStrictEqual(await botoes(), ['1 Permitir desta vez', '2 Permitir nesta conversa', '3 Negar', '4 Negar e parar']);
    await clicar('[data-perm="sessao"]');
    assert.deepStrictEqual(await resposta(), { decision: 'acceptForSession' });
    assert.match(await fim(), /Permitido nesta conversa · o Codex não pergunta de novo pela mesma coisa/);
  });

  await t.test('acesso a mais: lista o que ele pede e marca o que é fora da pasta; "só neste turno"', async () => {
    await pedir('acesso');
    const v = await app.avaliar(`(() => { const c = ${aberto}; return { texto: c.innerText.replace(/\\s+/g, ' '), itens: [...c.querySelectorAll('.itens-acesso li')].map((l) => l.innerText.replace(/\\s+/g, ' ').trim()) }; })()`);
    assert.match(v.texto, /pede acesso a mais/);
    // A conversa do Codex falso mora em /casa: só o que está fora dela ganha a marca.
    assert.deepStrictEqual(v.itens, ['Escrever em /projetos/site/dist fora da pasta desta conversa', 'Ler /casa/docs', 'Usar a rede']);
    assert.match(v.texto, /O Codex explica: copiar o resultado e baixar uma dependência/);
    assert.match(v.texto, /"Só neste turno" vale até o Codex terminar esta resposta\. Nenhuma das opções grava arquivo\./);
    assert.deepStrictEqual(await botoes(), ['1 Liberar só neste turno', '2 Liberar nesta conversa', '3 Negar']);
    await clicar('[data-acesso="turno"]');
    assert.deepStrictEqual(await resposta(), { permissions: { fileSystem: { entries: [{ access: 'write', path: { type: 'path', path: '/projetos/site/dist' } }, { access: 'read', path: { type: 'path', path: '/casa/docs' } }] }, network: { enabled: true } }, scope: 'turn' });
    assert.match(await fim(), /Acesso liberado só neste turno · escrever em \/projetos\/site\/dist · ler \/casa\/docs · rede/);
  });

  await t.test('acesso a mais: "nesta conversa" e "negar"', async () => {
    await pedir('acesso');
    await clicar('[data-acesso="sessao"]');
    assert.strictEqual((await resposta()).scope, 'session');
    assert.match(await fim(), /Acesso liberado nesta conversa/);
    await pedir('acesso');
    await clicar('[data-acesso="negar"]');
    assert.deepStrictEqual(await resposta(), { permissions: {} });
    assert.match(await fim(), /Acesso negado · o Codex continua só com o que já tinha/);
  });

  await t.test('acesso a mais com uma parte que o app não sabe mostrar: só dá para negar', async () => {
    await pedir('acesso-torto');
    assert.deepStrictEqual(await botoes(), ['Negar']);
    assert.match(await app.avaliar(`${aberto}.innerText`), /tem uma parte que o app não sabe mostrar; só dá para negar/);
    // Nem pedindo direto ao motor a liberação passa.
    const id = await app.avaliar(`${aberto}.dataset.pedido`);
    await app.avaliar(`window.orq.conversa.responder('orquestrador', ${JSON.stringify(id)}, { permitir: true, sessao: true })`);
    assert.deepStrictEqual(await resposta(), { permissions: {} });
  });

  await t.test('dado do MCP: o mesmo cartão do Claude; o segredo vai ao Codex e não fica na tela', async () => {
    await pedir('mcp');
    const v = await app.avaliar(`(() => { const c = ${aberto}; return { texto: c.innerText, tipos: [...c.querySelectorAll('[data-campo]')].map((x) => [x.dataset.campo, x.type]) }; })()`);
    assert.match(v.texto, /cofre-da-equipe[\s\S]*pede um dado/);
    assert.deepStrictEqual(v.tipos, [['codigo', 'password']]);
    // Preenchimento errado não vai: o pedido continua aberto.
    await app.avaliar(`(() => { const c = ${aberto}.querySelector('[data-campo="codigo"]'); c.value = '12'; })()`);
    await clicar('[data-mcp="enviar"]');
    await app.esperar(`/pelo menos 6/.test(${aberto}.querySelector('.erro-mcp').textContent)`, 6000);
    assert.strictEqual(respostas().length, pedidos - 1);
    await app.avaliar(`(() => { const c = ${aberto}.querySelector('[data-campo="codigo"]'); c.value = '481516'; })()`);
    await clicar('[data-mcp="enviar"]');
    assert.deepStrictEqual(await resposta(), { action: 'accept', content: { codigo: '481516' } });
    const final = await fim();
    assert.match(final, /Enviado ao servidor cofre-da-equipe/);
    assert.ok(!(await app.avaliar('document.body.innerHTML')).includes('481516'), 'o código não fica na tela');
  });

  await t.test('dado do MCP: recusar responde decline', async () => {
    await pedir('mcp');
    await clicar('[data-mcp="recusar"]');
    assert.deepStrictEqual(await resposta(), { action: 'decline' });
    await fim();
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
