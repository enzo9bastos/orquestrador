// Área: testes (os testes de tela não podem se misturar nem deixar sobra viva)
// 16/11: sete apps de teste ficaram órfãos, cada um segurando uma porta do
// DevTools sorteada entre 400. Um teste sorteou a porta de um órfão e conversou
// com o app ERRADO (viu o recado de outro teste); a publicação reprovou.
// Agora a porta é escolhida pelo sistema e lida do próprio app (na casa
// temporária dele), e o app de teste sai sozinho quando quem o abriu morre.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
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
  const filho = spawn(process.execPath, ['-e', `
    require(${JSON.stringify(path.join(__dirname, 'app.js'))}).abrirApp({ config: {} })
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
