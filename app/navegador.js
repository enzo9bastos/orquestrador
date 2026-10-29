// Aba Navegador: janelas de navegador dentro do app (<webview>), para o usuário
// navegar e para o orquestrador (ou um script) controlar pelo orq-nav.
//
// Como no Maestri, o motor é sempre o Chromium do app; "Firefox", "Edge" e
// "celular" mudam a identidade (user-agent) e, no celular, a tela (largura,
// toque, escala), que é o que os sites usam para decidir o que mostrar.
//
// Controle de fora: um servidor HTTP só em 127.0.0.1, com uma chave que muda a
// cada abertura do app e fica em ~/.config/orq-app/navegador.json (modo 600).
// Sem a chave, nada responde.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { session, webContents, ipcMain } = require('electron');
const config = require('./config');

const PARTICAO = 'persist:navegador';
const ARQ_CONTROLE = path.join(os.homedir(), '.config', 'orq-app', 'navegador.json');
const PASTA_PRINTS = path.join(os.homedir(), '.cache', 'orq-app', 'navegador');

const chrome = () => process.versions.chrome;
const maior = () => chrome().split('.')[0];
const PRESETS = {
  padrao: { nome: 'Padrão (Chromium)', ua: () => `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${maior()}.0.0.0 Safari/537.36` },
  chrome: { nome: 'Chrome', ua: () => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${maior()}.0.0.0 Safari/537.36` },
  firefox: { nome: 'Firefox', ua: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0' },
  edge: { nome: 'Edge', ua: () => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${maior()}.0.0.0 Safari/537.36 Edg/${maior()}.0.0.0` },
  iphone: { nome: 'Safari · iPhone', celular: { largura: 390, altura: 844, escala: 3 }, ua: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1' },
  'android-chrome': { nome: 'Chrome · Android', celular: { largura: 412, altura: 915, escala: 2.625 }, ua: () => `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${maior()}.0.0.0 Mobile Safari/537.36` },
  'android-firefox': { nome: 'Firefox · Android', celular: { largura: 412, altura: 915, escala: 2.625 }, ua: () => 'Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0' },
  'android-edge': { nome: 'Edge · Android', celular: { largura: 412, altura: 915, escala: 2.625 }, ua: () => `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${maior()}.0.0.0 Mobile Safari/537.36 EdgA/${maior()}.0.0.0` },
};
const presetOk = (p) => (Object.hasOwn(PRESETS, p) ? p : 'padrao');
const urlOk = (u) => { try { return ['http:', 'https:', 'about:'].includes(new URL(u).protocol); } catch { return false; } };

let janelaFn = () => null;
const janelas = new Map(); // id da janela (n1, n2…) → { wc, preset }
const enviar = (canal, ...a) => { const j = janelaFn(); if (j) j.webContents.send(canal, ...a); };

// Aplica a identidade do preset: user-agent e, no celular, a tela de celular
// (a mesma emulação do modo celular do DevTools: largura, meta viewport,
// toque e escala).
async function aplicarPreset(wc, preset) {
  const p = PRESETS[presetOk(preset)];
  wc.setUserAgent(p.ua());
  const d = wc.debugger;
  try { if (!d.isAttached()) d.attach('1.3'); } catch { return; }
  const plataforma = /iPhone/.test(p.ua()) ? 'iOS' : p.celular ? 'Android' : '';
  await d.sendCommand('Emulation.setUserAgentOverride', { userAgent: p.ua(), platform: plataforma }).catch(() => {});
  if (p.celular) {
    await d.sendCommand('Emulation.setDeviceMetricsOverride', { width: p.celular.largura, height: p.celular.altura, deviceScaleFactor: p.celular.escala, mobile: true }).catch(() => {});
    await d.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }).catch(() => {});
  } else {
    await d.sendCommand('Emulation.clearDeviceMetricsOverride').catch(() => {});
    await d.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {});
  }
}

// Segurança das janelas de navegador: nada de Node, preload nem outra
// partição; só páginas da web (http/https).
function prender(janela) {
  const s = session.fromPartition(PARTICAO);
  s.setUserAgent(PRESETS.padrao.ua());
  s.setPermissionRequestHandler((_wc, perm, ok) => ok(['fullscreen', 'clipboard-sanitized-write'].includes(perm)));
  janela.webContents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.webSecurity = true;
    if (params.partition !== PARTICAO || !urlOk(params.src || 'about:blank')) e.preventDefault();
  });
  janela.webContents.on('did-attach-webview', (_e, wc) => {
    // Link que abre janela nova vira uma janela nova do navegador do app.
    wc.setWindowOpenHandler(({ url }) => { if (urlOk(url)) enviar('navegador:abrir', { url }); return { action: 'deny' }; });
    wc.on('will-navigate', (e, url) => { if (!urlOk(url)) e.preventDefault(); });
  });
}

