// Área: testes (os testes de tela não podem se misturar nem deixar sobra viva)
// 16/11: sete apps de teste ficaram órfãos, cada um segurando uma porta do
// DevTools sorteada entre 400. Um teste sorteou a porta de um órfão e conversou
// com o app ERRADO (viu o recado de outro teste); a publicação reprovou.
// Agora a porta é escolhida pelo sistema e lida do próprio app (na casa
// temporária dele), e o app de teste sai sozinho quando quem o abriu morre.
const test = require('node:test');
const { pastaTemporaria } = require('../temporarias');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { abrirApp } = require('./app');

const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

test('testes de tela: cada app tem a própria porta, lida da casa temporária dele', async () => {
  const [a, b] = await Promise.all([abrirApp({ config: { idioma: 'en' } }), abrirApp({ config: { idioma: 'pt-BR' } })]);
  try {
    assert.ok(Number.isInteger(a.porta) && Number.isInteger(b.porta), 'o teste não sabe em que porta o app dele está');
    assert.notStrictEqual(a.porta, b.porta);
    for (const app of [a, b]) {
      const arq = path.join(app.casa, '.config', 'orquestrador', 'DevToolsActivePort');
      assert.strictEqual(Number(fs.readFileSync(arq, 'utf8').split('\n')[0]), app.porta, 'a porta vem do arquivo que o próprio app gravou na casa dele');
    }
    // Cada conexão fala com o SEU app: o idioma da tela é o da casa de cada um.
    await a.esperar("document.querySelector('[data-aba=\"aba-recados\"]').textContent.trim() === 'Messages'");
    await b.esperar("document.querySelector('[data-aba=\"aba-recados\"]').textContent.trim() === 'Recados'");
  } finally { await a.fechar(); await b.fechar(); }
  assert.ok(!vivo(a.pid) && !vivo(b.pid), 'fechar() espera o app sair de verdade');
});

test('testes de tela: o app de teste não fica órfão quando quem o abriu morre', async () => {
  // A casa é criada aqui, e não no processo filho (que morre sem limpar nada):
  // assim ela é apagada com as outras quando o teste passa.
  const casa = pastaTemporaria('orq-tela-');
  fs.mkdirSync(path.join(casa, '.config', 'orq-app'), { recursive: true });
  fs.writeFileSync(path.join(casa, '.config', 'orq-app', 'config.json'), '{}');
  const filho = spawn(process.execPath, ['-e', `
    require(${JSON.stringify(path.join(__dirname, 'app.js'))}).abrirApp({ casa: ${JSON.stringify(casa)} })
      .then((app) => { console.log('pid ' + app.pid); setInterval(() => {}, 1000); })
      .catch((e) => { console.error(e); process.exit(1); });
  `], { stdio: ['ignore', 'pipe', 'inherit'], env: process.env });
  let saida = '';
  filho.stdout.on('data', (d) => { saida += d; });
  let pid = 0;
  for (let i = 0; i < 300 && !pid; i++) { await espera(100); pid = Number((saida.match(/pid (\d+)/) || [])[1] || 0); }
  try {
    assert.ok(pid > 0 && vivo(pid), 'o app de teste não abriu');
    filho.kill('SIGKILL'); // o teste morreu sem chamar fechar()
    let saiu = false;
    for (let i = 0; i < 100 && !saiu; i++) { await espera(100); saiu = !vivo(pid); }
    assert.ok(saiu, 'o app de teste continuou vivo (órfão) 10 s depois de quem o abriu morrer');
  } finally {
    filho.kill('SIGKILL');
    if (pid && vivo(pid)) process.kill(pid, 'SIGKILL');
  }
});

