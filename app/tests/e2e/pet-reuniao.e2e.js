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
