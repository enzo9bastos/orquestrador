// Área: conversa (conversas anteriores no motor: a lista com as marcas, arquivar, reabrir, renomear e apagar; planos 3.2 e 3.3)
// Antes uma conversa que saía da lista só voltava digitando /resume, e não havia como
// arquivar, renomear pela lista nem apagar pelo app. Aqui: conversa.js, anteriores.js e
// apagar-conversa.js, com o Claude falso, a casa temporária e uma lixeira de mentira.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria } = require('../ajuda');

const FALSO = path.join(__dirname, 'claude-falso.js');
const XFALSO = path.join(__dirname, 'codex-falso.js');
const casa = casaTemporaria({ iasCaminhos: { claude: FALSO, codex: XFALSO } });
let LOG, nLog = 0;
function novoLog() {
  nLog++;
  LOG = path.join(casa, `claude-falso-${nLog}.log`);
  process.env.CLAUDE_FALSO_LOG = LOG;
  process.env.CODEX_FALSO_LOG = path.join(casa, `codex-falso-${nLog}.log`);
}
novoLog();
test.beforeEach(() => novoLog());
const conversa = require('../../conversa');
const anteriores = require('../../anteriores');
const apagarBase = require('../../apagar');
const { criar: criarApagarConversa } = require('../../apagar-conversa');

