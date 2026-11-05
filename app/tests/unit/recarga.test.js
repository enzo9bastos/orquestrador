// Área: recarga (recarregar a tela ao vivo só com código publicado)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { publicado } = require('../../recarga');

const git = (d, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: d, stdio: 'pipe' });

test('recarga: só recarrega quando a pasta da tela está igual ao commit (S12)', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-recarga-'));
  const tela = path.join(d, 'renderer');
  fs.mkdirSync(tela);
  fs.writeFileSync(path.join(tela, 'a.js'), 'um');
  git(d, 'init', '-q'); git(d, 'add', '.'); git(d, 'commit', '-qm', 'um');
  assert.strictEqual(await publicado(tela), true, 'igual ao commit (o publicar.sh acabou de gravar)');
  fs.writeFileSync(path.join(tela, 'a.js'), 'mexido por fora');
  assert.strictEqual(await publicado(tela), false, 'arquivo mudado sem commit');
  git(d, 'commit', '-qam', 'dois');
  assert.strictEqual(await publicado(tela), true);
  fs.writeFileSync(path.join(tela, 'novo.js'), 'plantado');
  assert.strictEqual(await publicado(tela), false, 'arquivo novo fora do git');
  const solto = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-recarga-'));
  assert.strictEqual(await publicado(solto), false, 'sem git, não recarrega sozinho');
});
