// Ajudante: a janelinha do bichinho fora do app. É um processo próprio, em
// modo X11 (no Wayland um app não escolhe onde fica a própria janela), aberto
// pelo App de Orquestração (ajudante.js). Conversa com ele por linhas de JSON:
// recebe na entrada (stdin), responde na saída (stdout).
//
// Ele anda pelo "chão" da tela (o pé da área útil do monitor), entra pela
// borda quando alguém chama ou quando há pendência e sai pela borda quando vai
// embora. A janela é do tamanho dele (cresce só com a conversa aberta), para
// não tapar o que está atrás.
const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { spawn, execFileSync } = require('child_process');

app.commandLine.appendSwitch('enable-transparent-visuals');
app.commandLine.appendSwitch('ozone-platform', 'x11');
app.disableHardwareAcceleration(); // transparência confiável no X11 e mais leve
app.setName('orq-ajudante');
app.setPath('userData', path.join(os.homedir(), '.cache', 'orq-app', 'ajudante-perfil'));

const TESTE = process.env.ORQ_PET_TESTE === '1';
const PEQUENA = { w: 280, h: 200 };
const GRANDE = { w: 420, h: 480 };
let win = null;
let tam = PEQUENA;
let pos = { x: 0, y: 0 };
let timer = null;
let modo = 'escondido'; // escondido | entrando | parado | saindo
let passeando = false;
// Jeito de se mexer da espécie (vem com a roupa): anda, voa (fantasma, nuvem) ou pula (gosma).
let jeito = 'anda';
const JEITOS = { fantasma: 'voa', nuvem: 'voa', gosma: 'pula' };
let conversaAberta = false;
let fila = []; // mensagens que chegaram antes da tela ficar pronta
let pronto = false;

const paraApp = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const paraTela = (m) => { if (pronto && win) win.webContents.send('ajudante', m); else fila.push(m); };

function area() {
  const d = win && modo !== 'escondido'
    ? screen.getDisplayNearestPoint({ x: Math.round(pos.x + tam.w / 2), y: Math.round(pos.y + tam.h / 2) })
    : screen.getPrimaryDisplay();
  return d.workArea;
}
const chao = (a = area()) => a.y + a.height - tam.h;
function mover() { if (win) win.setBounds({ x: Math.round(pos.x), y: Math.round(pos.y), width: tam.w, height: tam.h }); }

// Anda até x (canto esquerdo da janela). vel em px/s.
function andar(x, vel, depois) {
  clearInterval(timer);
  paraTela({ t: 'andando', ligado: true, lado: x < pos.x ? 'esq' : 'dir' });
  let ultimo = Date.now();
  timer = setInterval(() => {
    const agora = Date.now();
    const passo = vel * (agora - ultimo) / 1000; ultimo = agora;
    const dx = x - pos.x;
    if (Math.abs(dx) <= passo) {
      pos.x = x; mover();
      clearInterval(timer); timer = null;
      paraTela({ t: 'andando', ligado: false });
      if (depois) depois();
      return;
    }
    pos.x += Math.sign(dx) * passo;
    mover();
  }, 33);
}

// Entra pela borda do monitor sem passar pelo monitor vizinho: a janela
// começa encostada na borda, por dentro, e o bichinho sai de trás da borda
// (deslizando dentro da janela) enquanto a janela anda até o destino.
function entrarPelaBorda(a, lado, destinoX, depois) {
  clearInterval(timer); timer = null;
  pos = { x: lado === 'dir' ? a.x + a.width - tam.w : a.x, y: chao(a) };
  mover();
  modo = 'entrando';
  paraTela({ t: 'entrar', lado });
  andar(Math.min(Math.max(destinoX, a.x), a.x + a.width - tam.w), 320, () => { modo = 'parado'; if (depois) depois(); });
}

