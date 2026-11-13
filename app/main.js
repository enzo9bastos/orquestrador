// App de Orquestração — processo principal (Electron).
//
// Casca por cima do tmux e do orq: os agentes continuam vivendo no tmux, dentro
// dos devcontainers. Fechar o app não derruba nada. O orquestrador também roda
// numa sessão tmux própria ("orquestrador"), então sobrevive ao app.
const { app, BrowserWindow, ipcMain, Notification, shell, dialog, protocol, net, Menu } = require('electron');
const { pathToFileURL } = require('url');
// Uma cópia só por usuário: duas rodariam cada workflow em dobro e
// brigariam pelo servidor de controle e pelo ajudante. Abrir de novo só traz
// a janela que já está aberta para a frente (sem mudar de área de trabalho).
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => {
  if (!janela || janela.isDestroyed()) return;
  if (janela.isMinimized()) janela.restore();
  janela.focus();
});

// orqnota://p<pasta>/<caminho>: imagens das pastas de notas, só dentro delas e
// só arquivos de imagem. Assim o editor mostra os anexos sem abrir o disco
// inteiro para a tela.
protocol.registerSchemesAsPrivileged([{ scheme: 'orqnota', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const pty = require('node-pty');
const coletor = require('./coletor');
const conversa = require('./conversa');
const notas = require('./notas');
const permissoes = require('./permissoes');
const repertorio = require('./repertorio');
const workflows = require('./workflows');
const ajudante = require('./ajudante');
const ias = require('./ias');
const topicos = require('./topicos');
const recados = require('./recados');
const canal = require('./canal');
const avulso = require('./avulso');
const { t } = require('./i18n');

// Aba "Terminal": um shell de reserva. O orquestrador agora é a conversa
// (conversa.js), sem tela de terminal.
const ORQUESTRADOR = process.env.ORQ_APP_ORQUESTRADOR || 'exec bash';

let janela;
const avisados = new Set();

function criarJanela() {
  // Testes de tela (ORQ_APP_E2E=1): janela escondida, desenhando por trás, para
  // não aparecer na tela de quem está trabalhando.
  const emTeste = process.env.ORQ_APP_E2E === '1';
  janela = new BrowserWindow({
    show: !emTeste,
    paintWhenInitiallyHidden: true,
    width: 1480,
    height: 920,
    minWidth: 900,
    minHeight: 680,
    title: 'Orquestração',
    icon: path.join(__dirname, 'icons', 'orquestracao-256.png'),
    backgroundColor: '#101114',
    // Sem a barra do sistema: o topo do app faz o papel dela (arrastar,
    // minimizar, maximizar, fechar), como os apps que desenham a própria barra.
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !emTeste,
      // Geração das imagens do README (ORQ_APP_PRINT + ORQ_APP_PRINT_MS):
      // desenha fora da tela, o que deixa capturar quadro atrás de quadro.
      offscreen: !!(process.env.ORQ_APP_PRINT && process.env.ORQ_APP_PRINT_MS),
    },
  });
  // Escondida, mas com foco no conteúdo (área de transferência e teclado
  // dependem disso nos testes).
  if (emTeste) janela.webContents.once('did-finish-load', () => janela.webContents.focus());
  janela.setMenuBarVisibility(false);
  janela.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Corretor: português e inglês. O botão direito num campo de texto mostra as
  // sugestões da palavra sublinhada (o Electron sublinha, mas não monta o menu).
  try { janela.webContents.session.setSpellCheckerLanguages(['pt-BR', 'en-US']); } catch { /* idioma sem dicionário */ }
  janela.webContents.on('context-menu', (_e, p) => {
    if (!p.isEditable && !p.selectionText) return; // fora de campo e sem seleção: o app tem os menus dele
    const itens = [];
    if (p.misspelledWord) {
      for (const s of (p.dictionarySuggestions || []).slice(0, 6)) itens.push({ label: s, click: () => janela.webContents.replaceMisspelling(s) });
      if (!itens.length) itens.push({ label: t('Nenhuma sugestão'), enabled: false });
      itens.push({ label: t('Adicionar ao dicionário'), click: () => janela.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
      itens.push({ type: 'separator' });
    }
    if (p.isEditable) itens.push({ label: t('Recortar'), role: 'cut', enabled: p.editFlags.canCut });
    itens.push({ label: t('Copiar'), role: 'copy', enabled: p.editFlags.canCopy });
    if (p.isEditable) itens.push({ label: t('Colar'), role: 'paste', enabled: p.editFlags.canPaste }, { type: 'separator' }, { label: t('Selecionar tudo'), role: 'selectAll' });
    Menu.buildFromTemplate(itens).popup({ window: janela });
  });
  janela.on('closed', () => { janela = null; });
  janela.on('maximize', () => janela.webContents.send('janela:maximizada', true));
  janela.on('unmaximize', () => janela.webContents.send('janela:maximizada', false));
  // Link clicado na conversa nunca troca a página do app.
  janela.webContents.on('will-navigate', (e) => e.preventDefault());
  janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Ajuste em tempo real: código novo da tela publicado (igual ao commit)
  // recarrega a janela sozinho — veja recarga.js. O terminal do orquestrador
  // vive aqui no processo principal e não cai.
  let espera;
  fs.watch(path.join(__dirname, 'renderer'), () => {
    // Tenta por até 30 s: no publicar.sh o git grava os arquivos antes de
    // fechar o commit do merge, e o commit não gera evento novo aqui.
    const rodada = Symbol('recarga');
    espera = rodada;
    setTimeout(async () => {
      for (let i = 0; i < 30 && espera === rodada; i++) {
        if (await require('./recarga').publicado(path.join(__dirname, 'renderer'))) {
          if (janela && !janela.isDestroyed()) janela.webContents.reload();
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }, 400);
  });
  // Teste: ORQ_APP_PRINT=/caminho/base grava um PNG da janela a cada 8 s
  // (ORQ_APP_PRINT_MS muda o intervalo: quadros para os GIFs do README).
  if (process.env.ORQ_APP_PRINT) {
    let n = 0, ocupado = false;
    setInterval(async () => {
      if (!janela || ocupado) return;
      ocupado = true;
      try {
        const img = await janela.webContents.capturePage();
        require('fs').writeFileSync(`${process.env.ORQ_APP_PRINT}-${String(++n).padStart(3, '0')}.png`, img.toPNG());
      } finally { ocupado = false; }
    }, Number(process.env.ORQ_APP_PRINT_MS) || 8000);
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
// Reiniciar mantendo as conversas: só pausa (a próxima abertura retoma cada
// conversa com --resume, com toda a memória) e abre o app de novo sozinho.
let reiniciando = false;
// Recarregar a tela pelo processo principal: a página não consegue (o
// will-navigate barra toda navegação dela, inclusive o location.reload).
ipcMain.handle('app:recarregarTela', () => { if (janela) janela.webContents.reload(); return true; });
ipcMain.handle('app:reiniciar', () => { reiniciando = true; app.relaunch(); app.quit(); return true; });

// Fechar = sair do app de vez, como o /exit do terminal: encerra as conversas
// (a próxima abertura começa do zero) e os terminais.
ipcMain.on('janela:fechar', () => app.quit());

// --- repertório: skills de todas as ferramentas + atalhos do usuário --------
ipcMain.handle('repertorio:lista', () => repertorio.lista());
ipcMain.handle('repertorio:conteudo', (_e, id) => repertorio.conteudo(id));
ipcMain.handle('repertorio:gravarAtalhos', (_e, l) => repertorio.gravarAtalhos(l));
ipcMain.handle('workflows:lista', () => workflows.lista());
ipcMain.handle('workflows:tipos', () => workflows.tipos());
ipcMain.handle('workflows:gravar', (_e, w) => workflows.gravar(w));
ipcMain.handle('workflows:apagar', (_e, id) => workflows.apagar(id));
ipcMain.handle('workflows:rodar', (_e, id) => workflows.rodar(id).catch((e) => ({ ok: false, erro: e.message })));
ipcMain.handle('workflows:execucoes', (_e, id) => (id ? workflows.execucoes(id) : workflows.todasExecucoes()));
ipcMain.handle('workflows:credenciais', () => workflows.credenciais());
ipcMain.handle('workflows:tiposCred', () => workflows.tiposCred());
ipcMain.handle('workflows:gravarCredencial', (_e, c) => workflows.gravarCredencial(c));
ipcMain.handle('workflows:apagarCredencial', (_e, id) => workflows.apagarCredencial(id));
ipcMain.handle('workflows:testarCredencial', (_e, id) => workflows.testarCredencial(id));

// --- /permissions: regras do settings.json do Claude ------------------------
ipcMain.handle('permissoes:ler', () => permissoes.ler());
ipcMain.handle('permissoes:gravar', (_e, novo) => permissoes.gravar(novo || {}));

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
ipcMain.handle('notas:salvarImagem', (_e, i, relNota, base64, tipo) => notas.salvarImagem(i, relNota, base64, tipo));
ipcMain.handle('notas:criarPasta', (_e, i, pai, nome) => notas.criarPasta(i, pai, nome));
ipcMain.handle('notas:criar', (_e, i, pasta, nome) => notas.criar(i, pasta, nome));
// Apagar nota = mandar para a lixeira do sistema (dá para recuperar de lá).
ipcMain.handle('notas:lixeira', async (_e, i, rel) => { await shell.trashItem(notas.caminhoDaNota(i, rel)); return true; });
// Pastas: esconder só da árvore (não apaga) ou mandar para a lixeira do sistema
// (recuperável de lá; nunca a raiz da pasta de notas).
ipcMain.handle('notas:escondidas', (_e, i) => notas.escondidas(i));
ipcMain.handle('notas:esconder', (_e, i, rel) => notas.esconder(i, rel));
ipcMain.handle('notas:mostrar', (_e, i, rel) => notas.mostrar(i, rel));
ipcMain.handle('notas:contarPasta', (_e, i, rel) => notas.contarPasta(i, rel));
ipcMain.handle('notas:lixeiraPasta', async (_e, i, rel) => { await shell.trashItem(notas.caminhoDaPasta(i, rel)); return true; });
// Anexar na conversa: imagens viram imagem para o Claude; o resto vai pelo
// caminho (o Claude lê o arquivo do disco).
const EXT_IMAGEM = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
ipcMain.handle('arquivos:escolher', async () => {
  const r = await dialog.showOpenDialog(janela, { title: t('Anexar à conversa'), properties: ['openFile', 'multiSelections'] });
  if (r.canceled) return [];
  return r.filePaths.slice(0, 10).map((c) => {
    const tipo = EXT_IMAGEM[path.extname(c).toLowerCase()];
    if (tipo && fs.statSync(c).size < 5_000_000) return { nome: path.basename(c), tipo, dados: fs.readFileSync(c).toString('base64') };
    return { nome: path.basename(c), caminho: c };
  });
});
ipcMain.handle('notas:vigiar', (_e, i, rel) => notas.vigiar(i, rel, (m) => janela && janela.webContents.send('notas:mudou', m)));

// --- conversas (orquestrador e avulsas) -----------------------------------
conversa.ligar((canal, dado) => enviar(canal, dado));

// Notificação do app quando uma conversa precisa do usuário (no lugar de hook
// do Claude). Clicar traz a janela e abre a conversa certa.
const config = require('./config');
const avisosAbertos = new Map(); // conversa → notificação na tela (uma por vez)
conversa.ligarAvisos((a) => {
  if (ajudante.aviso(a)) return; // a conversa do ajudante responde no balão do bichinho
  const n = config.ler().notificacoes || {};
  const emFoco = janela && janela.isFocused() && !janela.isMinimized();
  if (a.tipo === 'pedido' && n.pedidos === false) return;
  if (a.tipo === 'resposta' && (n.respostas === false || emFoco)) return;
  if (!Notification.isSupported()) return;
  const quem = a.orquestrador ? 'O orquestrador' : `"${a.titulo}"`;
  const titulo = t(a.tipo === 'pedido' ? `${quem} precisa de você` : `${quem} respondeu`);
  const corpo = String(a.texto || '').replace(/\s+/g, ' ').slice(0, 220);
  if (avisosAbertos.has(a.id)) avisosAbertos.get(a.id).close();
  const aviso = new Notification({ title: titulo, body: corpo, urgency: a.tipo === 'pedido' ? 'critical' : 'normal' });
  aviso.on('click', () => {
    if (!janela) return;
    // Só pede foco: "mostrar" no Wayland pode puxar o app para a área de
    // trabalho atual, fora do lugar.
    if (janela.isMinimized()) janela.restore();
    janela.focus();
    enviar('conversa:focar', a.id);
  });
  aviso.show();
  avisosAbertos.set(a.id, aviso);
});
ipcMain.handle('conversa:lista', () => conversa.lista());
ipcMain.handle('conversa:abrir', (_e, id) => conversa.abrir(id));
// Imagens: só os tipos que o Claude aceita, até 5 MB cada e 6 por mensagem.
const TIPOS_IMAGEM = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
ipcMain.handle('conversa:mandar', (_e, id, texto, imagens = [], exibir = null) => {
  ajudante.limparAcoes(id);
  const imgs = (Array.isArray(imagens) ? imagens : []).filter((i) => i && TIPOS_IMAGEM.includes(i.tipo) && typeof i.dados === 'string' && i.dados.length < 7_000_000).slice(0, 6);
  const t = typeof texto === 'string' ? texto.trim() : '';
  if (!t && !imgs.length) return false;
  return conversa.mandar(id, t, imgs, typeof exibir === 'string' ? exibir : null);
});
ipcMain.handle('conversa:responder', (_e, id, reqId, decisao) => conversa.responder(id, reqId, decisao));
ipcMain.handle('conversa:interromper', (_e, id) => conversa.interromper(id));
// Voltar a conversa para antes de uma mensagem: devolve { ok, texto } ou
// { ok: false, erro } (a tela mostra e nada muda).
ipcMain.handle('conversa:voltar', (_e, id, ordemDoFim, texto) => {
  try {
    ajudante.limparAcoes(id);
    return { ok: true, texto: conversa.voltar(id, Number(ordemDoFim) || 0, String(texto || '').slice(0, 20000)) };
  } catch (e) { return { ok: false, erro: e.message }; }
});
ipcMain.handle('conversa:configurar', (_e, id, o) => conversa.configurar(id, o));
ipcMain.handle('conversa:reiniciar', (_e, id) => conversa.reiniciar(id));
ipcMain.handle('conversa:nova', () => conversa.nova());
ipcMain.handle('conversa:fechar', (_e, id) => conversa.fechar(id));

// --- configurações --------------------------------------------------------
// A tela só lê o que precisa para desenhar; grava só a aparência.
// A tela lê a configuração como está escrita (sem expandir ~) e grava
// chave por chave; o processo principal valida antes de gravar.
ipcMain.handle('config:ler', () => ({ ...config.cru(), arquivo: config.ARQ }));
ipcMain.handle('config:gravar', (_e, mudancas) => {
  const { ok, recusado } = config.validar(mudancas);
  if (Object.keys(ok).length) config.gravar(ok);
  if (ok.pastasNotas) enviar('notas:pastasMudaram');
  if (ok.idioma || ok.tema || ok.destaque) ajudante.atualizarAparencia(); // o ajudante segue o idioma e o tema
  return { ...config.cru(), arquivo: config.ARQ, recusado };
});

// --- IAs conectadas (CLIs no PATH) ----------------------------------------
// O resultado fica 1 min guardado; "Detectar de novo" passa forcar. Volta
// junto a IA que de fato roda (escolhida não suportada = Claude).
ipcMain.handle('ias:listar', async (_e, forcar) => {
  const c = config.ler();
  const lista = await ias.listar({ env: conversa.ambienteLimpo(), forcar: forcar === true, caminhos: c.iasCaminhos });
  return { ias: lista, orquestrador: ias.efetiva(c.iaOrquestrador, lista), agentes: ias.efetiva(c.iaAgentes, lista) };
});
// "Escolher…" no cartão de uma IA: a janela de abrir arquivo do sistema.
// Só devolve o caminho; quem grava é a tela, por config:gravar (que valida).
ipcMain.handle('ias:escolherCaminho', async (_e, id) => {
  const cand = ias.CANDIDATOS.find((x) => x.id === id);
  if (!cand) return null;
  const atual = ias.caminhoEscolhido(id, config.ler().iasCaminhos);
  const r = await dialog.showOpenDialog(janela, {
    title: `Executável do ${cand.nome}`,
    defaultPath: atual ? path.dirname(atual) : os.homedir(),
    properties: ['openFile', 'showHiddenFiles', 'dontAddToRecent'],
  });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});

// --- tópicos (coluna da direita) -------------------------------------------
// O orquestrador mexe pelo bin/orq-topico; a tela, por aqui. Erro volta como
// { erro } para a tela mostrar, em vez de estourar no invoke.
const pelaTela = (fn) => (_e, ...a) => { try { return { topicos: (fn(...a), topicos.ler()) }; } catch (e) { return { erro: e.message }; } };
// Onde a nota de uma demanda está na aba Notas ({ i, rel }) para o painel abrir.
ipcMain.handle('topicos:nota', (_e, id) => {
  try {
    const o = topicos.ondeNota(id);
    if (!o) return { erro: 'esta demanda ainda não tem nota (só as aprovadas têm)' };
    if (!fs.existsSync(o.abs)) return { erro: `a nota ${o.arquivo} não está na pasta Demandas` };
    const l = notas.localizar(o.abs);
    return l || { erro: 'a pasta Demandas não está dentro de uma pasta de notas' };
  } catch (e) { return { erro: e.message }; }
});
ipcMain.handle('topicos:lista', () => { try { return { topicos: topicos.ler() }; } catch (e) { return { topicos: null, erro: e.message }; } });
ipcMain.handle('topicos:abrir', pelaTela((o) => topicos.abrir(o || {})));
ipcMain.handle('topicos:item', pelaTela((id, txt) => topicos.item(id, txt)));
ipcMain.handle('topicos:marcar', pelaTela((id, item, feito) => topicos.marcar(id, item, feito)));
ipcMain.handle('topicos:estado', pelaTela((id, e) => topicos.estado(id, e)));
// Pela tela, o segundo clique já foi a confirmação: conclui mesmo com item aberto.
ipcMain.handle('topicos:concluir', pelaTela((id) => topicos.concluir(id, { mesmoAssim: true })));
ipcMain.handle('topicos:resumo', pelaTela((id, txt) => topicos.resumo(id, txt)));
// Apagar pelo painel: devolve onde a nota estava, para a aba Notas fechá-la se
// estiver aberta (senão salvar a recriaria).
ipcMain.handle('topicos:apagar', (_e, id) => {
  try {
    const o = topicos.ondeNota(id);
    const fechar = o ? notas.localizar(o.abs) : null;
    topicos.apagar(id);
    return { topicos: topicos.ler(), fechar };
  } catch (e) { return { erro: e.message }; }
});
ipcMain.handle('topicos:reconsiderar', pelaTela((id) => topicos.reconsiderar(id)));
// Aprovar/recusar a sugestão do orquestrador: grava e avisa a conversa dele
// por trás (só se estiver viva; senão ele vê no próximo orq-topico listar).
const decidirTopico = (fn, acao) => (_e, ...a) => {
  try {
    const t = fn(...a);
    try { topicos.avisarOrquestrador(conversa, t, acao); } catch { /* o aviso é extra; a decisão já está gravada */ }
    return { topicos: topicos.ler() };
  } catch (e) { return { erro: e.message }; }
};
ipcMain.handle('topicos:aprovar', decidirTopico((id, titulo) => topicos.aprovar(id, { titulo }), 'aprovado'));
ipcMain.handle('topicos:recusar', decidirTopico((id) => topicos.recusar(id), 'recusado'));
let pararTopicos = null;

// --- recados (agentes ↔ orquestrador) e memória dos projetos ---------------
// A cada 3 s: recolhe o que os agentes deixaram em .orq/recados/saida/ (só
// chama o coletor, que é caro, quando há recado esperando) e entrega os novos
// ao orquestrador, se ele estiver vivo. A tela recebe a lista quando o
// registro muda (inclusive pelo bin/orq-recado).
let marcaRecados = 0;
let ultimoQuadro = 0;
let ultimoRetrato = null;
function cicloRecados() {
  try {
    const ps = coletor.projetos();
    const esperando = ps.some((p) => { try { return fs.readdirSync(path.join(p.dir, '.orq', 'recados', 'saida')).some((f) => f.endsWith('.json')); } catch { return false; } });
    // Agentes abertos: do último retrato da tela se tiver menos de 10 s
    // (o coletor é caro); senão, um retrato novo, só quando for preciso.
    let frentes = null;
    const obterFrentes = () => {
      if (!frentes) frentes = (Date.now() - ultimoEstado < 10000 && ultimoRetrato) ? ultimoRetrato.frentes : coletor.estado().frentes;
      return frentes;
    };
    if (esperando) recados.recolher(ps, obterFrentes());
    recados.entregar(conversa, obterFrentes);
    // Quadro de quem está aberto e das vezes abertas, a cada 15 s.
    // A cada 15 s: o script em todo agente aberto, a memória igual entre as
    // cópias do mesmo projeto e o quadro de quem está aberto.
    if (Date.now() - ultimoQuadro > 15000) {
      ultimoQuadro = Date.now();
      recados.instalarNosAgentes(obterFrentes());
      recados.sincronizarMemoria(recados.gruposDeMemoria(ps, config.ler().memoriaGrupos));
      recados.escreverQuadros(ps, obterFrentes());
    }
    let m = 0;
    try { m = fs.statSync(recados.arquivoLog()).mtimeMs; } catch { /* ainda sem recado */ }
    try { m += fs.statSync(recados.arquivoVezes()).mtimeMs; } catch { /* ainda sem vez passada */ }
    if (m !== marcaRecados) { marcaRecados = m; enviar('recados:mudou', recados.ler()); }
  } catch (e) { console.error('[recados]', e.message); }
}
setInterval(cicloRecados, 3000);

// Pedidos avulsos: até 2 rodando ao mesmo tempo, cada um num container
// descartável. O que estava rodando quando o app fechou vira "falhou".
try { recados.largarRodando(); } catch (e) { console.error('[avulso]', e.message); }
const rodandoAvulso = new Set();
function cicloAvulsos() {
  if (process.env.ORQ_APP_E2E) return; // testes de tela não sobem container
  let fila;
  try { fila = recados.pedidosNaFila(); } catch { return; }
  for (const p of fila) {
    if (rodandoAvulso.size >= 2) break;
    if (rodandoAvulso.has(p.id)) continue;
    const proj = coletor.projetos().find((x) => x.alvo === p.para.alvo);
    if (!proj) { recados.concluirPedido(p.id, { ok: false, erro: `projeto não encontrado: ${p.para.alvo}` }); continue; }
    rodandoAvulso.add(p.id);
    recados.marcarRodando(p.id);
    avulso.rodar({ id: p.id, dir: proj.dir, motor: p.para.motor, texto: p.texto, escrever: p.escrever, modelo: p.modelo, nota: p.nota })
      .catch((e) => ({ ok: false, erro: e.message }))
      .then((res) => { try { recados.concluirPedido(p.id, res); } finally { rodandoAvulso.delete(p.id); cicloRecados(); } });
  }
}
setInterval(cicloAvulsos, 3000);
ipcMain.handle('recados:decidir', (_e, id, aprovar, nota) => { try { recados.decidir(id, !!aprovar, nota); cicloRecados(); cicloCanal(); return { ok: true }; } catch (e) { return { erro: e.message }; } });

// --- canal entre orquestradores de computadores diferentes (canal.js) ---------
// A cada 3 s: (re)liga a escuta quando a configuração muda e publica o que o
// usuário aprovou. Falha de rede tenta de novo com espera crescente; recusa do
// servidor (token, permissão, tamanho) vira "falhou" e o orquestrador fica sabendo.
let canalEscuta = null;
let canalChave = null;
let canalSituacao = { conectado: false, erro: null };
const canalTentativas = new Map(); // id → { n, depois }
const canalEnviando = new Set();
const avisadosCanal = new Set();
function situacaoCanal() {
  const a = canal.ajustes(config.ler());
  return { ativo: a.ativo, pronto: a.pronto, falta: a.falta, servidor: a.host, minhaCaixa: a.minhaCaixa, contatos: a.contatos,
    aprovarEnvio: a.aprovarEnvio, conectado: !!(canalEscuta && canalSituacao.conectado), erro: canalEscuta ? canalSituacao.erro : null };
}
function cicloCanal() {
  try {
    const a = canal.ajustes(config.ler());
    // A chave muda com servidor, caixa ou token (o token só entra resumido).
    const chave = a.pronto && a.minhaCaixa ? `${a.host}|${a.minhaCaixa}|${require('crypto').createHash('sha256').update(a.token).digest('hex').slice(0, 12)}` : null;
    if (chave !== canalChave) {
      if (canalEscuta) canalEscuta.parar();
      canalEscuta = null; canalChave = chave; canalSituacao = { conectado: false, erro: null };
      if (chave) {
        canalEscuta = canal.escutar(a, {
          aoChegar: (m) => { if (recados.recebidoExterno(m, canal.remetente(m, a.contatos))) cicloRecados(); },
          aoEstado: (e) => { canalSituacao = e; enviar('canal:estado', situacaoCanal()); },
        });
      }
      enviar('canal:estado', situacaoCanal());
    }
    const fila = recados.externosNaFila();
    // Recado esperando aprovação: avisa uma vez (notificação do sistema).
    for (const r of recados.ler(1000)) {
      if (!(r.canal && r.para.tipo === 'externo' && r.estado === 'aguardando') || avisadosCanal.has(r.id)) continue;
      avisadosCanal.add(r.id);
      if (Notification.isSupported()) new Notification({ title: t('Precisa de você'), body: `${t('O orquestrador quer mandar um recado para')} ${r.para.nome}`, urgency: 'critical' }).show();
    }
    if (!fila.length) return;
    for (const r of fila) {
      if (canalEnviando.has(r.id)) continue;
      const tent = canalTentativas.get(r.id) || { n: 0, depois: 0 };
      if (Date.now() < tent.depois) continue;
      if (!a.pronto) { recados.adiarExterno(r.id, `canal sem configuração: ${a.falta || 'falta caixa ou contato'}`); canalTentativas.set(r.id, { n: tent.n, depois: Date.now() + 30000 }); continue; }
      if (!a.contatos.some((c) => c.caixa === r.para.caixa)) { recados.concluirExterno(r.id, { ok: false, erro: `${r.para.nome} não está mais nos contatos do canal` }); continue; }
      const problema = canal.problemaDoTexto(r.texto);
      if (problema) { recados.concluirExterno(r.id, { ok: false, erro: problema }); continue; }
      canalEnviando.add(r.id);
      canal.publicar(a, { caixa: r.para.caixa, texto: r.texto, titulo: r.titulo })
        .then(() => { canalTentativas.delete(r.id); recados.concluirExterno(r.id, { ok: true }); })
        .catch((e) => {
          const definitivo = e.status && e.status !== 429 && e.status < 500;
          if (definitivo || tent.n >= 20) { canalTentativas.delete(r.id); recados.concluirExterno(r.id, { ok: false, erro: e.message }); return; }
          canalTentativas.set(r.id, { n: tent.n + 1, depois: Date.now() + Math.min(5000 * 2 ** tent.n, 10 * 60 * 1000) });
          recados.adiarExterno(r.id, `não saiu ainda (${e.message}); tento de novo sozinho`);
        })
        .finally(() => { canalEnviando.delete(r.id); cicloRecados(); });
    }
  } catch (e) { console.error('[canal]', e.message); }
}
setInterval(cicloCanal, 3000);
ipcMain.handle('canal:estado', () => situacaoCanal());
ipcMain.handle('recados:lista', () => recados.ler());
ipcMain.handle('recados:vezes', () => recados.lerVezes());
ipcMain.handle('recados:liberar', (_e, id) => { try { recados.liberar(id); cicloRecados(); return { ok: true }; } catch (e) { return { erro: e.message }; } });
ipcMain.handle('recados:projetos', () => coletor.projetos().map((p) => ({ alvo: p.alvo, notas: recados.memoria(p.dir, { max: 1000 }).length })));
ipcMain.handle('recados:memoria', (_e, alvo) => {
  const p = coletor.projetos().find((x) => x.alvo === alvo);
  return p ? recados.memoria(p.dir) : [];
});

// --- dados ---------------------------------------------------------------
// O que espera o usuário: permissões e pedidos dos agentes (fila) e
// perguntas das conversas do app. O ajudante vem avisar das novas.
function verPendencias(r) {
  const lista = [
    ...r.fila.map((p) => ({
      id: `fila:${p.emp}:${p.proj}:${p.id}`,
      texto: p.tipo === 'permissao' ? `Um agente (${p.proj}) quer usar ${p.ferramenta}` : `Pedido ao servidor de ${p.proj}`,
      // Permissão de agente: dá para responder direto no ajudante.
      item: p.tipo === 'permissao' ? { tipo: 'agente', quem: `Agente de ${p.proj}`, emp: p.emp, proj: p.proj, id: p.id, ferramenta: p.ferramenta, comando: p.entrada?.command || p.entrada?.file_path || null, descricao: p.entrada?.description || null } : null,
    })),
    ...conversa.lista().filter((c) => c.pedidos > 0).flatMap((c) => conversa.pedidos(c.id).map((p) => ({
      id: `conversa:${c.id}:${p.id}`,
      conversa: c.id,
      texto: c.orquestrador ? 'O orquestrador tem uma pergunta para você' : `"${c.titulo}" tem uma pergunta para você`,
      // A pergunta inteira (com as opções) ou o pedido de permissão: o
      // ajudante mostra e o usuário responde ali mesmo.
      item: { tipo: p.entrada?.questions ? 'pergunta' : 'permissao', quem: c.orquestrador ? 'O orquestrador' : c.titulo, reqId: p.id, perguntas: p.entrada?.questions || null, ferramenta: p.ferramenta, comando: p.entrada?.command || p.entrada?.file_path || null, descricao: p.entrada?.description || null },
    }))),
    // O que espera aprovação na aba Recados (recado para fora, pedido avulso
    // que pede escrita): o bichinho traz, e dá para decidir ali mesmo.
    ...recados.ler(1000).filter((r) => r.estado === 'aguardando').map((r) => ({
      id: `aprovar:${r.id}`,
      texto: r.canal ? `Recado para ${r.para.nome} espera você aprovar` : `Pedido ao ${r.para.nome} espera você aprovar`,
      item: { tipo: 'aprovacao', recado: r.id, canal: !!r.canal, quem: r.para.nome, titulo: r.titulo || null, texto: String(r.texto || '').slice(0, 1500), motivo: r.motivo || null },
    })),
  ];
  ajudante.pendencias(lista);
}
let ultimoEstado = 0;
ipcMain.handle('estado', () => {
  const r = coletor.estado();
  ultimoEstado = Date.now();
  ultimoRetrato = r;
  avisarNovidades(r);
  verPendencias(r);
  return r;
});
// Com a janela minimizada a tela quase não pergunta o estado: aí o processo
// principal confere sozinho, para o ajudante não perder pendência.
setInterval(() => { if (Date.now() - ultimoEstado > 8000) { try { verPendencias(coletor.estado()); } catch { /* tenta de novo */ } } }, 5000);

// Ajudante (bichinho fora do app).
ipcMain.handle('pet:prefs', () => ({ ...ajudante.ler(), fora: ajudante.estaFora() }));
ipcMain.handle('pet:gravarVisual', (_e, v) => ajudante.gravarVisual(v));
ipcMain.handle('pet:gravarPrefs', (_e, p) => ajudante.gravar({ avisarFora: p.avisarFora !== false }));
ipcMain.handle('pet:chamar', (_e, o) => { ajudante.chamar(o || {}); return true; });
ipcMain.handle('pet:passear', () => { ajudante.passear(); return true; });
ipcMain.handle('pet:recolher', () => { ajudante.recolher(); return true; });
ipcMain.handle('pet:instalarAtalho', () => ajudante.instalarAtalho());
ipcMain.handle('pet:atalhoInstalado', () => ajudante.atalhoInstalado());
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
// Caminho clicado na conversa: pasta abre no explorador; arquivo aparece
// selecionado na pasta dele (nunca é aberto nem executado).
// Nome sem caminho completo é procurado, nesta ordem: pasta da conversa,
// pastas dos caminhos citados na mesma mensagem, Downloads, Área de Trabalho
// e pasta pessoal.
ipcMain.handle('abrir-caminho', (_e, p, onde = {}) => {
  if (typeof p !== 'string' || !p) return false;
  const home = os.homedir();
  const expandir = (x) => String(x).replace(/^~(?=$|\/)/, home);
  const candidatos = [];
  if (/^(~|\/)/.test(p)) candidatos.push(path.resolve(expandir(p)));
  else {
    const bases = [];
    if (onde && typeof onde.pasta === 'string' && path.isAbsolute(expandir(onde.pasta))) bases.push(expandir(onde.pasta));
    for (const d of (onde && Array.isArray(onde.dicas) ? onde.dicas.slice(0, 20) : [])) {
      if (typeof d !== 'string') continue;
      const abs = path.resolve(expandir(d));
      try { bases.push(fs.statSync(abs).isDirectory() ? abs : path.dirname(abs)); } catch { bases.push(path.dirname(abs)); }
    }
    // getPath cai na pasta pessoal se a pasta não existia ao abrir; por isso o nome fixo também.
    for (const nome of ['downloads', 'desktop']) { try { bases.push(app.getPath(nome)); } catch { /* sem a pasta */ } }
    bases.push(path.join(home, 'Downloads'), path.join(home, 'Desktop'), home);
    for (const b of [...new Set(bases)]) candidatos.push(path.resolve(b, p));
  }
  for (const abs of candidatos) {
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    // Nos testes de tela não abre o explorador de verdade; devolve onde achou.
    if (!process.env.ORQ_APP_E2E) { if (st.isDirectory()) shell.openPath(abs); else shell.showItemInFolder(abs); }
    return abs;
  }
  return false;
});
// Link de nota (Ctrl+clique): só http/https, no navegador do sistema.
ipcMain.handle('abrir-link', (_e, url) => {
  try { const u = new URL(String(url)); if (!['http:', 'https:'].includes(u.protocol)) return false; shell.openExternal(u.toString()); return true; } catch { return false; }
});
ipcMain.handle('abrir-pasta', (_e, dir) => dir.startsWith(coletor.raiz()) && shell.openPath(dir));

// Notificação do sistema quando algo novo precisa do usuário (substitui o apito
// de aviso do terminal enquanto o app estiver aberto).
function avisarNovidades(r) {
  if ((config.ler().notificacoes || {}).agentes === false) return; // desligado na engrenagem
  for (const p of r.fila) {
    const chave = `${p.tipo}:${p.proj}:${p.id}`;
    if (avisados.has(chave)) continue;
    avisados.add(chave);
    const corpo = p.tipo === 'permissao'
      ? `${p.proj} quer usar ${p.ferramenta}`
      : `${p.proj} deixou um pedido ao servidor`;
    if (Notification.isSupported()) new Notification({ title: t('Precisa de você'), body: corpo, urgency: 'critical' }).show();
  }
}

app.whenReady().then(() => {
  protocol.handle('orqnota', (req) => {
    try {
      const u = new URL(req.url);
      const i = Number(u.hostname.replace(/^p/, ''));
      const rel = decodeURIComponent(u.pathname).replace(/^\//, '');
      if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(rel)) return new Response('', { status: 403 });
      return net.fetch(pathToFileURL(notas.caminho(i, rel)).toString());
    } catch { return new Response('', { status: 404 }); }
  });
  criarJanela();
  ajudante.ligar({ janela: () => janela, presenca: () => require('./janelas').estado([process.pid]),
    decidir: (id, aprovar, nota) => { recados.decidir(id, aprovar, nota); cicloRecados(); cicloCanal(); return true; }, conversa, responderAgente: coletor.responder, enviarTela: (canal, dado) => enviar(canal, dado), bin: path.join(__dirname, 'bin', 'orq-pet') });
  // Workflows: o relógio roda aqui; o aviso usa a notificação do sistema.
  workflows.ligar({
    conversa,
    enviarTela: (canal, dado) => enviar(canal, dado),
    avisar: (titulo, corpo) => { if (Notification.isSupported()) new Notification({ title: titulo, body: corpo }).show(); },
  });
  // Tópicos: o orq-topico grava o arquivo; a tela recebe a lista nova na hora.
  // Demandas viram notas .md (pasta Demandas da 1ª pasta de notas): cria o
  // arquivo das que ainda não têm. Só cria; rodar de novo não faz nada.
  try { const m = topicos.migrarParaNotas(); if (m.criados.length) console.log(`[demandas] ${m.criados.length} nota(s) criada(s) em ${m.pasta}`); } catch (e) { console.error('[demandas] migração:', e.message); }
  try { pararTopicos = topicos.vigiar((m) => enviar('topicos:mudou', m)); } catch { /* sem pasta de config: a tela ainda lê ao abrir */ }
  // Sinal de vida a cada 3 s: o hook só espera resposta do app se este
  // arquivo foi tocado há menos de 15 s.
  setInterval(() => coletor.sinalDeVida(), 3000);
  coletor.sinalDeVida();
});
function encerrarTudo() {
  for (const t of terminais.values()) { try { t.pty.kill(); } catch { /* já saiu */ } }
  terminais.clear();
  workflows.desligar();
  if (pararTopicos) { pararTopicos(); pararTopicos = null; }
  ajudante.desligar();
  if (reiniciando) conversa.pararTodas(); else conversa.encerrarTodas();
}
app.on('before-quit', encerrarTudo);
app.on('window-all-closed', () => { encerrarTudo(); app.quit(); });
