// Área: pet [lento]
const test = require('node:test');
const { pastaTemporaria } = require('../temporarias');
const assert = require('node:assert');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { abrirApp } = require('./app');

test('bichinho no app: menu e guarda-roupa', async (t) => {
  const app = await abrirApp();
  t.after(() => app.fechar());
  await app.esperar('!!window.orqGuardaRoupa && !!document.querySelector("#palco-pet .pet svg")');

  await t.test('botão direito abre o menu com guarda-roupa e chamar', async () => {
    await app.avaliar("document.querySelector('#palco-pet .pet').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 }))");
    await app.esperar("!document.querySelector('.pet-menu').hidden");
    assert.match(await app.avaliar("document.querySelector('.pet-menu').innerText"), /Conversar com ele[\s\S]*pedaço da tela[\s\S]*Guarda-roupa[\s\S]*Passear/);
    await app.avaliar("document.querySelector('[data-pm=roupa]').click()");
    await app.esperar("!document.getElementById('guarda-roupa').hidden");
  });

  await t.test('guarda-roupa: 30 itens + "nenhum" por parte; vestir grava e muda o bichinho', async () => {
    assert.strictEqual(await app.avaliar("document.querySelectorAll('.gr-item[data-gr-item]:not([data-gr-item=\"\"])').length"), 30);
    assert.strictEqual(await app.avaliar("document.querySelectorAll('.gr-item[data-gr-item=\"\"]').length"), 6);
    assert.strictEqual(await app.visivel('.gr-topo h3'), 'ok');
    await app.avaliar("document.querySelector('[data-gr-item=cartola]').click()");
    await app.esperar("!!document.querySelector('#palco-pet .item-cartola')");
    await app.avaliar("document.querySelector('[data-gr-item=bigode]').click()");
    await app.avaliar("document.querySelector('[data-gr-cor=verde]').click()");
    await app.esperar("!!document.querySelector('#palco-pet .item-bigode') && /#22a06b/.test(document.querySelector('#palco-pet .pet-svg').getAttribute('style'))");
    await app.espera(300);
    const p = JSON.parse(app.ler('.config/orq-app/pet.json'));
    assert.deepStrictEqual(p.visual, { especie: 'bicho', cor: 'verde', itens: { cabeca: 'cartola', rosto: 'bigode' } });
    assert.ok(await app.avaliar("document.querySelector('[data-gr-item=cartola]').classList.contains('ativo')"));
  });

  await t.test('trocar de chapéu substitui; Tirar tudo limpa', async () => {
    await app.avaliar("document.querySelector('[data-gr-item=coroa]').click()");
    await app.esperar("!!document.querySelector('#palco-pet .item-coroa') && !document.querySelector('#palco-pet .item-cartola')");
    await app.avaliar("document.querySelector('[data-gr-tirar]').click()");
    await app.esperar("!document.querySelector('#palco-pet .item')");
  });

  await t.test('Esc fecha; a roupa volta depois de recarregar', async () => {
    await app.avaliar("document.querySelector('[data-gr-item=gorro]').click()");
    await app.tecla('Escape');
    await app.esperar("document.getElementById('guarda-roupa').hidden");
    await app.avaliar('location.reload()');
    await app.espera(800);
    await app.esperar("!!document.querySelector('#palco-pet .item-gorro')", 8000);
  });

  // Regressão 2026-10-30: ele ficava "voando" acima da caixa de escrever.
  await t.test('regressão: pisa em cima da caixa de escrever, sem flutuar', async () => {
    await app.avaliar("document.querySelector('[data-aba=aba-orquestrador]').click()");
    await app.avaliar(`(() => { const p = window.orqPetAtual; const c = document.querySelector('.caixa-entrada').getBoundingClientRect();
      p.salaNome = 'centro'; p.modo = 'outro'; p.x = Math.round(c.left + 100); p.y = 0; p.noAr = false; p.encaixar(); })()`);
    await app.esperar('!window.orqPetAtual.noAr', 8000); // cai e pousa
    const r = await app.avaliar("({ pe: Math.round(window.orqPetAtual.el.getBoundingClientRect().bottom), topo: Math.round(document.querySelector('.caixa-entrada').getBoundingClientRect().top) })");
    assert.ok(Math.abs(r.pe - r.topo) <= 2, `pés em ${r.pe}, topo da caixa em ${r.topo}`);
  });

  // Regressão 2026-10-30: virado (desenho espelhado), ele olhava para o lado oposto ao do mouse.
  await t.test('regressão: virado, os olhos continuam indo para o lado certo', async () => {
    const r = await app.avaliar(`(() => { const p = window.orqPetAtual; const out = [];
      p.virar('dir'); p.olhar('esq'); out.push(p.el.dataset.olhar);
      p.virar('esq'); out.push(p.el.dataset.olhar);
      p.olhar('dir'); out.push(p.el.dataset.olhar);
      p.virar('dir'); out.push(p.el.dataset.olhar);
      return out; })()`);
    assert.deepStrictEqual(r, ['esq', 'dir', 'esq', 'dir']);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

// A janelinha do ajudante (processo próprio, em X11): o protocolo por linhas
// de JSON. Em teste a janela nunca aparece na tela.
test('ajudante fora do app: protocolo da janelinha', { skip: !process.env.DISPLAY && 'sem tela (DISPLAY) para o modo X11' }, async (t) => {
  const p = spawn(process.env.ORQ_ELECTRON, [path.join(__dirname, '../../pet/main.js'), '--ozone-platform=x11'], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, ORQ_PET_TESTE: '1', HOME: pastaTemporaria('orq-tela-') } });
  t.after(() => p.kill());
  const recebidas = [];
  readline.createInterface({ input: p.stdout }).on('line', (l) => { try { recebidas.push(JSON.parse(l)); } catch { /* outra saída */ } });
  const manda = (m) => p.stdin.write(JSON.stringify(m) + '\n');
  const espera = async (fn, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { const r = recebidas.find(fn); if (r) return r; await new Promise((x) => setTimeout(x, 100)); } throw new Error(`não chegou: ${fn}`); };
  const estado = async () => { recebidas.length = 0; manda({ t: 'estado' }); return espera((m) => m.t === 'estado'); };

  await espera((m) => m.t === 'iniciado', 20000);
  manda({ t: 'visual', visual: { cor: 'azul', itens: { cabeca: 'mago' } }, tema: 'dark' });
  manda({ t: 'chamar' });
  await espera((m) => m.t === 'visivel' && m.visivel);
  for (let i = 0; i < 60 && (await estado()).modo !== 'parado'; i++) await new Promise((x) => setTimeout(x, 100));
  const e = await estado();
  assert.strictEqual(e.modo, 'parado', 'entrou andando e parou');
  assert.strictEqual(e.conversaAberta, true, 'chamar abre a conversa');
  assert.deepStrictEqual(e.tam, { w: 420, h: 480 });
  manda({ t: 'sumir' });
  recebidas.length = 0;
  await espera((m) => m.t === 'visivel' && !m.visivel);
  assert.strictEqual((await estado()).modo, 'escondido');

  // Pedido de 2026-10-30: a pergunta vem com as opções e é respondida no próprio ajudante.
  manda({ t: 'sumir' });
  await new Promise((x) => setTimeout(x, 1500));
  const js = async (codigo) => { recebidas.length = 0; manda({ t: 'js', codigo }); return (await espera((m) => m.t === 'js')).r; };
  manda({ t: 'pendencia', texto: 'O orquestrador tem uma pergunta', total: 1, conversa: 'orquestrador', id: 'conversa:orquestrador:r1',
    item: { tipo: 'pergunta', quem: 'O orquestrador', reqId: 'r1', perguntas: [{ header: 'Ordem', question: 'Qual ordem vale?', options: [{ label: 'A primeira', description: 'como em 23/10' }, { label: 'A nova' }] }, { question: 'Grava agora?', multiSelect: true, options: [{ label: 'Sim' }, { label: 'Depois' }] }] } });
  for (let i = 0; i < 80 && !(await js("!document.getElementById('pergunta').hidden")); i++) await new Promise((x) => setTimeout(x, 100));
  assert.match(await js("document.getElementById('pg-corpo').innerText"), /Qual ordem vale\?[\s\S]*A primeira[\s\S]*como em 23\/10[\s\S]*A nova/);
  assert.strictEqual((await estado()).conversaAberta, true, 'janela grande para caber a pergunta');
  await js("document.querySelector('[data-op=\"A nova\"]').click()");
  assert.match(await js("document.getElementById('pg-passo').textContent"), /pergunta 2 de 2/);
  await js("document.querySelector('[data-op=\"Sim\"]').click(); document.querySelector('[data-pg=confirmar]').click()");
  const r = await espera((m) => m.t === 'responder');
  assert.deepStrictEqual({ id: r.id, respostas: r.respostas }, { id: 'conversa:orquestrador:r1', respostas: { 'Qual ordem vale?': 'A nova', 'Grava agora?': 'Sim' } });
  manda({ t: 'respondido', ok: true });
  for (let i = 0; i < 40 && !(await js("document.getElementById('pergunta').hidden")); i++) await new Promise((x) => setTimeout(x, 100));
  assert.ok(await js("document.getElementById('pergunta').hidden"), 'fecha depois de responder');
  // Depois de responder ele agradece e vai embora sozinho: espera sair de vez.
  recebidas.length = 0;
  await espera((m) => m.t === 'visivel' && !m.visivel, 15000);

  // Troca de área de trabalho (monitor principal): entra pela borda e volta ao mesmo lugar.
  manda({ t: 'pendencia', texto: 'teste', total: 1 });
  for (let i = 0; i < 60 && (await estado()).modo !== 'parado'; i++) await new Promise((x) => setTimeout(x, 100));
  const antes = (await estado()).pos.x;
  manda({ t: 'trocarArea', de: 1, para: 0 });
  const entrando = await estado();
  assert.strictEqual(entrando.modo, 'entrando');
  assert.ok(entrando.janela.x >= antes, 'começa na borda direita, por dentro do monitor');
  for (let i = 0; i < 60 && (await estado()).modo !== 'parado'; i++) await new Promise((x) => setTimeout(x, 100));
  assert.strictEqual((await estado()).pos.x, antes, 'volta para onde estava');
});

// Chegada e saída de cada espécie: pet-especies-1/2/3.e2e.js (dividido para rodar em paralelo).

// Pedido de 2026-11-13: o que espera aprovação vem com o bichinho de sempre
// (o pombo-correio separado foi desfeito no mesmo dia) e dá para aprovar ou
// negar ali mesmo, com motivo.
test('ajudante fora do app: o bichinho traz a aprovação', { skip: !process.env.DISPLAY && 'sem tela (DISPLAY) para o modo X11' }, async () => {
  const p = spawn(process.env.ORQ_ELECTRON, [path.join(__dirname, '../../pet/main.js'), '--ozone-platform=x11'], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, ORQ_PET_TESTE: '1', HOME: pastaTemporaria('orq-tela-') } });
  const recebidas = [];
  readline.createInterface({ input: p.stdout }).on('line', (l) => { try { recebidas.push(JSON.parse(l)); } catch { /* outra saída */ } });
  const manda = (m) => p.stdin.write(JSON.stringify(m) + '\n');
  const espera = async (fn, ms = 10000) => { for (let i = 0; i < ms / 50; i++) { const r = recebidas.find(fn); if (r) return r; await new Promise((x) => setTimeout(x, 50)); } throw new Error(`não chegou: ${fn}`); };
  const estado = async () => { recebidas.length = 0; manda({ t: 'estado' }); return espera((m) => m.t === 'estado'); };
  const js = async (codigo) => { recebidas.length = 0; manda({ t: 'js', codigo }); return (await espera((m) => m.t === 'js')).r; };
  try {
    await espera((m) => m.t === 'iniciado', 20000);
    manda({ t: 'visual', visual: { especie: 'gatinho', cor: 'azul', itens: { mao: 'caneca' } }, tema: 'dark' });
    manda({ t: 'pendencia', texto: 'Recado para Bruno espera você aprovar', total: 1, id: 'aprovar:e9',
      item: { tipo: 'aprovacao', recado: 'e9', canal: true, quem: 'Bruno', titulo: 'Deploy', texto: 'pode ser às 17h', motivo: 'vai sair deste computador; decisão: espera você aprovar' } });
    assert.strictEqual((await estado()).especie, 'gatinho', 'o bichinho de sempre');
    for (let i = 0; i < 80 && !(await js("!document.getElementById('pergunta').hidden")); i++) await new Promise((x) => setTimeout(x, 100));
    assert.match(await js("document.getElementById('pg-corpo').innerText"), /Recado para Bruno[\s\S]*Deploy[\s\S]*pode ser às 17h[\s\S]*espera você aprovar/);
    await js("document.getElementById('pg-nota').value = 'ok, mas confirma com a Carla'; document.querySelector('[data-pg=permitir]').click()");
    const r = await espera((m) => m.t === 'responder');
    assert.deepStrictEqual({ id: r.id, permitir: r.permitir, nota: r.nota }, { id: 'aprovar:e9', permitir: true, nota: 'ok, mas confirma com a Carla' });
  } finally { p.kill(); }
});

