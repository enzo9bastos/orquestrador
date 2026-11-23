// Área: voz (detectar a reunião pelo microfone: pedido de 23/11, "detectar um Meet, Zoom… e começar sozinho")
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pastaTemporaria } = require('../temporarias');
const D = require('../../reuniao-detectar');

function montar(o = {}) {
  let t = 0;
  let agora = [];
  const eventos = [];
  let gravando = false;
  const d = D.criar({ listar: async () => agora, agora: () => t, aoMudar: (e) => eventos.push(e), gravando: () => gravando, nossos: () => [999], ...o });
  return { d, eventos, pôr: (l) => { agora = l; }, andar: (s) => { t += s * 1000; }, gravar: (g) => { gravando = g; } };
}

test('detectar: um programa de reunião usando o microfone por 10 s vira "detectada", uma vez só por ligação', async () => {
  const m = montar();
  m.pôr([{ app: 'Google Chrome', binario: 'chrome', pid: 10 }]);
  await m.d.passo(); m.andar(5); await m.d.passo();
  assert.deepStrictEqual(m.eventos, [], 'antes dos 10 s, nada');
  m.andar(6); await m.d.passo();
  assert.deepStrictEqual(m.eventos, [{ evento: 'detectada', nome: 'o navegador' }]);
  m.andar(30); await m.d.passo();
  assert.strictEqual(m.eventos.length, 1, 'a mesma ligação não é avisada de novo');
});

test('detectar: gravando, quando a ligação solta o microfone por 60 s vira "acabou"; uma pausa curta não', async () => {
  const m = montar();
  m.pôr([{ app: 'ZOOM VoiceEngine', binario: 'zoom', pid: 11 }]);
  await m.d.passo(); m.andar(11); await m.d.passo();
  assert.deepStrictEqual(m.eventos.map((e) => e.nome), ['o Zoom']);
  m.gravar(true);
  m.pôr([]); m.andar(30); await m.d.passo();
  m.pôr([{ app: 'ZOOM VoiceEngine', binario: 'zoom', pid: 11 }]); m.andar(5); await m.d.passo();
  m.pôr([]); m.andar(40); await m.d.passo();
  assert.strictEqual(m.eventos.length, 1, 'voltou a usar o microfone no meio: não acabou');
  m.andar(25); await m.d.passo();
  assert.deepStrictEqual(m.eventos[1], { evento: 'acabou', nome: 'o Zoom' });
  // Depois que acabou, uma ligação nova é avisada de novo.
  m.gravar(false);
  m.pôr([{ app: 'teams-for-linux', binario: 'teams-for-linux', pid: 12 }]);
  await m.d.passo(); m.andar(11); await m.d.passo();
  assert.deepStrictEqual(m.eventos[2], { evento: 'detectada', nome: 'o Teams' });
});

test('detectar: o próprio app (ffmpeg, o pid do app), programas que não são de ligação e captura do som do computador ficam de fora', async () => {
  const m = montar();
  m.pôr([{ app: 'ffmpeg', binario: 'ffmpeg', pid: 50 }, { app: 'Lavf61.7.100', binario: 'ffmpeg', pid: 51 }, { app: 'OBS', binario: 'obs', pid: 52 }, { app: 'Google Chrome', binario: 'chrome', pid: 999 }]);
  await m.d.passo(); m.andar(20); await m.d.passo();
  assert.deepStrictEqual(m.eventos, []);
});

test('detectar: já gravando quando a ligação começa, não pergunta; sem PipeWire, fica quieto', async () => {
  const m = montar();
  m.gravar(true);
  m.pôr([{ app: 'Slack', binario: 'slack', pid: 13 }]);
  await m.d.passo(); m.andar(11); await m.d.passo();
  assert.deepStrictEqual(m.eventos, []);
  const n = montar({ listar: async () => null });
  await n.d.passo(); n.andar(20); await n.d.passo();
  assert.deepStrictEqual(n.eventos, []);
});

test('detectar: o pw-dump é lido só pela classe do nó; o nome de cada programa conhecido', async () => {
  const arq = path.join(pastaTemporaria('orq-pw-'), 'l.json');
  fs.writeFileSync(arq, JSON.stringify([{ app: 'Firefox', binario: 'firefox', pid: 5 }, { app: 'ffmpeg', binario: 'ffmpeg', pid: 6, monitor: true }]));
  process.env.PW_FALSO_ARQ = arq;
  const l = await D.listarPipeWire({ comando: path.join(__dirname, 'pw-dump-falso.js') });
  assert.deepStrictEqual(l, [{ app: 'Firefox', binario: 'firefox', pid: 5 }], 'captura do som do computador fica de fora');
  assert.strictEqual(await D.listarPipeWire({ comando: '/nao/existe' }), null);
  for (const [bin, nome] of [['brave', 'o navegador'], ['msedge', 'o navegador'], ['Discord', 'o Discord'], ['webex', 'o Webex'], ['spotify', null]]) assert.strictEqual(D.nomeDe({ binario: bin, app: '' }), nome, bin);
});
