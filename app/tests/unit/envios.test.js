// Área: envios
// 0.C5: envios à tela em lote. Conversa: um `conversa:lote` a cada 50 ms por
// conversa (urgentes esvaziam na hora), na mesma ordem. Terminal: 16 ms, e o
// histórico é uma lista de pedaços.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { casaTemporaria } = require('../ajuda');

const FALSO = path.join(__dirname, 'claude-falso.js');
const casa = casaTemporaria({ iasCaminhos: { claude: FALSO } });
process.env.CLAUDE_FALSO_LOG = path.join(casa, 'claude-falso.log');
const conversa = require('../../conversa');

async function ate(cond, ms = 8000) {
  for (let i = 0; i < ms / 20; i++) { if (cond()) return; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error('não aconteceu a tempo');
}
const turnos = (c) => c.eventos.filter((e) => e.tipo === 'resultado').length;

// Desmonta o que a tela recebe na mesma ordem em que a tela desmonta: lote → itens.
const achatar = (envios) => envios.flatMap((e) => (e.canal === 'conversa:lote' ? e.dado.itens.map(([canal, dado]) => ({ canal, id: e.dado.id, dado })) : [{ canal: e.canal, id: e.dado && e.dado.id, dado: e.dado && e.dado.dado }]));

test('0.C5: 1 000 deltas em ~1 s chegam à tela em no máximo 20 envios, com o mesmo texto e a mesma ordem', async (t) => {
  const envios = [];
  conversa.ligar((canal, dado) => envios.push({ canal, dado }), { lote: true });
  const c = new conversa._Conversa({ id: 'envios1', titulo: 'Conversa 2' });
  t.after(() => { c.parar(); conversa.ligar(() => {}); });
  const t0 = Date.now();
  c.mandar('manda 1000 deltas');
  await ate(() => turnos(c) === 1);
  await new Promise((r) => setTimeout(r, 120)); // sobra do último lote
  const seg = (Date.now() - t0) / 1000;
  const doTurno = envios.filter((e) => e.canal !== 'conversa:lista');
  const resumo = doTurno.map((e) => (e.canal === 'conversa:lote' ? e.dado.itens.map((i) => i[0].slice(9) + (i[1] && i[1].tipo ? `:${i[1].tipo}` : '')).join('+') : e.canal)).join(' | ');
  const comTexto = doTurno.filter((e) => e.canal === 'conversa:lote' && e.dado.itens.some((i) => i[0] === 'conversa:parcial' && typeof i[1] === 'string'));
  assert.ok(comTexto.length <= Math.ceil(seg * 20) + 1, `${comTexto.length} envios com texto (1 000 deltas): ${resumo}`);
  const itens = achatar(doTurno).filter((i) => i.id === 'envios1');
  const parcial = itens.filter((i) => i.canal === 'conversa:parcial' && typeof i.dado === 'string').map((i) => i.dado).join('');
  const esperado = Array.from({ length: 1000 }, (_, j) => `d${j} `).join('');
  assert.strictEqual(parcial, esperado, 'o texto parcial é idêntico, na mesma ordem');
  // O texto completo (evento) vem depois de todos os pedaços parciais e o fim de turno por último.
  const posUltimoParcial = itens.map((i) => i.canal).lastIndexOf('conversa:parcial');
  const posTexto = itens.findIndex((i) => i.canal === 'conversa:evento' && i.dado.tipo === 'assistant');
  const posFim = itens.findIndex((i) => i.canal === 'conversa:evento' && i.dado.tipo === 'resultado');
  assert.ok(posTexto > posUltimoParcial && posFim > posTexto, 'ordem: parciais, texto, fim de turno');
});

test('0.C5: sem lote (como antes) cada delta é um envio — a base do ANTES', async (t) => {
  const envios = [];
  conversa.ligar((canal, dado) => envios.push({ canal, dado }));
  const c = new conversa._Conversa({ id: 'envios2', titulo: 'Conversa 3' });
  t.after(() => { c.parar(); conversa.ligar(() => {}); });
  c.mandar('manda 300 deltas');
  await ate(() => turnos(c) === 1);
  assert.ok(envios.filter((e) => e.canal === 'conversa:parcial').length >= 300);
});

const { criarLote, criarLoteTerminal, criarHistorico } = require('../../envios');
// Relógio manual: o teste decide quando os 50 ms passam.
function relogioManual() {
  const fila = [];
  return { set: (f) => { const h = { f }; fila.push(h); return h; }, clear: (h) => { const i = fila.indexOf(h); if (i >= 0) fila.splice(i, 1); }, passar: () => { for (const h of fila.splice(0)) h.f(); }, _n: () => fila.length };
}

test('0.C5: eventos urgentes (pergunta, fim de turno, erro) esvaziam o lote na hora, levando o que veio antes', () => {
  const saida = []; const rel = relogioManual();
  const l = criarLote({ enviar: (canal, dado) => saida.push([canal, dado]), relogio: rel });
  l.enviar('conversa:parcial', { id: 'a', dado: 'um ' });
  l.enviar('conversa:parcial', { id: 'a', dado: 'dois' });
  l.enviar('conversa:evento', { id: 'a', dado: { tipo: 'assistant', texto: 'um dois' } });
  assert.strictEqual(saida.length, 0, 'nada urgente ainda: espera os 50 ms');
  l.enviar('conversa:pedido', { id: 'a', dado: { id: 'p1' } });
  assert.strictEqual(saida.length, 1, 'a pergunta saiu na hora');
  assert.deepStrictEqual(saida[0][1].itens.map((i) => i[0]), ['conversa:parcial', 'conversa:evento', 'conversa:pedido'], 'na ordem, com o que veio antes');
  assert.strictEqual(saida[0][1].itens[0][1], 'um dois', 'parciais seguidos viram um só');
  l.enviar('conversa:evento', { id: 'a', dado: { tipo: 'erro', texto: 'x' } });
  l.enviar('conversa:evento', { id: 'a', dado: { tipo: 'resultado' } });
  assert.strictEqual(saida.length, 3, 'erro e fim de turno também saem na hora');
  assert.strictEqual(rel._n(), 0, 'sem temporizador sobrando');
});

test('0.C5: o lote é por conversa; um parcial nulo (nova mensagem) separa os textos; o teto de bytes esvazia', () => {
  const saida = []; const rel = relogioManual();
  const l = criarLote({ enviar: (c, d) => saida.push([c, d]), teto: 100, relogio: rel });
  l.enviar('conversa:parcial', { id: 'a', dado: 'x' });
  l.enviar('conversa:parcial', { id: 'b', dado: 'y' });
  l.enviar('conversa:parcial', { id: 'a', dado: null });
  l.enviar('conversa:parcial', { id: 'a', dado: 'z' });
  rel.passar();
  assert.strictEqual(saida.length, 2);
  const a = saida.find((s) => s[1].id === 'a')[1].itens;
  assert.deepStrictEqual(a, [['conversa:parcial', 'x'], ['conversa:parcial', null], ['conversa:parcial', 'z']]);
  l.enviar('conversa:parcial', { id: 'a', dado: 'q'.repeat(150) });
  assert.strictEqual(saida.length, 3, 'passou do teto: saiu sem esperar');
  l.enviar('conversa:lista', [1]);
  assert.strictEqual(saida[3][0], 'conversa:lista', 'canal sem conversa segue direto, no formato de sempre');
});

test('0.C5: terminal junta a saída a cada 16 ms e descartar não duplica o que o histórico já mandou', () => {
  const saida = []; const rel = relogioManual();
  const l = criarLoteTerminal({ enviar: (c, id, d) => saida.push([c, id, d]), relogio: rel });
  for (let i = 0; i < 500; i++) l.dados('t1', `p${i};`);
  l.dados('t2', 'outro');
  assert.strictEqual(saida.length, 0);
  rel.passar();
  assert.strictEqual(saida.length, 2);
  assert.strictEqual(saida[0][2], Array.from({ length: 500 }, (_, i) => `p${i};`).join(''));
  l.dados('t1', 'perdido'); l.descartar('t1'); rel.passar();
  assert.strictEqual(saida.length, 2);
});

test('0.C5: historico do terminal guarda exatamente os últimos 200 000 caracteres, como lista de pedaços', () => {
  const h = criarHistorico(200000);
  let todo = '';
  for (let i = 0; i < 300; i++) { const p = `${i}:`.padEnd(1500, String.fromCharCode(97 + (i % 26))); todo += p; h.add(p); }
  assert.strictEqual(h.texto(), todo.slice(-200000));
  const h2 = criarHistorico(10);
  h2.add('abcdef'); h2.add('ghijkl');
  assert.strictEqual(h2.texto(), 'cdefghijkl');
});

test('0.C5: `yes | head -c 50M` em pedaços de 4 KB não recopia 200 KB a cada pedaço', () => {
  const pedaco = 'y\n'.repeat(2048);
  const N = Math.floor(50 * 1024 * 1024 / pedaco.length);
  const h = criarHistorico(200000);
  const t0 = process.cpuUsage();
  for (let i = 0; i < N; i++) h.add(pedaco);
  const u = process.cpuUsage(t0);
  const ms = (u.user + u.system) / 1000;
  assert.ok(h.pedacos <= 60, `lista de ${h.pedacos} pedaços (o limite de 200 KB em pedaços de 4 KB)`);
  assert.ok(ms < 250, `CPU ${ms.toFixed(0)} ms para 50 MB`);
  assert.strictEqual(h.texto().length, 200000);
});
