// Área: topicos
// Coluna da direita: tópicos ao vivo (o orq-topico grava, a tela mostra),
// checklist marcado pela tela, concluir em dois cliques, faixa "Precisa de
// você" só quando tem algo e o detalhe do agente ainda alcançável.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');
const { abrirApp } = require('./app');

const cli = path.join(__dirname, '..', '..', 'bin', 'orq-topico');
const agora = Date.now();
const frente = { chave: 'g/a:%1', emp: 'g', proj: 'proj-a', dir: '/x/a', pane: '%1', sessaoTmux: 'proj-a', nome: 'Agente 2', estado: 'trabalhando', fonte: 'sinal', desde: agora - 60000, tarefa: 'Botão Aprovar', ultimaResposta: 'Terminei a parte 1.', git: {}, linhaDoTempo: [] };
const permissao = { tipo: 'permissao', emp: 'g', proj: 'proj-a', id: 'perm-1', ferramenta: 'Bash', entrada: { command: 'git push' }, desde: agora - 5000 };

test('topicos', async (t) => {
  const app = await abrirApp();
  t.after(() => app.fechar());
  const orq = (...a) => execFileSync(process.execPath, [cli, ...a], { env: { ...process.env, HOME: app.casa }, encoding: 'utf8' }).trim();
  const lerArq = () => JSON.parse(app.ler('.config/orq-app/topicos.json')).topicos;
  await app.avaliar(`window.__estadoFalso = ${JSON.stringify({ lidoEm: agora, semTerminal: 0, frentes: [frente], fila: [] })}`);
  await app.esperar("document.querySelectorAll('.cartao-agente').length === 1", 6000);

  await t.test('sem tópicos: explica o que é e cita o orq-topico', async () => {
    const txt = await app.avaliar("document.getElementById('topicos').innerText");
    assert.match(txt, /Nenhuma demanda em andamento/);
    assert.match(txt, /orq-topico/);
    assert.strictEqual(await app.visivel('#novo-topico'), 'ok');
  });

  await t.test('"Precisa de você" some vazia e aparece no topo com item', async () => {
    assert.strictEqual(await app.avaliar("document.getElementById('bloco-fila').hidden"), true);
    await app.avaliar(`window.__estadoFalso = ${JSON.stringify({ lidoEm: agora, semTerminal: 0, frentes: [frente], fila: [permissao] })}`);
    await app.esperar("!document.getElementById('bloco-fila').hidden", 4000);
    assert.match(await app.avaliar("document.getElementById('fila').innerText"), /git push/);
    assert.ok(await app.avaliar("document.querySelector('.inspetor').firstElementChild.id === 'bloco-fila'"), 'faixa fica no topo');
    assert.ok(await app.avaliar("!!document.querySelector('#fila [data-resp=\"permitir\"]')"));
    await app.avaliar(`window.__estadoFalso = ${JSON.stringify({ lidoEm: agora, semTerminal: 0, frentes: [frente], fila: [] })}`);
    await app.esperar("document.getElementById('bloco-fila').hidden", 4000);
  });

  await t.test('o orq-topico cria e atualiza, e a coluna mostra na hora', async () => {
    const id = orq('abrir', 'Arrumar o redirect do login', '--codigo', 'ABC-123', '--agente', 'Agente 2');
    orq('item', id, 'ajustar a rota');
    orq('item', id, 'testar no navegador');
    await app.esperar("document.querySelectorAll('#topicos .topico [data-item-topico]').length === 2", 4000);
    const c = await app.avaliar("document.querySelector('#topicos .topico').innerText.replace(/\\s+/g, ' ')");
    assert.match(c, /Aberto/);
    assert.match(c, /Arrumar o redirect do login/);
    assert.match(c, /ABC-123/);
    assert.match(c, /Agente 2/);
    assert.match(c, /0\/2/);
    orq('marcar', id, '1');
    orq('estado', id, 'esperando');
    await app.esperar("/1\\/2/.test(document.querySelector('#topicos .topico').innerText)", 4000);
    await app.esperar("/Esperando você/.test(document.querySelector('#topicos .chip-topico').innerText)", 4000);
    assert.strictEqual(await app.avaliar("document.getElementById('n-topicos').textContent"), '1');
  });

  await t.test('marcar o item pela tela grava no arquivo', async () => {
    await app.avaliar("document.querySelectorAll('#topicos [data-item-topico]')[1].click()");
    await app.esperar("/2\\/2/.test(document.querySelector('#topicos .topico').innerText)", 4000);
    assert.deepStrictEqual(lerArq()[0].itens.map((i) => i.feito), [true, true]);
  });

  await t.test('novo tópico à mão e item pelo campo do cartão', async () => {
    await app.avaliar("document.getElementById('novo-topico').click()");
    assert.strictEqual(await app.visivel('#topico-titulo'), 'ok');
    await app.avaliar("document.getElementById('topico-titulo').value = 'Revisar o relatório'; document.getElementById('topico-codigo').value = 'XYZ-9'");
    await app.avaliar("document.querySelector('#form-topico [type=submit]').click()");
    await app.esperar("document.querySelectorAll('#topicos .topico').length === 2", 4000);
    assert.ok(await app.avaliar("document.getElementById('form-topico').hidden"));
    const novo = lerArq().find((x) => x.titulo === 'Revisar o relatório');
    assert.strictEqual(novo.codigo, 'XYZ-9');
    await app.avaliar(`(() => { const f = document.querySelector('[data-novo-item="${novo.id}"]'); f.querySelector('input').value = 'ler as tabelas'; f.requestSubmit(); })()`);
    await app.esperar(`(document.querySelector('[data-topico="${novo.id}"]') || {}).innerText?.includes('ler as tabelas')`, 4000);
    assert.strictEqual(lerArq().find((x) => x.id === novo.id).itens[0].texto, 'ler as tabelas');
  });

  await t.test('concluir pede o segundo clique; concluído vai para "Concluídos (N)"', async () => {
    const sel = '[data-topico="1"] [data-concluir-topico]';
    await app.avaliar(`document.querySelector('${sel}').click()`);
    assert.match(await app.avaliar(`document.querySelector('${sel}').textContent`), /Confirmar conclusão/);
    assert.strictEqual(lerArq()[0].estado, 'esperando', 'um clique só não conclui');
    await app.avaliar(`document.querySelector('${sel}').click()`);
    await app.esperar("!document.getElementById('topicos-concluidos').hidden", 4000);
    assert.strictEqual(lerArq()[0].estado, 'concluido');
    assert.match(await app.avaliar("document.getElementById('resumo-concluidos').textContent"), /Concluídos \(1\)/);
    assert.ok(await app.avaliar("!document.querySelector('#topicos [data-topico=\"1\"]')"));
  });

  await t.test('com item por fazer, o segundo clique avisa quantos faltam', async () => {
    const id = lerArq().find((x) => x.titulo === 'Revisar o relatório').id;
    await app.avaliar(`document.querySelector('[data-topico="${id}"] [data-concluir-topico]').click()`);
    assert.match(await app.avaliar(`document.querySelector('[data-topico="${id}"] [data-concluir-topico]').textContent`), /Faltam 1/);
  });

  await t.test('detalhe do agente continua alcançável, com Abrir terminal', async () => {
    await app.avaliar("document.querySelector('.cartao-agente').click()");
    assert.ok(await app.avaliar("document.getElementById('bloco-detalhe').open"));
    assert.match(await app.avaliar("document.getElementById('detalhe').innerText"), /Terminei a parte 1/);
    assert.ok(await app.avaliar("!!document.querySelector('#detalhe [data-abrir=\"proj-a\"]')"));
    assert.strictEqual(await app.avaliar("document.getElementById('titulo-detalhe').textContent"), 'Agente 2');
  });

  // Pedido de 2026-10-30: o orquestrador sugere; o usuário aprova ou recusa.
  await t.test('sugestão aparece primeiro, marcada, com Aprovar e Recusar', async () => {
    const id = orq('sugerir', 'Revisar os backups', '--resumo', 'Conferir se os backups da semana rodaram.', '--item', 'listar os backups', '--item', 'testar uma restauração');
    await app.esperar(`!!document.querySelector('#topicos [data-topico="${id}"].estado-sugerido')`, 4000);
    assert.strictEqual(await app.avaliar("document.querySelector('#topicos .topico').dataset.topico"), id, 'sugerido vem antes dos outros');
    const c = await app.avaliar(`document.querySelector('[data-topico="${id}"]').innerText.replace(/\\s+/g, ' ')`);
    assert.match(c, /Sugerido pelo orquestrador/);
    assert.match(c, /Conferir se os backups da semana rodaram/);
    assert.match(c, /Etapas previstas/i); // o rótulo é em caixa alta pelo CSS
    assert.match(c, /testar uma restauração/);
    assert.ok(await app.avaliar(`!!document.querySelector('[data-aprovar-topico="${id}"]') && !!document.querySelector('[data-recusar-topico="${id}"]')`));
    assert.strictEqual(await app.avaliar(`document.querySelector('[data-titulo-sugerido="${id}"]').value`), 'Revisar os backups');
    assert.ok(await app.avaliar(`!document.querySelector('[data-topico="${id}"] [data-concluir-topico]')`), 'sugerido não tem Concluir');
  });

  await t.test('aprovar (com o título corrigido) vira aberto, com as etapas no checklist', async () => {
    const id = lerArq().find((x) => x.estado === 'sugerido').id;
    await app.avaliar(`(() => { const c = document.querySelector('[data-titulo-sugerido="${id}"]'); c.value = 'Revisar os backups da semana'; c.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await app.avaliar(`document.querySelector('[data-aprovar-topico="${id}"]').click()`);
    await app.esperar(`!!document.querySelector('#topicos [data-topico="${id}"].estado-aberto')`, 4000);
    const t = lerArq().find((x) => x.id === id);
    assert.strictEqual(t.estado, 'aberto');
    assert.strictEqual(t.titulo, 'Revisar os backups da semana');
    assert.strictEqual(await app.avaliar(`document.querySelectorAll('[data-topico="${id}"] [data-item-topico]').length`), 2);
    assert.match(await app.avaliar(`document.querySelector('[data-topico="${id}"] .topico-resumo').innerText`), /Conferir se os backups/);
  });

  await t.test('resumo editado no próprio cartão grava no arquivo', async () => {
    const id = lerArq().find((x) => x.titulo === 'Revisar os backups da semana').id;
    await app.avaliar(`document.querySelector('[data-topico="${id}"] p[data-editar-resumo]').click()`);
    assert.ok(await app.avaliar("document.activeElement.classList.contains('topico-resumo-edicao')"));
    await app.avaliar("(() => { const a = document.activeElement; a.value = 'Backups da semana conferidos um a um.'; a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()");
    await app.esperar(`/conferidos um a um/.test(document.querySelector('[data-topico="${id}"] .topico-resumo')?.innerText || '')`, 4000);
    assert.strictEqual(lerArq().find((x) => x.id === id).resumo, 'Backups da semana conferidos um a um.');
  });

  await t.test('recusar vai para "Recusados (N)" e reconsiderar traz de volta', async () => {
    const id = orq('sugerir', 'Trocar o tema do editor');
    await app.esperar(`!!document.querySelector('[data-recusar-topico="${id}"]')`, 4000);
    await app.avaliar(`document.querySelector('[data-recusar-topico="${id}"]').click()`);
    await app.esperar("!document.getElementById('topicos-recusados').hidden", 4000);
    assert.strictEqual(lerArq().find((x) => x.id === id).estado, 'recusado');
    assert.match(await app.avaliar("document.getElementById('resumo-recusados').textContent"), /Recusados \(1\)/);
    assert.ok(await app.avaliar(`!document.querySelector('#topicos [data-topico="${id}"]') && !!document.querySelector('#lista-recusados [data-topico="${id}"]')`));
    assert.ok(!(await app.avaliar("document.getElementById('topicos-recusados').open")), 'recolhido');
    await app.avaliar(`document.querySelector('[data-reconsiderar-topico="${id}"]').click()`);
    await app.esperar(`!!document.querySelector('#topicos [data-topico="${id}"].estado-sugerido')`, 4000);
    assert.ok(await app.avaliar("document.getElementById('topicos-recusados').hidden"));
    assert.strictEqual(lerArq().find((x) => x.id === id).estado, 'sugerido');
  });

  // O Aprovar/Recusar lá de cima já mandou o aviso à conversa do orquestrador
  // (o processo dela está de pé no teste): aparece como linha discreta.
  await t.test('aprovar/recusar pela tela avisa o orquestrador por trás', async () => {
    await app.esperar("document.querySelectorAll('#mensagens .msg-bastidor-topico').length >= 2", 4000);
    const linhas = await app.avaliar("[...document.querySelectorAll('#mensagens .msg-bastidor-topico summary')].map((s) => s.textContent)");
    assert.deepStrictEqual(linhas.slice(0, 2), ['📌 Demanda aprovada: Revisar os backups da semana', '📌 Demanda recusada: Trocar o tema do editor']);
    assert.match(await app.avaliar("document.querySelector('#mensagens .msg-bastidor-topico .msg-bastidor-texto').textContent"), /aprovado pelo usuário: crie as etapas \(orq-topico item\) e mande um resumo \(orq-topico resumo\)/);
    assert.ok(!(await app.avaliar("[...document.querySelectorAll('#mensagens .msg-voce')].some((b) => b.innerText.includes('orq-topico'))")), 'nenhum balão do usuário');
  });

  await t.test('aviso de tópico aprovado na conversa: linha discreta, não balão do usuário', async () => {
    await app.esperar('!!window.__orqTeste', 4000);
    const baloes = "document.querySelectorAll('#mensagens .msg-voce').length";
    const antes = await app.avaliar(baloes);
    const nAntes = await app.avaliar("document.querySelectorAll('#mensagens .msg-bastidor-topico').length");
    const msg = '<orq-topico id="9" acao="aprovado" titulo="Revisar os backups">\nTópico #9 «Revisar os backups» aprovado pelo usuário: crie as etapas (orq-topico item) e mande um resumo (orq-topico resumo).\n</orq-topico>';
    await app.avaliar(`window.__orqTeste.desenharEvento(${JSON.stringify({ tipo: 'user', local: true, message: { role: 'user', content: msg } })})`);
    await app.avaliar(`window.__orqTeste.desenharEvento(${JSON.stringify({ tipo: 'user', antigo: true, message: { role: 'user', content: msg.replace('aprovado"', 'recusado"') } })})`);
    assert.strictEqual(await app.avaliar(baloes), antes);
    const linhas = await app.avaliar("[...document.querySelectorAll('#mensagens .msg-bastidor-topico summary')].map((s) => s.textContent)");
    assert.deepStrictEqual(linhas.slice(nAntes), ['📌 Demanda aprovada: Revisar os backups', '📌 Demanda recusada: Revisar os backups']);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
