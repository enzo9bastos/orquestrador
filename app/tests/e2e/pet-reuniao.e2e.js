// Área: pet (modo reunião no bichinho: começar, sinal de gravando, Print, Marcar, Terminar, nota pronta)
// Pedido de 23/11. A janelinha do bichinho só pede e mostra: aqui o teste faz o papel do app.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { pastaTemporaria } = require('../temporarias');

test('bichinho: modo reunião', { skip: !process.env.DISPLAY && 'sem tela (DISPLAY) para o modo X11' }, async (t) => {
  const env = { ...process.env, ORQ_PET_TESTE: '1', HOME: pastaTemporaria('orq-tela-') };
  delete env.WAYLAND_DISPLAY;
  const p = spawn(process.env.ORQ_ELECTRON, [path.join(__dirname, '../../pet/main.js'), '--ozone-platform=x11'], { stdio: ['pipe', 'pipe', 'ignore'], env });
  t.after(() => p.kill());
  const recebidas = [];
  readline.createInterface({ input: p.stdout }).on('line', (l) => { try { recebidas.push(JSON.parse(l)); } catch { /* outra saída */ } });
  const manda = (m) => p.stdin.write(JSON.stringify(m) + '\n');
  const espera = async (fn, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { const r = recebidas.find(fn); if (r) return r; await new Promise((x) => setTimeout(x, 100)); } throw new Error(`não chegou: ${fn}`); };
  const js = async (codigo) => { const i = recebidas.length; manda({ t: 'js', codigo }); return (await espera((m, k) => k >= i && m.t === 'js')).r; };
  const pedido = async (acao) => espera((m) => m.t === 'reuniao' && m.acao === acao);
  const texto = (id) => js(`document.getElementById('${id}').innerText.replace(/\\s+/g, ' ').trim()`);
  const estado = (x = {}) => ({ gravando: true, inicio: Date.now() - 65000, titulo: 'Alinhamento', prints: 0, marcas: 0, dispositivos: { voce: 'Microfone de teste', outros: 'Fone de teste' }, printsLigados: true, processando: [], ...x });

  await espera((m) => m.t === 'iniciado', 20000);
  manda({ t: 'visual', visual: { cor: 'azul', itens: {} }, tema: 'dark' });
  manda({ t: 'chamar' });
  await espera((m) => m.t === 'visivel' && m.visivel);
  await js("document.getElementById('fechar').click(); 1");

  await t.test('menu › Gravar reunião: título opcional, o lembrete de avisar as pessoas e "Começar a gravar"', async () => {
    await js("document.querySelector('[data-m=reuniao]').click(); 1");
    assert.strictEqual(await js("!document.getElementById('reuniao').hidden"), true);
    const c = await texto('reuniao');
    assert.match(c, /^Gravar reunião ✕ Título \(opcional\) Avise as pessoas da reunião que ela está sendo gravada\./);
    assert.match(c, /Cancelar Começar a gravar$/);
    await js("document.getElementById('rn-nome').value = 'Alinhamento'; document.querySelector('[data-rn=comecar]').click(); 1");
    const r = await pedido('comecar');
    assert.strictEqual(r.titulo, 'Alinhamento');
  });

  await t.test('erro ao começar volta para o painel com o motivo', async () => {
    const r = recebidas.find((m) => m.t === 'reuniao' && m.acao === 'comecar');
    manda({ t: 'reuniaoResposta', id: r.id, acao: 'comecar', erro: 'escolha a pasta das reuniões nas Configurações' });
    for (let i = 0; i < 30 && !/escolha a pasta/.test(await texto('reuniao')); i++) await new Promise((x) => setTimeout(x, 100));
    assert.match(await texto('reuniao'), /escolha a pasta das reuniões nas Configurações/);
  });

  await t.test('gravando: o sinal vermelho com o tempo fica no bichinho; o painel mostra os aparelhos e as contas', async () => {
    manda({ t: 'reuniao', estado: estado({ evento: 'comecou' }) });
    manda({ t: 'reuniaoResposta', id: 99, acao: 'comecar', ok: true });
    for (let i = 0; i < 30 && await js("document.getElementById('rec').hidden"); i++) await new Promise((x) => setTimeout(x, 100));
    assert.strictEqual(await js("document.getElementById('rec').hidden"), false);
    assert.match(await texto('rec'), /^01:0[5-9]$/);
    assert.strictEqual(await js("document.getElementById('pet').classList.contains('gravando')"), true);
    assert.match(await texto('reuniao'), /Alinhamento gravando · 01:0\d ✕ Microfone: Microfone de teste Som do computador: Fone de teste 📷 0 ★ 0 📷 Print ★ Marcar momento ⏹ Terminar/);
    assert.strictEqual(await js("document.getElementById('menu-reuniao').textContent"), '🎙 Reunião (gravando)');
  });

  await t.test('Print e Marcar pedem ao app; o painel mostra as contas novas', async () => {
    await js("document.querySelector('[data-rn=print]').click(); 1");
    await pedido('print');
    await js("document.querySelector('[data-rn=marcar]').click(); 1");
    await pedido('marcar');
    manda({ t: 'reuniao', estado: estado({ prints: 1, marcas: 1, evento: 'marca' }) });
    for (let i = 0; i < 30 && !/📷 1 ★ 1/.test(await texto('reuniao')); i++) await new Promise((x) => setTimeout(x, 100));
    assert.match(await texto('reuniao'), /📷 1 ★ 1/);
  });

  await t.test('fechado o painel, um clique no bichinho gravando abre o painel de novo', async () => {
    await js("document.getElementById('rn-fechar').click(); 1");
    assert.strictEqual(await js("document.getElementById('reuniao').hidden"), true);
    await js("const e = document.getElementById('pet'); e.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, pointerId: 1 })); e.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true, pointerId: 1 })); 1");
    assert.strictEqual(await js("!document.getElementById('reuniao').hidden"), true);
  });

  await t.test('Terminar pede confirmação; só "Terminar" de novo pede ao app', async () => {
    await js("document.querySelector('[data-rn=terminar]').click(); 1");
    assert.match(await texto('reuniao'), /Terminar a reunião\? A gravação para e a nota começa a ser montada\. Continuar gravando Terminar/);
    await js("document.querySelector('[data-rn=continuar]').click(); 1");
    assert.ok(!recebidas.some((m) => m.t === 'reuniao' && m.acao === 'terminar'));
    await js("document.querySelector('[data-rn=terminar]').click(); document.querySelector('[data-rn=\"terminar-sim\"]').click(); 1");
    await pedido('terminar');
    manda({ t: 'reuniao', estado: { gravando: false, processando: [{ pasta: '/x', fase: 'transcrevendo', pct: 40 }], evento: 'parou' } });
    for (let i = 0; i < 30 && !/40%/.test(await texto('reuniao')); i++) await new Promise((x) => setTimeout(x, 100));
    assert.match(await texto('reuniao'), /Montando a nota ✕ Transcrevendo… 40%/);
    assert.strictEqual(await js("document.getElementById('rec').hidden"), true, 'parou de gravar: o sinal sai');
  });

  await t.test('nota pronta: o painel oferece abrir a nota e a pasta', async () => {
    manda({ t: 'reuniao', estado: { gravando: false, processando: [], evento: 'pronta', nota: '/r/2026-11-23-09h30-nf/reuniao.md', pasta: '/r/2026-11-23-09h30-nf', assunto: 'NF obrigatória' } });
    for (let i = 0; i < 30 && !/NF obrigatória/.test(await texto('reuniao')); i++) await new Promise((x) => setTimeout(x, 100));
    assert.match(await texto('reuniao'), /Nota da reunião pronta ✕ NF obrigatória Abrir a pasta Abrir a nota/);
    await js("document.querySelector('[data-rn=nota]').click(); 1");
    const r = await pedido('abrir');
    assert.strictEqual(r.caminho, '/r/2026-11-23-09h30-nf/reuniao.md');
  });
});

