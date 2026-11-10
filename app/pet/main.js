// Ajudante: a janelinha do bichinho fora do app. É um processo próprio, em
// modo X11 (no Wayland um app não escolhe onde fica a própria janela), aberto
// pelo App de Orquestração (ajudante.js). Conversa com ele por linhas de JSON:
// recebe na entrada (stdin), responde na saída (stdout).
//
// Ele anda pelo "chão" da tela (o pé da área útil do monitor), entra pela
// borda quando alguém chama ou quando há pendência e sai pela borda quando vai
// embora. A janela é do tamanho dele (cresce só com a conversa aberta), para
// não tapar o que está atrás.
const { app, BrowserWindow, screen, ipcMain, clipboard } = require('electron');
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
const QUADRO = 16; // ms entre um passo e outro da janela (~60 por segundo)
let win = null;
let tam = PEQUENA;
let pos = { x: 0, y: 0 };
let timer = null;
let modo = 'escondido'; // escondido | entrando | parado | saindo
let passeando = false;
// Jeito de cada espécie (vem com a roupa). jeito: anda, voa ou pula. chega: o
// floreio ao chegar. noAr: quantos px acima do chão quem voa fica esperando.
// vel: px/s andando. pulo/passo: altura e velocidade dos pulos. desliza: chega
// e vai embora de barriga (pinguim). brota: nasce do chão e afunda nele.
const ESPECIES = {
  bicho: { jeito: 'anda', chega: 'oi' },
  gatinho: { jeito: 'anda', chega: 'espreguica', vel: 470 },
  pinguim: { jeito: 'anda', chega: 'levanta', desliza: true },
  passarinho: { jeito: 'voa', chega: 'looping', noAr: 130 },
  sapinho: { jeito: 'pula', chega: 'quica', pulo: 150, passo: 300 },
  cogumelo: { jeito: 'anda', chega: 'brota', brota: true },
  fantasma: { jeito: 'voa', chega: 'pirueta', noAr: 150 },
  nuvem: { jeito: 'voa', chega: 'rolinho', noAr: 175 },
  gosma: { jeito: 'pula', chega: 'quica', pulo: 110, passo: 250 },
};
let especie = 'bicho';
let jeito = 'anda';
const esp = () => ESPECIES[especie];
let ultimoFloreio = null;
const floreio = (tipo) => { ultimoFloreio = tipo; paraTela({ t: 'floreio', tipo }); };
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
// Onde ele espera: no chão, ou no ar (quem voa).
const parada = (a = area()) => (jeito === 'voa' ? Math.max(a.y, chao(a) - esp().noAr) : chao(a));
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
  }, QUADRO);
}

