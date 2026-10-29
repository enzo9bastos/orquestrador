// Área: permissoes
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria, escrever } = require('../ajuda');

const casa = casaTemporaria();
escrever(casa, '.claude/settings.json', JSON.stringify({ model: 'opus', hooks: { x: 1 } }));
const permissoes = require('../../permissoes');

test('permissoes: grava só a chave permissions e guarda cópia', () => {
  permissoes.gravar({ allow: ['Bash(ls:*)', 'Bash(ls:*)'], deny: [], defaultMode: 'auto' });
  const s = JSON.parse(fs.readFileSync(path.join(casa, '.claude/settings.json'), 'utf8'));
  assert.deepStrictEqual(s.permissions, { allow: ['Bash(ls:*)'], defaultMode: 'auto' });
  assert.strictEqual(s.model, 'opus', 'o resto do arquivo fica igual');
  assert.ok(fs.readdirSync(path.join(casa, '.local/share/orq-app/versoes/claude-settings')).length >= 1);
});