// A tela avisa qual webview é qual janela; o preset e a primeira página são
// postos daqui, para a primeira requisição já sair com a identidade certa.
ipcMain.handle('navegador:registrar', async (_e, id, wcId, preset, url) => {
  const wc = webContents.fromId(wcId);
  if (!wc || !/^n\d+$/.test(String(id))) return false;
  janelas.set(id, { wc, preset: presetOk(preset) });
  wc.once('destroyed', () => { if (janelas.get(id)?.wc === wc) janelas.delete(id); });
  await aplicarPreset(wc, preset);
  if (url && urlOk(url)) wc.loadURL(url).catch(() => {});
  return true;
});
ipcMain.handle('navegador:preset', async (_e, id, preset) => {
  const j = janelas.get(id);
  if (!j) return false;
  j.preset = presetOk(preset);
  await aplicarPreset(j.wc, j.preset);
  j.wc.reload();
  return true;
});
ipcMain.handle('navegador:presets', () => Object.entries(PRESETS).map(([id, p]) => ({ id, nome: p.nome, celular: p.celular || null })));

// Pedidos que só a tela sabe fazer (abrir e fechar janela): manda e espera.
let nPedido = 0;
const esperando = new Map();
ipcMain.on('navegador:resposta', (_e, n, r) => { const f = esperando.get(n); if (f) { esperando.delete(n); f(r); } });
function pedirTela(acao, dados, ms = 15000) {
  return new Promise((ok, falha) => {
    const n = ++nPedido;
    const t = setTimeout(() => { esperando.delete(n); falha(new Error('a tela não respondeu')); }, ms);
    esperando.set(n, (r) => { clearTimeout(t); ok(r); });
    enviar('navegador:pedido', { n, acao, ...dados });
  });
}

// --- ações do controle (orq-nav) -------------------------------------------
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
function janela(id) {
  const j = id ? janelas.get(String(id)) : [...janelas.values()].pop();
  if (!j || j.wc.isDestroyed()) throw new Error(id ? `janela ${id} não existe` : 'nenhuma janela aberta (use: orq-nav abrir <url>)');
  return j;
}
function idDe(j) { for (const [k, v] of janelas) if (v === j) return k; return null; }
async function carregou(wc, ms = 20000) {
  for (let t = 0; t < ms && wc.isLoading(); t += 100) await espera(100);
}
const js = (wc, codigo) => wc.executeJavaScript(codigo, true);

// Marca os elementos que dá para usar (link, botão, campo) com um número, e
// devolve a lista: o controle clica e digita pelo número.
const MARCAR = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const els = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [contenteditable=true], summary')].filter(vis);
  return els.slice(0, 300).map((e, i) => {
    e.setAttribute('data-orq-n', i + 1);
    const texto = (e.innerText || e.value || e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.getAttribute('title') || e.getAttribute('name') || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
    return { n: i + 1, tipo: e.tagName.toLowerCase() + (e.type && e.tagName !== 'BUTTON' ? ':' + e.type : ''), texto, href: e.getAttribute('href') || undefined };
  });
})()`;
const alvo = (a) => (a.n ? `[data-orq-n="${Number(a.n)}"]` : String(a.seletor || ''));
async function centro(wc, a) {
  const sel = alvo(a);
  if (!sel) throw new Error('diga qual elemento: número (de "elementos") ou seletor CSS');
  const r = await js(wc, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  if (!r) throw new Error(`elemento não encontrado: ${sel}`);
  return r;
}
function tecla(wc, tecla) {
  wc.sendInputEvent({ type: 'keyDown', keyCode: tecla });
  if (tecla === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: tecla });
}

const ACOES = {
  async listar() {
    return [...janelas].map(([id, j]) => ({ id, url: j.wc.getURL(), titulo: j.wc.getTitle(), preset: j.preset }));
  },
  async presets() { return Object.entries(PRESETS).map(([id, p]) => ({ id, nome: p.nome })); },
  async abrir(a) {
    if (a.url && !urlOk(a.url)) throw new Error('só endereços http ou https');
    const r = await pedirTela('abrir', { url: a.url || 'about:blank', preset: presetOk(a.preset) });
    if (!r || !r.id) throw new Error(r?.erro || 'não abriu');
    for (let t = 0; t < 10000 && !janelas.has(r.id); t += 100) await espera(100);
    const j = janela(r.id);
    await espera(200);
    await carregou(j.wc);
    return { id: r.id, url: j.wc.getURL(), titulo: j.wc.getTitle() };
  },
  async ir(a) {
    const j = janela(a.id);
    if (!urlOk(a.url)) throw new Error('só endereços http ou https');
    await j.wc.loadURL(a.url).catch(() => {});
    return { id: idDe(j), url: j.wc.getURL(), titulo: j.wc.getTitle() };
  },
  async voltar(a) { const j = janela(a.id); j.wc.navigationHistory.goBack(); await espera(300); await carregou(j.wc); return { url: j.wc.getURL() }; },
  async avancar(a) { const j = janela(a.id); j.wc.navigationHistory.goForward(); await espera(300); await carregou(j.wc); return { url: j.wc.getURL() }; },
  async recarregar(a) { const j = janela(a.id); j.wc.reload(); await espera(300); await carregou(j.wc); return { url: j.wc.getURL() }; },
  async texto(a) {
    const j = janela(a.id);
    const t = await js(j.wc, 'document.body ? document.body.innerText : ""');
    const max = Math.min(Number(a.max) || 20000, 200000);
    return { url: j.wc.getURL(), titulo: j.wc.getTitle(), texto: t.slice(0, max), cortado: t.length > max };
  },
  async elementos(a) { const j = janela(a.id); return js(j.wc, MARCAR); },
  async clicar(a) {
    const j = janela(a.id);
    const { x, y } = await centro(j.wc, a);
    j.wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    j.wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    await espera(400);
    await carregou(j.wc);
    return { url: j.wc.getURL(), titulo: j.wc.getTitle() };
  },
  async digitar(a) {
    const j = janela(a.id);
    if (a.n || a.seletor) {
      const ok = await js(j.wc, `(() => { const e = document.querySelector(${JSON.stringify(alvo(a))}); if (!e) return false; e.focus(); if ('value' in e && ${a.limpar !== false}) { e.select?.(); } return true; })()`);
      if (!ok) throw new Error(`elemento não encontrado: ${alvo(a)}`);
    }
    await j.wc.insertText(String(a.texto ?? ''));
    if (a.enter) { tecla(j.wc, 'Enter'); await espera(400); await carregou(j.wc); }
    return { url: j.wc.getURL() };
  },
  async tecla(a) { const j = janela(a.id); tecla(j.wc, String(a.tecla || 'Enter')); await espera(200); return true; },
  async js(a) { const j = janela(a.id); return js(j.wc, String(a.codigo || '')); },
  async print(a) {
    const j = janela(a.id);
    const img = await j.wc.capturePage();
    fs.mkdirSync(PASTA_PRINTS, { recursive: true });
    const arq = path.join(PASTA_PRINTS, `${idDe(j)}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
    fs.writeFileSync(arq, img.toPNG());
    return { arquivo: arq };
  },
  async preset(a) {
    const j = janela(a.id);
    j.preset = presetOk(a.preset);
    await pedirTela('preset', { id: idDe(j), preset: j.preset });
    return { id: idDe(j), preset: j.preset };
  },
  async fechar(a) { const j = janela(a.id); await pedirTela('fechar', { id: idDe(j) }); return true; },
};

