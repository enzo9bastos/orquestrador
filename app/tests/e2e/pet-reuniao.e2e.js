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

  // Pedido de 24/11: a miniatura era tirada uma vez, no começo da gravação, e ficava parada. Quem
  // começava a reunião pelo app via o próprio app nela e achava que os prints mostravam a tela errada.
  await t.test('a miniatura é a de agora: aberto, o painel pede uma nova na hora e de 2 em 2 s; a antiga não reaparece; fechado, para de pedir', async () => {
    const pedidos = () => recebidas.filter((m) => m.t === 'reuniao' && m.acao === 'tela').length;
    const img = () => js("(document.querySelector('#rn-corpo .rn-tela img') || {}).src || ''");
    const uma = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const outra = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    await dorme(3200); // a miniatura do subteste anterior envelhece
    const antes = pedidos();
    await js("document.querySelector('[data-m=reuniao]').click(); 1");
    for (let i = 0; i < 30 && pedidos() === antes; i++) await dorme(100);
    assert.strictEqual(pedidos(), antes + 1, 'pede a de agora ao abrir');
    assert.strictEqual(await img(), '', 'a miniatura antiga não aparece como se fosse de agora');
    manda({ t: 'reuniaoResposta', acao: 'tela', ok: true, tela: { miniatura: uma } });
    for (let i = 0; i < 30 && (await img()) !== uma; i++) await dorme(100);
    assert.strictEqual(await img(), uma);
    // 2 s depois pede de novo; a resposta troca só a imagem (o painel não é redesenhado).
    await js("document.querySelector('#rn-corpo .rn-tela').dataset.marca = 'a mesma'; 1");
    for (let i = 0; i < 40 && pedidos() < antes + 2; i++) await dorme(100);
    assert.ok(pedidos() >= antes + 2, 'pede de novo em 2 s');
    manda({ t: 'reuniaoResposta', acao: 'tela', ok: true, tela: { miniatura: outra } });
    for (let i = 0; i < 30 && (await img()) !== outra; i++) await dorme(100);
    assert.strictEqual(await img(), outra);
    assert.strictEqual(await js("document.querySelector('#rn-corpo .rn-tela').dataset.marca"), 'a mesma', 'só a imagem mudou');
    // Resposta sem imagem (a captura não respondeu): fica a última, sem mensagem de erro.
    manda({ t: 'reuniaoResposta', acao: 'tela', erro: 'a captura não respondeu' });
    await dorme(300);
    assert.strictEqual(await img(), outra);
    assert.strictEqual(await js("!!document.querySelector('#rn-corpo .aj-erro')"), false);
    // Na confirmação de terminar a miniatura continua viva; com o painel fechado, os pedidos param.
    await js("document.querySelector('[data-rn=terminar]').click(); 1");
    const naConfirmacao = pedidos();
    for (let i = 0; i < 40 && pedidos() === naConfirmacao; i++) await dorme(100);
    assert.ok(pedidos() > naConfirmacao, 'continua pedindo na confirmação de terminar');
    assert.strictEqual(await img(), outra);
    await js("document.querySelector('[data-rn=continuar]').click(); 1");
    await js("document.getElementById('rn-fechar').click(); 1");
    await dorme(300);
    const fechado = pedidos();
    await dorme(2600);
    assert.strictEqual(pedidos(), fechado, 'com o painel fechado não pede miniatura');
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

  // Pedido de 24/11: as paredes valiam para a janelinha (280×200, com o bichinho no canto de baixo, à
  // direita): ele batia no ar uns 180 px antes da borda esquerda e uns 150 px abaixo do topo da tela.
  await t.test('as bordas da tela valem para o desenho: arrastado, ele encosta na esquerda, no topo e na direita, e a janela não sai da tela', async () => {
    for (let i = 0; i < 60 && (await estado()).modo !== 'parado'; i++) await dorme(100);
    const a = (await estado()).area;
    const dentroDaTela = (e) => e.janela.x >= a.x && e.janela.y >= a.y && e.janela.x + e.janela.width <= a.x + a.width && e.janela.y + e.janela.height <= a.y + a.height;
    const arrasta = async (dx, dy) => { await js(`window.ajudante.enviar({ t: 'arrastar', dx: ${dx}, dy: ${dy} }); 1`); await dorme(150); const e = await estado(); assert.ok(dentroDaTela(e), `a janela não sai da tela: ${JSON.stringify(e.janela)}`); return e; };
    let e = await arrasta(-5000, -300);
    assert.ok(Math.abs(e.desenho.esq - a.x) <= 1, `encosta na borda esquerda: ${e.desenho.esq}`);
    assert.strictEqual(e.janela.x, a.x, 'a janela para na borda esquerda; quem anda é o desenho dentro dela');
    assert.ok(e.dentro.x < -100, `o desenho andou para a esquerda dentro da janela: ${e.dentro.x}`);
    assert.strictEqual(await js("getComputedStyle(document.getElementById('pet')).transform"), `matrix(1, 0, 0, 1, ${e.dentro.x}, ${e.dentro.y})`);
    e = await arrasta(5000, -5000);
    assert.ok(Math.abs(e.desenho.topo - a.y) <= 1, `encosta no topo: ${e.desenho.topo}`);
    assert.strictEqual(e.janela.y, a.y);
    e = await arrasta(5000, 5000);
    assert.ok(Math.abs(e.desenho.dir - (a.x + a.width)) <= 1, `encosta na borda direita: ${e.desenho.dir}`);
    // Solto encostado na esquerda, sem impulso: cai até o chão e dá uns passos para dentro, até caber de novo.
    await arrasta(-10000, 0);
    await js("window.ajudante.enviar({ t: 'soltar', vx: 0, vy: 0 }); 1");
    for (let i = 0; i < 80; i++) { await dorme(100); e = await estado(); if (Math.abs(e.pos.y - e.chao) <= 1 && e.dentro.x === 0 && e.dentro.y === 0 && e.pos.x === a.x) break; }
    assert.deepStrictEqual({ x: e.dentro.x, y: e.dentro.y, janelaX: e.janela.x, noChao: Math.abs(e.pos.y - e.chao) <= 1 }, { x: 0, y: 0, janelaX: a.x, noChao: true });
    assert.strictEqual(await js("getComputedStyle(document.getElementById('pet')).transform"), 'matrix(1, 0, 0, 1, 0, 0)');
  });

  // Visto na bateria de 24/11, com a máquina carregada: parado a menos de 1 px para fora da borda, ele
  // não se ajeitava e o arredondamento deixava o desenho 1 px deslocado dentro da janela.
  await t.test('parado a menos de 1 px da borda, ele acerta no lugar: o desenho não fica 1 px deslocado', async () => {
    const a = (await estado()).area;
    let e = await estado();
    assert.deepStrictEqual({ x: e.pos.x, dx: e.dentro.x }, { x: a.x, dx: 0 }, 'começa encostado na borda esquerda, ajeitado');
    await js("window.ajudante.enviar({ t: 'arrastar', dx: -0.7, dy: 0 }); 1");
    await js("window.ajudante.enviar({ t: 'soltar', vx: 0, vy: 0 }); 1");
    await dorme(600);
    e = await estado();
    assert.deepStrictEqual({ x: e.dentro.x, y: e.dentro.y, janelaX: e.janela.x }, { x: 0, y: 0, janelaX: a.x });
    assert.strictEqual(await js("getComputedStyle(document.getElementById('pet')).transform"), 'matrix(1, 0, 0, 1, 0, 0)');
  });

  await t.test('tacado com força, o desenho chega à borda esquerda e ao topo (e, para o outro lado, à direita); a janela fica dentro da tela', async () => {
    const a = (await estado()).area;
    const taca = async (vx, vy) => {
      manda({ t: 'extremos' });
      await js(`window.ajudante.enviar({ t: 'soltar', vx: ${vx}, vy: ${vy} }); 1`);
      await dorme(1500);
      let e = await estado();
      for (let i = 0; i < 80 && !(Math.abs(e.pos.y - e.chao) <= 1 && e.dentro.x === 0 && e.dentro.y === 0); i++) { await dorme(100); e = await estado(); }
      return e;
    };
    let e = await taca(-3000, -3000);
    assert.ok(e.extremos.esq <= a.x + 1, `chegou à borda esquerda: ${e.extremos.esq}`);
    assert.ok(e.extremos.topo <= a.y + 1, `chegou ao topo: ${e.extremos.topo}`);
    assert.ok(e.extremos.janelaEsq >= a.x && e.extremos.janelaTopo >= a.y, `a janela ficou dentro da tela: ${JSON.stringify(e.extremos)}`);
    assert.deepStrictEqual({ x: e.dentro.x, y: e.dentro.y, noChao: Math.abs(e.pos.y - e.chao) <= 1 }, { x: 0, y: 0, noChao: true }, 'parado, o desenho volta a caber na janela');
    e = await taca(3000, -1200);
    assert.ok(e.extremos.dir >= a.x + a.width - 1, `chegou à borda direita: ${e.extremos.dir}`);
    assert.ok(e.extremos.janelaDir <= a.x + a.width, `a janela ficou dentro da tela: ${JSON.stringify(e.extremos)}`);
    assert.deepStrictEqual({ x: e.dentro.x, y: e.dentro.y }, { x: 0, y: 0 });
  });

  // Pedido de 24/11 (visto num print: o pinguim deitado, parado no alto da tela): agarrado no meio da
  // chegada, ele ficava "chegando" para sempre, deitado de barriga, e não passeava mais.
  await t.test('agarrado no meio da chegada: a chegada acaba ali; pousado, ele fica em pé e faz o que veio fazer (passear)', async () => {
    manda({ t: 'sumir' });
    for (let i = 0; i < 100 && (await estado()).modo !== 'escondido'; i++) await dorme(100);
    manda({ t: 'visual', visual: { especie: 'pinguim', cor: 'azul', itens: {} }, tema: 'dark' });
    manda({ t: 'passear' });
    for (let i = 0; i < 200 && (await estado()).modo !== 'entrando'; i++) await dorme(50);
    await dorme(300);
    assert.strictEqual((await estado()).modo, 'entrando');
    await js("window.ajudante.enviar({ t: 'arrastar', dx: -200, dy: -200 }); 1");
    await dorme(150);
    await js("window.ajudante.enviar({ t: 'soltar', vx: 0, vy: 0 }); 1");
    let e = await estado();
    for (let i = 0; i < 60 && !(Math.abs(e.pos.y - e.chao) <= 1 && e.passeando); i++) { await dorme(100); e = await estado(); }
    const classes = await js("document.getElementById('pet').className");
    assert.deepStrictEqual({ modo: e.modo, passeando: e.passeando, noChao: Math.abs(e.pos.y - e.chao) <= 1, deitado: /deslizando/.test(classes) }, { modo: 'parado', passeando: true, noChao: true, deitado: false });
  });

  await t.test('agarrado no meio da saída: a saída é cancelada e ele fica na tela', async () => {
    manda({ t: 'sumir' });
    for (let i = 0; i < 100 && (await estado()).modo !== 'saindo'; i++) await dorme(50);
    await dorme(700);
    const desde = recebidas.length;
    await js("window.ajudante.enviar({ t: 'arrastar', dx: -150, dy: -100 }); 1");
    await dorme(150);
    await js("window.ajudante.enviar({ t: 'soltar', vx: 0, vy: 0 }); 1");
    await dorme(3000);
    const e = await estado();
    const foiEmbora = recebidas.slice(desde).some((m) => m.t === 'visivel' && m.visivel === false);
    assert.deepStrictEqual({ modo: e.modo, foiEmbora, noChao: Math.abs(e.pos.y - e.chao) <= 1 }, { modo: 'parado', foiEmbora: false, noChao: true });
  });
});

