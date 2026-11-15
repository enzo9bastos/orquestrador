// Área: conversa (pedidos internos do Claude: control_request)
// 0.A5 da Etapa 0. O app só tratava o control_request "can_use_tool"; qualquer
// outro (ex.: elicitation de um MCP) ficava sem resposta e a conversa travava
// "trabalhando" para sempre, sem aviso. Agora todo pedido recebe resposta: o
// desconhecido, erro na hora e uma linha na conversa. O cancelamento do CLI
// (control_cancel_request) fecha o cartão, e o fim do turno limpa o que ficou.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria } = require('../ajuda');

const FALSO = path.join(__dirname, 'claude-falso.js');
const casa = casaTemporaria({ iasCaminhos: { claude: FALSO } });
const LOG = path.join(casa, 'claude-falso.log');
process.env.CLAUDE_FALSO_LOG = LOG;
const conversa = require('../../conversa');

const recebidos = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const telas = [];
conversa.ligar((canal, dado) => telas.push({ canal, ...dado }));
conversa.ligarAvisos(() => {});
async function ate(cond, ms = 6000) {
  for (let i = 0; i < ms / 20; i++) { if (cond()) return; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error('não aconteceu a tempo');
}
const turnos = (c) => c.eventos.filter((e) => e.tipo === 'resultado').length;

test('A5: pedido que o app não atende recebe erro na hora, com aviso na conversa, e a conversa não trava', async (t) => {
  const c = new conversa._Conversa({ id: 'ce', titulo: 'Conversa 2' });
  t.after(() => c.parar());
  c.mandar('pede elicitation');
  await ate(() => turnos(c) === 1);
  const r = recebidos().find((x) => x.type === 'control_response' && x.response.request_id === 'el-1');
  assert.strictEqual(r.response.subtype, 'error');
  assert.match(r.response.error, /elicitation/);
  assert.strictEqual(c.pendentes.size, 0);
  assert.strictEqual(c.info.ocupado, false);
  assert.ok(c.eventos.some((e) => e.tipo === 'aviso' && /^Pedido não suportado: elicitation/.test(e.texto)), 'linha na conversa');
  assert.ok(c.eventos.some((e) => e.tipo === 'assistant' && e.message.content[0].text === 'seguiu sem a elicitação'));
});

test('A5: o Claude cancela um pedido → o cartão fecha (conversa:respondido)', async (t) => {
  const c = new conversa._Conversa({ id: 'cc', titulo: 'Conversa 3' });
  t.after(() => c.parar());
  c.mandar('pede e cancela');
  await ate(() => turnos(c) === 1);
  assert.strictEqual(c.pendentes.size, 0);
  assert.ok(telas.some((x) => x.id === 'cc' && x.canal === 'conversa:respondido' && x.dado === 'p-1'));
  assert.strictEqual(c.responder('p-1', { permitir: true }), false, 'responder depois do cancelamento não escreve nada');
  assert.ok(!recebidos().some((x) => x.type === 'control_response' && x.response.request_id === 'p-1'));
});

test('A5: fim de turno limpa o pedido que ficou sem resposta e fecha o cartão', async (t) => {
  const c = new conversa._Conversa({ id: 'cf', titulo: 'Conversa 4' });
  t.after(() => c.parar());
  c.mandar('pede permissão e termina');
  await ate(() => turnos(c) === 1);
  assert.strictEqual(c.pendentes.size, 0);
  assert.ok(telas.some((x) => x.id === 'cf' && x.canal === 'conversa:respondido' && x.dado === 'p-2'));
});

test('A5: a permissão comum continua virando cartão e a resposta continua indo ao Claude', async (t) => {
  const c = new conversa._Conversa({ id: 'cp', titulo: 'Conversa 5' });
  t.after(() => c.parar());
  c.mandar('pede e cancela');
  await ate(() => telas.some((x) => x.id === 'cp' && x.canal === 'conversa:pedido'));
  assert.deepStrictEqual(telas.find((x) => x.id === 'cp' && x.canal === 'conversa:pedido').dado.entrada, { command: 'ls' });
});
