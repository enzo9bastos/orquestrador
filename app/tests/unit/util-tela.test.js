// Área: tela (utilidades compartilhadas)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PASTA = path.join(__dirname, '..', '..', 'renderer');

test('tela: esc() mora num lugar só e escapa os 5 caracteres (M9)', () => {
  const copias = fs.readdirSync(PASTA).filter((n) => n.endsWith('.js') && !n.includes('bundle'))
    .filter((n) => /&#39;|&quot;/.test(fs.readFileSync(path.join(PASTA, n), 'utf8')) && n !== 'util.js');
  assert.deepStrictEqual(copias, [], 'cópia própria de esc() fora do util.js');
  const janela = {};
  vm.runInNewContext(fs.readFileSync(path.join(PASTA, 'util.js'), 'utf8'), { window: janela });
  assert.strictEqual(janela.orqUtil.esc(`<a href='x' title="y">&</a>`), '&lt;a href=&#39;x&#39; title=&quot;y&quot;&gt;&amp;&lt;/a&gt;');
  assert.strictEqual(janela.orqUtil.esc(null), '');
  assert.strictEqual(janela.orqUtil.esc(undefined), '');
  assert.ok(/<script src="util\.js"><\/script>[\s\S]*<script src="paleta-tela\.js">/.test(fs.readFileSync(path.join(PASTA, 'index.html'), 'utf8')), 'util.js carrega antes das telas');
});