// Chegada de cada espécie, sem passar pelo monitor vizinho: a janela começa
// encostada na borda, por dentro, e o bichinho sai de trás dela.
//  - quem anda sai andando (o gatinho, trotando; o pinguim, de barriga);
//  - quem voa entra pelo alto, mergulha, sobe freando até o ponto de espera
//    no ar e dá o seu floreio (pirueta, rolinho, looping) — e fica voando ali;
//  - quem pula chega em pulos e quica ao pousar;
//  - o cogumelo não vem de lugar nenhum: brota do chão onde vai ficar.
function entrada(a, lado, destinoX, depois) {
  clearInterval(timer); timer = null;
  const e = esp();
  const borda = lado === 'dir' ? a.x + a.width - tam.w : a.x;
  const alvo = Math.min(Math.max(destinoX, a.x), a.x + a.width - tam.w);
  modo = 'entrando';
  const chegou = () => { modo = 'parado'; floreio(e.chega); if (depois) depois(); };
  if (e.brota) {
    pos = { x: alvo, y: chao(a) };
    mover();
    paraTela({ t: 'entrar', lado, estilo: 'brota' });
    floreio('brota');
    const minha = saida;
    setTimeout(() => { if (minha === saida && modo === 'entrando') { modo = 'parado'; if (depois) depois(); } }, 950);
    return;
  }
  if (jeito === 'voa') {
    const fim = parada(a);
    pos = { x: borda, y: Math.max(a.y, fim - 220) };
    mover();
    paraTela({ t: 'entrar', lado });
    const fundo = especie === 'passarinho' ? 150 : especie === 'nuvem' ? 80 : 100;
    irPara(alvo, fim, 0, chegou, { facil: 'chega', dur: especie === 'nuvem' ? 1250 : 950, curva: { x: (borda + alvo) / 2, y: Math.min(chao(a), fim + fundo) } });
    return;
  }
  pos = { x: borda, y: chao(a) };
  mover();
  paraTela({ t: 'entrar', lado });
  if (jeito === 'pula') irPara(alvo, chao(a), e.passo, chegou, { pulos: true, altura: e.pulo, larguraPulo: 150 });
  else if (e.desliza) {
    paraTela({ t: 'deslizar', ligado: true });
    irPara(alvo, chao(a), 0, () => { paraTela({ t: 'deslizar', ligado: false }); chegou(); }, { facil: 'chega', dur: 1300 });
  } else andar(alvo, e.vel || 340, chegou);
}
// Saída de cada espécie até a borda direita, e depois some atrás dela: quem
// voa sobe acelerando (o fantasma desvanece, a nuvem se desfaz), quem pula vai
// pulando, o pinguim escorrega de barriga e o cogumelo afunda no chão.
function partida(a, depois) {
  const e = esp();
  const borda = a.x + a.width - tam.w;
  if (e.brota) { floreio('afunda'); setTimeout(depois, 850); return; }
  if (jeito === 'voa') {
    if (especie === 'fantasma') floreio('desvanece');
    else if (especie === 'nuvem') floreio('dissolve');
    irPara(borda, a.y + 10, 0, depois, { facil: 'sai', dur: especie === 'nuvem' ? 1400 : 900, curva: { x: pos.x + (borda - pos.x) * 0.25, y: pos.y + 30 } });
  } else if (jeito === 'pula') irPara(borda, chao(a), e.passo, depois, { pulos: true, altura: e.pulo, larguraPulo: 150 });
  else if (e.desliza) { paraTela({ t: 'deslizar', ligado: true }); irPara(borda, chao(a), 0, depois, { facil: 'sai', dur: 1000 }); }
  else andar(borda, (e.vel || 340) + 40, depois);
}

// Cada saída tem um número: chegar de novo cancela a saída em andamento (os
// passos dela, que vêm depois, veem que perderam a vez).
let saida = 0;
// Curvas de velocidade: chega (rápido e freando), sai (devagar e acelerando),
// suave (acelera e freia).
const FACIL = {
  linear: (t) => t,
  chega: (t) => 1 - (1 - t) ** 3,
  sai: (t) => t ** 3,
  suave: (t) => 0.5 - Math.cos(Math.PI * t) / 2,
};
// Voa até (x, y), a vel px/s ou em dur ms. opc: true ou { pulos } vai em arcos
// de ~larguraPulo px (altura: quanto sobe cada pulo; a tela recebe a duração
// de cada pulo para amassar e esticar junto); { onda } ondula; { curva: {x, y} }
// faz o caminho em curva passando perto desse ponto; { facil } a curva de
// velocidade.
function irPara(x, y, vel, depois, opc = false) {
  const { pulos = false, altura = 70, onda = 0, facil = 'linear', curva = null, dur: durFixa = 0, larguraPulo = 110 } = opc === true ? { pulos: true } : (opc || {});
  clearInterval(timer);
  paraTela({ t: 'andando', ligado: true, lado: x < pos.x ? 'esq' : 'dir' });
  const ini = { x: pos.x, y: pos.y };
  const dist = Math.hypot(x - ini.x, y - ini.y);
  const dur = durFixa || Math.max(200, (dist / vel) * 1000);
  const comeco = Date.now();
  const nPulos = Math.max(1, Math.round(Math.abs(x - ini.x) / larguraPulo));
  if (pulos) paraTela({ t: 'pulos', ms: Math.round(dur / nPulos) });
  timer = setInterval(() => {
    const t = Math.min(1, (Date.now() - comeco) / dur);
    const k = pulos ? t : FACIL[facil](t);
    const u = 1 - k;
    const bx = curva ? u * u * ini.x + 2 * u * k * curva.x + k * k * x : ini.x + (x - ini.x) * k;
    const by = curva ? u * u * ini.y + 2 * u * k * curva.y + k * k * y : ini.y + (y - ini.y) * k;
    pos.x = bx;
    pos.y = by - (pulos ? Math.abs(Math.sin(Math.PI * t * nPulos)) * altura : 0)
      + (onda ? Math.sin(Math.PI * 3 * k) * onda * (1 - k) : 0);
    mover();
    if (t >= 1) {
      clearInterval(timer); timer = null;
      paraTela({ t: 'andando', ligado: false });
      if (depois) depois();
    }
  }, QUADRO);
}

