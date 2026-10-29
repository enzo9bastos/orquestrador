// Área: notas
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria, escrever } = require('../ajuda');

const casa = casaTemporaria({ pastasNotas: [{ nome: 'N', caminho: '~/notas' }] });
escrever(casa, 'notas/a.md', '# A\n');
escrever(casa, 'notas/diario/2026-10-29.md', 'dia\n');
escrever(casa, 'notas/so-texto.txt', 'não é nota');
const notas = require('../../notas');

test('notas: árvore mostra só .md e as pastas que levam a eles', () => {
  const nomes = JSON.stringify(notas.arvore(0));
  assert.match(nomes, /"a\.md"/);
  assert.match(nomes, /2026-10-29\.md/);
  assert.doesNotMatch(nomes, /so-texto/);
});

test('notas: não sai da pasta (../)', () => {
  assert.throws(() => notas.ler(0, '../../etc/passwd'), /fora da pasta/);
});

test('notas: gravar guarda a versão anterior antes de escrever', () => {
  const { mtime } = notas.ler(0, 'a.md');
  notas.gravar(0, 'a.md', '# A2\n', mtime);
  const versoes = path.join(casa, '.local/share/orq-app/versoes');
  const guardadas = fs.readdirSync(versoes).flatMap((d) => fs.readdirSync(path.join(versoes, d)).filter((f) => f.endsWith('.md')));
  assert.ok(guardadas.length >= 1, 'versão anterior guardada');
  assert.strictEqual(fs.readFileSync(path.join(casa, 'notas/a.md'), 'utf8'), '# A2\n');
});

test('notas: mudou por fora → conflito, sem gravar por cima', () => {
  const { mtime } = notas.ler(0, 'a.md');
  const abs = path.join(casa, 'notas/a.md');
  fs.writeFileSync(abs, '# A2\nlinha do agente\n');
  fs.utimesSync(abs, new Date(), new Date(Date.now() + 5000));
  const r = notas.gravar(0, 'a.md', '# meu\n', mtime);
  assert.strictEqual(r.conflito, true);
  assert.strictEqual(fs.readFileSync(abs, 'utf8'), '# A2\nlinha do agente\n');
});

test('notas: renomear nunca sobrescreve', () => {
  escrever(casa, 'notas/b.md', 'b');
  const r = notas.renomear(0, 'a.md', 'b');
  assert.ok(r.erro);
  assert.strictEqual(fs.readFileSync(path.join(casa, 'notas/b.md'), 'utf8'), 'b');
});

test('notas: nota nova nasce vazia (o título é o nome do arquivo)', () => {
  const r = notas.criar(0, '', 'Nova');
  assert.strictEqual(fs.readFileSync(path.join(casa, 'notas', r.rel), 'utf8'), '');
});

test('notas: tirar pasta do app não apaga nada do disco', () => {
  notas.removerPasta(0);
  assert.ok(fs.existsSync(path.join(casa, 'notas/b.md')));
});
