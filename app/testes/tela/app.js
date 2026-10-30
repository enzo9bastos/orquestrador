// Abre o app de verdade para um teste de tela: casa temporária, porta própria
// do DevTools, e ajudantes para avaliar código na página e mandar teclas.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function abrirApp({ config = {}, arquivos = {} } = {}) {
  const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-tela-'));
  const cfg = path.join(casa, '.config', 'orq-app', 'config.json');
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  fs.writeFileSync(cfg, JSON.stringify(config).replace(/~\//g, `${casa}/`));
  for (const [rel, texto] of Object.entries(arquivos)) {
    const abs = path.join(casa, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, texto);
  }
  const porta = 9400 + Math.floor(Math.random() * 400);
  const proc = spawn(process.env.ORQ_ELECTRON, [path.join(__dirname, '..', '..'), `--remote-debugging-port=${porta}`], {
    env: { ...process.env, HOME: casa, ORQ_APP_TESTE: '1', ORQ_APP_E2E: '1' }, stdio: 'ignore',
  });
  let ws = null;
  for (let i = 0; i < 150 && !ws; i++) {
    await espera(100);
    try {
      const alvos = await (await fetch(`http://127.0.0.1:${porta}/json`)).json();
      ws = (alvos.find((t) => t.type === 'page') || {}).webSocketDebuggerUrl;
    } catch { /* ainda subindo */ }
  }
  if (!ws) { proc.kill(); throw new Error('o app não abriu'); }
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
    async fechar() { try { sock.close(); } catch { /* já fechou */ } proc.kill(); await espera(300); },
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