// Pedido de 23/11: o app nota a ligação pelo microfone e o bichinho pergunta; a miniatura do que os
// prints mostram, com "Trocar"; e tacar o bichinho pela tela, como o de dentro do app.
test('bichinho: reunião detectada, fim da ligação, miniatura da tela e arremesso', { skip: !process.env.DISPLAY && 'sem tela (DISPLAY) para o modo X11' }, async (t) => {
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
  const bolha = () => js("document.getElementById('bolha').hidden ? '' : document.getElementById('bolha').innerText.replace(/\\s+/g, ' ').trim()");
  const dorme = (ms) => new Promise((x) => setTimeout(x, ms));
  await espera((m) => m.t === 'iniciado', 20000);
  manda({ t: 'visual', visual: { cor: 'azul', itens: {} }, tema: 'dark' });

  await t.test('ligação detectada com ele escondido: ele aparece e pergunta; "Gravar" pede ao app', async () => {
    manda({ t: 'reuniao', estado: { gravando: false, processando: [], evento: 'detectada', nome: 'o navegador' } });
    await espera((m) => m.t === 'visivel' && m.visivel, 15000);
    for (let i = 0; i < 40 && !/Começou uma reunião no navegador/.test(await bolha()); i++) await dorme(100);
    assert.match(await bolha(), /^Começou uma reunião no navegador\? Quer gravar\? Sim, gravar Agora não$/);
    await js("document.querySelector('#bolha [data-acao=\"rn-gravar\"]').click(); 1");
    const r = await espera((m) => m.t === 'reuniao' && m.acao === 'comecar');
    assert.strictEqual(r.titulo, '');
  });

  await t.test('gravando: a miniatura do que os prints mostram aparece no painel, com "Trocar"', async () => {
    manda({ t: 'reuniao', estado: { gravando: true, inicio: Date.now(), prints: 0, marcas: 0, printsLigados: true, processando: [], evento: 'comecou' } });
    const px = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
    manda({ t: 'reuniao', estado: { gravando: true, inicio: Date.now(), prints: 0, marcas: 0, printsLigados: true, processando: [], evento: 'tela', tela: { miniatura: px } } });
    await dorme(300);
    await js("document.querySelector('[data-m=reuniao]').click(); 1");
    for (let i = 0; i < 30 && !(await js("!!document.querySelector('.rn-tela img')")); i++) await dorme(100);
    assert.match(await js("document.querySelector('.rn-tela').innerText.replace(/\\s+/g, ' ').trim()"), /^Os prints mostram isto\. Trocar$/);
    await js("document.querySelector('[data-rn=\"trocar-tela\"]').click(); 1");
    await espera((m) => m.t === 'reuniao' && m.acao === 'trocarTela');
    await js("document.getElementById('rn-fechar').click(); 1");
  });

  await t.test('a ligação acabou: ele pergunta se termina; "Terminar" pede ao app', async () => {
    manda({ t: 'reuniao', estado: { gravando: true, inicio: Date.now(), prints: 0, marcas: 0, printsLigados: true, processando: [], evento: 'acabou', nome: 'o navegador' } });
    for (let i = 0; i < 40 && !/acabou\?/.test(await bolha()); i++) await dorme(100);
    assert.match(await bolha(), /^A ligação no navegador acabou\? Terminar a gravação\? Terminar Continuar gravando$/);
    await js("document.querySelector('#bolha [data-acao=\"rn-terminar\"]').click(); 1");
    await espera((m) => m.t === 'reuniao' && m.acao === 'terminar');
    manda({ t: 'reuniao', estado: { gravando: false, processando: [], evento: 'parou' } });
  });

  await t.test('tacar: solto com velocidade para a esquerda e para cima, ele voa e para no chão, dentro da tela', async () => {
    for (let i = 0; i < 60 && (await estado()).modo !== 'parado'; i++) await dorme(100);
    const antes = await estado();
    await js("window.ajudante.enviar({ t: 'soltar', vx: -250, vy: -1800 }); 1");
    await dorme(150);
    const voando = await estado();
    assert.ok(voando.pos.y < antes.pos.y, `subiu: ${antes.pos.y} → ${voando.pos.y}`);
    await dorme(2500);
    let e = await estado();
    for (let i = 0; i < 60 && Math.abs(e.pos.y - e.chao) > 1; i++) { await dorme(100); e = await estado(); }
    assert.ok(Math.abs(e.pos.y - e.chao) <= 1, `parou no chão: y ${e.pos.y}, chão ${e.chao}`);
    const larg = await js('screen.availWidth');
    assert.ok(e.pos.x >= 0 && e.pos.x + e.tam.w <= larg + 1, `dentro da tela: x ${e.pos.x}`);
    assert.ok(e.pos.x < antes.pos.x - 100, `foi para a esquerda: ${antes.pos.x} → ${e.pos.x}`);
  });
});

