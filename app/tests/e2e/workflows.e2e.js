// Área: workflows
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

test('workflows', async (t) => {
  const app = await abrirApp({ arquivos: { 'segredo.txt': 'valor-secreto-123' } });
  t.after(() => app.fechar());
  await app.esperar('!!window.orqWorkflows');
  const centro = (sel) => app.avaliar(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
  const arrastar = async (de, para) => {
    await app.mouse('mousePressed', ...de);
    for (let i = 1; i <= 5; i++) await app.mouse('mouseMoved', Math.round(de[0] + (para[0] - de[0]) * i / 5), Math.round(de[1] + (para[1] - de[1]) * i / 5));
    await app.mouse('mouseReleased', ...para);
  };
  const salvo = (id) => app.avaliar(`window.orq.workflows.lista().then((l) => l.find((w) => w.id === ${JSON.stringify(id)}))`);
  const campo = (sel, v) => app.avaliar(`(() => { const c = document.querySelector(${JSON.stringify(sel)}); c.value = ${JSON.stringify(v)}; c.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const clicar = (sel) => app.avaliar(`document.querySelector(${JSON.stringify(sel)}).click()`);

  await t.test('a aba abre na lista (Workflows | Credenciais | Execuções), com a passada desligada', async () => {
    await clicar('[data-aba=aba-workflows]');
    await app.esperar("!document.getElementById('wf-inicio').hidden && document.querySelectorAll('.wf-linha-lista').length === 1");
    assert.ok(await app.avaliar('document.getElementById("wf-editor").hidden'));
    assert.deepStrictEqual(await app.avaliar("[...document.querySelectorAll('[data-wf-aba]')].map((b) => b.textContent)"), ['Workflows', 'Credenciais', 'Execuções']);
    assert.match(await app.avaliar("document.querySelector('.wf-linha-lista').innerText"), /Passada nos agentes[\s\S]*Desligado/);
    assert.ok(!(await app.avaliar('!!document.querySelector(".wf-inspetor")')), 'sem o painel “Este workflow”');
  });

  await t.test('credencial guarda só a referência; Testar diz o tamanho, nunca o valor', async () => {
    await clicar('[data-wf-aba=credenciais]');
    await app.esperar("/Nenhuma credencial/.test(document.getElementById('wf-lista-corpo').innerText)");
    await clicar('#wf-criar');
    await app.esperar("!document.getElementById('wf-modal').hidden");
    await app.avaliar(`(() => { const f = document.querySelector('[data-cred-form]'); f.nome.value = 'Token de teste'; f.tipo.value = 'arquivo'; f.tipo.dispatchEvent(new Event('change', { bubbles: true })); f.ref.value = '~/segredo.txt'; f.variavel.value = 'meu_token'; f.requestSubmit(); })()`);
    await app.esperar("!!document.querySelector('[data-testar-cred]')");
    await clicar('[data-testar-cred]');
    await app.esperar("!document.querySelector('[data-resultado-teste]').hidden");
    const r = await app.avaliar("document.querySelector('[data-resultado-teste]').textContent");
    assert.match(r, /Leu: 17 caracteres/);
    assert.doesNotMatch(await app.avaliar('document.body.innerText'), /valor-secreto/);
    const arq = app.ler('.config/orq-app/credenciais.json');
    assert.doesNotMatch(arq, /valor-secreto/);
    assert.match(arq, /"variavel": "MEU_TOKEN"/);
    await clicar('[data-fechar-modal]');
    await app.esperar("document.querySelectorAll('.wf-linha-lista[data-cred]').length === 1");
  });

  let id;
  await t.test('criar workflow abre o quadro em tela cheia; + acrescenta passo e abre os ajustes', async () => {
    await clicar('[data-wf-aba=workflows]');
    await clicar('#wf-criar');
    await app.esperar("!document.getElementById('wf-editor').hidden && document.querySelectorAll('.wf-no').length === 1 && document.activeElement.id === 'wf-nome'");
    await app.texto('Meu fluxo');
    id = (await app.avaliar('window.orq.workflows.lista()')).find((w) => w.id !== 'passada-frentes').id;
    await clicar('[data-mais-depois=n1]');
    await app.esperar("!document.getElementById('wf-gaveta').hidden");
    assert.ok(!(await app.avaliar("!!document.querySelector('#wf-gaveta [data-novo-no=agenda]')")), 'depois de um passo não se põe gatilho');
    await clicar('#wf-gaveta [data-novo-no=comando]');
    await app.esperar("document.querySelectorAll('.wf-no').length === 2 && document.querySelectorAll('.wf-linha').length === 1 && !document.getElementById('wf-modal').hidden");
    await campo('[data-cfg-no=comando]', 'echo "olá $MEU_TOKEN"');
    await app.avaliar("(() => { const c = document.querySelector('[data-cred-no]'); c.checked = true; c.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await clicar('[data-fechar-modal]');
    assert.match(await app.avaliar("document.querySelectorAll('.wf-no')[1].innerText"), /echo "olá \$MEU_TOKEN" · 🔑1/);
  });

  await t.test('rodar: o comando recebe a credencial e a saída sai mascarada', async () => {
    await clicar('#wf-rodar');
    await app.esperar("document.querySelector('.wf-no[data-no=n2]')?.classList.contains('estado-ok')", 8000);
    await clicar('[data-wf-modo=execucoes]');
    await app.esperar("!!document.querySelector('#wf-execs-editor [data-exec]')");
    // A execução que acabou de rodar já vem aberta.
    await app.esperar("/olá ••••/.test(document.getElementById('wf-execs-editor').innerText)");
    assert.doesNotMatch(app.ler('.cache/orq-app/workflows-execucoes.json'), /valor-secreto/);
    await clicar('[data-wf-modo=editor]');
  });

  await t.test('arrastar o passo grava; arrastar o fundo move o quadro; zoom', async () => {
    const antes = (await salvo(id)).nos[1];
    const z = await app.avaliar("parseFloat(document.getElementById('wf-zoom-valor').textContent) / 100");
    const de = await centro('.wf-no[data-no=n2] .wf-no-topo');
    await arrastar(de, [de[0] - 30, de[1] + 80]);
    await app.espera(500);
    const depois = (await salvo(id)).nos[1];
    assert.ok(Math.abs(depois.x - antes.x + 30 / z) <= 3 && Math.abs(depois.y - antes.y - 80 / z) <= 3, JSON.stringify([antes, depois, z]));
    const t0 = await app.avaliar("document.getElementById('wf-area').style.transform");
    const r = await app.avaliar("(() => { const q = document.getElementById('wf-quadro').getBoundingClientRect(); return [Math.round(q.left + 30), Math.round(q.top + 30)]; })()");
    // Botão do meio (rodinha apertada) move o quadro.
    const meio = (type, x, y) => app.cdp('Input.dispatchMouseEvent', { type, x, y, button: 'middle', buttons: type === 'mouseReleased' ? 0 : 4, clickCount: 1 });
    await meio('mousePressed', ...r);
    for (let i = 1; i <= 4; i++) await meio('mouseMoved', r[0] + i * 12, r[1] + i * 10);
    await meio('mouseReleased', r[0] + 48, r[1] + 40);
    await app.esperar(`document.getElementById('wf-area').style.transform !== ${JSON.stringify(t0)}`); // o fundo move
    await clicar('[data-zoom=mais]');
    await app.esperar(`parseFloat(document.getElementById('wf-zoom-valor').textContent) > ${z * 100}`);
    await clicar('[data-zoom=ajustar]');
    // O quadro muda no quadro de tela seguinte: medir antes daria posições velhas.
    await app.esperar("/scale\\(1\\.1\\)|scale\\(0\\./.test(document.getElementById('wf-area').style.transform)");
  });

  await t.test('tirar a ligação (Delete) e ligar de novo puxando da bolinha', async () => {
    await app.avaliar("document.querySelector('.wf-linha-toque').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))");
    await app.avaliar("document.getElementById('wf-quadro').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))");
    await app.esperar("document.querySelectorAll('.wf-linha').length === 0");
    await arrastar(await centro('.wf-no[data-no=n1] .porta.saida'), await centro('.wf-no[data-no=n2] .wf-no-resumo'));
    await app.esperar("document.querySelectorAll('.wf-linha').length === 1");
    await app.espera(500);
    assert.deepStrictEqual((await salvo(id)).ligacoes, [{ de: 'n1', para: 'n2' }]);
  });

  // Pedido de 2026-10-30: como no n8n/Maestri — esquerdo no fundo seleciona,
  // botão direito tem menu (acrescentar, duplicar, apagar, apagar tudo).
  await t.test('retângulo de seleção, Ctrl+D duplica, Delete apaga os selecionados', async () => {
    const q = await app.avaliar("(() => { const r = document.getElementById('wf-quadro').getBoundingClientRect(); return [Math.round(r.left + 8), Math.round(r.top + 8), Math.round(r.right - 60), Math.round(r.bottom - 70)]; })()");
    await arrastar([q[0], q[1]], [q[2], q[3]]);
    await app.esperar("document.querySelectorAll('.wf-no.selecionado').length === 2");
    await app.avaliar("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }))");
    await app.esperar("document.querySelectorAll('.wf-no').length === 4 && document.querySelectorAll('.wf-no.selecionado').length === 2");
    assert.strictEqual(await app.avaliar("document.querySelectorAll('.wf-linha').length"), 2, 'a cópia vem com a ligação entre eles');
    await app.avaliar("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))");
    await app.esperar("document.querySelectorAll('.wf-no').length === 2");
    await app.espera(500);
    assert.deepStrictEqual((await salvo(id)).nos.map((n) => n.id), ['n1', 'n2'], 'apagou só as cópias');
  });

  await t.test('botão direito: menu do fundo e do passo; acrescentar aqui; apagar tudo pede confirmação', async () => {
    const menu = async (sel, x, y) => app.avaliar(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${x} ?? r.left + 20, clientY: ${y} ?? r.top + 20 })); return document.getElementById('wf-menu-quadro').innerText; })()`);
    assert.match(await menu('.wf-no[data-no=n2] .wf-no-topo', 'null', 'null'), /Ajustes do passo[\s\S]*Duplicar[\s\S]*Apagar/);
    await app.avaliar("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    const q = await app.avaliar("(() => { const r = document.getElementById('wf-quadro').getBoundingClientRect(); return [Math.round(r.left + 40), Math.round(r.top + 40)]; })()");
    assert.match(await menu('#wf-grade', q[0], q[1]), /Acrescentar passo aqui[\s\S]*Selecionar tudo[\s\S]*Ajustar à tela[\s\S]*Apagar tudo/);
    await clicar('[data-mq=novo]');
    await app.esperar("!document.getElementById('wf-gaveta').hidden");
    assert.ok(await app.avaliar("!!document.querySelector('#wf-gaveta [data-novo-no=pasta]') && !!document.querySelector('#wf-gaveta [data-novo-no=escrever]')"), 'tem os passos de arquivo');
    await clicar('#wf-gaveta [data-novo-no=pasta]');
    await app.esperar("document.querySelectorAll('.wf-no').length === 3 && !document.getElementById('wf-modal').hidden");
    await app.avaliar("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await menu('#wf-grade', q[0], q[1]);
    await clicar('[data-mq=apagar-tudo]');
    assert.match(await app.avaliar("document.querySelector('[data-mq=apagar-tudo]').textContent"), /Confirmar: apagar os 3 passos/);
    assert.strictEqual(await app.avaliar("document.querySelectorAll('.wf-no').length"), 3, 'um clique só não apaga');
    await app.avaliar("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await app.avaliar("document.querySelector('.wf-no[data-no=n3]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))");
    await app.avaliar("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))");
    await app.esperar("document.querySelectorAll('.wf-no').length === 2");
  });

  await t.test('dois cliques no passo abrem os ajustes; descrição pelo menu ⋯', async () => {
    await app.avaliar("document.querySelector('.wf-no[data-no=n2]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))");
    await app.esperar("!!document.querySelector('[data-passo=n2]')");
    assert.match(await app.avaliar("document.querySelector('.wf-ultima').innerText"), /olá ••••/);
    await app.avaliar("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
    await app.esperar("document.getElementById('wf-modal').hidden");
    await clicar('#wf-mais');
    await clicar('[data-wf-acao=descricao]');
    await campo('[data-wf-prop=descricao]', 'Diz olá');
    await clicar('[data-fechar-modal]');
    await app.espera(500);
    assert.strictEqual((await salvo(id)).descricao, 'Diz olá');
  });

  await t.test('voltar à lista: aparece o workflow, a execução e o uso da credencial', async () => {
    await clicar('#wf-ativo');
    await clicar('#wf-voltar');
    await app.esperar("!document.getElementById('wf-inicio').hidden && document.querySelectorAll('.wf-linha-lista').length === 2");
    assert.match(await app.avaliar(`document.querySelector('[data-wf="${id}"]').innerText`), /Meu fluxo[\s\S]*Diz olá[\s\S]*última execução[\s\S]*Ligado/);
    await clicar('[data-wf-aba=execucoes]');
    assert.match(await app.avaliar("document.getElementById('wf-lista-corpo').innerText"), /Meu fluxo[\s\S]*manual/);
    await clicar('[data-wf-aba=credenciais]');
    assert.match(await app.avaliar("document.getElementById('wf-lista-corpo').innerText"), /usada em 1 workflow/);
    await clicar('[data-wf-aba=workflows]');
  });

  await t.test('@workflow: aparece na conversa e vai com os passos', async () => {
    assert.ok(await app.avaliar("window.orqWorkflows.listar().some((w) => w.nome === 'Meu fluxo')"));
    const e = await app.avaliar("window.__orqTeste.expandir('veja @workflow:\"Meu fluxo\"')");
    assert.match(e.enviar, /Workflow «Meu fluxo»[\s\S]*Rodar comando/);
  });

  await t.test('apagar (menu ⋯) pede confirmação e volta à lista', async () => {
    await clicar(`[data-wf="${id}"]`);
    await app.esperar("!document.getElementById('wf-editor').hidden");
    await clicar('#wf-mais');
    await clicar('[data-wf-acao=apagar]');
    assert.ok(await salvo(id), 'um clique só não apaga');
    await clicar('[data-wf-acao=apagar]');
    await app.esperar("!document.getElementById('wf-inicio').hidden && document.querySelectorAll('.wf-linha-lista').length === 1");
    assert.strictEqual(await salvo(id), undefined);
  });

  // Pedido de 2026-10-30: botão de apagar direto na lista.
  await t.test('apagar pela lista: botão na linha, com confirmação', async () => {
    const g = await app.avaliar("window.orq.workflows.gravar({ nome: 'Para apagar', nos: [{ id: 'n1', tipo: 'manual' }], ligacoes: [] })");
    await clicar('[data-aba=aba-workflows]');
    await app.esperar(`!!document.querySelector('[data-apagar-wf="${g.id}"]')`);
    assert.strictEqual(await app.visivel(`[data-apagar-wf="${g.id}"]`), 'ok');
    await clicar(`[data-apagar-wf="${g.id}"]`);
    assert.match(await app.avaliar(`document.querySelector('[data-apagar-wf="${g.id}"]').textContent`), /Confirmar/);
    assert.ok(await salvo(g.id), 'um clique só não apaga');
    assert.ok(!(await app.avaliar("document.getElementById('wf-editor').hidden === false")), 'clicar em Apagar não abre o workflow');
    await clicar(`[data-apagar-wf="${g.id}"]`);
    await app.esperar(`!document.querySelector('[data-wf="${g.id}"]')`);
    assert.strictEqual(await salvo(g.id), undefined);
    assert.ok(await salvo('passada-frentes'), 'os outros continuam');
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
