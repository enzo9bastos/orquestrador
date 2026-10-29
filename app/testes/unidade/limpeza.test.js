// Área: limpeza (portão do repositório público)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const script = path.join(__dirname, '../../../scripts/verificar-limpeza.sh');

test('limpeza: reprova quando aparece termo proibido', { skip: !fs.existsSync(script) && 'fora do repositório' }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-limpeza-'));
  execFileSync('git', ['init', '-q'], { cwd: d });
  fs.writeFileSync(path.join(d, 'a.txt'), 'nada demais aqui\nempresa-secreta x\n');
  fs.writeFileSync(path.join(d, 'termos.txt'), '# lista\nempresa-secreta\n');
  let saiu = 0;
  try { execFileSync('bash', [script, path.join(d, 'termos.txt')], { cwd: d, stdio: 'pipe' }); } catch (e) { saiu = e.status; }
  assert.notStrictEqual(saiu, 0);
});