// Cada saída tem um número: chegar de novo cancela a saída em andamento (os
// passos dela, que vêm depois, veem que perderam a vez).
let saida = 0;
// Voa em linha reta até (x, y). Pulando: vai em arcos de ~110 px.
function irPara(x, y, vel, depois, pulos = false) {
  clearInterval(timer);
  paraTela({ t: 'andando', ligado: true, lado: x < pos.x ? 'esq' : 'dir' });
  const ini = { x: pos.x, y: pos.y };
  const dist = Math.hypot(x - ini.x, y - ini.y);
  const dur = Math.max(200, (dist / vel) * 1000);
  const comeco = Date.now();
  const nPulos = Math.max(1, Math.round(Math.abs(x - ini.x) / 110));
  timer = setInterval(() => {
    const t = Math.min(1, (Date.now() - comeco) / dur);
    pos.x = ini.x + (x - ini.x) * t;
    pos.y = ini.y + (y - ini.y) * t - (pulos ? Math.abs(Math.sin(Math.PI * t * nPulos)) * 70 : 0);
    mover();
    if (t >= 1) {
      clearInterval(timer); timer = null;
      paraTela({ t: 'andando', ligado: false });
      if (depois) depois();
    }
  }, 33);
}

function aparecer(depois) {
  if (modo === 'parado' || modo === 'entrando') { if (depois) depois(); return; }
  if (modo === 'saindo') {
    // Estava indo embora: desiste e volta andando para o meio da tela.
    saida++;
    const a = area();
    modo = 'entrando';
    paraTela({ t: 'entrar', lado: 'dir' });
    andar(a.x + Math.round(a.width * 0.78) - tam.w, 320, () => { modo = 'parado'; if (depois) depois(); });
    return;
  }
  saida++;
  const a = screen.getPrimaryDisplay().workArea;
  if (!TESTE) win.showInactive();
  win.setAlwaysOnTop(true, 'screen-saver');
  // Depois de mostrar (antes disso o X11 ignora): todas as áreas de trabalho e
  // fora da visão geral, do Alt+Tab e do dock — ele não é uma "janela aberta".
  win.setVisibleOnAllWorkspaces(true);
  win.setSkipTaskbar(true);
  paraApp({ t: 'visivel', visivel: true });
  entrarPelaBorda(a, 'dir', a.x + Math.round(a.width * 0.78) - tam.w, depois);
}

function sumir() {
  passeando = false;
  aviso = false;
  if (modo === 'escondido') return;
  fecharConversa();
  modo = 'saindo';
  const minha = ++saida;
  paraTela({ t: 'tchau' });
  const a = area();
  // Anda até encostar na borda (por dentro do monitor) e some atrás dela.
  setTimeout(() => minha === saida && andar(a.x + a.width - tam.w, 360, () => {
    if (minha !== saida) return;
    paraTela({ t: 'sair', lado: 'dir' });
    setTimeout(() => {
      if (minha !== saida) return;
      modo = 'escondido';
      win.hide();
      paraApp({ t: 'visivel', visivel: false });
    }, 480);
  }), 500);
}

// A conversa cresce para a esquerda e para cima, com o bichinho no mesmo lugar.
function redimensionar(novo) {
  pos.x += tam.w - novo.w;
  pos.y += tam.h - novo.h;
  tam = novo;
  const a = area();
  pos.x = Math.min(Math.max(pos.x, a.x), a.x + a.width - tam.w);
  pos.y = Math.max(Math.min(pos.y, chao(a)), a.y); // voando alto, a conversa não sai pelo topo
  mover();
}
function abrirConversa() {
  if (conversaAberta) return;
  conversaAberta = true;
  clearInterval(timer);
  redimensionar(GRANDE);
  win.setFocusable(true);
  win.focus();
}
function fecharConversa() {
  if (!conversaAberta) return;
  conversaAberta = false;
  redimensionar(PEQUENA);
  pos.y = chao(); mover();
}