// --- servidor do controle --------------------------------------------------
let servidor = null;
function ligarControle() {
  const c = config.ler();
  if (c.navegadorControle === false) return;
  const chave = crypto.randomBytes(24).toString('hex');
  servidor = http.createServer((req, res) => {
    const responder = (cod, corpo) => { res.writeHead(cod, { 'content-type': 'application/json' }); res.end(JSON.stringify(corpo)); };
    const dada = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (req.method !== 'POST' || req.url !== '/acao' || dada.length !== chave.length || !crypto.timingSafeEqual(Buffer.from(dada), Buffer.from(chave))) return responder(403, { erro: 'sem permissão' });
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      let a;
      try { a = JSON.parse(corpo); } catch { return responder(400, { erro: 'JSON inválido' }); }
      const fn = Object.hasOwn(ACOES, a.acao) ? ACOES[a.acao] : null;
      if (!fn) return responder(400, { erro: `ação desconhecida: ${a.acao}`, acoes: Object.keys(ACOES) });
      try {
        // A tela mostra, ao vivo, que aquela janela está sendo controlada.
        if (!['listar', 'presets', 'abrir'].includes(a.acao)) { try { enviar('navegador:controlado', idDe(janela(a.id)), a.acao); } catch { /* erro vem abaixo */ } }
        const r = await fn(a);
        if (a.acao === 'abrir') enviar('navegador:controlado', r.id, a.acao);
        responder(200, { ok: true, r });
      } catch (e) { responder(200, { ok: false, erro: e.message }); }
    });
  });
  servidor.listen(Number(c.navegadorPorta) || 0, '127.0.0.1', () => {
    fs.mkdirSync(path.dirname(ARQ_CONTROLE), { recursive: true });
    const tmp = `${ARQ_CONTROLE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ porta: servidor.address().port, chave, pid: process.pid }) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, ARQ_CONTROLE);
  });
  servidor.on('error', () => { servidor = null; });
}
function desligarControle() {
  if (servidor) { servidor.close(); servidor = null; }
  // Só tira o arquivo se ele ainda for deste app (outro app aberto depois o
  // teria trocado).
  try { if (JSON.parse(fs.readFileSync(ARQ_CONTROLE, 'utf8')).pid === process.pid) fs.unlinkSync(ARQ_CONTROLE); } catch { /* não tem */ }
}

function ligar(fn) {
  janelaFn = fn;
  prender(fn());
  ligarControle();
}

module.exports = { ligar, desligarControle, PRESETS, ACOES, ARQ_CONTROLE };
