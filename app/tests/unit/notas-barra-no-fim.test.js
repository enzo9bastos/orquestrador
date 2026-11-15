// Área: notas
// pastaNotas (ou o caminho de uma pastasNotas) escrito com barra no fim
// ("~/n/") abre a aba Notas igual a "~/n".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria, escrever } = require('../ajuda');

const casa = casaTemporaria({ pastaNotas: '~/n/' });
escrever(casa, 'n/a.md', '# A\n');
escrever(casa, 'n/sub/b.md', '# B\n');
escrever(casa, 'm/c.md', '# C\n');
const config = require('../../config');
const notas = require('../../notas');

test('notas: pastaNotas "~/n/" abre, lista, lê, grava e esconde como "~/n"', () => {
  assert.strictEqual(notas.caminho(0, ''), path.join(casa, 'n'));
  const arvore = JSON.stringify(notas.arvore(0));
  assert.match(arvore, /"a\.md"/);
  assert.match(arvore, /b\.md/);
  const { conteudo, mtime } = notas.ler(0, 'a.md');
  assert.strictEqual(conteudo, '# A\n');
  notas.gravar(0, 'a.md', '# A2\n', mtime);
  assert.strictEqual(fs.readFileSync(path.join(casa, 'n/a.md'), 'utf8'), '# A2\n');
  assert.deepStrictEqual(notas.esconder(0, 'sub'), ['sub']);
  assert.deepStrictEqual(notas.mostrar(0, 'sub'), []);
  assert.throws(() => notas.ler(0, '../m/c.md'), /fora da pasta/, 'continua sem sair da pasta');
});

test('notas: pastasNotas com barra no fim também', () => {
  config.gravar({ pastasNotas: [{ nome: 'M', caminho: '~/m//' }] });
  assert.strictEqual(notas.caminho(0, ''), path.join(casa, 'm'));
  assert.strictEqual(notas.ler(0, 'c.md').conteudo, '# C\n');
  assert.strictEqual(notas.localizar(path.join(casa, 'm/c.md')).rel, 'c.md');
  assert.strictEqual(notas.adicionarPasta(path.join(casa, 'm')), 0, 'a mesma pasta não entra duas vezes');
  assert.strictEqual(notas.removerPasta(0), true);
  assert.deepStrictEqual(config.ler().pastasNotas, [], 'tirar a pasta tira mesmo com a barra no fim');
});
