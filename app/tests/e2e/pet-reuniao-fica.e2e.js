// Área: pet (o bichinho na área de trabalho durante a gravação de uma reunião)
// Relato de 25/11: "quando tô em reunião gravando e chega mensagem o pet vai embora". Gravando, o
// bichinho de fora é o controle da gravação (o balão do print, o tempo). Mas ele saía sozinho
// sempre que o aviso de uma pendência era resolvido, dispensado ou respondido, ou quando a pessoa
// ia ao app, sem olhar se havia reunião sendo gravada. Agora, gravando, ele fica; fora da
// gravação continua indo embora como antes, e a pessoa ainda pode mandar ("Voltar para o app").
const test = require('node:test');
const { pastaTemporaria } = require('../temporarias');
const assert = require('node:assert');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

test('bichinho fora do app com reunião sendo gravada: aviso que some não leva ele embora', { skip: !process.env.DISPLAY && 'sem tela (DISPLAY) para o modo X11' }, async (t) => {
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
  let marca = 0;
  const bolha = () => js("document.getElementById('bolha').hidden ? '' : document.getElementById('bolha').innerText.replace(/\\s+/g, ' ').trim()");
  const modo = async (qual, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { if ((await estado()).modo === qual) return true; await dorme(100); } return false; };
  const gravando = (mais = {}) => ({ gravando: true, inicio: Date.now(), prints: 0, marcas: 0, printsLigados: true, processando: [], ...mais });
  // Uma pendência chega: ele traz o aviso (e, se estava escondido, vem para a tela).
  const aviso = async () => {
    manda({ t: 'pendencia', texto: 'O orquestrador tem uma pergunta para você', total: 1, conversa: 'orquestrador', id: `conversa:orquestrador:${Date.now()}`, item: null });
    for (let i = 0; i < 100 && !/pergunta para você/.test(await bolha()); i++) await dorme(100);
    assert.match(await bolha(), /O orquestrador tem uma pergunta para você/);
  };
  // Continua na tela, sem estar saindo, pelo tempo em que antes já teria ido embora. (Nos testes a
  // janelinha nunca é mostrada de verdade: o que diz se ele está na tela é o modo.)
  const ficou = async (porque) => {
    await dorme(2600);
    const e = await estado();
    assert.strictEqual(e.modo, 'parado', porque);
    assert.ok(!recebidas.slice(marca).some((m) => m.t === 'visivel' && m.visivel === false), `${porque}: ele não avisou o app de que foi embora`);
    assert.deepStrictEqual(await js("[document.getElementById('rec').hidden, document.getElementById('pensa-print').hidden]"), [false, false], 'o tempo de gravação e o balão do print continuam com ele');
  };
  await espera((m) => m.t === 'iniciado', 20000);
  manda({ t: 'visual', visual: { cor: 'azul', itens: {} }, tema: 'dark' });

  await t.test('sem reunião, nada mudou: a pessoa foi ao app com o aviso lá fora e ele vai embora', async () => {
    await aviso();
    assert.ok(await modo('parado'));
    manda({ t: 'noApp' });
    assert.ok(await modo('escondido'), 'saiu de cena');
    assert.ok(recebidas.some((m) => m.t === 'visivel' && m.visivel === false));
  });

  await t.test('gravando: a pessoa foi ao app com o aviso lá fora, e ele fica (só o aviso sai)', async () => {
    manda({ t: 'reuniao', estado: gravando({ evento: 'comecou' }) });
    assert.ok(await modo('parado', 15000), 'gravando, ele vem para a tela');
    marca = recebidas.length; // daqui em diante, enquanto grava, ele não pode avisar que foi embora
    await aviso();
    manda({ t: 'noApp' });
    for (let i = 0; i < 50 && (await bolha()); i++) await dorme(100);
    assert.strictEqual(await bolha(), '', 'o aviso saiu');
    await ficou('foi ao app');
  });

  await t.test('gravando: a pendência foi resolvida no app, e ele fica', async () => {
    await aviso();
    manda({ t: 'resolvida' });
    for (let i = 0; i < 30 && !/Já foi resolvido/.test(await bolha()); i++) await dorme(100);
    assert.match(await bolha(), /Já foi resolvido/);
    await ficou('resolvida no app');
  });

  await t.test('gravando: a pessoa dispensou o aviso com "OK", e ele fica', async () => {
    await aviso();
    await js("document.querySelector('#bolha [data-acao=depois]').click(); 1");
    await ficou('dispensou com OK');
  });

  await t.test('gravando: o atalho com a conversa aberta fecha a conversa, e ele fica', async () => {
    manda({ t: 'chamar' });
    for (let i = 0; i < 50 && !(await estado()).conversaAberta; i++) await dorme(100);
    assert.strictEqual((await estado()).conversaAberta, true);
    manda({ t: 'chamar' });
    for (let i = 0; i < 50 && (await estado()).conversaAberta; i++) await dorme(100);
    assert.strictEqual((await estado()).conversaAberta, false);
    assert.strictEqual(await js("document.getElementById('conversa').hidden"), true);
    await ficou('fechou a conversa pelo atalho');
  });

  await t.test('gravando, a pessoa ainda pode mandar: "Voltar para o app" leva ele embora', async () => {
    await js("document.getElementById('pet').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); 1");
    await js("document.querySelector('#menu [data-m=voltar]').click(); 1");
    await espera((m) => m.t === 'voltar');
    assert.ok(await modo('escondido'));
  });

  await t.test('a reunião acabou: o aviso que some volta a levar ele embora', async () => {
    manda({ t: 'reuniao', estado: { gravando: false, processando: [], evento: 'parou' } });
    await aviso();
    assert.ok(await modo('parado'));
    manda({ t: 'resolvida' });
    assert.ok(await modo('escondido'), 'sem gravação, ele sai como antes');
  });
});
