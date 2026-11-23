// Liga o modo reunião (reuniao.js) ao Electron: a janela escondida que tira os prints, as peças
// de verdade (reuniao-pecas.js, transcricao.js), a tela do app e o bichinho.
//
// IPC (só a tela do app chama): reuniao:estado, reuniao:comecar, reuniao:print, reuniao:marcar,
// reuniao:terminar, reuniao:abrir, reuniao:voz (motor, modelos e recomendações para as Configurações).
// Eventos para a tela: 'reuniao:mudou' (estado). O bichinho recebe { t: 'reuniao', ... }.
const path = require('path');
const { BrowserWindow, desktopCapturer, ipcMain, shell, Notification } = require('electron');
const reuniao = require('./reuniao');
const pecas = require('./reuniao-pecas');
const transcricao = require('./transcricao');

function ligar({ config, comandoClaude, ambiente, enviarTela, avisarBichinho, emTeste = false }) {
  // --- prints: janela escondida que segura a imagem da tela ---------------------------
  let janela = null;
  let esperando = new Map();
  let n = 0;
  const pedir = (m, ms = 60000) => new Promise((ok) => {
    const id = ++n;
    const t = setTimeout(() => { esperando.delete(id); ok({ erro: 'a captura não respondeu' }); }, ms);
    esperando.set(id, (r) => { clearTimeout(t); ok(r); });
    janela.webContents.send('captura', { ...m, id });
  });
  ipcMain.on('captura:r', (e, m) => {
    if (!janela || e.sender !== janela.webContents || !m) return;
    if (m.t === 'acabou') { r.printsDesligados('o compartilhamento da tela foi encerrado'); return; }
    const f = esperando.get(m.id);
    if (f) { esperando.delete(m.id); f(m); }
  });
  async function abrirCaptura() {
    if (janela) return { ok: true };
    janela = new BrowserWindow({ show: false, width: 320, height: 200, webPreferences: { preload: path.join(__dirname, 'voz', 'captura-preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, partition: 'captura-reuniao' } });
    // A tela inteira. No Wayland, o pedido passa pelo sistema, que mostra a escolha uma vez.
    janela.webContents.session.setDisplayMediaRequestHandler((_req, cb) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((s) => cb(s.length ? { video: s[0] } : {})).catch(() => cb({}));
    });
    await janela.loadFile(path.join(__dirname, 'voz', 'captura.html'));
    const res = await pedir({ t: 'iniciar' }, 120000);
    if (res.erro) { fecharCaptura(); return { erro: res.erro }; }
    return { ok: true };
  }
  function fecharCaptura() {
    if (!janela) return;
    try { janela.webContents.send('captura', { t: 'parar' }); } catch { /* já fechou */ }
    const j = janela;
    janela = null;
    for (const f of esperando.values()) f({ erro: 'a captura foi fechada' });
    esperando = new Map();
    setTimeout(() => { try { j.destroy(); } catch { /* já fechou */ } }, 200);
  }
  async function capturar(arquivo) {
    if (!janela) { const a = await abrirCaptura(); if (a.erro) throw new Error(`sem permissão para ver a tela: ${a.erro}`); }
    const res = await pedir({ t: 'print' });
    if (res.erro) throw new Error(res.erro);
    require('fs').writeFileSync(arquivo, Buffer.from(res.png), { flag: 'wx' });
  }

  // --- resumo: o escolhido nas Configurações, ou o recomendado para o computador ------------
  let recomendacao = null;
  async function qualResumo() {
    const c = config.ler();
    if (c.reuniaoResumo) return c.reuniaoResumo;
    if (!recomendacao) recomendacao = await pecas.recomendacaoResumo(transcricao.maquina());
    return recomendacao.recomendado;
  }
  async function resumir(texto, o) {
    const qual = await qualResumo();
    if (qual === 'nenhum') return null;
    if (qual === 'local') return pecas.resumirLocal(texto, { ...o, modelo: config.ler().reuniaoModeloLocal });
    return pecas.resumirClaude(texto, { ...o, comando: comandoClaude(), env: ambiente() });
  }
  const modelo = () => config.ler().vozModelo || transcricao.recomendado();

  const r = reuniao.criar({
    base: () => config.ler().reunioesPasta,
    gravar: (trilha, arquivo) => pecas.gravar(trilha, arquivo),
    capturar,
    transcrever: (arquivo, o) => transcricao.transcrever(arquivo, { ...o, modelo: modelo(), escolhido: config.ler().vozPython }),
    resumir,
    aoMudar: (e) => {
      enviarTela('reuniao:mudou', e);
      avisarBichinho(e);
      if (e.evento === 'pronta' && Notification.isSupported() && !emTeste) {
        try { new Notification({ title: 'Nota da reunião pronta', body: e.assunto || 'Reunião' }).show(); } catch { /* sem notificações */ }
      }
    },
  });

  // As ações, iguais para a tela do app e para o bichinho.
  async function comecar(titulo) {
    const est = await r.comecar({ titulo: typeof titulo === 'string' ? titulo : '' });
    // Os prints pedem a tela uma vez, logo no começo (no Wayland, o sistema pergunta qual tela).
    if (config.ler().reuniaoPrints !== false) {
      const a = await abrirCaptura();
      if (a.erro) r.printsDesligados(`sem permissão para ver a tela (${a.erro})`);
    } else r.printsDesligados('desligados nas Configurações');
    return r.estado();
  }
  async function terminar() { fecharCaptura(); const t = await r.terminar(); return { pasta: t.pasta }; }
  // Abrir a nota ou a pasta: só o que está dentro da pasta das reuniões.
  async function abrir(caminho) {
    const base = config.ler().reunioesPasta;
    const alvo = path.resolve(String(caminho || ''));
    if (!base || !(alvo === base || alvo.startsWith(base + path.sep))) throw new Error('fora da pasta das reuniões');
    if (!emTeste) await shell.openPath(alvo);
    return { aberto: alvo };
  }
  const seguro = (fn) => async (_e, ...a) => { try { return { ok: true, ...(await fn(...a)) }; } catch (e) { return { erro: e.message }; } };
  ipcMain.handle('reuniao:estado', () => r.estado());
  ipcMain.handle('reuniao:comecar', seguro(async (o = {}) => comecar(o && o.titulo)));
  ipcMain.handle('reuniao:print', seguro(async () => r.print()));
  ipcMain.handle('reuniao:marcar', seguro(async (texto) => r.marcar(typeof texto === 'string' ? texto : '')));
  ipcMain.handle('reuniao:terminar', seguro(async () => terminar()));
  ipcMain.handle('reuniao:abrir', seguro(async (caminho) => abrir(caminho)));
  ipcMain.handle('reuniao:voz', seguro(async (deNovo) => {
    const c = config.ler();
    const m = transcricao.maquina();
    if (deNovo) recomendacao = null;
    recomendacao = recomendacao || await pecas.recomendacaoResumo(m);
    return { maquina: m, motor: transcricao.acharMotor({ escolhido: c.vozPython, deNovo: !!deNovo }), modelos: transcricao.modelos(m), resumo: recomendacao, pasta: c.reunioesPasta };
  }));

  // Reunião que ficou no meio (o app fechou gravando ou montando a nota): monta a nota agora.
  setTimeout(() => { for (const p of r.pendentes()) r.processar(p.pasta).catch(() => {}); }, emTeste ? 300 : 15000);

  // Pedido do bichinho: as mesmas ações da tela.
  async function executar(acao, dados = {}) {
    if (acao === 'comecar') return comecar(dados.titulo);
    if (acao === 'print') return r.print();
    if (acao === 'marcar') return r.marcar(typeof dados.texto === 'string' ? dados.texto : '');
    if (acao === 'terminar') return terminar();
    if (acao === 'abrir') return abrir(dados.caminho);
    throw new Error('ação desconhecida');
  }
  return { reuniao: r, executar, encerrar: async () => { fecharCaptura(); await r.encerrar(); } };
}

module.exports = { ligar };
