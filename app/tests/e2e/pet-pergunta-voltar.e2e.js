// Área: pet (balão de perguntas do bichinho: voltar às perguntas de antes)
// 23/11: com várias perguntas, o balão do bichinho só andava para a frente; respondida a 3ª,
// não dava para corrigir a 1ª antes de a última mandar tudo. Agora há "‹ Voltar" a partir da 2ª,
// e a resposta já dada aparece marcada (ou no campo, se foi escrita). Nada sai antes da última.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { pastaTemporaria } = require('../temporarias');

test('balão de perguntas do bichinho: voltar às perguntas de antes', { skip: !process.env.DISPLAY && 'sem tela (DISPLAY) para o modo X11' }, async (t) => {
  const env = { ...process.env, ORQ_PET_TESTE: '1', HOME: pastaTemporaria('orq-tela-') };
  delete env.WAYLAND_DISPLAY;
  const p = spawn(process.env.ORQ_ELECTRON, [path.join(__dirname, '../../pet/main.js'), '--ozone-platform=x11'], { stdio: ['pipe', 'pipe', 'ignore'], env });
  t.after(() => p.kill());
  const recebidas = [];
  readline.createInterface({ input: p.stdout }).on('line', (l) => { try { recebidas.push(JSON.parse(l)); } catch { /* outra saída */ } });
  const manda = (m) => p.stdin.write(JSON.stringify(m) + '\n');
  const espera = async (fn, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { const r = recebidas.find(fn); if (r) return r; await new Promise((x) => setTimeout(x, 100)); } throw new Error(`não chegou: ${fn}`); };
  const js = async (codigo) => { recebidas.length = 0; manda({ t: 'js', codigo }); return (await espera((m) => m.t === 'js')).r; };
  const passo = () => js("document.getElementById('pg-passo').textContent");
  const marcadas = () => js("[...document.querySelectorAll('#pg-corpo .aj-opcao.marcada')].map((b) => b.dataset.op)");
  const temVoltar = () => js("!!document.querySelector('[data-pg=voltar]')");
  const clicar = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click(); 1`);

  await espera((m) => m.t === 'iniciado', 20000);
  manda({ t: 'visual', visual: { cor: 'azul', itens: {} }, tema: 'dark' });
  manda({ t: 'pendencia', texto: 'O orquestrador tem uma pergunta', total: 1, conversa: 'orquestrador', id: 'conversa:orquestrador:r9',
    item: { tipo: 'pergunta', quem: 'O orquestrador', reqId: 'r9', perguntas: [
      { header: 'NF', question: 'A NF continua obrigatória?', options: [{ label: 'Liberar no cartão' }, { label: 'Manter obrigatória' }] },
      { question: 'Quais setores?', multiSelect: true, options: [{ label: 'Compras' }, { label: 'Financeiro' }, { label: 'TI' }] },
      { question: 'Quando começa?', options: [{ label: 'Hoje' }, { label: 'Segunda' }] },
    ] } });
  for (let i = 0; i < 80 && !(await js("!document.getElementById('pergunta').hidden")); i++) await new Promise((x) => setTimeout(x, 100));

  await t.test('na 1ª pergunta não há "‹ Voltar"; da 2ª em diante, há', async () => {
    assert.match(await passo(), /^pergunta 1 de 3$/);
    assert.strictEqual(await temVoltar(), false);
    await clicar('[data-op="Liberar no cartão"]');
    assert.match(await passo(), /^pergunta 2 de 3/);
    assert.strictEqual(await temVoltar(), true);
  });

  await t.test('voltar mostra a resposta já dada marcada; nada foi enviado', async () => {
    await clicar('[data-pg=voltar]');
    assert.match(await passo(), /^pergunta 1 de 3$/);
    assert.deepStrictEqual(await marcadas(), ['Liberar no cartão']);
    assert.strictEqual(await js("document.querySelector('[data-op=\"Liberar no cartão\"]').getAttribute('aria-pressed')"), 'true');
    assert.ok(!recebidas.some((m) => m.t === 'responder'));
  });

  await t.test('trocar a resposta e seguir: a de várias escolhas volta com as marcadas; a escrita volta no campo', async () => {
    await clicar('[data-op="Manter obrigatória"]');
    await clicar('[data-op="Compras"]');
    await clicar('[data-op="TI"]');
    await clicar('[data-pg=confirmar]');
    assert.match(await passo(), /^pergunta 3 de 3$/);
    await clicar('[data-pg=voltar]');
    assert.deepStrictEqual(await marcadas(), ['Compras', 'TI']);
    await clicar('[data-pg=voltar]');
    assert.deepStrictEqual(await marcadas(), ['Manter obrigatória']);
    // Resposta escrita no campo: volta no campo.
    await js("document.getElementById('pg-outra').value = 'Só para compras acima de R$ 500'; document.getElementById('pg-outra').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); 1");
    assert.match(await passo(), /^pergunta 2 de 3/);
    await clicar('[data-pg=voltar]');
    assert.strictEqual(await js("document.getElementById('pg-outra').value"), 'Só para compras acima de R$ 500');
    assert.deepStrictEqual(await marcadas(), []);
  });

  await t.test('só a última manda, com as respostas como ficaram', async () => {
    await clicar('[data-op="Liberar no cartão"]');
    assert.deepStrictEqual(await marcadas(), ['Compras', 'TI'], 'a 2ª continua como estava');
    await clicar('[data-pg=confirmar]');
    await clicar('[data-op="Segunda"]');
    const r = await espera((m) => m.t === 'responder');
    assert.deepStrictEqual({ id: r.id, respostas: r.respostas }, { id: 'conversa:orquestrador:r9', respostas: {
      'A NF continua obrigatória?': 'Liberar no cartão', 'Quais setores?': 'Compras, TI', 'Quando começa?': 'Segunda' } });
    assert.strictEqual(recebidas.filter((m) => m.t === 'responder').length, 1);
  });
});
