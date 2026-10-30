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

function aparecer(depois) {
  if (modo === 'parado' || modo === 'entrando') { if (depois) depois(); return; }
  const a = screen.getPrimaryDisplay().workArea;
  pos = { x: a.x + a.width, y: chao(a) };
  modo = 'entrando';
  mover();
  if (!TESTE) win.showInactive();
  win.setAlwaysOnTop(true, 'screen-saver');
  paraApp({ t: 'visivel', visivel: true });
  andar(a.x + Math.round(a.width * 0.78) - tam.w, 320, () => { modo = 'parado'; if (depois) depois(); });
}

function sumir() {
  passeando = false;
  if (modo === 'escondido') return;
  fecharConversa();
  modo = 'saindo';
  paraTela({ t: 'tchau' });
  const a = area();
  setTimeout(() => andar(a.x + a.width + 10, 360, () => {
    modo = 'escondido';
    win.hide();
    paraApp({ t: 'visivel', visivel: false });
  }), 500);
}

// A conversa cresce para a esquerda e para cima, com o bichinho no mesmo lugar.
function redimensionar(novo) {
  pos.x += tam.w - novo.w;
  pos.y += tam.h - novo.h;
  tam = novo;
  const a = area();
  pos.x = Math.min(Math.max(pos.x, a.x), a.x + a.width - tam.w);
  pos.y = Math.min(pos.y, chao(a));
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

// Passeio: anda de um lado para o outro do monitor até alguém chamar.
async function passear() {
  passeando = true;
  while (passeando && modo !== 'escondido') {
    await new Promise((r) => setTimeout(r, 4000 + Math.random() * 6000));
    if (!passeando || conversaAberta || timer || modo !== 'parado') continue;
    const a = area();
    const x = a.x + Math.round(Math.random() * (a.width - tam.w));
    await new Promise((r) => andar(x, 70, r));
    if (Math.random() < 0.3) paraTela({ t: 'gesto' });
  }
}

function receber(m) {
  if (m.t === 'visual') paraTela(m);
  else if (m.t === 'chamar') aparecer(() => { abrirConversa(); paraTela({ t: 'conversar', capturar: !!m.capturar }); });
  else if (m.t === 'pendencia') aparecer(() => paraTela({ t: 'pendencia', texto: m.texto, total: m.total }));
  else if (m.t === 'passear') aparecer(() => { paraTela({ t: 'falar', texto: 'Vou dar uma volta!' }); passear(); });
  else if (m.t === 'sumir') sumir();
  else if (m.t === 'pensando' || m.t === 'resposta') paraTela(m);
  else if (m.t === 'imagem') { if (!TESTE && modo !== 'escondido') win.showInactive(); win.focus(); paraTela(m); }
  else if (m.t === 'estado') paraApp({ t: 'estado', modo, conversaAberta, tam, passeando });
  else if (m.t === 'print-tela' && TESTE) win.webContents.capturePage().then((img) => paraApp({ t: 'print', png: img.toPNG().toString('base64') }));
}

ipcMain.on('ajudante', (_e, m) => {
  if (m.t === 'pronto') { pronto = true; for (const x of fila.splice(0)) win.webContents.send('ajudante', x); }
  else if (m.t === 'abrirConversa') abrirConversa();
  else if (m.t === 'fecharConversa') fecharConversa();
  else if (m.t === 'perguntar') paraApp(m);
  else if (m.t === 'capturar') { if (!TESTE) win.hide(); setTimeout(() => paraApp({ t: 'capturar' }), 250); }
  else if (m.t === 'abrirApp') paraApp(m);
  else if (m.t === 'voltar') { sumir(); paraApp({ t: 'voltar' }); }
  else if (m.t === 'irEmbora') sumir();
  else if (m.t === 'passear') { paraTela({ t: 'falar', texto: 'Oba, passeio!' }); passear(); }
  else if (m.t === 'arrastar') { clearInterval(timer); timer = null; pos.x += m.dx; pos.y += m.dy; mover(); }
  else if (m.t === 'soltar') {
    // Cai até o chão do monitor onde foi solto.
    const fim = chao();
    const cair = setInterval(() => { pos.y = Math.min(fim, pos.y + 40); mover(); if (pos.y >= fim) { clearInterval(cair); paraTela({ t: 'pousou' }); } }, 16);
  }
});

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: tam.w, height: tam.h, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, alwaysOnTop: true, type: 'toolbar', focusable: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.setVisibleOnAllWorkspaces(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'janela.html'));
  readline.createInterface({ input: process.stdin }).on('line', (l) => { let m; try { m = JSON.parse(l); } catch { return; } receber(m); });
  process.stdin.on('end', () => app.quit()); // o app fechou
  paraApp({ t: 'iniciado' });
});
app.on('window-all-closed', () => app.quit());