// Passeio: na tela e livre (sem conversa aberta nem aviso esperando), ele
// anda de um lado para o outro do monitor sozinho.
let aviso = false;
async function passear() {
  if (passeando) return;
  passeando = true;
  let primeiro = true;
  while (passeando && modo !== 'escondido') {
    await new Promise((r) => setTimeout(r, primeiro ? 1500 + Math.random() * 2500 : 3000 + Math.random() * 5000));
    primeiro = false;
    if (!passeando || conversaAberta || aviso || timer || modo !== 'parado') continue;
    const a = area();
    const x = a.x + Math.round(Math.random() * (a.width - tam.w));
    if (jeito === 'voa') {
      // Voa pela tela toda: qualquer altura entre o topo e o chão.
      const y = a.y + 40 + Math.round(Math.random() * Math.max(0, chao(a) - a.y - 40));
      await new Promise((r) => irPara(x, y, 90, r));
    } else if (jeito === 'pula') await new Promise((r) => irPara(x, chao(a), 150, r, true));
    else await new Promise((r) => andar(x, 70, r));
    if (Math.random() < 0.3) paraTela({ t: 'gesto' });
  }
}

function receber(m) {
  if (m.t === 'visual') { jeito = JEITOS[m.visual && m.visual.especie] || 'anda'; paraTela(m); if (jeito !== 'voa' && modo === 'parado' && !conversaAberta) { pos.y = chao(); mover(); } }
  // O atalho alterna: com a conversa aberta, apertar de novo manda ele embora.
  else if (m.t === 'chamar' && conversaAberta && !m.capturar) sumir();
  else if (m.t === 'chamar') aparecer(() => { abrirConversa(); paraTela({ t: 'conversar', capturar: !!m.capturar }); passear(); });
  else if (m.t === 'resolvida') { if (aviso) { aviso = false; paraTela({ t: 'falar', texto: 'Já foi resolvido! 👍' }); setTimeout(() => { if (!conversaAberta) sumir(); }, 1600); } }
  else if (m.t === 'pendencia') { aviso = true; aparecer(() => { paraTela({ t: 'pendencia', texto: m.texto, total: m.total, conversa: m.conversa || null, id: m.id || null, item: m.item || null }); passear(); }); }
  else if (m.t === 'passear') aparecer(() => { paraTela({ t: 'falar', texto: 'Vou dar uma volta!' }); passear(); });
  else if (m.t === 'sumir') sumir();
  else if (m.t === 'pensando' || m.t === 'resposta' || m.t === 'respondido') paraTela(m);
  else if (m.t === 'imagem') { if (!TESTE && modo !== 'escondido') { win.showInactive(); win.setSkipTaskbar(true); win.setVisibleOnAllWorkspaces(true); } win.focus(); paraTela(m); }
  else if (m.t === 'trocarArea' && TESTE) trocouArea(m.de, m.para);
  else if (m.t === 'js' && TESTE) win.webContents.executeJavaScript(m.codigo).then((r) => paraApp({ t: 'js', r }), (e) => paraApp({ t: 'js', erro: String(e) }));
  else if (m.t === 'estado') paraApp({ t: 'estado', modo, conversaAberta, tam, passeando, pos: { x: Math.round(pos.x), y: Math.round(pos.y) }, janela: win.getBounds(), visivel: win.isVisible() });
  else if (m.t === 'print-tela' && TESTE) win.webContents.capturePage().then((img) => paraApp({ t: 'print', png: img.toPNG().toString('base64') }));
}