conversa.ligar(() => {});
conversa.ligarAvisos(() => {});
const ler = (arq) => (fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const recebidos = () => ler(LOG);
async function ate(cond, ms = 6000) {
  for (let i = 0; i < ms / 20; i++) { if (await cond()) return; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error('não aconteceu a tempo');
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const raiz = path.join(casa, '.claude', 'projects');
let n = 0;
// Uma conversa guardada pelo Claude: o arquivo dela na pasta dos projetos. Devolve { sessao, arq }.
function guardada(titulo, { cwd = casa, subagentes = 0, quando = null } = {}) {
  const sessao = `sessao-guardada-${String(++n).padStart(4, '0')}`;
  const dir = path.join(raiz, cwd.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const arq = path.join(dir, `${sessao}.jsonl`);
  fs.writeFileSync(arq, `${JSON.stringify({ type: 'user', message: { role: 'user', content: titulo }, cwd })}\n${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } })}\n`);
  if (quando) fs.utimesSync(arq, quando / 1000, quando / 1000);
  for (let i = 0; i < subagentes; i++) { fs.mkdirSync(path.join(dir, sessao, 'subagents'), { recursive: true }); fs.writeFileSync(path.join(dir, sessao, 'subagents', `agent-${i}.jsonl`), `${'x'.repeat(100)}\n`); }
  return { sessao, arq, dir };
}
const projeto = (nome) => { const d = path.join(casa, 'proj', nome); fs.mkdirSync(d, { recursive: true }); return d; };
const daTela = async (sessao) => (await conversa.anterioresDaTela()).find((x) => x.sessao === sessao);
const naLista = (id) => conversa.lista().some((c) => c.id === id);

// Lixeira de mentira: move para uma pasta do teste.
const LIXO = path.join(casa, 'lixeira-falsa');
fs.mkdirSync(LIXO);
const naLixeira = [];
let relogio = null;
const agora = () => (relogio == null ? Date.now() : relogio);
const apagar = apagarBase.criar({
  lixeira: async (abs) => { naLixeira.push(abs); fs.renameSync(abs, path.join(LIXO, `${naLixeira.length}-${path.basename(abs)}`)); },
  protegidos: async () => apagarBase.protegidosDoApp({ casa }),
  agora,
});
const apagarConversa = criarApagarConversa({ apagar, agora, casa: () => casa,
  conversas: { listar: () => anteriores.listar(), raiz: () => anteriores.pastaProjetos(), emUso: () => conversa.sessoesEmUso(), doOrquestrador: () => conversa.sessoesDoOrquestrador(), apagada: (s) => anteriores.desarquivar(s) } });

test('anteriores na tela: cada conversa guardada diz a pasta (com ~), o tamanho, se está aberta agora, se é do orquestrador e se está arquivada', async (t) => {
  const dir = projeto('api');
  const a = guardada('Ajuste do botão de exportar', { cwd: dir });
  const b = guardada('Relatório de vendas');
  const c = guardada('Rodada do orquestrador');
  const sumiu = guardada('Pasta que não existe mais', { cwd: path.join(casa, 'proj', 'apagada') });
  const orq = conversa._pegar('orquestrador');
  const antes = orq.anteriores;
  orq.anteriores = [...(antes || []), c.sessao];
  t.after(() => { orq.anteriores = antes; });
  const la = await daTela(a.sessao);
  assert.deepStrictEqual({ titulo: la.titulo, motor: la.motor, pasta: la.pasta, pastaExiste: la.pastaExiste, aberta: la.aberta, orquestrador: la.orquestrador, arquivada: la.arquivada },
    { titulo: 'Ajuste do botão de exportar', motor: 'claude', pasta: '~/proj/api', pastaExiste: true, aberta: null, orquestrador: false, arquivada: false });
  assert.strictEqual(la.bytes, fs.statSync(a.arq).size);
  assert.strictEqual((await daTela(b.sessao)).pasta, '~');
  assert.strictEqual((await daTela(c.sessao)).orquestrador, true);
  assert.strictEqual((await daTela(sumiu.sessao)).pastaExiste, false);
});

test('arquivar pela lista: a conversa sai da lista e fica marcada como arquivada, com o nome, o motor e a pasta; nada é apagado', async (t) => {
  const g = guardada('Teste de importação de planilha');
  const { id } = await conversa.reabrirDeAnteriores(g.sessao);
  t.after(() => { try { conversa.fechar(id); } catch { /* já saiu da lista */ } });
  assert.strictEqual((await daTela(g.sessao)).aberta, 'Teste de importação de planilha');
  assert.deepStrictEqual(conversa.arquivarConversa(id), { arquivada: true, sessao: g.sessao, titulo: 'Teste de importação de planilha' });
  assert.strictEqual(naLista(id), false);
  assert.ok(fs.existsSync(g.arq), 'arquivar apagou o arquivo da conversa');
  const l = await daTela(g.sessao);
  assert.deepStrictEqual({ arquivada: l.arquivada, aberta: l.aberta }, { arquivada: true, aberta: null });
  assert.deepStrictEqual({ titulo: anteriores.lerArquivadas()[g.sessao].titulo, motor: anteriores.lerArquivadas()[g.sessao].motor }, { titulo: 'Teste de importação de planilha', motor: 'claude' });
  // Conversa que nem começou (sem sessão): só sai da lista, sem marca nenhuma.
  await espera(3);
  const nova = conversa.nova();
  const antes = Object.keys(anteriores.lerArquivadas()).length;
  const tituloDaNova = conversa._pegar(nova).titulo;
  assert.deepStrictEqual(conversa.arquivarConversa(nova), { arquivada: false, sessao: null, titulo: tituloDaNova });
  assert.strictEqual(naLista(nova), false);
  assert.strictEqual(Object.keys(anteriores.lerArquivadas()).length, antes);
  assert.throws(() => conversa.arquivarConversa('orquestrador'), /orquestrador/);
  assert.ok(naLista('orquestrador'));
});

test('reabrir: abre na pasta em que a conversa rodava (passando pelo cartão da pasta), tira a marca de arquivada e nunca abre a mesma sessão duas vezes', async (t) => {
  const dir = projeto('site');
  const g = guardada('Revisão do site', { cwd: dir });
  await conversa.marcarArquivada(g.sessao, true);
  assert.strictEqual((await daTela(g.sessao)).arquivada, true);
  const r = await conversa.reabrirDeAnteriores(g.sessao);
  t.after(() => { try { conversa.fechar(r.id); } catch { /* já fechada */ } });
  assert.strictEqual(r.jaAberta, false);
  const c = conversa._pegar(r.id);
  assert.deepStrictEqual({ sessao: c.sessao, pasta: c.pasta, titulo: c.titulo }, { sessao: g.sessao, pasta: dir, titulo: 'Revisão do site' });
  assert.strictEqual((await daTela(g.sessao)).arquivada, false);
  // De novo: devolve a mesma conversa, sem criar outra.
  await espera(3);
  const de = await conversa.reabrirDeAnteriores(g.sessao);
  assert.deepStrictEqual(de, { id: r.id, jaAberta: true });
  assert.strictEqual(conversa.lista().filter((x) => x.id === r.id).length, 1);
  // Sobe só depois do cartão da pasta, retomando aquela sessão, naquela pasta.
  c.iniciar();
  await ate(() => c.estado().pasta);
  assert.strictEqual(c.proc, null);
  await c.responderPasta('confiar');
  await ate(() => recebidos().some((x) => Array.isArray(x.args)));
  const args = recebidos().find((x) => Array.isArray(x.args)).args;
  assert.strictEqual(args[args.indexOf('--resume') + 1], g.sessao);
  assert.strictEqual((await c.controle('get_status')).sections[0].rows.find((x) => x.label === 'Pasta').value, dir);
  assert.ok(conversa.pastasRecentes().some((x) => x.pasta === dir), 'a pasta reaberta não entrou nas usadas por último');
});

test('reabrir: conversa da pasta pessoal abre na pessoal; pasta que sumiu e conversa que não existe dão erro claro e não criam nada', async (t) => {
  const g = guardada('Relatório de outubro');
  const r = await conversa.reabrirDeAnteriores(g.sessao);
  t.after(() => { try { conversa.fechar(r.id); } catch { /* já fechada */ } });
  assert.strictEqual(conversa._pegar(r.id).pasta, casa);
  const antes = conversa.lista().length;
  const sumiu = guardada('Pasta apagada', { cwd: path.join(casa, 'proj', 'nao-existe-mais') });
  await assert.rejects(conversa.reabrirDeAnteriores(sumiu.sessao), /a pasta desta conversa não existe mais: ~\/proj\/nao-existe-mais/);
  await assert.rejects(conversa.reabrirDeAnteriores('sessao-que-nao-existe-0001'), /não achei esta conversa/);
  await assert.rejects(conversa.reabrirDeAnteriores('../../etc/passwd'), /inválida/);
  assert.strictEqual(conversa.lista().length, antes);
});

test('marcar como arquivada na tela: marca e desmarca; recusa a conversa aberta e a do orquestrador', async (t) => {
  const g = guardada('Para arquivar pela tela');
  assert.strictEqual(await conversa.marcarArquivada(g.sessao, true), true);
  assert.strictEqual((await daTela(g.sessao)).arquivada, true);
  assert.strictEqual(await conversa.marcarArquivada(g.sessao, false), true);
  assert.strictEqual((await daTela(g.sessao)).arquivada, false);
  const aberta = guardada('Aberta agora');
  const r = await conversa.reabrirDeAnteriores(aberta.sessao);
  t.after(() => { try { conversa.fechar(r.id); } catch { /* já fechada */ } });
  await assert.rejects(conversa.marcarArquivada(aberta.sessao, true), /está aberta/);
  const orq = conversa._pegar('orquestrador');
  const antes = orq.anteriores;
  const doOrq = guardada('Rodada antiga');
  orq.anteriores = [doOrq.sessao];
  t.after(() => { orq.anteriores = antes; });
  await assert.rejects(conversa.marcarArquivada(doOrq.sessao, true), /orquestrador/);
  await assert.rejects(conversa.marcarArquivada('sessao-que-nao-existe-0002', true), /não achei/);
});

test('renomear pela lista: muda o nome no app e pede ao Claude para mudar no histórico dele, sem mandar mensagem na conversa', async (t) => {
  await espera(3);
  const id = conversa.nova();
  t.after(() => { try { conversa.fechar(id); } catch { /* já fechada */ } });
  const c = conversa._pegar(id);
  // Com o Claude fechado: o nome muda no app e o pedido espera a conversa subir.
  assert.strictEqual(conversa.renomear(id, '  Ajuste   do botão\nde exportar  '), 'Ajuste do botão de exportar');
  assert.strictEqual(c.titulo, 'Ajuste do botão de exportar');
  assert.strictEqual(recebidos().length, 0);
  c.mandar('oi');
  await ate(() => c.sessao && !c.info.ocupado);
  await ate(() => recebidos().some((x) => x.type === 'control_request' && x.request.subtype === 'rename_session'));
  const p1 = recebidos().find((x) => x.type === 'control_request' && x.request.subtype === 'rename_session').request;
  assert.deepStrictEqual(p1, { subtype: 'rename_session', title: 'Ajuste do botão de exportar', source: 'host', session_id: c.sessao });
  assert.strictEqual(c.titulo, 'Ajuste do botão de exportar', 'a primeira mensagem trocou o nome que a pessoa deu');
  // Com o Claude aberto: o pedido vai na hora.
  conversa.renomear(id, 'Nome novo');
  await ate(() => recebidos().filter((x) => x.type === 'control_request' && x.request.subtype === 'rename_session').length === 2);
  assert.strictEqual(c.titulo, 'Nome novo');
  assert.ok(!recebidos().some((x) => x.type === 'user' && /rename|Nome novo/.test(JSON.stringify(x.message.content))), 'o nome foi mandado como mensagem na conversa');
  assert.ok(!c.eventos.some((e) => e.tipo === 'user' && /Nome novo/.test(JSON.stringify(e))));
  assert.throws(() => conversa.renomear(id, '   '), /escreva o nome/);
  assert.throws(() => conversa.renomear('orquestrador', 'Outro'), /orquestrador/);
  assert.strictEqual(c.titulo, 'Nome novo');
});

test('apagar conversa: o custo vem antes, em números (o arquivo e a pasta de subagentes ao lado) e nada é apagado até confirmar', async () => {
  const g = guardada('Conversa para apagar', { subagentes: 2 });
  fs.mkdirSync(path.join(casa, '.claude', 'session-env', g.sessao), { recursive: true });
  const bytes = fs.statSync(g.arq).size + 2 * 101;
  const r = await apagarConversa.preparar(g.sessao);
  assert.ok(r.comprovante, JSON.stringify(r));
  assert.deepStrictEqual({ sessao: r.custo.sessao, titulo: r.custo.titulo, arquivos: r.custo.arquivos, bytes: r.custo.bytes, destino: r.custo.destino, comSubagentes: r.custo.comSubagentes },
    { sessao: g.sessao, titulo: 'Conversa para apagar', arquivos: 3, bytes, destino: 'lixeira', comSubagentes: true });
  assert.deepStrictEqual(r.custo.orfaos.map((o) => path.relative(casa, o.quem)), [path.join('.claude', 'session-env', g.sessao)]);
  assert.ok(fs.existsSync(g.arq) && fs.existsSync(path.join(g.dir, g.sessao, 'subagents', 'agent-0.jsonl')));
  assert.strictEqual(apagarConversa.cancelar(r.comprovante), true);
  assert.match((await apagarConversa.executar(g.sessao, r.comprovante)).erro, /não há confirmação válida/);
  assert.ok(fs.existsSync(g.arq), 'apagou com um comprovante cancelado');
});

test('apagar conversa: com o comprovante, o arquivo e a pasta de subagentes vão para a lixeira, a marca de arquivada sai e o comprovante não vale duas vezes', async () => {
  const g = guardada('Vai para a lixeira', { subagentes: 1 });
  const fica = guardada('Esta fica');
  await conversa.marcarArquivada(g.sessao, true);
  const r = await apagarConversa.preparar(g.sessao);
  const antes = naLixeira.length;
  assert.deepStrictEqual(await apagarConversa.executar(g.sessao, r.comprovante), { ok: true, sessao: g.sessao });
  assert.strictEqual(fs.existsSync(g.arq), false);
  assert.strictEqual(fs.existsSync(path.join(g.dir, g.sessao)), false);
  assert.deepStrictEqual(naLixeira.slice(antes).sort(), [g.arq, path.join(g.dir, g.sessao)].sort());
  assert.ok(fs.existsSync(fica.arq), 'apagou outra conversa junto');
  assert.strictEqual(await daTela(g.sessao), undefined);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(anteriores.lerArquivadas(), g.sessao), false);
  assert.match((await apagarConversa.executar(g.sessao, r.comprovante)).erro, /não há confirmação válida/);
});

test('apagar conversa: recusa a que está aberta (também se abriu depois do custo), a do orquestrador, o comprovante de outra e o vencido', async (t) => {
  const aberta = guardada('Aberta no app');
  const r1 = await conversa.reabrirDeAnteriores(aberta.sessao);
  t.after(() => { try { conversa.fechar(r1.id); } catch { /* já fechada */ } });
  const p1 = await apagarConversa.preparar(aberta.sessao);
  assert.deepStrictEqual({ codigo: p1.codigo, temErro: /está aberta no app \("Aberta no app"\)/.test(p1.erro) }, { codigo: 'aberta', temErro: true });
  // Abriu entre o custo e o clique: o executar recusa.
  const depois = guardada('Abre no meio');
  const p2 = await apagarConversa.preparar(depois.sessao);
  assert.ok(p2.comprovante);
  await espera(3);
  const r2 = await conversa.reabrirDeAnteriores(depois.sessao);
  t.after(() => { try { conversa.fechar(r2.id); } catch { /* já fechada */ } });
  assert.strictEqual((await apagarConversa.executar(depois.sessao, p2.comprovante)).codigo, 'aberta');
  assert.ok(fs.existsSync(depois.arq));
  // Do orquestrador.
  const orq = conversa._pegar('orquestrador');
  const antes = orq.anteriores;
  const doOrq = guardada('Rodada do orquestrador');
  orq.anteriores = [doOrq.sessao];
  t.after(() => { orq.anteriores = antes; });
  assert.strictEqual((await apagarConversa.preparar(doOrq.sessao)).codigo, 'orquestrador');
  // Comprovante de outra conversa e comprovante vencido.
  const a = guardada('Uma');
  const b = guardada('Outra');
  const pa = await apagarConversa.preparar(a.sessao);
  assert.match((await apagarConversa.executar(b.sessao, pa.comprovante)).erro, /é de outra conversa/);
  const pb = await apagarConversa.preparar(b.sessao);
  relogio = Date.now() + 3 * 60 * 1000;
  t.after(() => { relogio = null; });
  assert.match((await apagarConversa.executar(b.sessao, pb.comprovante)).erro, /venceu/);
  relogio = null;
  assert.ok(fs.existsSync(a.arq) && fs.existsSync(b.arq));
  assert.match((await apagarConversa.preparar('sessao-que-nao-existe-0003')).erro, /não achei esta conversa/);
  assert.match((await apagarConversa.preparar('x')).erro, /inválida/);
});

test('desfazer o arquivar: a conversa arquivada pelo app reabre pelo que o app guardou, mesmo sem o arquivo dela na lista', async (t) => {
  const dir = projeto('desfazer');
  await espera(3);
  const id = conversa.nova({ pasta: dir });
  const c = conversa._pegar(id);
  c.sessao = 'sessao-sem-arquivo-0001'; // o Claude ainda não gravou (ou o arquivo está noutro lugar)
  c.titulo = 'Conversa arquivada agora';
  const r = conversa.arquivarConversa(id);
  assert.deepStrictEqual(r, { arquivada: true, sessao: 'sessao-sem-arquivo-0001', titulo: 'Conversa arquivada agora' });
  assert.strictEqual(await daTela('sessao-sem-arquivo-0001'), undefined, 'conversa do Claude sem arquivo não aparece em Anteriores');
  const de = await conversa.reabrirDeAnteriores('sessao-sem-arquivo-0001');
  t.after(() => { try { conversa.fechar(de.id); } catch { /* já fechada */ } });
  const volta = conversa._pegar(de.id);
  assert.deepStrictEqual({ sessao: volta.sessao, pasta: volta.pasta, titulo: volta.titulo, motor: volta.motor }, { sessao: 'sessao-sem-arquivo-0001', pasta: dir, titulo: 'Conversa arquivada agora', motor: 'claude' });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(anteriores.lerArquivadas(), 'sessao-sem-arquivo-0001'), false);
});
