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

test('atalhoBuscaEscritos: padrão Ctrl+R, troca, desligar com "" e recusa do que colide com o app, com as colunas ou com a pergunta rápida', () => {
  config.gravar({ atalhosColunas: { agentes: 'Ctrl+Alt+Comma', demandas: 'Ctrl+Alt+Period' }, atalhoPerguntaRapida: 'Ctrl+Alt+KeyP', atalhoBuscaEscritos: 'Ctrl+KeyR' });
  assert.strictEqual(config.ler().atalhoBuscaEscritos, 'Ctrl+KeyR');
  // O próprio padrão é aceito (o Ctrl+R deixou a lista dos reservados para ser deste atalho).
  assert.deepStrictEqual(config.validar({ atalhoBuscaEscritos: 'Ctrl+KeyR' }), { ok: { atalhoBuscaEscritos: 'Ctrl+KeyR' }, recusado: [] });
  assert.deepStrictEqual(config.validar({ atalhoBuscaEscritos: 'Ctrl+Alt+KeyR' }), { ok: { atalhoBuscaEscritos: 'Ctrl+Alt+KeyR' }, recusado: [] });
  assert.deepStrictEqual(config.validar({ atalhoBuscaEscritos: '' }), { ok: { atalhoBuscaEscritos: '' }, recusado: [] });
  const ruins = ['Ctrl+KeyK', 'Ctrl+KeyF', 'Ctrl+Alt+Comma', 'Ctrl+Alt+Period', 'Ctrl+Alt+KeyP', 'KeyR', 'Shift+KeyR', 'qualquer coisa', null, 7, {}];
  for (const v of ruins) assert.deepStrictEqual(config.validar({ atalhoBuscaEscritos: v }), { ok: {}, recusado: ['atalhoBuscaEscritos'] }, JSON.stringify(v));
  // Os outros atalhos não pegam a combinação da busca…
  assert.deepStrictEqual(config.validar({ atalhoPerguntaRapida: 'Ctrl+KeyR' }), { ok: {}, recusado: ['atalhoPerguntaRapida'] });
  assert.deepStrictEqual(config.validar({ atalhosColunas: { agentes: 'Ctrl+KeyR', demandas: '' } }), { ok: {}, recusado: ['atalhosColunas'] });
  // …a não ser que a busca saia dela no mesmo pedido.
  assert.deepStrictEqual(config.validar({ atalhoPerguntaRapida: 'Ctrl+KeyR', atalhoBuscaEscritos: '' }).recusado, []);
  assert.deepStrictEqual(config.validar({ atalhosColunas: { agentes: 'Ctrl+KeyR', demandas: '' }, atalhoBuscaEscritos: 'Ctrl+Alt+KeyR' }).recusado, []);
  // Dois iguais no mesmo pedido: os dois recusados.
  assert.deepStrictEqual(config.validar({ atalhoPerguntaRapida: 'Ctrl+Alt+KeyJ', atalhoBuscaEscritos: 'Ctrl+Alt+KeyJ' }), { ok: {}, recusado: ['atalhoPerguntaRapida', 'atalhoBuscaEscritos'] });
  config.gravar(config.validar({ atalhoBuscaEscritos: '' }).ok);
  assert.strictEqual(config.ler().atalhoBuscaEscritos, '');
  config.gravar(config.validar({ atalhoBuscaEscritos: 'Ctrl+KeyR' }).ok);
});

test('atalhoGuardarRascunho e atalhoEditorDeTexto: padrão Ctrl+S e Ctrl+G, troca, desligar com "" e nenhum dos atalhos trocáveis repete o outro', () => {
  const PADRAO = { atalhosColunas: { agentes: 'Ctrl+Alt+Comma', demandas: 'Ctrl+Alt+Period' }, atalhoPerguntaRapida: 'Ctrl+Alt+KeyP', atalhoBuscaEscritos: 'Ctrl+KeyR', atalhoGuardarRascunho: 'Ctrl+KeyS', atalhoEditorDeTexto: 'Ctrl+KeyG' };
  config.gravar(PADRAO);
  assert.strictEqual(config.ler().atalhoGuardarRascunho, 'Ctrl+KeyS');
  assert.strictEqual(config.ler().atalhoEditorDeTexto, 'Ctrl+KeyG');
  for (const k of ['atalhoGuardarRascunho', 'atalhoEditorDeTexto']) {
    // O próprio padrão é aceito (Ctrl+S e Ctrl+G deixaram a lista dos reservados para serem destes atalhos).
    assert.deepStrictEqual(config.validar({ [k]: PADRAO[k] }), { ok: { [k]: PADRAO[k] }, recusado: [] });
    assert.deepStrictEqual(config.validar({ [k]: 'Ctrl+Alt+KeyJ' }), { ok: { [k]: 'Ctrl+Alt+KeyJ' }, recusado: [] });
    assert.deepStrictEqual(config.validar({ [k]: '' }), { ok: { [k]: '' }, recusado: [] });
    const outro = k === 'atalhoGuardarRascunho' ? 'Ctrl+KeyG' : 'Ctrl+KeyS';
    const ruins = ['Ctrl+KeyK', 'Ctrl+KeyF', 'Ctrl+Alt+Comma', 'Ctrl+Alt+Period', 'Ctrl+Alt+KeyP', 'Ctrl+KeyR', outro, 'KeyS', 'Shift+KeyG', 'qualquer coisa', null, 7, {}];
    for (const v of ruins) assert.deepStrictEqual(config.validar({ [k]: v }), { ok: {}, recusado: [k] }, `${k} = ${JSON.stringify(v)}`);
    // Os outros atalhos não pegam a combinação deste…
    assert.deepStrictEqual(config.validar({ atalhoPerguntaRapida: PADRAO[k] }), { ok: {}, recusado: ['atalhoPerguntaRapida'] });
    assert.deepStrictEqual(config.validar({ atalhoBuscaEscritos: PADRAO[k] }), { ok: {}, recusado: ['atalhoBuscaEscritos'] });
    assert.deepStrictEqual(config.validar({ atalhosColunas: { agentes: PADRAO[k], demandas: '' } }), { ok: {}, recusado: ['atalhosColunas'] });
    // …a não ser que ele saia dela no mesmo pedido.
    assert.deepStrictEqual(config.validar({ atalhoPerguntaRapida: PADRAO[k], [k]: '' }).recusado, []);
    assert.deepStrictEqual(config.validar({ atalhosColunas: { agentes: PADRAO[k], demandas: '' }, [k]: 'Ctrl+Alt+KeyJ' }).recusado, []);
  }
  // Os dois trocam de combinação entre si no mesmo pedido; dois iguais no mesmo pedido são recusados.
  assert.deepStrictEqual(config.validar({ atalhoGuardarRascunho: 'Ctrl+KeyG', atalhoEditorDeTexto: 'Ctrl+KeyS' }).recusado, []);
  assert.deepStrictEqual(config.validar({ atalhoGuardarRascunho: 'Ctrl+Alt+KeyJ', atalhoEditorDeTexto: 'Ctrl+Alt+KeyJ' }), { ok: {}, recusado: ['atalhoGuardarRascunho', 'atalhoEditorDeTexto'] });
  config.gravar(config.validar({ atalhoGuardarRascunho: '', atalhoEditorDeTexto: '' }).ok);
  assert.strictEqual(config.ler().atalhoGuardarRascunho, '');
  assert.strictEqual(config.ler().atalhoEditorDeTexto, '');
  config.gravar(PADRAO);
});
