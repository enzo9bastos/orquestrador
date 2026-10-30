// Área: pet
const test = require('node:test');
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
    assert.deepStrictEqual(p.visual, { cor: 'verde', itens: { cabeca: 'cartola', rosto: 'bigode' } });
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
  const p = spawn(process.env.ORQ_ELECTRON, [path.join(__dirname, '../../pet/main.js'), '--ozone-platform=x11'], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, ORQ_PET_TESTE: '1', HOME: require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'orq-tela-')) } });
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
});
