// Área: voz (as configurações de voz e reuniões)
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const { casaTemporaria } = require('../ajuda');

casaTemporaria({});
const config = require('../../config');

test('voz: padrões (pasta ~/Reuniões, modelo e resumo recomendados, prints ligados) e ~ expandido na leitura', () => {
  const c = config.ler();
  assert.strictEqual(c.reunioesPasta, path.join(os.homedir(), 'Reuniões'));
  assert.deepStrictEqual([c.vozModelo, c.vozPython, c.reuniaoResumo, c.reuniaoModeloLocal, c.reuniaoPrints], ['', '', '', 'qwen2.5:7b', true]);
});

test('voz: o que vale e o que é recusado', () => {
  const ok = { reunioesPasta: '~/dev/_x/reunioes/', vozModelo: 'large-v3-turbo', vozPython: '~/.local/share/w/venv/bin/python', reuniaoResumo: 'claude', reuniaoModeloLocal: 'llama3.1:8b', reuniaoPrints: false };
  const r = config.validar(ok);
  assert.deepStrictEqual(r.recusado, []);
  assert.strictEqual(r.ok.reunioesPasta, '~/dev/_x/reunioes', 'sem a barra no fim');
  for (const [k, v] of [['reunioesPasta', 'relativa/pasta'], ['reunioesPasta', '~/a/../b'], ['reunioesPasta', ''], ['vozModelo', 'tiny'], ['vozPython', 'python'], ['vozPython', '/x/../y'],
    ['reuniaoResumo', 'gpt'], ['reuniaoModeloLocal', 'a b'], ['reuniaoModeloLocal', ''], ['reuniaoPrints', 'sim']]) {
    assert.deepStrictEqual(config.validar({ [k]: v }).recusado, [k], `${k} = ${JSON.stringify(v)}`);
  }
  for (const v of ['', 'small', 'large-v3']) assert.deepStrictEqual(config.validar({ vozModelo: v }).recusado, []);
  for (const v of ['', 'local', 'nenhum']) assert.deepStrictEqual(config.validar({ reuniaoResumo: v }).recusado, []);
  assert.deepStrictEqual(config.validar({ vozPython: '' }).recusado, [], 'vazio: o app procura');
});
