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

// 16/11: publicação que mudou a tela E o processo principal recarregou só a
// tela; a tela nova (envios em lote) não entendia o processo antigo e as
// mensagens do usuário sumiram até reiniciar. A recarga sozinha só vale quando
// o código fora de renderer/ é o mesmo de quando o app abriu.
test('recarga: mudança fora da tela muda a versão do principal (pede reinício); só na tela, não', async () => {
  const { versaoDoPrincipal } = require('../../recarga');
  assert.strictEqual(typeof versaoDoPrincipal, 'function', 'sem a trava de versão');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-recarga-'));
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
  assert.strictEqual(await versaoDoPrincipal(fs.mkdtempSync(path.join(os.tmpdir(), 'orq-recarga-'))), null, 'sem git');
});

// 16/11 (Etapa 0.D): publicação que mudou SÓ o código de fora da tela (main.js,
// conversa.js, bin/…) não mexeu em renderer/, a vigia da tela não disparou e o
// app ficou rodando o processo principal velho sem avisar ninguém.
test('recarga: decisão do principal — pede reinício só com o código de fora da tela mudado e inteiro no disco', () => {
  const { decidirPrincipal } = require('../../recarga');
  assert.strictEqual(typeof decidirPrincipal, 'function', 'sem a decisão do principal');
  const v1 = 'main.js 1', v2 = 'main.js 2';
  assert.strictEqual(decidirPrincipal({ inicio: v1, agora: v1, publicado: true, ocupado: false }), 'nada', 'nada mudou fora da tela');
  assert.strictEqual(decidirPrincipal({ inicio: v1, agora: v2, publicado: true, ocupado: false }), 'reiniciar');
  assert.strictEqual(decidirPrincipal({ inicio: v1, agora: v2, publicado: false, ocupado: false }), 'esperar', 'o disco ainda não bate com o commit');
  assert.strictEqual(decidirPrincipal({ inicio: v1, agora: v2, publicado: true, ocupado: true }), 'esperar', 'git trabalhando');
  assert.strictEqual(decidirPrincipal({ inicio: null, agora: v2, publicado: true, ocupado: false }), 'nada', 'sem git ao abrir');
  assert.strictEqual(decidirPrincipal({ inicio: v1, agora: null, publicado: true, ocupado: false }), 'nada', 'o git sumiu');
});

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function ate(cond, ms, msg) {
  for (let t = 0; t < ms; t += 50) { if (cond()) return; await espera(50); }
  assert.fail(msg);
}
function repoDeApp() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-recarga-'));
  const app = path.join(raiz, 'app');
  fs.mkdirSync(path.join(app, 'renderer'), { recursive: true });
  fs.mkdirSync(path.join(app, 'bin'));
  fs.writeFileSync(path.join(app, 'renderer', 'tela.js'), 'tela 1');
  fs.writeFileSync(path.join(app, 'main.js'), 'principal 1');
  fs.writeFileSync(path.join(app, 'conversa.js'), 'conversa 1');
  fs.writeFileSync(path.join(app, 'bin', 'orq-x'), 'bin 1');
  git(raiz, 'init', '-q'); git(raiz, 'add', '.'); git(raiz, 'commit', '-qm', 'um');
  return { raiz, app, dirGit: path.join(raiz, '.git') };
}

test('recarga: commit só fora da tela pede o reinício (uma vez por mudança); só na tela, não', async () => {
  const { vigiarPrincipal, versaoDoPrincipal } = require('../../recarga');
  assert.strictEqual(typeof vigiarPrincipal, 'function', 'sem a vigia do principal: mudança só fora da tela não avisa');
  const { raiz, app } = repoDeApp();
  const inicio = versaoDoPrincipal(app); // promessa, como no main.js
  let pedidos = 0;
  const parar = vigiarPrincipal({ pastaApp: app, inicio, aoMudar: () => { pedidos++; }, esperaMs: 50, intervaloMs: 100, tentativas: 20 });
  try {
    await espera(400); // a vigia liga depois do rev-parse
    fs.writeFileSync(path.join(app, 'renderer', 'tela.js'), 'tela 2');
    git(raiz, 'commit', '-qam', 'só a tela');
    await espera(800);
    assert.strictEqual(pedidos, 0, 'só a tela mudou: quem cuida é a recarga da tela');
    fs.writeFileSync(path.join(app, 'conversa.js'), 'conversa 2');
    git(raiz, 'commit', '-qam', 'só fora da tela');
    await ate(() => pedidos === 1, 5000, 'mudou só fora da tela e o app não pediu reinício');
    fs.writeFileSync(path.join(app, 'bin', 'orq-x'), 'bin 2');
    git(raiz, 'commit', '-qam', 'bin/');
    await ate(() => pedidos === 2, 5000, 'segunda publicação (bin/) não avisou de novo');
  } finally { parar(); }
  fs.writeFileSync(path.join(app, 'main.js'), 'principal 2');
  git(raiz, 'commit', '-qam', 'depois de parar');
  await espera(800);
  assert.strictEqual(pedidos, 2, 'vigia parada não avisa');
});

test('recarga: git pela metade ou pasta mexida à mão não acende a faixa; acende quando o git termina', async () => {
  const { vigiarPrincipal, versaoDoPrincipal, conferirPrincipal } = require('../../recarga');
  assert.strictEqual(typeof vigiarPrincipal, 'function', 'sem a vigia do principal');
  const { raiz, app, dirGit } = repoDeApp();
  const inicio = await versaoDoPrincipal(app);
  // Rebase pela metade: o HEAD anda a cada passo, mas ainda não é a hora.
  fs.mkdirSync(path.join(dirGit, 'rebase-merge'));
  let pedidos = 0;
  const parar = vigiarPrincipal({ pastaApp: app, inicio, aoMudar: () => { pedidos++; }, esperaMs: 50, intervaloMs: 100, tentativas: 40 });
  try {
    await espera(400);
    fs.writeFileSync(path.join(app, 'main.js'), 'principal 2');
    git(raiz, 'commit', '-qam', 'passo do rebase');
    await espera(800);
    assert.strictEqual(pedidos, 0, 'avisou com o git trabalhando');
    assert.strictEqual(await conferirPrincipal({ pastaApp: app, dirGit, inicio }), 'esperar');
    fs.rmdirSync(path.join(dirGit, 'rebase-merge'));
    await ate(() => pedidos === 1, 5000, 'o git terminou e o app não pediu reinício');
  } finally { parar(); }
  assert.strictEqual(await conferirPrincipal({ pastaApp: app, dirGit, inicio }), 'reiniciar');
  fs.writeFileSync(path.join(app, 'conversa.js'), 'mexido à mão, sem commit');
  assert.strictEqual(await conferirPrincipal({ pastaApp: app, dirGit, inicio }), 'esperar', 'pasta diferente do commit');
  fs.writeFileSync(path.join(dirGit, 'index.lock'), '');
  try {
    assert.strictEqual(await conferirPrincipal({ pastaApp: app, dirGit, inicio }), 'esperar', 'índice travado');
  } finally { fs.unlinkSync(path.join(dirGit, 'index.lock')); }
});
