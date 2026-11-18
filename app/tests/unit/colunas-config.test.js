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

test('atalhosColunas: padrão, troca válida, desligar com "" e recusa de colisão, de repetição e de combinação inválida', () => {
  assert.deepStrictEqual(config.ler().atalhosColunas, { agentes: 'Ctrl+Alt+Comma', demandas: 'Ctrl+Alt+Period' });
  assert.deepStrictEqual(config.validar({ atalhosColunas: { agentes: 'Ctrl+Alt+KeyJ', demandas: '' } }).ok, { atalhosColunas: { agentes: 'Ctrl+Alt+KeyJ', demandas: '' } });
  const ruins = [
    { agentes: 'Ctrl+KeyK', demandas: '' }, // paleta de comandos
    { agentes: 'Ctrl+KeyB', demandas: '' }, // negrito
    { agentes: 'Ctrl+Alt+Digit3', demandas: '' }, // atalho do repertório
    { agentes: 'Ctrl+Alt+Space', demandas: '' }, // bichinho
    { agentes: 'Ctrl+Alt+KeyJ', demandas: 'Ctrl+Alt+KeyJ' }, // repetida
    { agentes: 'KeyJ', demandas: '' }, // sem modificador
    { agentes: 'Shift+KeyJ', demandas: '' }, // só Shift
    { agentes: 'Alt+Ctrl+KeyJ', demandas: '' }, // fora da ordem canônica
    { agentes: 'Ctrl+Alt+Foo', demandas: '' },
    { agentes: 'Ctrl+Alt+KeyJ' }, // falta o outro lado
    { agentes: 1, demandas: '' }, null, 'x', [],
  ];
  for (const v of ruins) assert.deepStrictEqual(config.validar({ atalhosColunas: v }), { ok: {}, recusado: ['atalhosColunas'] }, JSON.stringify(v));
});

test('atalhos: o que a tela captura (KeyboardEvent) vira a combinação certa e é mostrado como no teclado', () => {
  const A = require('../../renderer/atalhos-lista');
  assert.strictEqual(A.deEvento({ code: 'Comma', key: ',', ctrlKey: true, altKey: true }), 'Ctrl+Alt+Comma');
  assert.strictEqual(A.deEvento({ code: 'KeyJ', key: 'j', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+KeyJ');
  assert.strictEqual(A.deEvento({ code: 'ControlLeft', key: 'Control', ctrlKey: true }), null, 'só modificador não é combinação');
  assert.strictEqual(A.mostrar('Ctrl+Alt+Comma'), 'Ctrl+Alt+,');
  assert.strictEqual(A.mostrar('Ctrl+Shift+KeyJ'), 'Ctrl+Shift+J');
  assert.strictEqual(A.mostrar('Alt+Digit5'), 'Alt+5');
});

test('atalhoPerguntaRapida: padrão, troca, desligar com "" e recusa do que colide com o app ou com os atalhos das colunas', () => {
  // Parte do que está gravado: os padrões das colunas e o da pergunta rápida.
  config.gravar({ atalhosColunas: { agentes: 'Ctrl+Alt+Comma', demandas: 'Ctrl+Alt+Period' } });
  assert.strictEqual(config.ler().atalhoPerguntaRapida, 'Ctrl+Alt+KeyP');
  assert.deepStrictEqual(config.validar({ atalhoPerguntaRapida: 'Ctrl+Alt+KeyJ' }), { ok: { atalhoPerguntaRapida: 'Ctrl+Alt+KeyJ' }, recusado: [] });
  assert.deepStrictEqual(config.validar({ atalhoPerguntaRapida: '' }), { ok: { atalhoPerguntaRapida: '' }, recusado: [] });
  const ruins = [
    'Ctrl+KeyK', // paleta de comandos
    'Ctrl+Alt+Space', // bichinho
    'Ctrl+Alt+Comma', // o atalho da coluna dos agentes
    'Ctrl+Alt+Period', // o atalho da coluna das demandas
    'KeyP', 'Shift+KeyP', 'Alt+Ctrl+KeyP', 'Ctrl+Alt+Foo', 5, null, {}, [],
  ];
  for (const v of ruins) assert.deepStrictEqual(config.validar({ atalhoPerguntaRapida: v }), { ok: {}, recusado: ['atalhoPerguntaRapida'] }, JSON.stringify(v));
  // Uma coluna não pode pegar a combinação da pergunta rápida que está gravada…
  assert.deepStrictEqual(config.validar({ atalhosColunas: { agentes: 'Ctrl+Alt+KeyP', demandas: '' } }), { ok: {}, recusado: ['atalhosColunas'] });
  // …a não ser que o mesmo pedido mude a da pergunta rápida (vale como os três vão ficar).
  assert.deepStrictEqual(config.validar({ atalhosColunas: { agentes: 'Ctrl+Alt+KeyP', demandas: '' }, atalhoPerguntaRapida: '' }).recusado, []);
  assert.deepStrictEqual(config.validar({ atalhosColunas: { agentes: 'Ctrl+Alt+KeyJ', demandas: '' }, atalhoPerguntaRapida: 'Ctrl+Alt+Comma' }).recusado, []);
  // Os dois iguais no mesmo pedido: nenhum dos dois entra.
  assert.deepStrictEqual(config.validar({ atalhosColunas: { agentes: 'Ctrl+Alt+KeyJ', demandas: '' }, atalhoPerguntaRapida: 'Ctrl+Alt+KeyJ' }), { ok: {}, recusado: ['atalhosColunas', 'atalhoPerguntaRapida'] });
  // Gravado, volta igual.
  config.gravar(config.validar({ atalhoPerguntaRapida: 'Ctrl+Alt+KeyJ' }).ok);
  assert.strictEqual(config.ler().atalhoPerguntaRapida, 'Ctrl+Alt+KeyJ');
});
