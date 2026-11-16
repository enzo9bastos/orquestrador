// Área: recarga (recarregar a tela ao vivo só com código publicado)
const test = require('node:test');
const { pastaTemporaria } = require('../temporarias');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { publicado } = require('../../recarga');

const git = (d, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: d, stdio: 'pipe' });

test('recarga: só recarrega quando a pasta da tela está igual ao commit (S12)', async () => {
  const d = pastaTemporaria('orq-recarga-');
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
  const solto = pastaTemporaria('orq-recarga-');
  assert.strictEqual(await publicado(solto), false, 'sem git, não recarrega sozinho');
});

// 16/11: publicação que mudou a tela E o processo principal recarregou só a
// tela; a tela nova (envios em lote) não entendia o processo antigo e as
// mensagens do usuário sumiram até reiniciar. A recarga sozinha só vale quando
// o código fora de renderer/ é o mesmo de quando o app abriu.
test('recarga: mudança fora da tela muda a versão do principal (pede reinício); só na tela, não', async () => {
  const { versaoDoPrincipal } = require('../../recarga');
  assert.strictEqual(typeof versaoDoPrincipal, 'function', 'sem a trava de versão');
  const d = pastaTemporaria('orq-recarga-');
  fs.mkdirSync(path.join(d, 'renderer'));
  fs.writeFileSync(path.join(d, 'renderer', 'tela.js'), 'tela 1');
  fs.writeFileSync(path.join(d, 'main.js'), 'principal 1');
  fs.writeFileSync(path.join(d, 'preload.js'), 'ponte 1');
  git(d, 'init', '-q'); git(d, 'add', '.'); git(d, 'commit', '-qm', 'um');
  const inicio = await versaoDoPrincipal(d);
  assert.ok(inicio && /main\.js/.test(inicio) && !/renderer/.test(inicio));
  fs.writeFileSync(path.join(d, 'renderer', 'tela.js'), 'tela 2');
  git(d, 'commit', '-qam', 'só a tela');
  assert.strictEqual(await versaoDoPrincipal(d), inicio, 'só a tela mudou: pode recarregar sozinha');
  fs.writeFileSync(path.join(d, 'preload.js'), 'ponte 2');
  git(d, 'commit', '-qam', 'a ponte mudou');
  assert.notStrictEqual(await versaoDoPrincipal(d), inicio, 'a ponte mudou: não recarrega, pede reinício');
  assert.strictEqual(await versaoDoPrincipal(pastaTemporaria('orq-recarga-')), null, 'sem git');
});
