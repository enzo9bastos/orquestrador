// Área: topicos (apagar demanda em dois tempos, com custo e comprovante)
// 1ª ligação do apagar.js (0.E2) a uma tela: o painel Demandas. Casa
// temporária e lixeira FALSA (move para uma pasta do teste).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria } = require('../ajuda');

const casa = casaTemporaria({ pastasNotas: [{ nome: 'Orquestração', caminho: '~/orq' }] });
fs.mkdirSync(path.join(casa, 'orq'));
const topicos = require('../../topicos');
const apagarBase = require('../../apagar');
const { criar } = require('../../apagar-demanda');

const PASTA = path.join(casa, 'orq', 'Demandas');
const LIXO = path.join(casa, 'lixeira-falsa');
fs.mkdirSync(LIXO);
const naLixeira = [];
let lixeiraFalha = false;
let relogio = null; // null = hora de verdade
const agora = () => (relogio == null ? Date.now() : relogio);
const apagar = apagarBase.criar({
  lixeira: async (abs) => {
    if (lixeiraFalha) throw new Error('lixeira falsa: não aceitou');
    naLixeira.push(abs);
    fs.renameSync(abs, path.join(LIXO, `${naLixeira.length}-${path.basename(abs)}`));
  },
  protegidos: async () => apagarBase.protegidosDoApp({ casa, pastaNotas: path.join(casa, 'orq'), pastaDemandas: topicos.pastaDemandas() }),
  agora,
});
const d = criar({ apagar, topicos, agora });
const naPasta = () => fs.readdirSync(PASTA).filter((f) => f.endsWith('.md')).sort();
const noPainel = (id) => topicos.ler().some((x) => x.id === id);
const registro = () => { try { return fs.readFileSync(apagar.arquivoRegistro(), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };

test('apagar demanda: preparar traz o custo em números e não apaga nada', async () => {
  const t = topicos.abrir({ titulo: 'Medir antes' });
  const bytes = fs.statSync(path.join(PASTA, 'Medir antes.md')).size;
  const r = await d.preparar(t.id);
  assert.ok(!r.erro, r.erro);
  assert.match(r.comprovante, /^[0-9a-f]{48}$/);
  assert.deepStrictEqual(r.custo, { id: t.id, nota: { nome: 'Medir antes.md', arquivos: 1, bytes, destino: 'lixeira' }, pedidoDoOrquestrador: false });
  assert.ok(r.validoAte > Date.now() && r.validoAte <= Date.now() + 2 * 60 * 1000);
  assert.ok(naPasta().includes('Medir antes.md'));
  assert.ok(noPainel(t.id));
  assert.deepStrictEqual(naLixeira, []);
});

test('apagar demanda: sem comprovante, com o de outra demanda ou usado duas vezes, nada some', async () => {
  const a = topicos.abrir({ titulo: 'Alfa' });
  const b = topicos.abrir({ titulo: 'Beta' });
  for (const falso of [undefined, null, '', 'x'.repeat(48), 42, {}]) {
    assert.match((await d.executar(a.id, falso)).erro, /não há confirmação válida/);
  }
  const deB = await d.preparar(b.id);
  assert.match((await d.executar(a.id, deB.comprovante)).erro, /de outra demanda/);
  assert.match((await d.executar(b.id, deB.comprovante)).erro, /não há confirmação válida/, 'o comprovante usado errado já não vale');
  assert.deepStrictEqual([noPainel(a.id), noPainel(b.id)], [true, true]);
  assert.ok(naPasta().includes('Alfa.md') && naPasta().includes('Beta.md'));
  assert.deepStrictEqual(naLixeira, []);
  assert.strictEqual(apagar._emAberto(), 1, 'só o comprovante do primeiro teste segue em aberto: o recusado é cancelado no apagar.js');
});

test('apagar demanda: com o comprovante, a nota vai para a lixeira, a demanda sai do painel e fica a linha no registro', async () => {
  const t = topicos.abrir({ titulo: 'Vai embora' });
  const versoesAntes = fs.readdirSync(topicos.versoes()).filter((f) => f.endsWith('.json')).length;
  const p = await d.preparar(t.id);
  const r = await d.executar(t.id, p.comprovante);
  assert.ok(r.ok, r.erro);
  assert.strictEqual(r.notaNaLixeira, true);
  assert.strictEqual(r.demanda.titulo, 'Vai embora');
  assert.deepStrictEqual(naLixeira.map((x) => path.basename(x)), ['Vai embora.md']);
  assert.ok(!naPasta().includes('Vai embora.md'));
  assert.ok(!noPainel(t.id));
  assert.ok(fs.readdirSync(topicos.versoes()).filter((f) => f.endsWith('.json')).length > versoesAntes, 'a lista de antes fica guardada');
  const linha = registro().at(-1);
  assert.deepStrictEqual([linha.operacao, linha.tipo, linha.resultado, linha.destino, linha.arquivos], ['apagar', 'demanda', 'ok', 'lixeira', 1]);
  assert.match((await d.executar(t.id, p.comprovante)).erro, /não há confirmação válida/, 'uso único');
  topicos.migrarParaNotas();
  assert.ok(!naPasta().includes('Vai embora.md'), 'não renasce');
});

test('apagar demanda: a nota mudou depois da medição → recusa e nada some', async () => {
  const t = topicos.abrir({ titulo: 'Mexida' });
  const p = await d.preparar(t.id);
  fs.appendFileSync(path.join(PASTA, 'Mexida.md'), '\nanotação escrita depois de ver o custo\n');
  const r = await d.executar(t.id, p.comprovante);
  assert.match(r.erro, /mudou desde a confirmação/);
  assert.ok(naPasta().includes('Mexida.md'));
  assert.ok(noPainel(t.id));
});

test('apagar demanda: sugerida (sem nota) sai só do painel; o custo diz que não há nota', async () => {
  const s = topicos.sugerir({ titulo: 'Só sugestão' });
  const antes = naLixeira.length;
  const p = await d.preparar(s.id);
  assert.strictEqual(p.custo.nota, null);
  const r = await d.executar(s.id, p.comprovante);
  assert.ok(r.ok, r.erro);
  assert.strictEqual(r.notaNaLixeira, false);
  assert.ok(!noPainel(s.id));
  assert.strictEqual(naLixeira.length, antes);
});

test('apagar demanda: comprovante vencido não vale; desistir cancela na hora', async () => {
  const t = topicos.abrir({ titulo: 'Demorou' });
  relogio = Date.now();
  const p = await d.preparar(t.id);
  relogio += 2 * 60 * 1000 + 1;
  assert.match((await d.executar(t.id, p.comprovante)).erro, /venceu/);
  relogio = null;
  const q = await d.preparar(t.id);
  assert.strictEqual(d.cancelar(q.comprovante), true);
  assert.match((await d.executar(t.id, q.comprovante)).erro, /não há confirmação válida/);
  assert.ok(naPasta().includes('Demorou.md') && noPainel(t.id));
});

test('apagar demanda: se a lixeira falhar, a demanda continua no painel e a nota na pasta', async () => {
  const t = topicos.abrir({ titulo: 'Lixeira quebrada' });
  const p = await d.preparar(t.id);
  lixeiraFalha = true;
  const r = await d.executar(t.id, p.comprovante);
  lixeiraFalha = false;
  assert.match(r.erro, /lixeira não aceitou/);
  assert.ok(naPasta().includes('Lixeira quebrada.md') && noPainel(t.id));
});

test('apagar demanda: demanda que não existe e pedido do orquestrador no custo', async () => {
  assert.match((await d.preparar('9999')).erro, /não existe a demanda 9999/);
  const t = topicos.abrir({ titulo: 'Pedida pelo orquestrador' });
  topicos.pedirApagar(t.id);
  assert.strictEqual((await d.preparar(t.id)).custo.pedidoDoOrquestrador, true);
});
