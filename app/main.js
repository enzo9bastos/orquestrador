// App de Orquestração — processo principal (Electron).
//
// Casca por cima do tmux e do orq: os agentes continuam vivendo no tmux, dentro
// dos devcontainers. Fechar o app não derruba nada. O orquestrador também roda
// numa sessão tmux própria ("orquestrador"), então sobrevive ao app.
const { app, BrowserWindow, ipcMain, Notification, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const pty = require('node-pty');
const coletor = require('./coletor');
const conversa = require('./conversa');
const notas = require('./notas');

// Aba "Terminal": um shell de reserva. O orquestrador agora é a conversa
// (conversa.js), sem tela de terminal.
const ORQUESTRADOR = process.env.ORQ_APP_ORQUESTRADOR || 'exec bash';

let janela;
const avisados = new Set();

function criarJanela() {
  janela = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 900,
    minHeight: 680,
    title: 'Orquestração',
    icon: path.join(__dirname, 'icone', 'orquestracao-256.png'),
    backgroundColor: '#101114',
    // Sem a barra do sistema: o topo do app faz o papel dela (arrastar,
    // minimizar, maximizar, fechar), como os apps que desenham a própria barra.
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  janela.setMenuBarVisibility(false);
  janela.loadFile(path.join(__dirname, 'tela', 'index.html'));
  janela.on('closed', () => { janela = null; });
  janela.on('maximize', () => janela.webContents.send('janela:maximizada', true));
  janela.on('unmaximize', () => janela.webContents.send('janela:maximizada', false));
  // Link clicado na conversa nunca troca a página do app.
  janela.webContents.on('will-navigate', (e) => e.preventDefault());
  janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Ajuste em tempo real: salvar qualquer arquivo da tela recarrega a janela.
  // O terminal do orquestrador vive aqui no processo principal e não cai.
  let espera;
  fs.watch(path.join(__dirname, 'tela'), () => {
    clearTimeout(espera);
    espera = setTimeout(() => janela && janela.webContents.reload(), 150);
  });
  // Teste: ORQ_APP_PRINT=/caminho/base grava um PNG da janela a cada 8 s.
  if (process.env.ORQ_APP_PRINT) {
    let n = 0;
    setInterval(async () => {
      if (!janela) return;
      const img = await janela.webContents.capturePage();
      require('fs').writeFileSync(`${process.env.ORQ_APP_PRINT}-${++n}.png`, img.toPNG());
    }, 8000);
  }
}

// --- terminais de reserva (até 4) ---------------------------------------
// Cada terminal é um shell próprio, guardado aqui no processo principal: a tela
// recarregar não derruba nenhum, e ao voltar ela recebe o que já passou.
const MAX_TERMINAIS = 4;
const terminais = new Map(); // id → { pty, historico, sessao }
const enviar = (canal, ...a) => janela && janela.webContents.send(canal, ...a);

ipcMain.handle('pty:lista', () => [...terminais].map(([id, t]) => ({ id, sessao: t.sessao })));
// sessao: nome de uma sessão tmux de agente para anexar (o "Abrir terminal" da
// frente), em vez de um shell novo. ignore-size: não encolhe as outras telas.
ipcMain.handle('pty:abrir', (_e, id, cols, rows, sessao) => {
  const t = terminais.get(id);
  if (t) {
    enviar('pty:dados', id, t.historico);
    try { t.pty.resize(cols, rows); } catch { /* fechou */ }
    return true;
  }
  if (terminais.size >= MAX_TERMINAIS || !/^t\d+$/.test(id)) return false;
  if (sessao && !/^[\w.-]+$/.test(sessao)) return false;
  const comando = sessao ? `exec tmux attach -f ignore-size -t '${sessao}'` : ORQUESTRADOR;
  // Shell de login: o PATH do app aberto pelo menu não tem ~/.local/bin.
  const p = pty.spawn('bash', ['-lc', comando], {
    name: 'xterm-256color', cols, rows, cwd: os.homedir(), env: conversa.ambienteLimpo(),
  });
  const novo = { pty: p, historico: '', sessao: sessao || null };
  terminais.set(id, novo);
  p.onData((d) => {
    novo.historico = (novo.historico + d).slice(-200000);
    enviar('pty:dados', id, d);
  });
  p.onExit(() => { terminais.delete(id); enviar('pty:saiu', id); });
  return true;
});
ipcMain.on('pty:escrever', (_e, id, d) => { const t = terminais.get(id); if (t) t.pty.write(d); });
ipcMain.on('pty:tamanho', (_e, id, c, r) => { try { terminais.get(id).pty.resize(c, r); } catch { /* fechou */ } });
ipcMain.handle('pty:fechar', (_e, id) => { const t = terminais.get(id); if (t) t.pty.kill(); return true; });

// --- janela sem moldura: os botões do topo ---------------------------------
ipcMain.on('janela:minimizar', () => janela && janela.minimize());
ipcMain.on('janela:maximizar', () => { if (janela) janela.isMaximized() ? janela.unmaximize() : janela.maximize(); });
// Fechar = sair do app de vez, como o /exit do terminal: encerra as conversas
// (a próxima abertura começa do zero) e os terminais.
ipcMain.on('janela:fechar', () => app.quit());

// --- editor de notas ------------------------------------------------------
ipcMain.handle('notas:pastas', () => notas.pastas());
ipcMain.handle('notas:adicionarPasta', async () => {
  const r = await dialog.showOpenDialog(janela, { title: 'Abrir pasta de notas', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return notas.adicionarPasta(r.filePaths[0]);
});
ipcMain.handle('notas:removerPasta', (_e, i) => notas.removerPasta(i));
ipcMain.handle('notas:renomear', (_e, i, rel, nome) => notas.renomear(i, rel, nome));
ipcMain.handle('notas:caminho', (_e, i, rel) => notas.caminho(i, rel));
// Mostrar no gerenciador de arquivos (pasta abre; arquivo aparece selecionado).
ipcMain.handle('notas:revelar', (_e, i, rel) => {
  const abs = notas.caminho(i, rel);
  if (rel && rel.toLowerCase().endsWith('.md')) shell.showItemInFolder(abs); else shell.openPath(abs);
  return true;
});
ipcMain.handle('notas:arvore', (_e, i) => notas.arvore(i));
ipcMain.handle('notas:ler', (_e, i, rel) => notas.ler(i, rel));
ipcMain.handle('notas:gravar', (_e, i, rel, conteudo, mtime) => notas.gravar(i, rel, conteudo, mtime));
ipcMain.handle('notas:guardarCopia', (_e, i, rel, texto) => notas.guardarCopia(i, rel, texto));
ipcMain.handle('notas:criarPasta', (_e, i, pai, nome) => notas.criarPasta(i, pai, nome));
ipcMain.handle('notas:criar', (_e, i, pasta, nome) => notas.criar(i, pasta, nome));
ipcMain.handle('notas:vigiar', (_e, i, rel) => notas.vigiar(i, rel, (m) => janela && janela.webContents.send('notas:mudou', m)));

// --- conversas (orquestrador e avulsas) -----------------------------------
conversa.ligar((canal, dado) => enviar(canal, dado));
ipcMain.handle('conversa:lista', () => conversa.lista());
ipcMain.handle('conversa:abrir', (_e, id) => conversa.abrir(id));
ipcMain.handle('conversa:mandar', (_e, id, texto) => typeof texto === 'string' && texto.trim() && conversa.mandar(id, texto));
ipcMain.handle('conversa:responder', (_e, id, reqId, decisao) => conversa.responder(id, reqId, decisao));
ipcMain.handle('conversa:interromper', (_e, id) => conversa.interromper(id));
ipcMain.handle('conversa:configurar', (_e, id, o) => conversa.configurar(id, o));
ipcMain.handle('conversa:reiniciar', (_e, id) => conversa.reiniciar(id));
ipcMain.handle('conversa:nova', () => conversa.nova());
ipcMain.handle('conversa:fechar', (_e, id) => conversa.fechar(id));

// --- configurações --------------------------------------------------------
const config = require('./config');
// A tela só lê o que precisa para desenhar; grava só a aparência.
ipcMain.handle('config:ler', () => {
  const c = config.ler();
  return { tema: c.tema, destaque: c.destaque, comandoInicial: c.comandoInicial, comandoDesligar: c.comandoDesligar, comandoOrdem: c.comandoOrdem, temNotas: !!c.pastaNotas };
});
ipcMain.handle('config:gravar', (_e, mudancas) => {
  const m = {};
  if (['dark', 'light'].includes(mudancas.tema)) m.tema = mudancas.tema;
  if (/^#[0-9a-f]{6}$/i.test(mudancas.destaque || '')) m.destaque = mudancas.destaque.toLowerCase();
  const c = config.gravar(m);
  return { tema: c.tema, destaque: c.destaque };
});

// --- dados ---------------------------------------------------------------
ipcMain.handle('estado', () => {
  const r = coletor.estado();
  avisarNovidades(r);
  return r;
});
ipcMain.handle('espelho', (_e, pane) => coletor.espelho(pane));
ipcMain.handle('anotacoes', () => coletor.anotacoes());
ipcMain.handle('ler-nota', (_e, qual) => coletor.lerNota(qual));
ipcMain.handle('responder', (_e, emp, proj, id, decisao) => coletor.responder(emp, proj, id, decisao));

// Abre o terminal de verdade de uma frente numa janela do sistema, como o
// `orq tv` faz. ignore-size: anexar não encolhe as janelas que já estão abertas.
ipcMain.handle('abrir-terminal', (_e, sessao) => {
  if (!/^[\w.-]+$/.test(sessao)) return false;
  for (const t of ['gnome-terminal', 'kgx', 'x-terminal-emulator', 'xterm']) {
    try {
      const p = spawn(t, ['--', 'tmux', 'attach', '-f', 'ignore-size', '-t', sessao], { detached: true, stdio: 'ignore' });
      p.on('error', () => {});
      p.unref();
      return true;
    } catch { /* tenta o próximo */ }
  }
  return false;
});
ipcMain.handle('abrir-pasta', (_e, dir) => dir.startsWith(coletor.raiz()) && shell.openPath(dir));

// Notificação do sistema quando algo novo precisa do usuário (substitui o apito
// de aviso do terminal enquanto o app estiver aberto).
function avisarNovidades(r) {
  for (const p of r.fila) {
    const chave = `${p.tipo}:${p.proj}:${p.id}`;
    if (avisados.has(chave)) continue;
    avisados.add(chave);
    const corpo = p.tipo === 'permissao'
      ? `${p.proj} quer usar ${p.ferramenta}`
      : `${p.proj} deixou um pedido ao servidor`;
    if (Notification.isSupported()) new Notification({ title: 'Precisa de você', body: corpo, urgency: 'critical' }).show();
  }
}

app.whenReady().then(() => {
  criarJanela();
  // Sinal de vida a cada 3 s: o hook só espera resposta do app se este
  // arquivo foi tocado há menos de 15 s.
  setInterval(() => coletor.sinalDeVida(), 3000);
  coletor.sinalDeVida();
});
function encerrarTudo() {
  for (const t of terminais.values()) { try { t.pty.kill(); } catch { /* já saiu */ } }
  terminais.clear();
  conversa.encerrarTodas();
}
app.on('before-quit', encerrarTudo);
app.on('window-all-closed', () => { encerrarTudo(); app.quit(); });