// 16/11: os apps de teste perguntavam ao tmux DE VERDADE de quem rodava a
// bateria (só o de desempenho tinha tmux próprio): um agente do usuário numa
// pasta de projeto virava frente no app de teste, e um "Abrir terminal" de teste
// anexaria na sessão dele. Aqui o "tmux do usuário" é de mentira (TMUX_TMPDIR e
// TMUX apontando para ele, como num terminal aberto dentro do tmux): o app de
// teste não pode enxergá-lo, e enxerga o agente posto no tmux privado dele.
test('testes de tela: o app de teste não enxerga o tmux de quem roda os testes', async (t) => {
  try { execFileSync('tmux', ['-V'], { stdio: 'ignore' }); } catch { t.skip('sem tmux'); return; }
  const usuario = pastaTemporaria('orq-tmux-');
  const socketUsuario = path.join(usuario, `tmux-${process.getuid()}`, 'default');
  const antes = { TMUX_TMPDIR: process.env.TMUX_TMPDIR, TMUX: process.env.TMUX };
  process.env.TMUX_TMPDIR = usuario;
  process.env.TMUX = `${socketUsuario},1,0`;
  const tmuxEm = (dir) => (...a) => execFileSync('tmux', ['-f', '/dev/null', ...a], { env: { ...process.env, TMUX: '', TMUX_TMPDIR: dir }, stdio: 'ignore' });
  const app = await abrirApp({ config: { raizProjetos: '~/dev', niveis: 2, ignorar: '^[_-]' }, arquivos: { 'dev/emp/do-usuario/.keep': '', 'dev/emp/do-teste/.keep': '' } });
  const tmuxUsuario = tmuxEm(usuario);
  const tmuxApp = tmuxEm(app.tmux);
  t.after(async () => {
    await app.fechar();
    for (const tm of [tmuxUsuario, tmuxApp]) { try { tm('kill-server'); } catch { /* já não havia */ } }
    for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  // Agente falso: título do Claude e a tela de quem espera (as marcas que o coletor reconhece).
  const agenteSh = path.join(app.casa, 'agente.sh');
  fs.writeFileSync(agenteSh, "#!/bin/bash\nprintf '\\033]0;✳ Agente %s\\007' \"$1\"\nprintf 'Terminei.\\n────────\\n│ > \\n────────\\n  ⏵⏵ auto mode on (shift+tab to cycle)\\n'\nexec sleep 3600\n", { mode: 0o755 });
  tmuxUsuario('new-session', '-d', '-s', 'agente-usuario', '-x', '120', '-y', '40', '-c', path.join(app.casa, 'dev', 'emp', 'do-usuario'), '--', 'bash', agenteSh, '1');
  tmuxApp('new-session', '-d', '-s', 'agente-teste', '-x', '120', '-y', '40', '-c', path.join(app.casa, 'dev', 'emp', 'do-teste'), '--', 'bash', agenteSh, '2');
  assert.ok(fs.existsSync(socketUsuario), 'o tmux "do usuário" de mentira subiu');
  let r = null;
  for (let k = 0; k < 40; k++) { r = await app.avaliar('window.orq.estado()'); if (r.frentes.length) break; await espera(500); }
  await espera(2500); // mais uma volta da tela: a outra sessão também teria aparecido
  r = await app.avaliar('window.orq.estado()');
  const projs = r.frentes.map((f) => f.proj).sort();
  assert.ok(!projs.includes('do-usuario'), `o app de teste enxergou a sessão do tmux do usuário: ${projs}`);
  assert.deepStrictEqual(projs, ['do-teste'], 'o app enxerga o agente do tmux privado dele (o teste não passa à toa)');
});

// 16/11: dentro do xvfb-run, e mesmo sem WAYLAND_DISPLAY, o Electron de teste
// escolhia o Wayland (--ozone-platform=wayland no log) e a libwayland caía no
// socket padrão da sessão de verdade ($XDG_RUNTIME_DIR/wayland-0): a janela
// escondida, e qualquer caixa de erro, iam para a tela do usuário. O app de
// teste tem de falar com o X da tela virtual (DISPLAY), nunca com o Wayland.
// Prova pelos sockets: a quem cada socket do app está ligado (ss -xn).
function telasDoApp(pid) {
  const filhos = (p) => { try { return fs.readFileSync(`/proc/${p}/task/${p}/children`, 'utf8').trim().split(/\s+/).filter(Boolean); } catch { return []; } };
  const pids = [String(pid)];
  for (let i = 0; i < pids.length; i++) pids.push(...filhos(pids[i]));
  const inodes = new Set();
  for (const p of pids) {
    let fds = [];
    try { fds = fs.readdirSync(`/proc/${p}/fd`); } catch { continue; }
    for (const f of fds) { try { const m = fs.readlinkSync(`/proc/${p}/fd/${f}`).match(/^socket:\[(\d+)\]$/); if (m) inodes.add(m[1]); } catch { /* fechou */ } }
  }
  const caminhos = new Set();
  for (const l of execFileSync('ss', ['-xn'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n')) {
    const c = l.trim().split(/\s+/);
    if (c.length < 8) continue;
    const [local, , peer] = [c[4], c[5], c[7]]; // Local Address, Port, Peer Port
    if (inodes.has(peer) && local !== '*') caminhos.add(local);
  }
  return [...caminhos];
}

test('testes de tela: o app de teste desenha na tela virtual (X), nunca na sessão Wayland do usuário', async (t) => {
  try { execFileSync('ss', ['-V'], { stdio: 'ignore' }); } catch { t.skip('sem ss (iproute2)'); return; }
  const n = (String(process.env.DISPLAY || '').match(/^:(\d+)/) || [])[1];
  if (n === undefined) { t.skip('sem DISPLAY'); return; }
  const app = await abrirApp();
  t.after(() => app.fechar());
  let telas = [];
  for (let i = 0; i < 30; i++) { telas = telasDoApp(app.pid); if (telas.some((c) => /wayland|\.X11-unix\/X\d/.test(c))) break; await espera(100); }
  assert.deepStrictEqual(telas.filter((c) => /wayland/i.test(c)), [], `o app de teste se ligou ao Wayland da sessão: ${telas}`);
  assert.ok(telas.some((c) => c.endsWith(`.X11-unix/X${n}`)), `o app de teste não está no X da tela virtual (:${n}): ${telas}`);
});
