// Área: conversa (conversas anteriores e o ⋯ de cada conversa; planos 3.2 e 3.3)
// Antes uma conversa que saía da lista só voltava digitando /resume, o ✕ tirava a conversa sem
// dizer para onde ia, e não havia como renomear pela lista, arquivar nem apagar pelo app.
// Agora: a janela "Anteriores" (buscar, reabrir, arquivar, apagar mostrando o que some) e o ⋯
// em cada conversa (renomear, arquivar com desfazer, ramificar, terminal na pasta dela).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const lerLog = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const ABERTA = "(() => { const a = document.getElementById('anteriores'); return !a.hidden && getComputedStyle(a).display !== 'none'; })()";
const LINHAS = "[...document.querySelectorAll('#anteriores-lista .anteriores-item')].map((l) => ({ titulo: l.querySelector('.titulo').innerText, baixo: l.querySelector('.ant-baixo').innerText.replace(/\\s+/g, ' ').trim(), escolhida: l.getAttribute('aria-selected') === 'true' }))";
const LATERAL = "[...document.querySelectorAll('.item-conversa')].map((i) => ({ titulo: i.querySelector('.titulo-conversa').innerText, linha: i.querySelector('.pasta-conversa').innerText.replace(/\\s+/g, ' ').trim(), ativa: i.classList.contains('ativo') }))";
const SAIDA = "document.getElementById('anteriores-saida').innerText.replace(/\\s+/g, ' ').trim()";
const MENU = "document.getElementById('menu-conversa')";
const AVISO = "(() => { const a = document.getElementById('aviso-lateral'); return a.hidden ? '' : a.innerText.replace(/\\s+/g, ' ').trim(); })()";

