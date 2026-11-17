// Área: conversa (pergunta rápida, o /btw; plano 6.2)
// A pergunta rápida é respondida pelo Claude por um pedido de controle (side_question),
// sem entrar na conversa e sem interromper o turno. Aqui: o módulo que confere a
// pergunta, a resposta e o histórico (pergunta-de-lado.js) e o motor (conversa.js) com o
// Claude falso, que responde como o de verdade (2.1.326).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria } = require('../ajuda');
const lado = require('../../pergunta-de-lado');

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

const recebidos = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const pedidos = () => recebidos().filter((x) => x.type === 'control_request' && x.request.subtype === 'side_question');
const telas = [];
conversa.ligar((canal, dado) => telas.push({ canal, ...dado }));
conversa.ligarAvisos(() => {});
async function ate(cond, ms = 6000) {
  for (let i = 0; i < ms / 20; i++) { if (cond()) return; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error('não aconteceu a tempo');
}
function nova(t) {
  const id = conversa.nova();
  t.after(() => conversa.fechar(id));
  return { id, c: conversa._pegar(id) };
}

// --- o módulo ---------------------------------------------------------------------
test('lado: a pergunta precisa ser um texto com conteúdo e de tamanho razoável', () => {
  assert.deepStrictEqual(lado.conferirPergunta('  qual o arquivo?  '), { ok: true, pergunta: 'qual o arquivo?' });
  assert.strictEqual(lado.conferirPergunta('   ').ok, false);
  assert.strictEqual(lado.conferirPergunta(null).ok, false);
  assert.strictEqual(lado.conferirPergunta({ question: 'x' }).ok, false);
  assert.strictEqual(lado.conferirPergunta('x'.repeat(lado.MAX_PERGUNTA + 1)).ok, false);
  assert.strictEqual(lado.conferirPergunta('x'.repeat(lado.MAX_PERGUNTA)).ok, true);
});

test('lado: só `synthetic: false` (ou ausente) é resposta; o aviso que volta como "sucesso" é erro', () => {
  assert.deepStrictEqual(lado.conferirResposta({ response: 'É o config.json.', synthetic: false }), { ok: true, resposta: 'É o config.json.', reserva: null });
  assert.strictEqual(lado.conferirResposta({ response: 'Claude antigo, sem o campo' }).ok, true);
  const s = lado.conferirResposta({ response: '(API error: Not logged in)', synthetic: true });
  assert.deepStrictEqual(s, { ok: false, motivo: 'sintetica', detalhe: '(API error: Not logged in)' });
  assert.strictEqual(lado.conferirResposta({ response: 'x', synthetic: 'yes' }).motivo, 'sintetica', 'valor estranho no campo não vira resposta');
  assert.strictEqual(lado.conferirResposta({ response: null, synthetic: false }).motivo, 'vazia');
  assert.strictEqual(lado.conferirResposta({ response: '   ', synthetic: false }).motivo, 'vazia');
  assert.strictEqual(lado.conferirResposta({ response: 5 }).motivo, 'formato');
  assert.strictEqual(lado.conferirResposta(null).motivo, 'formato');
  assert.strictEqual(lado.conferirResposta([]).motivo, 'formato');
});

test('lado: o aviso de "outro modelo respondeu" acompanha a resposta, em uma linha e sem códigos de terminal', () => {
  const r = lado.conferirResposta({ response: 'ok', synthetic: false, refusal_fallback: { original_model: 'claude-a', fallback_model: 'claude-b', content: 'Answered by\n\x1b[31mclaude-b\x1b[0m.' } });
  assert.deepStrictEqual(r.reserva, { de: 'claude-a', para: 'claude-b', texto: 'Answered by claude-b.' });
  assert.strictEqual(lado.conferirResposta({ response: 'ok', synthetic: false, refusal_fallback: 'lixo' }).reserva, null);
  assert.strictEqual(lado.conferirResposta({ response: 'ok', synthetic: false, refusal_fallback: { content: '  ' } }).reserva, null);
});

test('lado: o histórico leva só as respondidas, as 20 mais novas, no formato do Claude', () => {
  const trocas = [
    { pergunta: 'a?', resposta: 'A.' },
    { pergunta: 'b?', erro: 'sintetica', detalhe: '(API error)' },
    { pergunta: 'c?', erro: 'parada' },
    { pergunta: 'd?', resposta: 'D.', reserva: { de: 'x', para: 'y', texto: 'Answered by y.' } },
  ];
  assert.deepStrictEqual(lado.historico(trocas), [{ question: 'a?', response: 'A.' }, { question: 'd?', response: 'D.', fallback_notice: 'Answered by y.' }]);
  const muitas = Array.from({ length: 30 }, (_, i) => ({ pergunta: `p${i}`, resposta: `r${i}` }));
  const h = lado.historico(muitas);
  assert.strictEqual(h.length, lado.MAX_HISTORICO);
  assert.strictEqual(h[0].question, 'p10');
  assert.strictEqual(h[19].question, 'p29');
  assert.deepStrictEqual(lado.historico(null), []);
});

test('lado: o andamento vira "começou" ou "tentando de novo (n de m)"; o resto é ignorado', () => {
  assert.deepStrictEqual(lado.conferirAndamento({ status: 'started' }), { estado: 'comecou' });
  assert.deepStrictEqual(lado.conferirAndamento({ status: 'api_retry', attempt: 2, max_retries: 10 }), { estado: 'tentando', tentativa: 2, de: 10 });
  assert.deepStrictEqual(lado.conferirAndamento({ status: 'api_retry', attempt: 'muitas', max_retries: -1 }), { estado: 'tentando', tentativa: null, de: null });
  assert.strictEqual(lado.conferirAndamento({ status: 'outra coisa' }), null);
  assert.strictEqual(lado.conferirAndamento(null), null);
});

// --- o motor, com o Claude falso -------------------------------------------------------
test('lado: a pergunta vai por side_question e a resposta fica só na lista da pergunta rápida, fora da conversa', async (t) => {
  const { id, c } = nova(t);
  const r = await c.ladoPerguntar('qual o arquivo?');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.troca.resposta, 'resposta de lado para: qual o arquivo?');
  const p = pedidos();
  assert.strictEqual(p.length, 1);
  assert.deepStrictEqual(p[0].request, { subtype: 'side_question', question: 'qual o arquivo?', history: [] });
  assert.ok(!recebidos().some((x) => x.type === 'user'), 'a pergunta foi ao Claude como mensagem da conversa');
  assert.ok(!c.eventos.some((e) => /qual o arquivo|resposta de lado/.test(JSON.stringify(e))), 'a pergunta ou a resposta entrou nos eventos da conversa');
  assert.strictEqual(c.info.ocupado, false, 'a pergunta rápida não marca a conversa como trabalhando');
  const e = c.ladoEstado();
  assert.strictEqual(e.pendente, null);
  assert.strictEqual(e.trocas.length, 1);
  assert.strictEqual(e.trocas[0].pergunta, 'qual o arquivo?');
  assert.ok(telas.some((x) => x.id === id && x.canal === 'conversa:lado' && x.dado.pendente && x.dado.pendente.pergunta === 'qual o arquivo?'), 'a tela soube da pergunta esperando');
  assert.ok(telas.some((x) => x.id === id && x.canal === 'conversa:lado' && !x.dado.pendente && x.dado.trocas.length === 1), 'a tela soube da resposta');
});

