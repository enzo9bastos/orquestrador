// Área: voz (modo reunião: quem falou, pelo Google Meet)
// Pedido de 26/11 (caminho A): a extensão do navegador lê, na página do Meet, os nomes e quem está
// falando, e só enquanto o app grava. Aqui ela roda numa página de mentira com as mesmas partes do
// Meet (meet-falso.html), com o fundo da extensão trocado por um falso que só anota o que recebe.
// O que só uma ligação de verdade prova (o Meet real, a aba em segundo plano) fica para o teste
// com o usuário.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { pastaTemporaria } = require('../temporarias');

test('extensão do Meet: liga a legenda, deixa invisível, diz quem fala; parada a gravação, devolve tudo como estava', { skip: !process.env.DISPLAY && 'sem tela (DISPLAY) para o modo X11' }, async (t) => {
  const env = { ...process.env, HOME: pastaTemporaria('orq-tela-') };
  delete env.WAYLAND_DISPLAY;
  const p = spawn(process.env.ORQ_ELECTRON, [path.join(__dirname, 'meet-pagina.js'), '--ozone-platform=x11'], { stdio: ['pipe', 'pipe', 'ignore'], env });
  t.after(() => p.kill());
  const respostas = new Map();
  let pronto = false;
  readline.createInterface({ input: p.stdout }).on('line', (l) => { try { const m = JSON.parse(l); if (m.t === 'pronto') pronto = true; else respostas.set(m.id, m); } catch { /* outra saída */ } });
  const dorme = (ms) => new Promise((x) => setTimeout(x, ms));
  let n = 0;
  const js = async (codigo) => {
    const id = ++n;
    p.stdin.write(JSON.stringify({ id, js: codigo }) + '\n');
    for (let i = 0; i < 100 && !respostas.has(id); i++) await dorme(50);
    const r = respostas.get(id);
    if (!r) throw new Error(`sem resposta: ${codigo}`);
    if (r.erro) throw new Error(r.erro);
    return r.r;
  };
  const espera = async (codigo, ms = 4000) => { for (let i = 0; i < ms / 100; i++) { if (await js(codigo)) return true; await dorme(100); } return false; };
  for (let i = 0; i < 200 && !pronto; i++) await dorme(100);
  assert.ok(pronto, 'a página de mentira abriu');

  // O fundo da extensão, de mentira: anota cada mensagem e responde se o app está gravando.
  await js(`window.__msgs = []; window.__gravando = true; window.ignorarC = 2;
    window.chrome = { runtime: { lastError: null, sendMessage: (m, cb) => { window.__msgs.push(m); if (cb) setTimeout(() => cb({ gravando: window.__gravando, conectado: true }), 0); } } };
    window.__orqMeetTeste = { estadoMs: 200, quadrosMs: 200, falandoMs: 50, expor: (api) => { window.__api = api; } }; 1`);
  await js(fs.readFileSync(path.join(__dirname, '../../extensao-meet/meet.js'), 'utf8') + '\n;1');
  const falando = () => js("window.__msgs.filter((m) => m.t === 'falando').map((m) => m.quem)");
  const ligada = () => js("document.getElementById('cc').getAttribute('aria-pressed') === 'true'");

  await t.test('gravando: manda os participantes (com quem é a própria pessoa) e liga a legenda, mesmo que o Meet ignore a tecla', async () => {
    assert.ok(await espera("window.__msgs.some((m) => m.t === 'participantes')"));
    const part = await js("window.__msgs.find((m) => m.t === 'participantes')");
    assert.deepStrictEqual(part, { t: 'participantes', nomes: ['Ana Souza', 'Bruno Lima', 'Carla Dias'], eu: 'Carla Dias' });
    assert.ok(await espera("document.getElementById('cc').getAttribute('aria-pressed') === 'true'"), 'a legenda ficou ligada');
    assert.strictEqual(await js('window.teclasC'), 3, 'o Meet ignorou a tecla 2 vezes; a extensão tentou de novo até ligar');
    await dorme(600);
    assert.strictEqual(await js('window.teclasC'), 3, 'ligada, não aperta mais (a tecla liga e desliga)');
  });

  await t.test('quem fala: o nome antes do texto da legenda; "Você" é a própria pessoa; nome encurtado também vale', async () => {
    await js("window.falar('Ana Souza', 'bom dia'); 1");
    assert.ok(await espera("window.__msgs.some((m) => m.t === 'falando')"));
    await dorme(120);
    await js("window.continuar('a todos'); 1");
    await dorme(120);
    await js("window.falar('Você', 'oi, tudo bem'); 1");
    await dorme(120);
    await js("window.falar('Bruno', 'pode começar'); 1");
    await dorme(200);
    const q = await falando();
    assert.deepStrictEqual([...new Set(q)], ['Ana Souza', 'Carla Dias', 'Bruno'], JSON.stringify(q));
    assert.ok(q.filter((x) => x === 'Ana Souza').length >= 2, 'a fala que continua avisa de novo');
    assert.ok(!(await js("window.__msgs.some((m) => 'texto' in m)")), 'o texto da legenda nunca é mandado');
  });

  await t.test('a legenda fica invisível só na tela da pessoa (transparente, sem receber clique)', async () => {
    assert.strictEqual(await js("document.getElementById('legenda').getAttribute('data-orq-legenda')"), '1');
    assert.deepStrictEqual(await js("(() => { const s = getComputedStyle(document.getElementById('legenda')); return [s.opacity, s.pointerEvents]; })()"), ['0', 'none']);
    assert.strictEqual(await js("getComputedStyle(document.getElementById('quadros')).opacity"), '1', 'o resto da página continua igual');
  });

  await t.test('a gravação parou: a legenda que a extensão ligou é desligada, volta a aparecer, e nada mais é mandado', async () => {
    await js('window.__gravando = false; 1');
    assert.ok(await espera("document.getElementById('cc').getAttribute('aria-pressed') === 'false'"), 'desligou a legenda que ela mesma ligou');
    assert.ok(await espera("!document.getElementById('orq-meet-esconde-legenda')"));
    assert.strictEqual(await js("getComputedStyle(document.getElementById('legenda')).opacity"), '1');
    const antes = (await falando()).length;
    await js("window.falar('Ana Souza', 'mais uma coisa'); 1");
    await dorme(400);
    assert.strictEqual((await falando()).length, antes, 'sem gravação, não manda quem fala');
  });

  await t.test('legenda que a própria pessoa já tinha ligado: a extensão não aperta a tecla e, no fim, não desliga', async () => {
    await js("document.getElementById('cc').click(); window.ignorarC = 0; 1");
    await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true })); 1");
    assert.strictEqual(await ligada(), true);
    const teclas = await js('window.teclasC');
    await js('window.__gravando = true; 1');
    assert.ok(await espera("!!document.getElementById('orq-meet-esconde-legenda')"));
    await dorme(500);
    assert.strictEqual(await js('window.teclasC'), teclas, 'já estava ligada: nenhuma tecla');
    await js('window.__gravando = false; 1');
    assert.ok(await espera("!document.getElementById('orq-meet-esconde-legenda')"));
    await dorme(400);
    assert.strictEqual(await ligada(), true, 'a legenda dela continua ligada');
  });
});