// Áreas de trabalho: o xprop avisa cada troca. Ele está em todas; ao trocar,
// chega andando pelo lado de onde você "veio" (área de número menor: entra
// pela direita, como se a tela tivesse andado para a esquerda).
let areaAtual = null;
const sorteia = (l) => l[Math.floor(Math.random() * l.length)];
function vigiarAreas() {
  if (TESTE) return;
  let p;
  try { p = spawn('xprop', ['-spy', '-root', '_NET_CURRENT_DESKTOP'], { stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return; }
  p.on('error', () => {});
  app.on('will-quit', () => { try { p.kill(); } catch { /* já saiu */ } });
  readline.createInterface({ input: p.stdout }).on('line', (l) => {
    const n = Number((l.match(/=\s*(\d+)/) || [])[1]);
    if (!Number.isFinite(n)) return;
    if (areaAtual !== null && n !== areaAtual) trocouArea(areaAtual, n);
    areaAtual = n;
  });
}
// No GNOME, por padrão, só o monitor principal troca de área de trabalho; os
// outros ficam iguais em todas. Lido uma vez ao abrir.
let soNoPrincipal = true;
try { soNoPrincipal = execFileSync('gsettings', ['get', 'org.gnome.mutter', 'workspaces-only-on-primary'], { encoding: 'utf8' }).trim() !== 'false'; } catch { /* sem GNOME: trata como padrão */ }
function trocouArea(de, para) {
  if (!win || modo === 'escondido') return;
  win.setVisibleOnAllWorkspaces(true);
  if (conversaAberta || modo === 'saindo') return; // com a conversa aberta, fica onde está
  const d = screen.getDisplayNearestPoint({ x: Math.round(pos.x + tam.w / 2), y: Math.round(pos.y + tam.h / 2) });
  if (soNoPrincipal && d.id !== screen.getPrimaryDisplay().id) return; // monitor que não trocou: fica
  const a = d.workArea;
  const volta = pos.x;
  // Com aviso ou pergunta esperando, chega quieto (não atropela o aviso).
  entrarPelaBorda(a, para < de ? 'dir' : 'esq', volta, () => { if (!aviso && Math.random() < 0.6) paraTela({ t: 'falar', texto: sorteia(['Cheguei!', 'Te achei!', 'Esperei por você!', 'Opa, mudou de mesa?']) }); });
}

ipcMain.on('ajudante', (_e, m) => {
  if (m.t === 'pronto') { pronto = true; for (const x of fila.splice(0)) win.webContents.send('ajudante', x); }
  else if (m.t === 'abrirConversa') abrirConversa();
  else if (m.t === 'fecharConversa') fecharConversa();
  else if (m.t === 'avisoFechado') aviso = false;
  else if (m.t === 'perguntar' || m.t === 'responder') paraApp(m);
  else if (m.t === 'capturar') { if (!TESTE) win.hide(); setTimeout(() => paraApp({ t: 'capturar' }), 250); }
  else if (m.t === 'abrirApp') paraApp(m);
  else if (m.t === 'voltar') { sumir(); paraApp({ t: 'voltar' }); }
  else if (m.t === 'irEmbora') sumir();
  else if (m.t === 'passear') { paraTela({ t: 'falar', texto: 'Oba, passeio!' }); passear(); }
  else if (m.t === 'arrastar') { clearInterval(timer); timer = null; pos.x += m.dx; pos.y += m.dy; mover(); }
  else if (m.t === 'soltar' && jeito === 'voa') paraTela({ t: 'pousou' }); // quem voa fica no ar onde foi solto
  else if (m.t === 'soltar') {
    // Cai até o chão do monitor onde foi solto.
    const fim = chao();
    const cair = setInterval(() => { pos.y = Math.min(fim, pos.y + 40); mover(); if (pos.y >= fim) { clearInterval(cair); paraTela({ t: 'pousou' }); } }, 16);
  }
});

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: tam.w, height: tam.h, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    // Tipo "barra de ferramentas": o GNOME deixa fora da visão geral, do
    // Alt+Tab e do dock (o skipTaskbar sozinho o Electron não aplica no X11).
    skipTaskbar: true, hasShadow: false, alwaysOnTop: true, focusable: true, type: 'toolbar',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.setVisibleOnAllWorkspaces(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'janela.html'));
  readline.createInterface({ input: process.stdin }).on('line', (l) => { let m; try { m = JSON.parse(l); } catch { return; } receber(m); });
  process.stdin.on('end', () => app.quit()); // o app fechou
  vigiarAreas();
  paraApp({ t: 'iniciado' });
});
app.on('window-all-closed', () => app.quit());
