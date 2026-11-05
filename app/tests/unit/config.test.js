// Área: config
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { casaTemporaria } = require('../ajuda');

const casa = casaTemporaria({ raizProjetos: '~/proj', destaque: '#123456' });
const config = require('../../config');

test('config: arquivo por cima dos padrões, com ~ expandido', () => {
  const c = config.ler();
  assert.strictEqual(c.raizProjetos, path.join(casa, 'proj'));
  assert.strictEqual(c.destaque, '#123456');
  assert.strictEqual(c.comandoInicial, null, 'sem configuração, nenhum comando inicial');
});

test('config: gravar guarda só a chave mudada, sem copiar os padrões', () => {
  config.gravar({ tema: 'light' });
  const bruto = JSON.parse(require('fs').readFileSync(config.ARQ, 'utf8'));
  assert.deepStrictEqual(Object.keys(bruto).sort(), ['destaque', 'raizProjetos', 'tema']);
});

test('config: navegador ligado por padrão; porta 0 (livre) ou 1024–65535', () => {
  assert.strictEqual(config.ler().navegadorControle, true);
  const { ok, recusado } = config.validar({ navegadorControle: false, navegadorPorta: 47811 });
  assert.deepStrictEqual(ok, { navegadorControle: false, navegadorPorta: 47811 });
  assert.deepStrictEqual(recusado, []);
  assert.deepStrictEqual(config.validar({ navegadorPorta: 80 }).recusado, ['navegadorPorta']);
  assert.deepStrictEqual(config.validar({ navegadorControle: 'sim' }).recusado, ['navegadorControle']);
});

test('config: arquivo estragado não vira perda silenciosa — o original fica guardado ao lado (S5)', () => {
  const fs = require('fs');
  fs.writeFileSync(config.ARQ, '{"raizProjetos": "~/meus", "tema": "light",'); // JSON cortado
  config.gravar({ destaque: '#abcdef' });
  const guardados = fs.readdirSync(path.dirname(config.ARQ)).filter((n) => n.startsWith('config.json.estragado-'));
  assert.strictEqual(guardados.length, 1, 'o arquivo estragado tem que ficar guardado');
  assert.strictEqual(fs.readFileSync(path.join(path.dirname(config.ARQ), guardados[0]), 'utf8'), '{"raizProjetos": "~/meus", "tema": "light",');
  assert.strictEqual(JSON.parse(fs.readFileSync(config.ARQ, 'utf8')).destaque, '#abcdef');
  assert.ok(!fs.readdirSync(path.dirname(config.ARQ)).some((n) => n.endsWith('.tmp')), 'sem sobra de gravação');
});