test('lado: a pergunta seguinte leva as anteriores respondidas (o Claude relê); a que deu erro não vai', async (t) => {
  const { c } = nova(t);
  await c.ladoPerguntar('primeira?');
  const s = await c.ladoPerguntar('pergunta sintética');
  assert.strictEqual(s.ok, false);
  assert.strictEqual(s.troca.erro, 'sintetica');
  const r = await c.ladoPerguntar('terceira?');
  assert.strictEqual(r.troca.resposta, 'resposta de lado para: terceira? (com 1 anterior)');
  assert.deepStrictEqual(pedidos()[2].request.history, [{ question: 'primeira?', response: 'resposta de lado para: primeira?' }]);
});

test('lado: texto sintético ("(API error…)" com sucesso) vira erro com o detalhe, nunca resposta', async (t) => {
  const { c } = nova(t);
  const r = await c.ladoPerguntar('pergunta sintética');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.troca.resposta, undefined);
  assert.strictEqual(r.troca.erro, 'sintetica');
  assert.match(r.troca.detalhe, /API error: Not logged in/);
  const n = await c.ladoPerguntar('resposta nula');
  assert.strictEqual(n.troca.erro, 'vazia');
});

test('lado: com o Claude no meio de um turno, a pergunta é respondida na hora e o turno continua', async (t) => {
  const { c } = nova(t);
  c.mandar('trabalha até parar');
  await ate(() => c.info.ocupado === true);
  const r = await c.ladoPerguntar('e agora?');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(c.info.ocupado, true, 'o turno foi interrompido pela pergunta');
  assert.strictEqual(c.fila.length, 0, 'a pergunta foi para a fila de mensagens');
  assert.ok(!recebidos().some((x) => x.type === 'control_request' && x.request.subtype === 'interrupt'));
  c.interromper();
  await ate(() => c.info.ocupado === false);
});