// Grava conversas "guardadas pelo Claude" na casa temporária do app. Devolve { sessao, arq }.
function guardador(casa) {
  const raiz = path.join(casa, '.claude', 'projects');
  let n = 0;
  return (titulo, { cwd = casa, minutos = 0, subagentes = 0 } = {}) => {
    const sessao = `sessao-de-tela-${String(++n).padStart(4, '0')}`;
    const dir = path.join(raiz, cwd.replace(/[^A-Za-z0-9]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    const arq = path.join(dir, `${sessao}.jsonl`);
    fs.writeFileSync(arq, `${JSON.stringify({ type: 'user', message: { role: 'user', content: titulo }, cwd })}\n${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } })}\n`);
    const t = (Date.now() - minutos * 60000) / 1000;
    fs.utimesSync(arq, t, t);
    for (let i = 0; i < subagentes; i++) { fs.mkdirSync(path.join(dir, sessao, 'subagents'), { recursive: true }); fs.writeFileSync(path.join(dir, sessao, 'subagents', `agent-${i}.jsonl`), 'x'.repeat(2048)); }
    return { sessao, arq, dir };
  };
}

test('conversas anteriores: a janela, a busca, reabrir, arquivar e apagar', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({ config: { mostrarBichinho: false }, arquivos: { 'projetos/site/leia.txt': 'x\n' } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste && !!window.orqAnteriores');
  const guardar = guardador(app.casa);
  const site = path.join(app.casa, 'projetos/site');
  const exportar = guardar('Ajuste do botão de exportar', { minutos: 20 });
  const revisao = guardar('Revisão do texto do site', { cwd: site, minutos: 60 * 26 });
  const relatorio = guardar('Relatório de vendas de outubro', { minutos: 60 * 24 * 6, subagentes: 2 });
  const sumiu = guardar('Conversa de uma pasta apagada', { cwd: path.join(app.casa, 'projetos/antigo'), minutos: 60 * 24 * 30 });
  const linhas = () => app.avaliar(LINHAS);
  const lateral = () => app.avaliar(LATERAL);
  const abrir = async () => {
    await app.avaliar("document.getElementById('abrir-anteriores').click()");
    await app.esperar(ABERTA);
    await app.esperar("document.querySelectorAll('#anteriores-lista .anteriores-item').length > 0", 8000);
  };
  const escrever = (q) => app.avaliar(`(() => { const c = document.getElementById('anteriores-busca'); c.focus(); c.value = ${JSON.stringify(q)}; c.dispatchEvent(new Event('input')); })()`);
  const naLinha = (titulo, acao) => app.avaliar(`[...document.querySelectorAll('#anteriores-lista .anteriores-item')].find((l) => l.querySelector('.titulo').innerText === ${JSON.stringify(titulo)}).querySelector('[data-ant=${acao}]').click()`);
  const clicarDeVerdade = async (seletor) => {
    const r = await app.avaliar(`(() => { const e = document.querySelector(${JSON.stringify(seletor)}); e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await app.mouse('mousePressed', r.x, r.y); await app.mouse('mouseReleased', r.x, r.y);
  };

  await t.test('fechada no começo; o botão "Anteriores…" fica na lista da esquerda', async () => {
    assert.strictEqual(await app.avaliar("getComputedStyle(document.getElementById('anteriores')).display"), 'none');
    assert.strictEqual(await app.visivel('#abrir-anteriores'), 'ok');
  });

  await t.test('lista o que o Claude guardou, da mais nova para a mais antiga, com a pasta, o tamanho e o motor', async () => {
    await abrir();
    const l = await linhas();
    assert.deepStrictEqual(l.map((x) => x.titulo), ['Ajuste do botão de exportar', 'Revisão do texto do site', 'Relatório de vendas de outubro', 'Conversa de uma pasta apagada']);
    assert.match(l[0].baixo, /^~ 1 KB Claude Arquivar Apagar…$/);
    assert.match(l[1].baixo, /^~\/projetos\/site 1 KB Claude Arquivar Apagar…$/);
    assert.match(l[3].baixo, /^~\/projetos\/antigo 1 KB Claude a pasta não existe mais Arquivar Apagar…$/);
    assert.strictEqual(l[0].escolhida, true);
    assert.deepStrictEqual(await app.avaliar("[...document.querySelectorAll('#anteriores-lista .ant-quando')].map((x) => x.innerText).slice(0, 2)"), ['há 20 min', 'ontem']);
    assert.ok(await app.avaliar("document.activeElement === document.getElementById('anteriores-busca')"));
    assert.ok(await app.avaliar("(() => { const p = document.querySelector('#anteriores .paleta'); return p.scrollWidth <= p.clientWidth; })()"), 'a janela rola para o lado');
  });

  await t.test('a busca acha pelo nome e pela pasta, sem diferenciar maiúsculas', async () => {
    await escrever('RELATÓRIO');
    assert.deepStrictEqual((await linhas()).map((x) => x.titulo), ['Relatório de vendas de outubro']);
    await escrever('projetos/site');
    assert.deepStrictEqual((await linhas()).map((x) => x.titulo), ['Revisão do texto do site']);
    await escrever('nada disso existe');
    assert.match(await app.avaliar("document.querySelector('#anteriores-lista .paleta-vazio').innerText"), /^Nenhuma conversa “nada disso existe”$/);
    await escrever('');
    assert.strictEqual((await linhas()).length, 4);
  });

  await t.test('seta para baixo e Enter reabrem a conversa escolhida, na pasta dela; a janela fecha', async () => {
    await app.avaliar("document.getElementById('anteriores-busca').focus()");
    await app.tecla('ArrowDown', 'ArrowDown', 40);
    assert.deepStrictEqual((await linhas()).map((x) => x.escolhida), [false, true, false, false]);
    await app.tecla('Enter', 'Enter', 13);
    await app.esperar(`!(${ABERTA})`, 8000);
    await app.esperar("document.querySelectorAll('.item-conversa').length === 2", 8000);
    const l = await lateral();
    assert.deepStrictEqual([l[1].titulo, l[1].ativa], ['Revisão do texto do site', true]);
    assert.match(l[1].linha, /^~\/projetos\/site · /);
    // Fora da pasta pessoal, o cartão de confiança da pasta aparece antes de o Claude subir.
    await app.esperar("!!document.querySelector('#mensagens .cartao-pasta [data-pasta=confiar]')", 8000);
    assert.ok(!lerLog(log).some((x) => Array.isArray(x.args) && x.args.includes(revisao.sessao)), 'o Claude retomou a conversa antes do cartão da pasta');
  });

  await t.test('a conversa aberta aparece como "aberta agora"; reabrir de novo vai para ela, sem abrir duas vezes', async () => {
    await abrir();
    const l = await linhas();
    assert.match(l.find((x) => x.titulo === 'Revisão do texto do site').baixo, /aberta agora/);
    assert.strictEqual(await app.avaliar("[...document.querySelectorAll('#anteriores-lista .anteriores-item')].find((l) => /Revisão/.test(l.innerText)).querySelector('[data-ant=arquivar]').disabled"), true);
    await app.avaliar("window.__orqTeste.trocar('orquestrador')");
    await app.avaliar("[...document.querySelectorAll('#anteriores-lista .anteriores-item')].find((l) => /Revisão/.test(l.innerText)).querySelector('.titulo').click()");
    await app.esperar(`!(${ABERTA})`, 8000);
    await app.esperar("window.orqConversa.ativa() !== 'orquestrador'", 8000);
    assert.strictEqual((await lateral()).length, 2);
    await app.esperar("[...document.querySelectorAll('#mensagens .aviso-conversa')].some((a) => /já estava aberta: fui para ela/.test(a.innerText))", 8000);
  });

  await t.test('arquivar tira da lista de sempre e põe em Arquivadas; desarquivar traz de volta; nada é apagado', async () => {
    await abrir();
    await naLinha('Ajuste do botão de exportar', 'arquivar');
    await app.esperar(`(${LINHAS}).length === 3`, 8000);
    assert.match(await app.avaliar(SAIDA), /^Arquivada \(nada foi apagado\): “Ajuste do botão de exportar”$/);
    assert.ok(fs.existsSync(exportar.arq));
    await app.avaliar("document.getElementById('anteriores-arquivadas').click()");
    assert.strictEqual(await app.avaliar("document.getElementById('anteriores-arquivadas').getAttribute('aria-pressed')"), 'true');
    const l = await linhas();
    assert.deepStrictEqual(l.map((x) => x.titulo), ['Ajuste do botão de exportar']);
    assert.match(l[0].baixo, /Desarquivar Apagar…$/);
    await naLinha('Ajuste do botão de exportar', 'arquivar');
    await app.esperar("!!document.querySelector('#anteriores-lista .paleta-vazio')", 8000);
    assert.match(await app.avaliar("document.querySelector('#anteriores-lista .paleta-vazio').innerText"), /^Nenhuma conversa arquivada$/);
    await app.avaliar("document.getElementById('anteriores-arquivadas').click()");
    assert.strictEqual((await linhas()).length, 4);
  });

  await t.test('apagar mostra antes o que some (com os subagentes), para onde vai e o que fica; clique por programa não apaga; Cancelar não apaga', async () => {
    await naLinha('Relatório de vendas de outubro', 'apagar');
    await app.esperar("!!document.querySelector('#anteriores-saida .anteriores-custo [data-custo=apagar]')", 8000);
    const texto = await app.avaliar(SAIDA);
    assert.match(texto, /^Apagar “Relatório de vendas de outubro” do histórico\?/);
    assert.match(texto, /O que some 3 arquivos de histórico do Claude \(4 KB\), com as conversas dos subagentes desta conversa/);
    assert.match(texto, /Para onde vai Para a lixeira do sistema\./);
    assert.match(texto, /O que fica Os arquivos do projeto e todas as outras conversas\./);
    await app.avaliar("document.querySelector('#anteriores-saida [data-custo=apagar]').click()");
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(fs.existsSync(relatorio.arq), 'um clique por programa apagou a conversa');
    await app.avaliar("document.querySelector('#anteriores-saida [data-custo=cancelar]').click()");
    await app.esperar(`(${SAIDA}) === 'Cancelado: nada foi apagado.'`, 4000);
    assert.ok(fs.existsSync(relatorio.arq) && fs.existsSync(path.join(relatorio.dir, relatorio.sessao, 'subagents', 'agent-0.jsonl')));
  });

  await t.test('com o cartão de apagar aberto, o primeiro Esc desiste de apagar e o segundo fecha a janela', async () => {
    await naLinha('Relatório de vendas de outubro', 'apagar');
    await app.esperar("!!document.querySelector('#anteriores-saida .anteriores-custo [data-custo=apagar]')", 8000);
    await app.tecla('Escape', 'Escape', 27);
    await app.esperar(`(${SAIDA}) === 'Cancelado: nada foi apagado.'`, 4000);
    assert.strictEqual(await app.avaliar(ABERTA), true);
    await app.tecla('Escape', 'Escape', 27);
    await app.esperar(`!(${ABERTA})`);
    assert.ok(await app.avaliar("document.activeElement === document.getElementById('entrada')"));
    assert.ok(fs.existsSync(relatorio.arq));
  });

  await t.test('apagar de verdade: o arquivo e a pasta de subagentes saem dali (lixeira), a linha some e a janela diz o que foi', async () => {
    await abrir();
    await naLinha('Relatório de vendas de outubro', 'apagar');
    await app.esperar("!!document.querySelector('#anteriores-saida .anteriores-custo [data-custo=apagar]')", 8000);
    await clicarDeVerdade('#anteriores-saida [data-custo=apagar]');
    await app.esperar(`/^Apagada:/.test(${SAIDA})`, 8000);
    assert.match(await app.avaliar(SAIDA), /^Apagada: “Relatório de vendas de outubro” · 3 arquivos foram para a lixeira do sistema \(4 KB\)$/);
    assert.strictEqual(fs.existsSync(relatorio.arq), false);
    assert.strictEqual(fs.existsSync(path.join(relatorio.dir, relatorio.sessao)), false);
    assert.deepStrictEqual((await linhas()).map((x) => x.titulo), ['Ajuste do botão de exportar', 'Revisão do texto do site', 'Conversa de uma pasta apagada']);
    assert.ok(fs.existsSync(exportar.arq) && fs.existsSync(revisao.arq) && fs.existsSync(sumiu.arq), 'apagou outra conversa junto');
  });

  await t.test('a conversa aberta não pode ser apagada: o cartão explica e não oferece o botão; a de pasta sumida não reabre', async () => {
    await naLinha('Revisão do texto do site', 'apagar');
    await app.esperar("!!document.querySelector('#anteriores-saida .anteriores-trava')", 8000);
    assert.match(await app.avaliar(SAIDA), /esta conversa está aberta no app \("Revisão do texto do site"\); arquive ou feche antes de apagar/);
    assert.strictEqual(await app.avaliar("document.querySelector('#anteriores-saida [data-custo=apagar]')"), null);
    await app.avaliar("document.querySelector('#anteriores-saida [data-custo=fechar]').click()");
    await app.avaliar("[...document.querySelectorAll('#anteriores-lista .anteriores-item')].find((l) => /pasta apagada/.test(l.innerText)).querySelector('.titulo').click()");
    await app.esperar(`/^Não reabri:/.test(${SAIDA})`, 8000);
    assert.match(await app.avaliar(SAIDA), /a pasta desta conversa não existe mais: ~\/projetos\/antigo/);
    assert.strictEqual(await app.avaliar(ABERTA), true);
    await app.tecla('Escape', 'Escape', 27);
    await app.esperar(`!(${ABERTA})`);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

test('o ⋯ de cada conversa: renomear, arquivar com desfazer, ramificar e terminal na pasta', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({ config: { mostrarBichinho: false }, arquivos: { 'projetos/site/leia.txt': 'x\n' } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste && !!window.orqAnteriores');
  const lateral = () => app.avaliar(LATERAL);
  const guardadas = () => JSON.parse(app.ler('.cache/orq-app/conversas-teste.json'));
  const abrirMenu = async (id) => {
    await app.avaliar(`document.querySelector('[data-mais-conversa="${id}"]').click()`);
    await app.esperar(`!${MENU}.hidden && getComputedStyle(${MENU}).display !== 'none'`);
  };
  const noMenu = (acao) => app.avaliar(`${MENU}.querySelector('[data-m=${acao}]').click()`);
  let id;

  await t.test('o ✕ deu lugar ao ⋯; o orquestrador tem o cadeado e não tem menu', async () => {
    id = await app.avaliar('window.orq.conversa.nova().then((i) => window.__orqTeste.trocar(i).then(() => i))');
    await app.esperar("document.querySelectorAll('.item-conversa').length === 2");
    assert.strictEqual(await app.avaliar("document.querySelectorAll('.fechar-conversa').length"), 0);
    assert.strictEqual(await app.avaliar("document.querySelectorAll('.item-conversa')[0].querySelectorAll('[data-mais-conversa]').length"), 0);
    assert.strictEqual(await app.avaliar("document.querySelectorAll('.item-conversa')[0].querySelectorAll('.cadeado-conversa').length"), 1);
    assert.strictEqual(await app.avaliar(`document.querySelectorAll('[data-mais-conversa="${id}"]').length`), 1);
    assert.strictEqual(await app.avaliar(`getComputedStyle(${MENU}).display`), 'none');
    await abrirMenu(id);
    assert.deepStrictEqual(await app.avaliar(`[...${MENU}.querySelectorAll('[data-m] span')].map((s) => s.innerText)`), ['Renomear', 'Arquivar', 'Ramificar', 'Terminal nesta pasta', 'Apagar…']);
    assert.ok(await app.avaliar(`(() => { const m = ${MENU}.getBoundingClientRect(); const l = document.querySelector('.lateral').getBoundingClientRect(); return m.left >= l.right - 40 && m.right <= innerWidth && m.bottom <= innerHeight; })()`), 'o menu cobre a lista ou sai da tela');
    await app.tecla('Escape', 'Escape', 27);
    await app.esperar(`${MENU}.hidden`);
  });

  await t.test('renomear: o nome novo aparece na lista e fica gravado; o Claude é avisado sem mensagem na conversa', async () => {
    await app.avaliar(`window.orq.conversa.mandar(${JSON.stringify(id)}, 'oi')`);
    await app.esperar("[...document.querySelectorAll('#mensagens .msg-voce')].some((m) => /oi/.test(m.innerText))", 8000);
    await app.esperar("document.getElementById('parar').hidden", 8000);
    await abrirMenu(id);
    await noMenu('renomear');
    await app.esperar("document.activeElement === document.getElementById('nome-conversa')");
    await app.avaliar("(() => { const c = document.getElementById('nome-conversa'); c.value = 'Ajuste do botão de exportar'; })()");
    await app.tecla('Enter', 'Enter', 13);
    await app.esperar(`(${LATERAL})[1].titulo === 'Ajuste do botão de exportar'`, 8000);
    assert.strictEqual(guardadas().find((c) => c.id === id).titulo, 'Ajuste do botão de exportar');
    assert.match(await app.avaliar(AVISO), /^Renomeada para “Ajuste do botão de exportar”$/);
    for (let i = 0; i < 60 && !lerLog(log).some((x) => x.type === 'control_request' && x.request.subtype === 'rename_session'); i++) await new Promise((r) => setTimeout(r, 100));
    const pedido = lerLog(log).find((x) => x.type === 'control_request' && x.request.subtype === 'rename_session');
    assert.deepStrictEqual([pedido.request.title, pedido.request.source], ['Ajuste do botão de exportar', 'host']);
    assert.strictEqual(await app.avaliar("[...document.querySelectorAll('#mensagens .msg-voce')].some((m) => /rename|Ajuste do botão/.test(m.innerText))"), false, 'o nome virou mensagem na conversa');
    // Nome vazio: o menu diz e nada muda.
    await abrirMenu(id);
    await noMenu('renomear');
    await app.avaliar("document.getElementById('nome-conversa').value = '   '");
    await app.tecla('Enter', 'Enter', 13);
    await app.esperar(`!${MENU}.querySelector('.menu-erro').hidden`, 4000);
    assert.match(await app.avaliar(`${MENU}.querySelector('.menu-erro').innerText`), /^Não renomeei: escreva o nome da conversa$/);
    await app.tecla('Escape', 'Escape', 27);
    assert.strictEqual((await lateral())[1].titulo, 'Ajuste do botão de exportar');
  });

  await t.test('ramificar abre outra conversa com a cópia e vai para ela; a original continua na lista', async () => {
    await abrirMenu(id);
    await noMenu('ramificar');
    await app.esperar("document.querySelectorAll('.item-conversa').length === 3", 8000);
    const l = await lateral();
    assert.deepStrictEqual(l.map((x) => x.titulo), ['Orquestrador', 'Ajuste do botão de exportar', 'Ajuste do botão de exportar (ramo)']);
    assert.strictEqual(l[2].ativa, true);
  });

  await t.test('arquivar: a conversa sai da lista, vai para Anteriores › Arquivadas e o Desfazer traz de volta', async () => {
    await app.avaliar(`window.__orqTeste.trocar(${JSON.stringify(id)})`);
    await abrirMenu(id);
    await noMenu('arquivar');
    await app.esperar("document.querySelectorAll('.item-conversa').length === 2", 8000);
    await app.esperar("window.orqConversa.ativa() === 'orquestrador'", 8000);
    await app.esperar(`/^Arquivada:/.test(${AVISO})`, 8000);
    assert.match(await app.avaliar(AVISO), /^Arquivada: “Ajuste do botão de exportar”\. Está em Anteriores › Arquivadas; nada foi apagado\. Desfazer$/);
    assert.ok(!(await lateral()).some((x) => x.titulo === 'Ajuste do botão de exportar'));
    const marcas = JSON.parse(app.ler('.cache/orq-app/arquivadas-teste.json')).sessoes;
    assert.strictEqual(Object.values(marcas).filter((m) => m.titulo === 'Ajuste do botão de exportar').length, 1);
    await app.avaliar("document.querySelector('#aviso-lateral [data-desfazer]').click()");
    await app.esperar("document.querySelectorAll('.item-conversa').length === 3", 8000);
    await app.esperar(`(${LATERAL}).some((x) => x.titulo === 'Ajuste do botão de exportar' && x.ativa)`, 8000);
    id = await app.avaliar('window.orqConversa.ativa()'); // reaberta, a conversa ganha outro número na lista
    assert.deepStrictEqual(JSON.parse(app.ler('.cache/orq-app/arquivadas-teste.json')).sessoes, {});
    // Conversa que nem começou: só sai da lista, e o aviso diz isso.
    const vazia = await app.avaliar('window.orq.conversa.nova().then((i) => window.__orqTeste.trocar(i).then(() => i))');
    await app.esperar("document.querySelectorAll('.item-conversa').length === 4");
    await abrirMenu(vazia);
    await noMenu('arquivar');
    await app.esperar("document.querySelectorAll('.item-conversa').length === 3", 8000);
    await app.esperar(`(${AVISO}) === 'A conversa ainda não tinha começado: só saiu da lista.'`, 8000);
  });

  await t.test('"Terminal nesta pasta" abre a aba Terminal com um terminal dentro da pasta da conversa', async () => {
    const pasta = path.join(app.casa, 'projetos/site');
    const noSite = await app.avaliar(`window.orq.conversa.nova({ pasta: ${JSON.stringify(pasta)}, motor: 'claude' })`);
    await app.esperar(`!!document.querySelector('[data-mais-conversa="${noSite}"]')`, 8000);
    await abrirMenu(noSite);
    assert.strictEqual(await app.avaliar(`${MENU}.querySelector('[data-m=terminal] small').innerText`), '~/projetos/site');
    await noMenu('terminal');
    await app.esperar("document.getElementById('aba-terminal').classList.contains('ativa')", 8000);
    for (let i = 0; i < 60 && !(await app.avaliar('window.orq.pty.lista()')).some((x) => x.pasta); i++) await new Promise((r) => setTimeout(r, 100));
    const lista = await app.avaliar('window.orq.pty.lista()');
    assert.deepStrictEqual(lista.filter((x) => x.pasta).map((x) => x.pasta), [pasta]);
    await app.esperar("[...document.querySelectorAll('.nome-terminal')].some((n) => /· ~\\/projetos\\/site$/.test(n.textContent))", 8000);
  });

  await t.test('"Apagar…" do menu leva para a janela Anteriores, onde aparece o que some', async () => {
    await app.avaliar("document.querySelector('[data-aba=\"aba-orquestrador\"]').click()");
    await abrirMenu(id);
    await noMenu('apagar');
    await app.esperar(ABERTA, 8000);
    await app.tecla('Escape', 'Escape', 27);
    await app.esperar(`!(${ABERTA})`);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

test('conversas anteriores e o ⋯ em inglês', async (t) => {
  process.env.CLAUDE_FALSO_LOG = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  const app = await abrirApp({ config: { idioma: 'en', mostrarBichinho: false } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste && !!window.orqAnteriores');
  const guardar = guardador(app.casa);
  guardar('Relatório de vendas de outubro', { minutos: 20, subagentes: 1 });

  await t.test('a janela, o cartão de apagar e o menu vêm em inglês; o nome da conversa fica como veio', async () => {
    assert.strictEqual(await app.avaliar("document.getElementById('abrir-anteriores').innerText"), 'Earlier…');
    await app.avaliar("document.getElementById('abrir-anteriores').click()");
    await app.esperar("document.querySelectorAll('#anteriores-lista .anteriores-item').length === 1", 8000);
    assert.strictEqual(await app.avaliar("document.getElementById('anteriores-busca').placeholder"), 'Search earlier conversations…');
    assert.strictEqual(await app.avaliar("document.getElementById('anteriores-arquivadas').innerText"), 'Archived');
    const l = await app.avaliar(LINHAS);
    assert.strictEqual(l[0].titulo, 'Relatório de vendas de outubro');
    assert.match(l[0].baixo, /Archive Delete…$/);
    assert.strictEqual(await app.avaliar("document.querySelector('#anteriores-lista .ant-quando').innerText"), '20 min ago');
    await app.avaliar("document.querySelector('#anteriores-lista [data-ant=apagar]').click()");
    await app.esperar("!!document.querySelector('#anteriores-saida [data-custo=apagar]')", 8000);
    const texto = await app.avaliar(SAIDA);
    assert.match(texto, /^Delete “Relatório de vendas de outubro” from the history\?/);
    assert.match(texto, /What goes away 2 Claude history files \(2 KB\), with this conversation's subagent conversations/);
    assert.match(texto, /Where it goes To the system trash\./);
    assert.match(texto, /Delete Cancel$/);
    await app.tecla('Escape', 'Escape', 27);
    await app.tecla('Escape', 'Escape', 27);
    const id = await app.avaliar('window.orq.conversa.nova().then((i) => window.__orqTeste.trocar(i).then(() => i))');
    await app.esperar(`!!document.querySelector('[data-mais-conversa="${id}"]')`, 8000);
    await app.avaliar(`document.querySelector('[data-mais-conversa="${id}"]').click()`);
    await app.esperar(`!${MENU}.hidden`);
    assert.deepStrictEqual(await app.avaliar(`[...${MENU}.querySelectorAll('[data-m] span')].map((s) => s.innerText)`), ['Rename', 'Archive', 'Branch', 'Terminal in this folder', 'Delete…']);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
