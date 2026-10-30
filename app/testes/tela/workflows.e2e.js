// Área: workflows
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

test('workflows', async (t) => {
  const app = await abrirApp();
  t.after(() => app.fechar());
  await app.esperar('!!window.orqWorkflows');
  const centro = (sel) => app.avaliar(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
  const arrastar = async (de, para) => {
    await app.mouse('mousePressed', ...de);
    for (let i = 1; i <= 5; i++) await app.mouse('mouseMoved', Math.round(de[0] + (para[0] - de[0]) * i / 5), Math.round(de[1] + (para[1] - de[1]) * i / 5));
    await app.mouse('mouseReleased', ...para);
  };
  const salvo = (id) => app.avaliar(`window.orq.workflows.lista().then((l) => l.find((w) => w.id === ${JSON.stringify(id)}))`);

  await t.test('aba existe e já traz a passada de 3 em 3 min, desligada', async () => {
    await app.avaliar("document.querySelector('[data-aba=aba-workflows]').click()");
    await app.esperar("document.querySelectorAll('.wf-no').length === 2");
    assert.match(await app.avaliar("document.querySelector('.item-workflow.ativo').innerText"), /Passada nas frentes/);
    assert.strictEqual(await app.avaliar("document.getElementById('wf-ativo').checked"), false);
    assert.strictEqual(await app.avaliar("document.querySelectorAll('.wf-linha').length"), 1);
    assert.match(await app.avaliar("document.querySelector('.wf-no').innerText"), /a cada 3 min/);
    assert.strictEqual(await app.visivel('#wf-rodar'), 'ok');
  });

  let id;
  await t.test('novo workflow + passo de comando + rodar mostra a saída', async () => {
    await app.avaliar("document.getElementById('novo-workflow').click()");
    await app.esperar("document.querySelectorAll('.wf-no').length === 1 && document.activeElement.id === 'wf-nome'");
    await app.texto('Meu fluxo');
    await app.avaliar("document.getElementById('wf-mais-passo').click()");
    await app.esperar("!document.getElementById('wf-menu-passos').hidden");
    await app.avaliar("document.querySelector('[data-novo-no=comando]').click()");
    await app.esperar("document.querySelectorAll('.wf-no').length === 2 && document.querySelectorAll('.wf-linha').length === 1");
    await app.avaliar("(() => { const c = document.querySelector('[data-cfg-no=comando]'); c.value = 'echo olá do workflow'; c.dispatchEvent(new Event('input', { bubbles: true })); })()");
    assert.match(await app.avaliar("document.querySelectorAll('.wf-no')[1].innerText"), /echo olá do workflow/);
    await app.avaliar("document.getElementById('wf-rodar').click()");
    await app.esperar("/olá do workflow/.test(document.getElementById('wf-execucoes').innerText)", 8000);
    assert.match(await app.avaliar("document.querySelector('.wf-exec-linha').innerText"), /manual[\s\S]*ok/);
    id = await app.avaliar("document.querySelector('.item-workflow.ativo').dataset.wf");
    const w = await salvo(id);
    assert.strictEqual(w.nome, 'Meu fluxo');
    assert.strictEqual(w.nos[1].config.comando, 'echo olá do workflow');
  });

  await t.test('arrastar um passo muda o lugar e grava', async () => {
    const antes = (await salvo(id)).nos[1];
    const de = await centro('.wf-no[data-no=n2] .wf-no-topo');
    await arrastar(de, [de[0] - 40, de[1] + 120]);
    await app.espera(500);
    const depois = (await salvo(id)).nos[1];
    assert.ok(Math.abs(depois.x - antes.x + 40) <= 2 && Math.abs(depois.y - antes.y - 120) <= 2, JSON.stringify([antes, depois]));
  });

  await t.test('tirar a ligação e ligar de novo puxando da bolinha', async () => {
    await app.avaliar("document.querySelector('.wf-linha-toque').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))");
    await app.esperar("!!document.querySelector('[data-wf-remover]') && /Ligação/.test(document.getElementById('wf-inspetor').innerText)");
    await app.avaliar("document.querySelector('[data-wf-remover]').click()");
    await app.esperar("document.querySelectorAll('.wf-linha').length === 0");
    await arrastar(await centro('.wf-no[data-no=n1] .porta.saida'), await centro('.wf-no[data-no=n2] .wf-no-resumo'));
    await app.esperar("document.querySelectorAll('.wf-linha').length === 1");
    await app.espera(500);
    assert.deepStrictEqual((await salvo(id)).ligacoes, [{ de: 'n1', para: 'n2' }]);
  });

  await t.test('ligar o workflow grava', async () => {
    await app.avaliar("document.getElementById('wf-ativo').click()");
    await app.espera(400);
    assert.strictEqual((await salvo(id)).ativo, true);
    assert.ok(await app.avaliar("document.querySelector('.item-workflow.ativo .ponto').classList.contains('trabalhando')"));
  });

  await t.test('@workflow: aparece na conversa e vai com os passos', async () => {
    assert.ok(await app.avaliar("window.orqWorkflows.listar().some((w) => w.nome === 'Meu fluxo')"));
    const e = await app.avaliar("window.__orqTeste.expandir('veja @workflow:\"Meu fluxo\"')");
    assert.match(e.enviar, /Workflow «Meu fluxo»[\s\S]*Rodar comando[\s\S]*echo olá do workflow/);
    assert.strictEqual(e.exibir, 'veja @workflow:"Meu fluxo"');
  });

  await t.test('apagar pede confirmação e volta para o outro workflow', async () => {
    await app.avaliar("document.getElementById('wf-apagar').click()");
    assert.match(await app.avaliar("document.getElementById('wf-apagar').textContent"), /Confirmar/);
    assert.ok(await salvo(id), 'um clique só não apaga');
    await app.avaliar("document.getElementById('wf-apagar').click()");
    await app.esperar("document.querySelectorAll('.item-workflow').length === 1 && /Passada/.test(document.querySelector('.item-workflow.ativo').innerText)");
    assert.strictEqual(await salvo(id), undefined);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