test('lado: "parar" manda o Claude desistir (control_cancel_request) e a pergunta fica marcada como parada', async (t) => {
  const { c } = nova(t);
  const espera = c.ladoPerguntar('esta demora');
  await ate(() => pedidos().length === 1 && c.ladoEstado().pendente);
  assert.strictEqual((await c.ladoPerguntar('outra')).ok, false, 'uma pergunta por vez em cada conversa');
  assert.strictEqual(pedidos().length, 1);
  assert.strictEqual(c.ladoParar(), true);
  const r = await espera;
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.troca.erro, 'parada');
  const cancelou = recebidos().filter((x) => x.type === 'control_cancel_request');
  assert.strictEqual(cancelou.length, 1);
  assert.strictEqual(cancelou[0].request_id, pedidos()[0].request_id);
  assert.strictEqual(c.ladoEstado().pendente, null);
  assert.strictEqual(c.ladoParar(), false, 'sem pergunta esperando, parar não faz nada');
  assert.deepStrictEqual(lado.historico(c.ladoEstado().trocas), [], 'pergunta parada não vai como histórico');
});

test('lado: quando a API falha e o Claude tenta de novo, a tela fica sabendo (tentativa 2 de 10)', async (t) => {
  const { id, c } = nova(t);
  const r = await c.ladoPerguntar('tenta de novo');
  assert.strictEqual(r.ok, true);
  const vistos = telas.filter((x) => x.id === id && x.canal === 'conversa:lado' && x.dado.pendente).map((x) => x.dado.pendente.andamento);
  assert.ok(vistos.some((a) => a && a.estado === 'comecou'));
  assert.ok(vistos.some((a) => a && a.estado === 'tentando' && a.tentativa === 2 && a.de === 10));
});

test('lado: o aviso de outro modelo acompanha a resposta e volta no histórico da pergunta seguinte', async (t) => {
  const { c } = nova(t);
  const r = await c.ladoPerguntar('modelo reserva');
  assert.deepStrictEqual(r.troca.reserva, { de: 'claude-falso-1-0', para: 'claude-falso-0-5', texto: 'Answered by claude-falso-0-5.' });
  await c.ladoPerguntar('e depois?');
  assert.strictEqual(pedidos()[1].request.history[0].fallback_notice, 'Answered by claude-falso-0-5.');
});

test('lado: limpar esvazia a lista e a pergunta seguinte vai sem histórico', async (t) => {
  const { id, c } = nova(t);
  await c.ladoPerguntar('primeira?');
  assert.strictEqual(c.ladoLimpar(), true);
  assert.deepStrictEqual(c.ladoEstado().trocas, []);
  assert.ok(telas.some((x) => x.id === id && x.canal === 'conversa:lado' && x.dado.trocas.length === 0 && !x.dado.pendente));
  await c.ladoPerguntar('segunda?');
  assert.deepStrictEqual(pedidos()[1].request.history, []);
});

test('lado: cada conversa tem as suas perguntas; nada vai para o disco', async (t) => {
  const a = nova(t);
  await new Promise((r) => setTimeout(r, 5)); // o id da conversa nova vem do relógio (ms): duas no mesmo instante teriam o mesmo
  const b = nova(t);
  assert.notStrictEqual(a.id, b.id);
  await a.c.ladoPerguntar('só da primeira');
  assert.strictEqual(b.c.ladoEstado().trocas.length, 0);
  assert.strictEqual(conversa.ladoEstado(a.id).trocas.length, 1);
  const guardado = fs.readFileSync(path.join(casa, '.cache', 'orq-app', process.env.ORQ_APP_TESTE === '1' ? 'conversas-teste.json' : 'conversas.json'), 'utf8');
  assert.ok(!/só da primeira|resposta de lado/.test(guardado), 'a pergunta rápida foi gravada na lista de conversas');
});

test('lado: pergunta vazia ou conversa do Codex não mandam pedido nenhum', async (t) => {
  const { c } = nova(t);
  assert.strictEqual((await c.ladoPerguntar('   ')).ok, false);
  assert.strictEqual(pedidos().length, 0);
  const x = new conversa._Conversa({ id: 'lado-x', titulo: 'X', motor: 'codex' });
  const r = await x.ladoPerguntar('qual?');
  assert.strictEqual(r.ok, false);
  assert.match(r.erro, /Codex/);
  assert.strictEqual(x.proc, null, 'a conversa do Codex subiu por causa da pergunta');
});

test('lado: o Claude que não atende o pedido (versão antiga) vira erro com o motivo, sem resposta inventada', async (t) => {
  process.env.CLAUDE_FALSO_SEM_CONTROLES = '1';
  t.after(() => { delete process.env.CLAUDE_FALSO_SEM_CONTROLES; });
  const { c } = nova(t);
  const r = await c.ladoPerguntar('qual?');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.troca.erro, 'falhou');
  assert.match(r.troca.detalhe, /Unsupported control request/);
});
