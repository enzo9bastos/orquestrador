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
  let tela = null; // { miniatura, largura, altura } do que está sendo mostrado
  const avisarTudo = (e) => { enviarTela('reuniao:mudou', e); avisarBichinho(e); };
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
    // A janela da reunião ou uma tela inteira. No Wayland o pedido passa pelo sistema, que mostra a
    // escolha (janela ou monitor) uma vez; o que a pessoa escolher é o que os prints mostram.
    janela.webContents.session.setDisplayMediaRequestHandler((_req, cb) => {
      // No Wayland o sistema mostra a escolha (janela ou tela) e devolve só a escolhida. No X11 não há
      // essa escolha: vale a tela inteira, como antes.
      const wayland = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;
      desktopCapturer.getSources({ types: wayland ? ['window', 'screen'] : ['screen'], thumbnailSize: { width: 0, height: 0 } })
        .then((s) => cb(s.length ? { video: s[0] } : {})).catch(() => cb({}));
    });
    await janela.loadFile(path.join(__dirname, 'voz', 'captura.html'));
    const res = await pedir({ t: 'iniciar' }, 120000);
    if (res.erro) { fecharCaptura(); return { erro: res.erro }; }
    // A miniatura do que foi escolhido, para a pessoa conferir se é a tela da reunião. Sai em
    // seguida, sem segurar o começo da gravação nem os prints.
    tamanhoDaTela = { largura: res.largura, altura: res.altura };
    tirarMiniatura().catch(() => {});
    return { ok: true };
  }
  let tamanhoDaTela = null;
  async function tirarMiniatura() {
    const minha = janela;
    for (let i = 0; i < 4 && janela && janela === minha; i++) {
      const mini = await pedir({ t: 'miniatura' });
      if (janela !== minha) return null;
      if (!mini.erro && mini.dataUrl) {
        tela = { miniatura: mini.dataUrl, ...(tamanhoDaTela || {}) };
        avisarTudo({ ...r.estado(), evento: 'tela', tela });
        return tela;
      }
      await new Promise((x) => setTimeout(x, 500));
    }
    return null;
  }
  function fecharCaptura() {
    if (!janela) return;
    try { janela.webContents.send('captura', { t: 'parar' }); } catch { /* já fechou */ }
    const j = janela;
    janela = null;
    for (const f of esperando.values()) f({ erro: 'a captura foi fechada' });
    esperando = new Map();
    tela = null;
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
      avisarTudo(e);
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
  // Trocar a tela ou janela dos prints no meio da reunião (o sistema pergunta de novo).
  async function trocarTela() {
    if (!r.estado().gravando) throw new Error('nenhuma reunião sendo gravada');
    fecharCaptura();
    await new Promise((x) => setTimeout(x, 300));
    const a = await abrirCaptura();
    if (a.erro) { r.printsDesligados(`sem permissão para ver a tela (${a.erro})`); throw new Error(a.erro); }
    return { tela: !!tela };
  }

  // --- detectar a reunião pelo microfone (reuniao-detectar.js) ----------------------
  // reuniaoDetectar: 'perguntar' (o bichinho pergunta se grava), 'gravar' (começa sozinho, com o
  // sinal e o lembrete de avisar as pessoas) ou 'desligado'. Quando a ligação solta o microfone,
  // pergunta se termina ('gravar': termina sozinho).
  const D = require('./reuniao-detectar');
  const modoDetectar = () => config.ler().reuniaoDetectar || 'perguntar';
  const detectar = D.criar({
    // Desligado: nem olha quem usa o microfone. Nos testes de tela só olha o servidor de som falso
    // (ORQ_PW_DUMP): um teste nunca consulta o som de verdade do computador.
    listar: () => (modoDetectar() === 'desligado' || (emTeste && !process.env.ORQ_PW_DUMP) ? Promise.resolve(null) : D.listarPipeWire()),
    gravando: () => r.estado().gravando,
    nossos: () => [process.pid],
    intervalo: emTeste ? 300 : 4000,
    minimoMs: emTeste ? 600 : 10000,
    acabouMs: emTeste ? 900 : 60000,
    aoMudar: async (d) => {
      const modo = modoDetectar();
      if (modo === 'desligado') return;
      if (d.evento === 'detectada' && modo === 'gravar') {
        try { await comecar(''); avisarTudo({ ...r.estado(), evento: 'comecou-sozinha', nome: d.nome }); } catch (e) { avisarTudo({ ...r.estado(), evento: 'falhou', erro: e.message }); }
        return;
      }
      if (d.evento === 'acabou' && modo === 'gravar') { try { await terminar(); } catch { /* já tinha parado */ } return; }
      avisarTudo({ ...r.estado(), evento: d.evento, nome: d.nome });
    },
  });
  detectar.ligar();
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
  ipcMain.handle('reuniao:trocarTela', seguro(async () => trocarTela()));
  ipcMain.handle('reuniao:tela', async () => tela || (janela ? tirarMiniatura().catch(() => null) : null));
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
    if (acao === 'trocarTela') return trocarTela();
    throw new Error('ação desconhecida');
  }
  return { reuniao: r, executar, detectar, encerrar: async () => { detectar.desligar(); fecharCaptura(); await r.encerrar(); } };
}

module.exports = { ligar };
