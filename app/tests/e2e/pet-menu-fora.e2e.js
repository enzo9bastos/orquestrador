// Área: pet (o menu do botão direito do bichinho na área de trabalho)
// Pedido de 24/11: o menu saía cortado em cima (tinha mais itens do que cabiam acima do bichinho na
// janelinha), "Voltar para o app" e "Ir embora" faziam a mesma coisa, e "Passear pela tela" não
// fazia nada com ele já passeando. Agora a janelinha cresce enquanto o menu está aberto, sobrou um
// item só para voltar, e o do passeio vira "Ficar parado" quando ele está passeando.
const test = require('node:test');
const { pastaTemporaria } = require('../temporarias');
const assert = require('node:assert');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

test('bichinho fora do app: menu do botão direito', { skip: !process.env.DISPLAY && 'sem tela (DISPLAY) para o modo X11' }, async (t) => {
  const env = { ...process.env, ORQ_PET_TESTE: '1', HOME: pastaTemporaria('orq-tela-') };
  delete env.WAYLAND_DISPLAY;
  const p = spawn(process.env.ORQ_ELECTRON, [path.join(__dirname, '../../pet/main.js'), '--ozone-platform=x11'], { stdio: ['pipe', 'pipe', 'ignore'], env });
  t.after(() => p.kill());
  const recebidas = [];
  readline.createInterface({ input: p.stdout }).on('line', (l) => { try { recebidas.push(JSON.parse(l)); } catch { /* outra saída */ } });
  const manda = (m) => p.stdin.write(JSON.stringify(m) + '\n');
  const espera = async (fn, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { const r = recebidas.find(fn); if (r) return r; await new Promise((x) => setTimeout(x, 100)); } throw new Error(`não chegou: ${fn}`); };
  const js = async (codigo) => { const i = recebidas.length; manda({ t: 'js', codigo }); return (await espera((m, k) => k >= i && m.t === 'js')).r; };
  const estado = async () => { const i = recebidas.length; manda({ t: 'estado' }); return espera((m, k) => k >= i && m.t === 'estado'); };
  const dorme = (ms) => new Promise((x) => setTimeout(x, ms));
  const bolha = () => js("document.getElementById('bolha').hidden ? '' : document.getElementById('bolha').innerText.replace(/\\s+/g, ' ').trim()");
  const botaoDireito = () => js("document.getElementById('pet').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); 1");
  const itens = () => js("[...document.querySelectorAll('#menu li')].map((li) => li.textContent.trim())");
  // Cada item do menu inteiro dentro da janelinha (nenhum cortado em cima).
  const cabe = () => js("(() => { const m = document.getElementById('menu'); if (m.hidden) return 'fechado'; return [...m.querySelectorAll('li')].every((li) => { const r = li.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; }) ? 'cabe' : 'cortado: topo do menu em ' + Math.round(m.getBoundingClientRect().top); })()");
  const clicar = (m) => js(`document.querySelector('#menu [data-m=${m}]').click(); 1`);
  await espera((m) => m.t === 'iniciado', 20000);
  manda({ t: 'visual', visual: { cor: 'azul', itens: {} }, tema: 'dark' });

  // Sai para a área de trabalho pelo "Passear pela área de trabalho" do app: chega e fica passeando.
  manda({ t: 'passear' });
  await espera((m) => m.t === 'visivel' && m.visivel, 15000);
  for (let i = 0; i < 80 && (await estado()).modo !== 'parado'; i++) await dorme(100);

  await t.test('os itens: um só para voltar ao app (sem "Ir embora"); passeando, o do passeio é "Ficar parado"', async () => {
    for (let i = 0; i < 50 && !(await estado()).passeando; i++) await dorme(100);
    assert.strictEqual((await estado()).passeando, true);
    await botaoDireito();
    assert.deepStrictEqual(await itens(), ['Conversar', '📷 Mostrar um pedaço da tela', '🎙 Gravar reunião', 'Ficar parado', 'Voltar para o app']);
  });

  await t.test('aberto, o menu cabe inteiro: a janelinha cresce para cima, com o bichinho no mesmo lugar; fechado, ela volta', async () => {
    for (let i = 0; i < 30 && (await estado()).tam.h === 200; i++) await dorme(100);
    const e = await estado();
    assert.strictEqual(e.menuAberto, true);
    assert.ok(e.tam.h > 200 && e.tam.w === 280, `a janelinha cresceu: ${JSON.stringify(e.tam)}`);
    assert.strictEqual(e.janela.height, e.tam.h);
    assert.strictEqual(e.janela.y + e.janela.height, e.area.y + e.area.height, 'o bichinho continua no chão');
    assert.strictEqual(await cabe(), 'cabe');
    await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1");
    for (let i = 0; i < 30 && (await estado()).tam.h !== 200; i++) await dorme(100);
    const f = await estado();
    assert.deepStrictEqual({ menu: f.menuAberto, tam: f.tam, noChao: f.janela.y + f.janela.height === f.area.y + f.area.height }, { menu: false, tam: { w: 280, h: 200 }, noChao: true });
  });

  await t.test('abrir o menu com ele andando: ele para onde está (o menu não sai andando junto)', async () => {
    let a = await estado(), b = a;
    for (let i = 0; i < 150; i++) { await dorme(100); b = await estado(); if (b.pos.x !== a.pos.x) break; a = b; }
    assert.notStrictEqual(b.pos.x, a.pos.x, 'ele começou a andar');
    await botaoDireito();
    await dorme(300);
    const c = await estado();
    await dorme(500);
    const d = await estado();
    assert.strictEqual(d.pos.x, c.pos.x, 'parou');
    assert.strictEqual(await js("document.getElementById('pet').classList.contains('andando')"), false);
    assert.strictEqual(await cabe(), 'cabe');
  });

  await t.test('"Ficar parado": ele para de passear e avisa; o item vira "Passear pela tela", que faz ele passear de novo', async () => {
    await clicar('passear');
    for (let i = 0; i < 30 && (await estado()).passeando; i++) await dorme(100);
    assert.strictEqual((await estado()).passeando, false);
    for (let i = 0; i < 30 && !/Fico aqui/.test(await bolha()); i++) await dorme(100);
    assert.match(await bolha(), /^Fico aqui!$/);
    assert.strictEqual(await js("document.getElementById('menu').hidden"), true);
    // Parado de verdade: 9 segundos (mais que a maior pausa do passeio) sem sair do lugar.
    const antes = await estado();
    await dorme(9000);
    const depois = await estado();
    assert.deepStrictEqual(depois.pos, antes.pos, 'não saiu do lugar');
    await botaoDireito();
    assert.deepStrictEqual(await itens(), ['Conversar', '📷 Mostrar um pedaço da tela', '🎙 Gravar reunião', 'Passear pela tela', 'Voltar para o app']);
    await clicar('passear');
    for (let i = 0; i < 30 && !(await estado()).passeando; i++) await dorme(100);
    assert.strictEqual((await estado()).passeando, true);
    for (let i = 0; i < 30 && !/passeio/.test(await bolha()); i++) await dorme(100);
    assert.match(await bolha(), /^Oba, passeio!$/);
  });

  await t.test('"Conversar" pelo menu: a janela vai para o tamanho da conversa e fica nele', async () => {
    await botaoDireito();
    for (let i = 0; i < 30 && !(await estado()).menuAberto; i++) await dorme(100);
    await clicar('conversar');
    for (let i = 0; i < 30 && !(await estado()).conversaAberta; i++) await dorme(100);
    await dorme(400);
    const e = await estado();
    assert.deepStrictEqual({ conversa: e.conversaAberta, menu: e.menuAberto, tam: e.tam }, { conversa: true, menu: false, tam: { w: 420, h: 480 } });
    await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1");
    for (let i = 0; i < 30 && (await estado()).conversaAberta; i++) await dorme(100);
    assert.deepStrictEqual((await estado()).tam, { w: 280, h: 200 });
  });

  await t.test('"Voltar para o app": ele vai embora e o app fica sabendo', async () => {
    await botaoDireito();
    await clicar('voltar');
    await espera((m) => m.t === 'voltar');
    for (let i = 0; i < 80 && (await estado()).modo !== 'escondido'; i++) await dorme(100);
    const e = await estado();
    assert.deepStrictEqual({ modo: e.modo, passeando: e.passeando, menu: e.menuAberto }, { modo: 'escondido', passeando: false, menu: false });
  });
});
