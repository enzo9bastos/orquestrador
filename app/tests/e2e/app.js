// Abre o app de verdade para um teste de tela: casa temporária, porta própria
// do DevTools, e ajudantes para avaliar código na página e mandar teclas.
// A porta é escolhida pelo sistema (porta 0) e lida do arquivo que o próprio
// app grava na casa temporária dele: dois testes nunca caem na mesma porta, e
// um teste nunca conversa com o app de outro (sorteada entre 400, um app órfão
// de outra rodada "atendia" no lugar do app do teste). O app de teste também
// vigia quem o abriu (ORQ_APP_E2E_PAI) e sai sozinho se esse processo morrer.
// A casa temporária é apagada quando o teste passa (../temporarias.js), e o app
// conversa com um tmux PRIVADO, dentro da casa: nunca enxerga nem mexe nas
// sessões de tmux do usuário.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pastaTemporaria } = require('../temporarias');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// casaExistente: reabre o app na mesma casa temporária de uma abertura anterior
// (para provar o que sobrevive a reiniciar); a configuração não é regravada.
// tmux: pasta do tmux privado do app (TMUX_TMPDIR); por padrão, <casa>/tm.
// pasta: abre o app de outra pasta (uma cópia num repositório git temporário,
// para o teste fazer commit sem tocar no repositório de verdade). env: variáveis
// a mais para o app (a casa e as marcas de teste continuam valendo).
async function abrirApp({ config = {}, arquivos = {}, casa: casaExistente = null, tmux = null, pasta = null, env: envExtra = {} } = {}) {
  const casa = casaExistente || pastaTemporaria('orq-tela-');
  const cfg = path.join(casa, '.config', 'orq-app', 'config.json');
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  if (!casaExistente) fs.writeFileSync(cfg, JSON.stringify(config).replace(/~\//g, `${casa}/`));
  for (const [rel, texto] of Object.entries(arquivos)) {
    const abs = path.join(casa, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, texto);
  }
  // Os dados do Electron ficam onde já ficavam (~/.config/orquestrador da casa
  // temporária), agora dito por extenso: é lá que o app grava a porta.
  const dados = path.join(casa, '.config', 'orquestrador');
  const arqPorta = path.join(dados, 'DevToolsActivePort');
  try { fs.unlinkSync(arqPorta); } catch { /* casa nova, ou reaberta sem o arquivo */ }
  // tmux privado: TMUX_TMPDIR dentro da casa e sem TMUX (que, herdado de quem
  // roda os testes de dentro de um tmux, apontaria para o servidor do usuário).
  const tmuxDir = tmux || path.join(casa, 'tm');
  fs.mkdirSync(tmuxDir, { recursive: true });
  const env = { ...process.env, ...envExtra, HOME: casa, TMUX_TMPDIR: tmuxDir, ORQ_APP_TESTE: '1', ORQ_APP_E2E: '1', ORQ_APP_E2E_PAI: String(process.pid) };
  delete env.TMUX;
  delete env.TMUX_PANE;
  // A saída do processo principal fica em <casa>/app.log: quando o teste falha,
  // a casa é guardada e o log diz o que o app reclamou.
  const log = fs.openSync(path.join(casa, 'app.log'), 'a');
  // X11 sempre: sem isto o Electron escolhe o Wayland da sessão (mesmo dentro
  // do xvfb-run e sem WAYLAND_DISPLAY, a libwayland acha o wayland-0 sozinha) e
  // a janela de teste vai para a tela de verdade. Com X11 ela fica no DISPLAY.
  delete env.WAYLAND_DISPLAY;
  const proc = spawn(process.env.ORQ_ELECTRON, [pasta || path.join(__dirname, '..', '..'), '--ozone-platform=x11', '--remote-debugging-port=0', `--user-data-dir=${dados}`], { env, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  let saiu = false;
  proc.once('exit', () => { saiu = true; });
  const matar = async () => {
    if (!saiu) proc.kill();
    for (let i = 0; i < 30 && !saiu; i++) await espera(100);
    if (!saiu) { proc.kill('SIGKILL'); for (let i = 0; i < 20 && !saiu; i++) await espera(100); }
  };
  let ws = null;
  let porta = 0;
  for (let i = 0; i < 150 && !ws && !saiu; i++) {
    await espera(100);
    try {
      if (!porta) porta = Number(fs.readFileSync(arqPorta, 'utf8').split('\n')[0]) || 0;
      if (!porta) continue;
      const alvos = await (await fetch(`http://127.0.0.1:${porta}/json`)).json();
      ws = (alvos.find((t) => t.type === 'page') || {}).webSocketDebuggerUrl;
    } catch { /* ainda subindo */ }
  }
  if (!ws) { await matar(); throw new Error('o app não abriu'); }
  const sock = new WebSocket(ws);
  await new Promise((r, e) => { sock.onopen = r; sock.onerror = e; });
  let id = 0;
  const pendentes = new Map();
  const erros = [];
  sock.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (pendentes.has(d.id)) { pendentes.get(d.id)(d); pendentes.delete(d.id); }
    // Erros da página ficam guardados: teste de tela não passa com erro na tela.
    if (d.method === 'Runtime.exceptionThrown') erros.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  };
  const cdp = (method, params = {}) => new Promise((r) => { const n = ++id; pendentes.set(n, r); sock.send(JSON.stringify({ id: n, method, params })); });

  const app = {
    casa,
    tmux: tmuxDir,
    porta,
    pid: proc.pid,
    erros,
    // Avalia uma expressão na página (pode ser assíncrona) e devolve o valor.
    async avaliar(expr) {
      const d = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (d.result && d.result.exceptionDetails) throw new Error(d.result.exceptionDetails.exception?.description || 'erro na página');
      return d.result && d.result.result ? d.result.result.value : undefined;
    },
    async esperar(expr, ms = 5000) {
      for (let t = 0; t < ms; t += 100) { if (await app.avaliar(expr)) return true; await espera(100); }
      throw new Error(`não aconteceu em ${ms} ms: ${expr}`);
    },
    texto: (t) => cdp('Input.insertText', { text: t }),
    async tecla(key, code = key, vk = 0) {
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
    },
    // Visível por inteiro: dentro da janela e, em 5 pontos (centro e cantos),
    // o elemento de cima é ele mesmo (ou algo dentro dele). Pega menu cortado
    // ou escondido atrás de outra parte da tela.
    async visivel(seletor) {
      return app.avaliar(`(() => {
        const el = document.querySelector(${JSON.stringify(seletor)});
        if (!el || el.hidden) return 'não existe ou está escondido';
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return 'sem tamanho';
        if (r.left < 0 || r.top < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) return 'sai da janela';
        // 12 px para dentro: cantos arredondados mostram o fundo atrás, e isso não é estar coberto.
        const d = Math.min(12, r.width / 4, r.height / 4);
        const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + d, r.top + d], [r.right - d, r.top + d], [r.left + d, r.bottom - d], [r.right - d, r.bottom - d]];
        for (const [x, y] of pts) { const t = document.elementFromPoint(x, y); if (!t || !(t === el || el.contains(t))) return 'coberto por ' + (t ? (t.id || t.className || t.tagName) : 'nada'); }
        return 'ok';
      })()`);
    },
    // Tamanho da janela (para testar janela estreita).
    tamanho: (largura, altura) => cdp('Emulation.setDeviceMetricsOverride', { width: largura, height: altura, deviceScaleFactor: 1, mobile: false }),
    // Mouse de verdade (arrastar o bichinho).
    async mouse(tipo, x, y) { await cdp('Input.dispatchMouseEvent', { type: tipo, x, y, button: 'left', buttons: tipo === 'mouseReleased' ? 0 : 1, clickCount: 1 }); },
    // Canal do DevTools cru (medir desempenho, por exemplo).
    cdp,
    // Print da janela (PNG), para conferir o visual à mão.
    async print(arq) { const d = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(arq, Buffer.from(d.result.data, 'base64')); },
    ler: (rel) => fs.readFileSync(path.join(casa, rel), 'utf8'),
    escrever: (rel, t) => fs.writeFileSync(path.join(casa, rel), t),
    espera,
    // Fecha e espera o app sair de verdade (não deixa processo para trás).
    async fechar() { try { sock.close(); } catch { /* já fechou */ } await matar(); },
  };
  // Recarrega com a escuta de erros já ligada, para pegar erro de carregamento.
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Page.reload');
  await espera(400);
  await app.esperar("document.readyState === 'complete' && !!window.orq");
  await espera(600);
  return app;
}

module.exports = { abrirApp };
