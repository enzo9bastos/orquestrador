// Ajudante: o bichinho fora do app. Roda numa janelinha transparente, num
// processo próprio (pet/main.js) em modo X11 — no Wayland um app não pode
// escolher onde fica a própria janela, e o bichinho precisa andar pela tela.
// Conversa com este processo por linhas de JSON na entrada e na saída.
//
// Ele vive num lugar só: quando está na área de trabalho, some de dentro do
// app. Aparece sozinho quando há pendência nova e o app está fora de foco, e
// vem quando alguém chama (atalho do sistema, dois cliques nele, orq-pet).
// O que se pergunta a ele vai para a conversa "Ajudante" do app.
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, execFile } = require('child_process');
const readline = require('readline');
const config = require('./config');

const ARQ = path.join(os.homedir(), '.config', 'orq-app', 'pet.json');
const SOQUETE = path.join(os.homedir(), '.cache', 'orq-app', 'ajudante.sock');
const CONVERSA = 'ajudante';
const ATALHO = '<Control><Alt>space';
const CHAVE_GNOME = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/orq-ajudante/';
const TESTE = process.env.ORQ_APP_TESTE === '1';

let ctx = { janela: () => null, conversa: null, enviarTela: () => {}, bin: '' };
let proc = null;
let fora = false;           // o bichinho está na área de trabalho (não no app)
const vistas = new Set();   // pendências já avisadas
let servidor = null;

// --- preferências ------------------------------------------------------------
function ler() {
  let p = {};
  try { p = JSON.parse(fs.readFileSync(ARQ, 'utf8')); } catch { /* primeira vez */ }
  return { visual: p.visual || { cor: 'padrao', itens: {} }, avisarFora: p.avisarFora !== false };
}
function gravar(mudanca) {
  const p = { ...ler(), ...mudanca };
  fs.mkdirSync(path.dirname(ARQ), { recursive: true });
  fs.writeFileSync(`${ARQ}.tmp`, JSON.stringify(p, null, 2) + '\n');
  fs.renameSync(`${ARQ}.tmp`, ARQ);
  return p;
}
function gravarVisual(v) {
  const p = gravar({ visual: v });
  mandar({ t: 'visual', ...aparencia() });
  ctx.enviarTela('pet:visual', p.visual);
  return p.visual;
}
const aparencia = () => { const c = config.ler(); return { visual: ler().visual, destaque: c.destaque || null, tema: c.tema || 'dark' }; };

// --- processo da janelinha ---------------------------------------------------
function mandar(m) { if (proc && proc.stdin.writable) proc.stdin.write(JSON.stringify(m) + '\n'); }
function iniciar() {
  if (proc || TESTE) return;
  const args = [path.join(__dirname, 'pet', 'main.js'), '--ozone-platform=x11', '--enable-transparent-visuals'];
  proc = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ELECTRON_OZONE_PLATFORM_HINT: 'x11' } });
  proc.on('exit', () => { proc = null; mudarLugar(false); });
  proc.on('error', () => { proc = null; });
  readline.createInterface({ input: proc.stdout }).on('line', (l) => { let m; try { m = JSON.parse(l); } catch { return; } receber(m); });
  mandar({ t: 'visual', ...aparencia() });
}
function mudarLugar(naArea) {
  fora = naArea;
  ctx.enviarTela('pet:fora', fora);
}

async function receber(m) {
  if (m.t === 'visivel') mudarLugar(!!m.visivel);
  else if (m.t === 'perguntar') perguntar(m.texto, m.imagem);
  else if (m.t === 'capturar') {
    const r = await capturar();
    mandar({ t: 'imagem', ...r });
  } else if (m.t === 'abrirApp') {
    const j = ctx.janela();
    if (j) { if (j.isMinimized()) j.restore(); j.show(); j.focus(); }
    if (m.conversa) ctx.enviarTela('conversa:focar', m.conversa);
  } else if (m.t === 'voltar') { mandar({ t: 'sumir' }); mudarLugar(false); }
}

// --- perguntar ao ajudante ---------------------------------------------------
function perguntar(texto, imagem) {
  const c = ctx.conversa;
  c.garantir(CONVERSA, 'Ajudante');
  const imagens = [];
  if (imagem) {
    try { imagens.push({ tipo: 'image/png', dados: fs.readFileSync(imagem).toString('base64') }); } catch { /* a imagem sumiu */ }
  }
  const t = String(texto || '').trim() || (imagens.length ? 'O que você vê aqui? Me ajude com isto.' : '');
  if (!t && !imagens.length) return;
  mandar({ t: 'pensando' });
  c.mandar(CONVERSA, t, imagens);
}
// O main.js passa aqui cada aviso das conversas: a resposta do ajudante
// vai para o balão do bichinho (e não vira notificação do sistema).
function aviso(a) {
  if (a.id !== CONVERSA) return false;
  if (a.tipo === 'resposta') mandar({ t: 'resposta', texto: a.texto });
  else if (a.tipo === 'pedido') mandar({ t: 'resposta', texto: `Preciso da sua permissão para continuar: ${a.texto || ''}`.trim(), abrir: true });
  return true;
}

