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