// 23/11: gravando, ele segura uma câmera; e um botão flutuante tira o print com um clique.
test('bichinho: câmera na mão enquanto grava e botão flutuante de print', { skip: !process.env.DISPLAY && 'sem tela (DISPLAY) para o modo X11' }, async (t) => {
  const env = { ...process.env, ORQ_PET_TESTE: '1', HOME: pastaTemporaria('orq-tela-') };
  delete env.WAYLAND_DISPLAY;
  const p = spawn(process.env.ORQ_ELECTRON, [path.join(__dirname, '../../pet/main.js'), '--ozone-platform=x11'], { stdio: ['pipe', 'pipe', 'ignore'], env });
  t.after(() => p.kill());
  const recebidas = [];
  readline.createInterface({ input: p.stdout }).on('line', (l) => { try { recebidas.push(JSON.parse(l)); } catch { /* outra saída */ } });
  const manda = (m) => p.stdin.write(JSON.stringify(m) + '\n');
  const espera = async (fn, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { const r = recebidas.find(fn); if (r) return r; await new Promise((x) => setTimeout(x, 100)); } throw new Error(`não chegou: ${fn}`); };
  const js = async (codigo, t2 = 'js') => { const i = recebidas.length; manda({ t: t2, codigo }); return (await espera((m, k) => k >= i && m.t === 'js')).r; };
  const estado = async () => { const i = recebidas.length; manda({ t: 'estado' }); return espera((m, k) => k >= i && m.t === 'estado'); };
  const dorme = (ms) => new Promise((x) => setTimeout(x, ms));
  const gravando = (x = {}) => ({ gravando: true, inicio: Date.now(), prints: 0, marcas: 0, printsLigados: true, processando: [], ...x });
  await espera((m) => m.t === 'iniciado', 20000);
  manda({ t: 'visual', visual: { cor: 'azul', itens: { mao: 'caneca' } }, tema: 'dark' });
  await dorme(300);

  await t.test('sem gravar: na mão, o que ele já tinha; nada de botão flutuante', async () => {
    assert.strictEqual(await js("!!document.querySelector('#pet .item-caneca') && !document.querySelector('#pet .item-camera')"), true);
    assert.strictEqual((await estado()).botao, null);
  });

  await t.test('gravando: a câmera no lugar da caneca, com a luz vermelha; o botão flutuante aparece na borda direita', async () => {
    manda({ t: 'reuniao', estado: gravando({ evento: 'comecou' }) });
    for (let i = 0; i < 30 && !(await js("!!document.querySelector('#pet .item-camera')")); i++) await dorme(100);
    assert.strictEqual(await js("!!document.querySelector('#pet .item-camera .rec-luz') && !document.querySelector('#pet .item-caneca')"), true);
    let e = await estado();
    for (let i = 0; i < 30 && !e.botao; i++) { await dorme(100); e = await estado(); }
    assert.ok(e.botao && e.botao.width === 64, JSON.stringify(e.botao));
    const larg = await js('screen.availWidth');
    assert.ok(e.botao.x + e.botao.width >= larg - 30, `na borda direita: ${e.botao.x}`);
  });

  await t.test('um clique no botão pede o print ao app na hora; a conta de prints aparece nele', async () => {
    await dorme(500);
    await js("(() => { const b = document.getElementById('b'); b.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, pointerId: 1, screenX: 10, screenY: 10 })); b.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true, pointerId: 1, screenX: 10, screenY: 10 })); return b.classList.contains('flash'); })()", 'js-botao');
    const r = await espera((m) => m.t === 'reuniao' && m.acao === 'print');
    assert.match(r.id, /^botao-\d+$/);
    manda({ t: 'reuniao', estado: gravando({ prints: 3, evento: 'print' }) });
    for (let i = 0; i < 20 && (await js("document.getElementById('n').textContent", 'js-botao')) !== '3'; i++) await dorme(100);
    assert.strictEqual(await js("document.getElementById('n').textContent", 'js-botao'), '3');
    // Erro do app: o botão fica cinza e diz por quê.
    manda({ t: 'reuniaoResposta', id: r.id, acao: 'print', erro: 'a tela não está sendo compartilhada' });
    for (let i = 0; i < 20 && !(await js("document.getElementById('b').classList.contains('erro')", 'js-botao')); i++) await dorme(100);
    assert.strictEqual(await js("document.getElementById('b').title", 'js-botao'), 'a tela não está sendo compartilhada');
  });

  await t.test('prints desligados ou fim da gravação: o botão some e a caneca volta', async () => {
    manda({ t: 'reuniao', estado: gravando({ printsLigados: false, evento: 'prints-off' }) });
    await dorme(300);
    assert.strictEqual((await estado()).botao, null);
    manda({ t: 'reuniao', estado: { gravando: false, processando: [], evento: 'parou' } });
    for (let i = 0; i < 30 && !(await js("!!document.querySelector('#pet .item-caneca')")); i++) await dorme(100);
    assert.strictEqual(await js("!document.querySelector('#pet .item-camera')"), true);
  });
});