// Recorte de um pedaço da tela: pelo print-nitido quando existe (resolução
// real com monitores em escalas diferentes), senão pelo gnome-screenshot.
const PRINT_NITIDO = path.join(os.homedir(), '.local', 'bin', 'print-nitido');
function capturar() {
  return new Promise((ok) => {
    const falhou = 'Não consegui recortar a tela (cancelado, ou sem ferramenta de captura instalada).';
    if (fs.existsSync(PRINT_NITIDO)) {
      execFile(PRINT_NITIDO, ['--salvar'], { timeout: 120000 }, (erro, saida) => {
        const caminho = String(saida || '').trim().split('\n').pop();
        ok(erro || !caminho || !fs.existsSync(caminho) ? { erro: falhou } : { caminho });
      });
      return;
    }
    const destino = path.join(os.homedir(), '.cache', 'orq-app', 'recortes', `recorte-${Date.now()}.png`);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    execFile('gnome-screenshot', ['-a', '-f', destino], { timeout: 120000 }, (erro) => ok(erro || !fs.existsSync(destino) ? { erro: falhou } : { caminho: destino }));
  });
}

// --- chamar e pendências -----------------------------------------------------
function chamar({ capturar: comPrint = false } = {}) {
  iniciar();
  mandar({ t: 'chamar', capturar: comPrint });
}
function passear() { iniciar(); mandar({ t: 'passear' }); }
function recolher() { mandar({ t: 'sumir' }); }

// lista: [{ id, texto }]. Pendência nova, com o app fora de foco: ele vem
// avisar. As que sumiram saem da memória (se voltarem, avisa de novo).
function pendencias(lista) {
  const ids = new Set(lista.map((p) => p.id));
  for (const v of [...vistas]) if (!ids.has(v)) vistas.delete(v);
  const novas = lista.filter((p) => !vistas.has(p.id));
  for (const p of novas) vistas.add(p.id);
  if (!novas.length || !ler().avisarFora) return novas;
  const j = ctx.janela();
  if (j && j.isFocused() && !j.isMinimized()) return novas;
  iniciar();
  const texto = novas.length === 1 ? novas[0].texto : `${novas.length} coisas esperando por você`;
  mandar({ t: 'pendencia', texto, total: lista.length });
  return novas;
}

// --- atalho do sistema ---------------------------------------------------------
// orq-pet (e o atalho do GNOME, que roda o orq-pet) fala com o app por este
// soquete, que só o usuário alcança.
function ligarSoquete() {
  if (TESTE) return;
  fs.mkdirSync(path.dirname(SOQUETE), { recursive: true, mode: 0o700 });
  try { fs.unlinkSync(SOQUETE); } catch { /* não havia */ }
  servidor = net.createServer((s) => {
    let d = '';
    s.on('data', (x) => { d += x; if (d.length > 200) s.destroy(); });
    s.on('end', () => {
      const cmd = d.trim();
      if (cmd === 'chamar') chamar();
      else if (cmd === 'print') chamar({ capturar: true });
      else if (cmd === 'passear') passear();
      else if (cmd === 'voltar') recolher();
      s.end('ok\n');
    });
  });
  servidor.listen(SOQUETE, () => { try { fs.chmodSync(SOQUETE, 0o600); } catch { /* sem chmod */ } });
  servidor.on('error', () => {});
}

const gs = (args) => new Promise((ok) => execFile('gsettings', args, (e, s) => ok(e ? null : String(s).trim())));
// Cria o atalho Ctrl+Alt+Espaço no GNOME (acrescenta à lista; não mexe nos
// atalhos que já existem). Recusa se a combinação já estiver em uso.
async function instalarAtalho() {
  const base = 'org.gnome.settings-daemon.plugins.media-keys';
  const atual = await gs(['get', base, 'custom-keybindings']);
  if (atual === null) return { ok: false, erro: 'Não achei o gsettings (o atalho do sistema só funciona no GNOME).' };
  const lista = (atual.match(/'[^']*'/g) || []).map((x) => x.slice(1, -1));
  const tudo = await gs(['list-recursively']) || '';
  const outros = await Promise.all(lista.filter((p) => p !== CHAVE_GNOME).map((p) => gs(['get', `${base}.custom-keybinding:${p}`, 'binding'])));
  if (tudo.includes(`'${ATALHO}'`) || outros.some((b) => b === `'${ATALHO}'`)) return { ok: false, erro: 'Ctrl+Alt+Espaço já está em uso por outro atalho do sistema.' };
  const alvo = `${base}.custom-keybinding:${CHAVE_GNOME}`;
  await gs(['set', alvo, 'name', 'Chamar o ajudante (App de Orquestração)']);
  await gs(['set', alvo, 'command', `${ctx.bin} chamar`]);
  await gs(['set', alvo, 'binding', ATALHO]);
  if (!lista.includes(CHAVE_GNOME)) await gs(['set', base, 'custom-keybindings', `[${[...lista, CHAVE_GNOME].map((p) => `'${p}'`).join(', ')}]`]);
  return { ok: true, atalho: 'Ctrl+Alt+Espaço' };
}
async function atalhoInstalado() {
  const atual = await gs(['get', 'org.gnome.settings-daemon.plugins.media-keys', 'custom-keybindings']);
  return !!atual && atual.includes(CHAVE_GNOME);
}

function ligar(c) {
  ctx = { ...ctx, ...c };
  ligarSoquete();
}
function desligar() {
  if (proc) { try { proc.kill(); } catch { /* já saiu */ } proc = null; }
  if (servidor) { try { servidor.close(); fs.unlinkSync(SOQUETE); } catch { /* já fechado */ } }
}

module.exports = { ligar, desligar, ler, gravar, gravarVisual, chamar, passear, recolher, pendencias, aviso, instalarAtalho, atalhoInstalado, estaFora: () => fora, CONVERSA, SOQUETE };
