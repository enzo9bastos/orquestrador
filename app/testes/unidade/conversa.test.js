// Área: conversa
const test = require('node:test');
const assert = require('node:assert');
const { casaTemporaria } = require('../ajuda');

casaTemporaria({});
const conversa = require('../../conversa');

test('conversa: pergunta do Claude vira aviso "precisa de você"', () => {
  const avisos = [];
  conversa.ligarAvisos((a) => avisos.push(a));
  conversa.ligar(() => {});
  const c = new conversa._Conversa({ id: 'x', titulo: 'Teste', orquestrador: true });
  c.tratar({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { questions: [{ header: 'GERA', question: 'Como conferimos?' }] } } });
  assert.deepStrictEqual(avisos.map((a) => [a.tipo, a.texto]), [['pedido', 'GERA: Como conferimos?']]);
});

test('conversa: fim de turno avisa com o último texto do Claude (não o de subagente)', () => {
  const avisos = [];
  conversa.ligarAvisos((a) => avisos.push(a));
  const c = new conversa._Conversa({ id: 'y', titulo: 'Outra' });
  c.tratar({ type: 'assistant', message: { content: [{ type: 'text', text: 'Pronto, terminei.' }] } });
  c.tratar({ type: 'assistant', parent_tool_use_id: 't1', message: { content: [{ type: 'text', text: 'texto do subagente' }] } });
  c.tratar({ type: 'result', is_error: false, modelUsage: {} });
  assert.strictEqual(avisos.at(-1).tipo, 'resposta');
  assert.strictEqual(avisos.at(-1).texto, 'Pronto, terminei.');
});