// 0.A3 da Etapa 0: pergunta com resposta secreta (isSecret, do Codex) nunca é
// digitada no bichinho. O app já não manda a pergunta para ele; se mandar (app
// antigo), a janelinha mostra só o aviso e o botão para abrir o app.
test('ajudante fora do app: pergunta com resposta secreta não tem campo no bichinho', { skip: !process.env.DISPLAY && 'sem tela (DISPLAY) para o modo X11' }, async () => {
  const p = spawn(process.env.ORQ_ELECTRON, [path.join(__dirname, '../../pet/main.js'), '--ozone-platform=x11'], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, ORQ_PET_TESTE: '1', HOME: pastaTemporaria('orq-tela-') } });
  const recebidas = [];
  readline.createInterface({ input: p.stdout }).on('line', (l) => { try { recebidas.push(JSON.parse(l)); } catch { /* outra saída */ } });
  const manda = (m) => p.stdin.write(JSON.stringify(m) + '\n');
  const espera = async (fn, ms = 10000) => { for (let i = 0; i < ms / 50; i++) { const r = recebidas.find(fn); if (r) return r; await new Promise((x) => setTimeout(x, 50)); } throw new Error(`não chegou: ${fn}`); };
  const js = async (codigo) => { recebidas.length = 0; manda({ t: 'js', codigo }); return (await espera((m) => m.t === 'js')).r; };
  try {
    await espera((m) => m.t === 'iniciado', 20000);
    manda({ t: 'visual', visual: { cor: 'azul', itens: {} }, tema: 'dark' });
    manda({ t: 'pendencia', texto: 'O orquestrador tem uma pergunta para você', total: 1, conversa: 'orquestrador', id: 'conversa:orquestrador:cx-99',
      item: { tipo: 'pergunta', quem: 'O orquestrador', reqId: 'cx-99', perguntas: [{ id: 'qa', header: 'Acesso', question: 'Qual a senha?', isSecret: true, isOther: true, options: [] }] } });
    for (let i = 0; i < 80 && !(await js("!document.getElementById('pergunta').hidden")); i++) await new Promise((x) => setTimeout(x, 100));
    assert.match(await js("document.getElementById('pg-corpo').innerText"), /resposta secreta: responda no app/);
    assert.strictEqual(await js("document.querySelectorAll('#pergunta textarea, #pergunta input').length"), 0, 'nenhum campo para digitar');
    assert.strictEqual(await js("!!document.querySelector('[data-pg=app]')"), true, 'só o botão de abrir o app');
    // Em inglês, o aviso também.
    manda({ t: 'visual', idioma: 'en', visual: { cor: 'azul', itens: {} }, tema: 'dark' });
    for (let i = 0; i < 50 && (await js('window.orqI18n.idioma()')) !== 'en'; i++) await new Promise((x) => setTimeout(x, 100));
    await new Promise((x) => setTimeout(x, 500));
    manda({ t: 'pendencia', texto: 'O orquestrador tem uma pergunta para você', total: 1, conversa: 'orquestrador', id: 'conversa:orquestrador:cx-100',
      item: { tipo: 'pergunta', quem: 'O orquestrador', reqId: 'cx-100', perguntas: [{ id: 'qa', question: 'Qual a senha?', isSecret: true, options: [] }] } });
    for (let i = 0; i < 50 && !/secret answer/.test(await js("document.getElementById('pg-corpo').innerText")); i++) await new Promise((x) => setTimeout(x, 100));
    assert.match(await js("document.getElementById('pg-corpo').innerText"), /^Question with a secret answer: answer it in the app\.$/);
  } finally { p.kill(); }
});

// 16/11: o app fechou enquanto a janelinha abria; o "iniciado" bateu num canal
// quebrado (EPIPE) e o Electron pôs a caixa "A JavaScript error occurred in the
// main process" na tela do usuário. A janelinha tem de sair quieta.
test('ajudante fora do app: app fechado antes do "iniciado" não vira caixa de erro', { skip: !process.env.DISPLAY && 'sem tela (DISPLAY) para o modo X11' }, async () => {
  const p = spawn(process.env.ORQ_ELECTRON, [path.join(__dirname, '../../pet/main.js'), '--ozone-platform=x11'], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ORQ_PET_TESTE: '1', HOME: pastaTemporaria('orq-tela-') } });
  let erro = '';
  p.stderr.on('data', (d) => { erro += d; });
  p.stdout.destroy(); // o lado do app fechou
  const saiu = await new Promise((ok) => {
    const t = setTimeout(() => ok(false), 15000);
    p.on('exit', () => { clearTimeout(t); ok(true); });
  });
  if (!saiu) p.kill('SIGKILL');
  assert.ok(saiu, 'a janelinha ficou presa (caixa de erro aberta) em vez de sair');
  assert.doesNotMatch(erro, /Uncaught Exception|EPIPE/);
});
