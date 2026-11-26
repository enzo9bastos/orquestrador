// Área: voz (modo reunião: quem falou, pelo Google Meet)
// Pedido de 26/11: "temos como fazer a gravação identificar quem está falando? Como o Granola faz
// isso?" (caminho escolhido: o A, pelo Meet). Aqui: o programa do computador que a extensão abre
// (extensao-meet/orq-meet-host.py), a preparação do navegador (meet-instalar.js) e a conta de quem
// falou em cada trecho (meet-falantes.js). Nomes de mentira.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pastaTemporaria } = require('../temporarias');

const casa = pastaTemporaria('orq-meet-');
process.env.HOME = casa;
const F = require('../../meet-falantes');
const I = require('../../meet-instalar');
const HOST = path.join(__dirname, '../../extensao-meet/orq-meet-host.py');
const PASTA = path.join(casa, '.local/share/orq-app/meet');

// Conversa com o programa como o navegador conversa: 4 bytes de tamanho e o JSON, nos dois sentidos.
function abrirHost() {
  const p = spawn('python3', [HOST], { env: { ...process.env, HOME: casa }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = Buffer.alloc(0);
  const esperando = [];
  p.stdout.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4) {
      const n = buf.readUInt32LE(0);
      if (buf.length < 4 + n) break;
      const m = JSON.parse(buf.subarray(4, 4 + n).toString('utf8'));
      buf = buf.subarray(4 + n);
      if (esperando.length) esperando.shift()(m);
    }
  });
  const mandarCru = (b) => { const c = Buffer.alloc(4); c.writeUInt32LE(b.length, 0); p.stdin.write(Buffer.concat([c, b])); };
  const pedirGrande = (b) => new Promise((ok) => { esperando.push(ok); mandarCru(b); });
  const pedir = (o) => pedirGrande(Buffer.from(JSON.stringify(o), 'utf8'));
  const fechar = () => new Promise((ok) => { p.on('close', ok); p.stdin.end(); });
  const matar = () => { try { p.kill(); } catch { /* já saiu */ } };
  return { pedir, pedirGrande, fechar, matar };
}
const eventos = () => { try { return fs.readFileSync(path.join(PASTA, 'eventos.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test('programa do computador: sem gravação não guarda nada; gravando, guarda nomes e quem fala', async (t) => {
  F.marcarGravando(null);
  const h = abrirHost();
  t.after(() => h.matar());
  assert.deepStrictEqual(await h.pedir({ t: 'estado' }), { t: 'estado', gravando: false });
  assert.deepStrictEqual(await h.pedir({ t: 'falando', quem: 'Ana Souza' }), { t: 'ok', guardado: false });
  assert.deepStrictEqual(eventos(), [], 'fora da gravação, nada fica no computador');
  F.marcarGravando(Date.now());
  assert.deepStrictEqual(await h.pedir({ t: 'estado' }), { t: 'estado', gravando: true });
  assert.deepStrictEqual(await h.pedir({ t: 'falando', quem: '  Ana Souza  ' }), { t: 'ok', guardado: true });
  assert.deepStrictEqual(await h.pedir({ t: 'participantes', nomes: ['Ana Souza', 'Bruno Lima', '', 42], eu: 'Carla Dias' }), { t: 'ok', guardado: true });
  // O que não é nome nem evento conhecido não entra; mensagem grande demais é descartada sem travar.
  assert.deepStrictEqual(await h.pedir({ t: 'texto', texto: 'o que foi dito' }), { t: 'ok', guardado: false });
  assert.deepStrictEqual(await h.pedirGrande(Buffer.alloc(70 * 1024, 0x61)), { t: 'erro', motivo: 'mensagem grande demais' });
  assert.deepStrictEqual(await h.pedir({ t: 'falando', quem: 'Bruno Lima' }), { t: 'ok', guardado: true }, 'depois de uma mensagem grande, segue respondendo');
  await h.fechar();
  const ev = eventos();
  assert.deepStrictEqual(ev.map((e) => [e.t, e.quem || e.nomes, e.eu || null]), [['falando', 'Ana Souza', null], ['participantes', ['Ana Souza', 'Bruno Lima'], 'Carla Dias'], ['falando', 'Bruno Lima', null]]);
  assert.ok(ev.every((e) => typeof e.ts === 'number' && !('texto' in e)), 'a hora é a do computador; texto falado nunca é guardado');
  assert.strictEqual(fs.statSync(path.join(PASTA, 'eventos.jsonl')).mode & 0o777, 0o600, 'só a própria pessoa lê');
  assert.strictEqual(fs.statSync(PASTA).mode & 0o777, 0o700);
  assert.ok(JSON.parse(fs.readFileSync(path.join(PASTA, 'contato.json'), 'utf8')).ts > 0, 'anota quando a extensão falou por último');
  F.marcarGravando(null);
});

test('quem falou em cada trecho: o nome de quem mais falou nele, sem contar a própria pessoa', () => {
  const ini = Date.UTC(2026, 10, 26, 13, 0, 0);
  const s = (seg) => ini + seg * 1000;
  // A legenda avisa a cada ~0,7 s enquanto a pessoa fala (e chega ~1 s depois da fala).
  const ev = [];
  for (let t = 11; t <= 15; t += 0.7) ev.push({ t: 'falando', ts: s(t), quem: 'Ana Souza' });
  for (let t = 21; t <= 24; t += 0.7) ev.push({ t: 'falando', ts: s(t), quem: 'Bruno Lima' });
  for (let t = 30; t <= 33; t += 0.7) ev.push({ t: 'falando', ts: s(t), quem: 'Carla Dias' });
  ev.push({ t: 'participantes', ts: s(1), nomes: ['Ana Souza', 'Bruno Lima', 'Carla Dias'], eu: 'Carla Dias' });
  const ivs = F.intervalos(ev);
  assert.deepStrictEqual(ivs.map((i) => i.quem), ['Ana Souza', 'Bruno Lima', 'Carla Dias'], 'falas seguidas da mesma pessoa viram um intervalo só');
  const trechos = [{ ini: 10, fim: 14 }, { ini: 20.5, fim: 23 }, { ini: 29, fim: 32 }, { ini: 50, fim: 52 }];
  assert.deepStrictEqual(F.atribuir(trechos, ivs, ini, 'Carla Dias'), ['Ana Souza', 'Bruno Lima', null, null], 'a própria pessoa não vira "Outros"; sem ninguém falando, fica sem nome');
  assert.deepStrictEqual(F.participantes(ev), { nomes: ['Ana Souza', 'Bruno Lima'], eu: 'Carla Dias' });
});

test('nomear: lê só os eventos do intervalo da reunião; sem eventos, a nota fica como antes', () => {
  const arq = path.join(pastaTemporaria('orq-meet-ev-'), 'eventos.jsonl');
  const ini = Date.UTC(2026, 10, 26, 14, 0, 0);
  const linhas = [
    { t: 'falando', ts: ini - 3600000, quem: 'De Outra Reunião' },
    { t: 'participantes', ts: ini + 1000, nomes: ['Ana Souza', 'Bruno Lima'], eu: 'Carla Dias' },
    { t: 'falando', ts: ini + 11000, quem: 'Ana Souza' }, { t: 'falando', ts: ini + 12000, quem: 'Ana Souza' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\nlinha estragada\n';
  fs.writeFileSync(arq, linhas);
  const r = F.nomear({ inicio: ini, fim: ini + 60000 }, [{ ini: 10, fim: 12 }, { ini: 40, fim: 42 }], { arquivo: arq });
  assert.deepStrictEqual(r, { participantes: ['Ana Souza', 'Bruno Lima'], eu: 'Carla Dias', quem: ['Ana Souza', null], nomeados: 1 });
  assert.strictEqual(F.nomear({ inicio: ini + 7200000, fim: ini + 7260000 }, [{ ini: 1, fim: 2 }], { arquivo: arq }), null, 'reunião sem nada do Meet: null');
  assert.strictEqual(F.nomear({ inicio: ini, fim: ini + 1 }, [], { arquivo: path.join(path.dirname(arq), 'nao-existe.jsonl') }), null);
});

test('preparar o navegador: só nos que existem; o arquivo de outro não é tocado; repetir não muda nada', () => {
  const c = pastaTemporaria('orq-meet-casa-');
  fs.mkdirSync(path.join(c, '.config/BraveSoftware/Brave-Browser'), { recursive: true });
  fs.mkdirSync(path.join(c, '.config/chromium/NativeMessagingHosts'), { recursive: true });
  const alheio = path.join(c, '.config/chromium/NativeMessagingHosts/com.orquestrador.meet.json');
  fs.writeFileSync(alheio, '{"name":"com.orquestrador.meet","path":"/outro/programa"}\n');
  assert.deepStrictEqual(I.estado({ casa: c }).navegadores, [{ navegador: 'Brave', pronto: false }, { navegador: 'Chromium', pronto: false }]);
  const r = I.instalar({ casa: c });
  assert.deepStrictEqual(r.map((x) => [x.navegador, x.resultado]), [['Brave', 'instalado'], ['Chromium', 'alheio']]);
  assert.strictEqual(fs.readFileSync(alheio, 'utf8'), '{"name":"com.orquestrador.meet","path":"/outro/programa"}\n', 'o arquivo que não é do app ficou como estava');
  const m = JSON.parse(fs.readFileSync(path.join(c, '.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.orquestrador.meet.json'), 'utf8'));
  assert.deepStrictEqual([m.name, m.type, m.path, m.allowed_origins], ['com.orquestrador.meet', 'stdio', I.PROGRAMA, [`chrome-extension://${I.ID_EXTENSAO}/`]]);
  assert.ok(fs.statSync(I.PROGRAMA).mode & 0o100, 'o programa pode ser executado pelo navegador');
  assert.deepStrictEqual(I.instalar({ casa: c }).map((x) => x.resultado), ['igual', 'alheio']);
  assert.deepStrictEqual(I.estado({ casa: c }).navegadores, [{ navegador: 'Brave', pronto: true }, { navegador: 'Chromium', pronto: false }]);
  assert.ok(!fs.existsSync(path.join(c, '.config/google-chrome')), 'navegador que não existe não ganha pasta');
});

test('a extensão: o programa só aceita a extensão desta pasta, e ela só pede para falar com o programa', () => {
  // A regra do navegador para extensão carregada de uma pasta: SHA-256 do caminho, 0-f viram a-p.
  assert.strictEqual(I.idDaPasta('/home/pessoa/app/extensao-meet'), [...require('crypto').createHash('sha256').update('/home/pessoa/app/extensao-meet').digest('hex').slice(0, 32)].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join(''));
  assert.match(I.ID_EXTENSAO, /^[a-p]{32}$/);
  assert.strictEqual(I.ID_EXTENSAO, I.idDaPasta(fs.realpathSync(I.PASTA_EXTENSAO)));
  const man = JSON.parse(fs.readFileSync(path.join(I.PASTA_EXTENSAO, 'manifest.json'), 'utf8'));
  assert.deepStrictEqual(man.permissions, ['nativeMessaging'], 'nenhuma permissão além de falar com o programa do computador');
  assert.deepStrictEqual(man.content_scripts.map((c) => c.matches), [['https://meet.google.com/*']], 'só a página do Meet');
  assert.ok(!('host_permissions' in man) && !('key' in man));
});