// 23/11: gravando, ele segura uma câmera; e o print sai com um clique no balão de pensamento que
// fica acima da cabeça dele (primeiro foi um botão solto no canto da tela; o pedido foi trazer para
// junto do bichinho). Depois o balão virou uma nuvem desenhada em pixel, como o bichinho, com a
// câmera dentro e a conta numa etiqueta, e passou a subir quando ele usa chapéu. O tempo de gravação
// é a etiqueta vermelha: a versão discreta (escura, só com o ponto vermelho) não agradou e foi desfeita.
test('bichinho: câmera na mão enquanto grava e balão de pensamento que tira o print', { skip: !process.env.DISPLAY && 'sem tela (DISPLAY) para o modo X11' }, async (t) => {
  const env = { ...process.env, ORQ_PET_TESTE: '1', HOME: pastaTemporaria('orq-tela-') };
  delete env.WAYLAND_DISPLAY;
  const p = spawn(process.env.ORQ_ELECTRON, [path.join(__dirname, '../../pet/main.js'), '--ozone-platform=x11'], { stdio: ['pipe', 'pipe', 'ignore'], env });
  t.after(() => p.kill());
  const recebidas = [];
  readline.createInterface({ input: p.stdout }).on('line', (l) => { try { recebidas.push(JSON.parse(l)); } catch { /* outra saída */ } });
  const manda = (m) => p.stdin.write(JSON.stringify(m) + '\n');
  const espera = async (fn, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { const r = recebidas.find(fn); if (r) return r; await new Promise((x) => setTimeout(x, 100)); } throw new Error(`não chegou: ${fn}`); };
  const js = async (codigo) => { const i = recebidas.length; manda({ t: 'js', codigo }); return (await espera((m, k) => k >= i && m.t === 'js')).r; };
  const dorme = (ms) => new Promise((x) => setTimeout(x, ms));
  const gravando = (x = {}) => ({ gravando: true, inicio: Date.now(), prints: 0, marcas: 0, printsLigados: true, processando: [], ...x });
  const BALAO = "document.getElementById('pensa-print')";
  const aVista = `(() => { const b = ${BALAO}; return !b.hidden && getComputedStyle(b).display !== 'none'; })()`;
  await espera((m) => m.t === 'iniciado', 20000);
  manda({ t: 'visual', visual: { cor: 'azul', itens: { mao: 'caneca' } }, tema: 'dark' });
  await dorme(300);

  await t.test('sem gravar: na mão, o que ele já tinha; nada de balão de print', async () => {
    assert.strictEqual(await js("!!document.querySelector('#pet .item-caneca') && !document.querySelector('#pet .item-camera')"), true);
    assert.strictEqual(await js(aVista), false);
  });

  await t.test('gravando: a câmera no lugar da caneca, com a luz vermelha; o balão de pensamento aparece acima dele, dentro do próprio bichinho', async () => {
    manda({ t: 'reuniao', estado: gravando({ evento: 'comecou' }) });
    for (let i = 0; i < 30 && !(await js("!!document.querySelector('#pet .item-camera')")); i++) await dorme(100);
    assert.strictEqual(await js("!!document.querySelector('#pet .item-camera .rec-luz') && !document.querySelector('#pet .item-caneca')"), true);
    for (let i = 0; i < 30 && !(await js(aVista)); i++) await dorme(100);
    assert.strictEqual(await js(aVista), true);
    // Ele chega andando de trás da borda: mede depois que parou dentro da janela.
    const medir = () => js(`(() => { const b = ${BALAO}.getBoundingClientRect(), p = document.querySelector('#pet .pet-vira').getBoundingClientRect(); return { dentroDoBichinho: !!${BALAO}.closest('#pet'), acima: b.bottom <= p.top + 40, perto: p.top - b.bottom < 40 && Math.abs((b.left + b.right) / 2 - (p.left + p.right) / 2) < 90, naJanela: b.top >= 0 && b.left >= 0 && b.right <= innerWidth }; })()`);
    let pos = await medir();
    for (let i = 0; i < 60 && !pos.naJanela; i++) { await dorme(100); pos = await medir(); }
    assert.deepStrictEqual(pos, { dentroDoBichinho: true, acima: true, perto: true, naJanela: true });
    // O balão fica na frente do desenho do bichinho: o clique de verdade pega nele (e não no bichinho).
    assert.strictEqual(await js(`(() => { const r = ${BALAO}.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && !!e.closest('#pensa-print'); })()`), true);
    // O balão é uma nuvem desenhada em pixel (sem fundo de botão), com a câmera desenhada dentro (sem emoji).
    assert.deepStrictEqual(await js(`(() => { const b = ${BALAO}; const s = b.querySelector('svg.pn-nuvem'); return { nuvem: !!s && s.getAttribute('shape-rendering') === 'crispEdges' && s.querySelectorAll('.pn-fundo rect').length > 4, camera: b.querySelectorAll('.pn-camera rect').length > 3, semEmoji: !/\\p{Extended_Pictographic}/u.test(b.textContent), fundoDoBotao: getComputedStyle(b).backgroundColor, bolinhas: b.querySelectorAll('i').length, certoNoBranco: Math.max(...[...b.querySelectorAll('.pn-certo rect')].map((r) => +r.getAttribute('y') + +r.getAttribute('height'))) <= Math.min(...[...b.querySelectorAll('.pn-sombra rect')].map((r) => +r.getAttribute('y'))) }; })()`), { nuvem: true, camera: true, semEmoji: true, fundoDoBotao: 'rgba(0, 0, 0, 0)', bolinhas: 2, certoNoBranco: true });
  });

  await t.test('o tempo de gravação fica na etiqueta vermelha, com letra e ponto brancos (a versão discreta não agradou)', async () => {
    const cor = await js("(() => { const r = document.getElementById('rec'); const c = getComputedStyle(r); return { fundo: c.backgroundColor, letra: c.color, ponto: getComputedStyle(r.querySelector('i')).backgroundColor }; })()");
    assert.deepStrictEqual(cor, { fundo: 'rgb(198, 40, 40)', letra: 'rgb(255, 255, 255)', ponto: 'rgb(255, 255, 255)' });
  });

  await t.test('de chapéu alto, o balão sobe: nem a nuvem nem as bolinhas ficam em cima do chapéu', async () => {
    // Medidas com tudo parado (o balão boia e o bichinho respira).
    await js("(() => { const e = document.createElement('style'); e.id = 'teste-parado'; e.textContent = '.aj-pet, .aj-pet * { animation: none !important; }'; document.head.appendChild(e); return 1; })()");
    const medir = () => js(`(() => { const b = ${BALAO}; const r = b.getBoundingClientRect(); const ch = document.querySelector('#pet .item-cartola'); return { topo: Math.round(r.top), fundo: Math.round(Math.max(r.bottom, ...[...b.querySelectorAll('i')].map((i) => i.getBoundingClientRect().bottom))), topoDoChapeu: ch ? Math.round(ch.getBoundingClientRect().top) : null }; })()`);
    const sem = await medir();
    manda({ t: 'visual', visual: { cor: 'azul', itens: { cabeca: 'cartola' } }, tema: 'dark' });
    for (let i = 0; i < 30 && !(await js("!!document.querySelector('#pet .item-cartola')")); i++) await dorme(100);
    const com = await medir();
    assert.ok(com.topoDoChapeu !== null && com.fundo <= com.topoDoChapeu, `acima do chapéu: ${JSON.stringify(com)}`);
    assert.ok(com.topo < sem.topo - 15 && com.topo >= 0, `subiu e continua na janela: ${sem.topo} → ${com.topo}`);
    manda({ t: 'visual', visual: { cor: 'azul', itens: { mao: 'caneca' } }, tema: 'dark' });
    for (let i = 0; i < 30 && (await js("!!document.querySelector('#pet .item-cartola')")); i++) await dorme(100);
    assert.strictEqual((await medir()).topo, sem.topo, 'sem o chapéu, volta para o lugar');
    await js("document.getElementById('teste-parado').remove(); 1");
  });

  await t.test('um clique no balão pede o print na hora, sem arrastar o bichinho nem abrir o painel; a conta aparece nele', async () => {
    await js(`(() => { const b = ${BALAO}; for (const t of ['pointerdown', 'pointerup', 'click']) b.dispatchEvent(new PointerEvent(t, { button: 0, bubbles: true, pointerId: 1 })); return 1; })()`);
    await espera((m) => m.t === 'reuniao' && m.acao === 'print');
    assert.strictEqual(await js("document.getElementById('reuniao').hidden && !document.getElementById('pet').classList.contains('arrastado')"), true);
    assert.strictEqual(await js(`${BALAO}.classList.contains('flash')`), true, 'o brilho aparece antes da resposta do app');
    manda({ t: 'reuniao', estado: gravando({ prints: 3, evento: 'print' }) });
    for (let i = 0; i < 20 && (await js("document.getElementById('pensa-n').textContent")) !== '3'; i++) await dorme(100);
    assert.strictEqual(await js("document.getElementById('pensa-n').textContent"), '3');
    assert.strictEqual(await js(`${BALAO}.classList.contains('ok')`), true, 'print guardado: o ✓ aparece na nuvem');
    // Com o ✓ ainda na nuvem, outro clique pede outro print na hora: o ✓ sai da frente e o clarão volta.
    const pedidos = () => recebidas.filter((m) => m.t === 'reuniao' && m.acao === 'print').length;
    const comOCerto = pedidos();
    assert.strictEqual(await js(`(() => { const b = ${BALAO}; const noMeio = getComputedStyle(b.querySelector('.pn-certo')).animationName === 'aj-pensa-certo'; b.click(); return noMeio; })()`), true, 'o ✓ ainda estava na nuvem na hora do clique');
    for (let i = 0; i < 20 && pedidos() === comOCerto; i++) await dorme(50);
    assert.strictEqual(pedidos(), comOCerto + 1, 'o clique durante o ✓ pede outro print');
    assert.deepStrictEqual(await js(`({ ok: ${BALAO}.classList.contains('ok'), flash: ${BALAO}.classList.contains('flash') })`), { ok: false, flash: true });
    assert.strictEqual(await js("document.getElementById('bolha').hidden"), true, 'com o balão à vista, ele não fala por cima');
    // Três cliques seguidos: três pedidos.
    const antes = recebidas.filter((m) => m.t === 'reuniao' && m.acao === 'print').length;
    await js(`(() => { for (let i = 0; i < 3; i++) ${BALAO}.click(); return 1; })()`);
    await dorme(400);
    assert.strictEqual(recebidas.filter((m) => m.t === 'reuniao' && m.acao === 'print').length, antes + 3);
  });

  await t.test('erro do print: ele diz o motivo; com fala, menu ou painel aberto o balão sai da frente', async () => {
    const r = recebidas.filter((m) => m.t === 'reuniao' && m.acao === 'print').pop();
    manda({ t: 'reuniaoResposta', id: r.id, acao: 'print', erro: 'a tela não está sendo compartilhada' });
    for (let i = 0; i < 20 && (await js("document.getElementById('bolha').hidden")); i++) await dorme(100);
    assert.match(await js("document.getElementById('bolha').innerText"), /a tela não está sendo compartilhada/);
    assert.strictEqual(await js(aVista), false, 'com a fala na tela, o balão de pensamento some');
    for (let i = 0; i < 50 && !(await js("document.getElementById('bolha').hidden")); i++) await dorme(100);
    assert.strictEqual(await js(aVista), true);
    await js("document.querySelector('[data-m=reuniao]').click(); 1");
    assert.strictEqual(await js(aVista), false, 'com o painel aberto, o Print é o do painel');
    await js("document.getElementById('rn-fechar').click(); 1");
    assert.strictEqual(await js(aVista), true);
  });

  await t.test('prints desligados ou fim da gravação: o balão some e a caneca volta', async () => {
    manda({ t: 'reuniao', estado: gravando({ printsLigados: false, evento: 'prints-off' }) });
    for (let i = 0; i < 20 && (await js(aVista)); i++) await dorme(100);
    assert.strictEqual(await js(aVista), false);
    manda({ t: 'reuniao', estado: { gravando: false, processando: [], evento: 'parou' } });
    for (let i = 0; i < 30 && !(await js("!!document.querySelector('#pet .item-caneca')")); i++) await dorme(100);
    assert.strictEqual(await js("!document.querySelector('#pet .item-camera')"), true);
    assert.strictEqual(await js(aVista), false);
  });
});
