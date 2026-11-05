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

// S8: o grep -I pulava binário — print com o nome da empresa nos metadados
// (tEXt do PNG, EXIF) ou no nome do arquivo passava.
for (const [caso, montar] of [
  ['metadados de imagem', (d) => fs.writeFileSync(path.join(d, 'print.png'), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), Buffer.from('tEXtAuthor\0empresa-secreta'), Buffer.alloc(64, 0)]))],
  ['nome do arquivo', (d) => fs.writeFileSync(path.join(d, 'tela-empresa-secreta.txt'), 'nada\n')],
]) {
  test(`limpeza: reprova termo proibido em ${caso} (S8)`, { skip: !fs.existsSync(script) && 'fora do repositório' }, () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-limpeza-'));
    execFileSync('git', ['init', '-q'], { cwd: d });
    // A lista fica fora do repositório (como a de verdade): dentro, ela mesma
    // reprovaria e o teste passaria por engano.
    const termos = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orq-termos-')), 'termos.txt');
    fs.writeFileSync(termos, '# lista\nempresa-secreta\n');
    fs.writeFileSync(path.join(d, 'leia.txt'), 'nada\n');
    montar(d);
    let saiu = 0;
    try { execFileSync('bash', [script, termos], { cwd: d, stdio: 'pipe' }); } catch (e) { saiu = e.status; }
    assert.notStrictEqual(saiu, 0);
  });
}

test('limpeza: repositório sem termo proibido passa (controle do S8)', { skip: !fs.existsSync(script) && 'fora do repositório' }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-limpeza-'));
  execFileSync('git', ['init', '-q'], { cwd: d });
  const termos = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orq-termos-')), 'termos.txt');
  fs.writeFileSync(termos, '# lista\nempresa-secreta\n');
  fs.writeFileSync(path.join(d, 'print.png'), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('tEXtAuthor\0outra-coisa'), Buffer.alloc(64, 0)]));
  const saida = execFileSync('bash', [script, termos], { cwd: d, stdio: 'pipe', encoding: 'utf8' });
  assert.match(saida, /limpo/);
});