function aparecer(depois) {
  if (modo === 'parado' || modo === 'entrando') { if (depois) depois(); return; }
  if (modo === 'saindo') {
    // Estava indo embora: desiste e volta andando para o meio da tela.
    saida++;
    const a = area();
    modo = 'entrando';
    paraTela({ t: 'entrar', lado: 'dir' });
    const volta = a.x + Math.round(a.width * 0.78) - tam.w;
    const fim = () => { modo = 'parado'; if (depois) depois(); };
    const e = esp();
    if (e.brota) { floreio('brota'); setTimeout(fim, 950); }
    else if (jeito === 'voa') irPara(volta, parada(a), 0, fim, { facil: 'chega', dur: 900 });
    else if (jeito === 'pula') irPara(volta, chao(a), e.passo, fim, { pulos: true, altura: e.pulo, larguraPulo: 150 });
    else if (e.desliza) { paraTela({ t: 'deslizar', ligado: false }); andar(volta, 300, fim); }
    else andar(volta, e.vel || 340, fim);
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
  entrada(a, 'dir', a.x + Math.round(a.width * 0.78) - tam.w, depois);
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
  // Vai até encostar na borda (por dentro do monitor), do jeito da espécie, e
  // some atrás dela.
  setTimeout(() => minha === saida && partida(a, () => {
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
  // Quem voa continua no ar onde estava; os outros pisam no chão.
  if (jeito !== 'voa') { pos.y = chao(); mover(); }
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
      // Voa pela tela toda (qualquer altura entre o topo e o chão), em curva.
      const y = a.y + 40 + Math.round(Math.random() * Math.max(0, chao(a) - a.y - 40));
      const dur = Math.max(900, Math.hypot(x - pos.x, y - pos.y) / 110 * 1000);
      const curva = { x: (x + pos.x) / 2 + (Math.random() - 0.5) * 200, y: Math.max(a.y, Math.min(chao(a), (y + pos.y) / 2 + (Math.random() - 0.5) * 200)) };
      await new Promise((r) => irPara(x, y, 0, r, { facil: 'suave', dur, curva }));
    } else if (jeito === 'pula') await new Promise((r) => irPara(x, chao(a), esp().passo * 0.6, r, { pulos: true, altura: Math.round(esp().pulo * 0.55) }));
    else await new Promise((r) => andar(x, especie === 'gatinho' ? 110 : especie === 'pinguim' ? 55 : 70, r));
    if (Math.random() < 0.3) paraTela({ t: 'gesto' });
  }
}

function receber(m) {
  if (m.t === 'visual') {
    especie = ESPECIES[m.visual && m.visual.especie] ? m.visual.especie : 'bicho';
    jeito = esp().jeito;
    paraTela(m);
    if (modo === 'parado' && !conversaAberta) { pos.y = parada(); mover(); }
  }
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
  else if (m.t === 'estado') paraApp({ t: 'estado', modo, conversaAberta, tam, passeando, especie, floreio: ultimoFloreio, chao: Math.round(chao()), pos: { x: Math.round(pos.x), y: Math.round(pos.y) }, janela: win.getBounds(), visivel: win.isVisible() });
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
  entrada(a, para < de ? 'dir' : 'esq', volta, () => { if (!aviso && Math.random() < 0.6) paraTela({ t: 'falar', texto: sorteia(['Cheguei!', 'Te achei!', 'Esperei por você!', 'Opa, mudou de mesa?']) }); });
}

ipcMain.on('ajudante', (_e, m) => {
  if (m.t === 'pronto') { pronto = true; for (const x of fila.splice(0)) win.webContents.send('ajudante', x); }
  else if (m.t === 'abrirConversa') abrirConversa();
  else if (m.t === 'fecharConversa') fecharConversa();
  else if (m.t === 'avisoFechado') aviso = false;
  else if (m.t === 'perguntar' || m.t === 'responder') paraApp(m);
  else if (m.t === 'copiar') clipboard.writeText(String(m.texto || ''));
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
