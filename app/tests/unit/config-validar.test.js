// Área: config
// config.validar recebe o que a tela de configurações manda: valor estranho é
// recusado, nunca derruba a gravação com TypeError.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { casaTemporaria } = require('../ajuda');

const casa = casaTemporaria({ pastaNotas: '~/n/' });
const config = require('../../config');

test('config: validar com valor nulo ou de tipo errado recusa a chave em vez de lançar', () => {
  const estranhos = { notificacoes: null, fontesRepertorio: null, pastasNotas: 'x', canalContatos: null, destaque: null, ambiente: null };
  for (const [k, v] of Object.entries(estranhos)) {
    let r;
    assert.doesNotThrow(() => { r = config.validar({ [k]: v }); }, `${k}: ${JSON.stringify(v)}`);
    assert.deepStrictEqual(r, { ok: {}, recusado: [k] }, k);
  }
  for (const v of [undefined, 0, 'x', true]) assert.doesNotThrow(() => config.validar({ notificacoes: v }), String(v));
});

test('config: o que já validava certo continua igual', () => {
  const r = config.validar({
    tema: 'light', idioma: 'en', destaque: '#ABCDEF', mostrarBichinho: false,
    notificacoes: { pedidos: false }, comandoInicial: ' /orquestrar ', raizProjetos: ' ~/p ', niveis: 2,
    fontesRepertorio: [{ nome: ' A ', caminho: ' ~/r ' }], pastasNotas: [{ caminho: ' ~/m ' }],
    canalServidor: 'https://ntfy.exemplo/', ambiente: { ABC: '1' }, tema2: 'x', niveis2: 1,
  });
  assert.deepStrictEqual(r.recusado, ['tema2', 'niveis2']);
  assert.deepStrictEqual(r.ok, {
    tema: 'light', idioma: 'en', destaque: '#abcdef', mostrarBichinho: false,
    notificacoes: { pedidos: false, respostas: true, agentes: true, ajudante: true },
    comandoInicial: '/orquestrar', raizProjetos: '~/p', niveis: 2,
    fontesRepertorio: [{ nome: 'A', ferramenta: 'outra', caminho: '~/r' }], pastasNotas: [{ nome: null, caminho: '~/m' }],
    canalServidor: 'https://ntfy.exemplo', ambiente: { ABC: '1' },
  });
  assert.deepStrictEqual(config.validar({ destaque: 'azul', niveis: 3 }), { ok: {}, recusado: ['destaque', 'niveis'] });
});

test('config: pastaNotas com barra no fim vale igual a sem barra', () => {
  assert.strictEqual(config.ler().pastaNotas, path.join(casa, 'n'));
  assert.strictEqual(config.validar({ pastaNotas: '~/n/' }).ok.pastaNotas, '~/n');
  assert.strictEqual(config.validar({ pastaNotas: '/srv/notas//' }).ok.pastaNotas, '/srv/notas');
  assert.strictEqual(config.validar({ pastaNotas: '/' }).ok.pastaNotas, '/', 'a raiz continua sendo a raiz');
  assert.strictEqual(config.validar({ pastaNotas: '  ' }).ok.pastaNotas, null);
});
