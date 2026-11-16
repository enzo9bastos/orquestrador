// Área: config
// A chave "colunas" (colunas laterais recolhidas por aba) é validada como as
// outras: valor estranho é recusado, nunca derruba a gravação, e só o que
// importa chega ao arquivo.
const test = require('node:test');
const assert = require('node:assert');
const { casaTemporaria } = require('../ajuda');

casaTemporaria({});
const config = require('../../config');

test('colunas: o padrão é vazio (cada aba usa o padrão dela) e o valor certo é aceito, sem sobras', () => {
  assert.deepStrictEqual(config.ler().colunas, {});
  const r = config.validar({ colunas: { 'aba-notas': { agentes: false, demandas: true, lixo: 1 }, 'aba-orquestrador': { agentes: true, demandas: true } } });
  assert.deepStrictEqual(r, { ok: { colunas: { 'aba-notas': { agentes: false, demandas: true }, 'aba-orquestrador': { agentes: true, demandas: true } } }, recusado: [] });
});

test('colunas: valor de tipo errado, aba com nome estranho ou campo que não é verdadeiro/falso é recusado', () => {
  const ruins = [null, 'x', 3, [], { 'aba-x': null }, { 'aba-x': { agentes: 'sim', demandas: true } }, { 'aba-x': { agentes: true } },
    { '../etc': { agentes: true, demandas: true } }, { 'x y': { agentes: true, demandas: true } }, { 'aba-Y': { agentes: true, demandas: true } }];
  for (const v of ruins) {
    let r;
    assert.doesNotThrow(() => { r = config.validar({ colunas: v }); }, JSON.stringify(v));
    assert.deepStrictEqual(r, { ok: {}, recusado: ['colunas'] }, JSON.stringify(v));
  }
});

test('colunas: grava e lê de volta (sobrevive a reiniciar)', () => {
  const v = { 'aba-notas': { agentes: true, demandas: false } };
  config.gravar(config.validar({ colunas: v }).ok);
  assert.deepStrictEqual(config.ler().colunas, v);
});
