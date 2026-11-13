// O app está na tela? Para o bichinho não sair do app à toa: se o usuário só
// clicou fora (na área de trabalho) e o app continua à vista, o aviso fica
// dentro do app.
//
// No Wayland um programa não enxerga as janelas dos outros, então cada
// ambiente tem o seu jeito. O app usa o primeiro que responder:
//   gnome     extensão "orq-janelas" do GNOME Shell (extras/gnome-shell), por D-Bus
//   sway      swaymsg -t get_tree
//   hyprland  hyprctl -j activewindow / clients / activeworkspace
//   x11       xprop (só numa sessão X11: no Wayland ele só vê janelas do XWayland)
// Sem nenhum: null, e quem pergunta usa a regra de reserva (minimizado ou não).
//
// Resposta: { foco: 'app' | 'outro' | 'nenhum', visivel: bool, via }. visivel:
// a janela do app está na área de trabalho atual, não minimizada e com a maior
// parte à vista (outras janelas por cima cobrindo menos de 70%).
const { execFile } = require('child_process');

const TEMPO = 1500;
function rodar(cmd, args) {
  return new Promise((ok) => {
    execFile(cmd, args, { timeout: TEMPO, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (erro, saida) => ok(erro ? null : String(saida)));
  });
}

// --- conta de área coberta (usada por sway, hyprland e x11) ------------------
// Fração do retângulo r coberta pela união dos retângulos de cima (grade de
// 20x20 pontos: precisão de sobra para "a maior parte está à vista").
function fracaoCoberta(r, deCima) {
  if (!r || r.w <= 0 || r.h <= 0 || !deCima.length) return 0;
  let cobertos = 0;
  const N = 20;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = r.x + ((i + 0.5) * r.w) / N;
      const y = r.y + ((j + 0.5) * r.h) / N;
      if (deCima.some((o) => x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h)) cobertos++;
    }
  }
  return cobertos / (N * N);
}
const LIMITE_COBERTA = 0.7;

// --- GNOME: a extensão responde Estado(pid) com um JSON curto ----------------
// (nada de título nem nome de janela: só o que diz respeito ao app).
async function gnome(pids) {
  const s = await rodar('gdbus', ['call', '--session', '--dest', 'org.gnome.Shell', '--object-path', '/org/orquestrador/Janelas',
    '--method', 'org.orquestrador.Janelas.Estado', JSON.stringify(pids)]);
  if (!s) return null;
  const m = /^\('(.*)',\)\s*$/s.exec(s.trim());
  if (!m) return null;
  try {
    const j = JSON.parse(m[1].replace(/\\'/g, "'"));
    return { foco: j.foco, visivel: !!j.visivel, via: 'gnome' };
  } catch { return null; }
}

// --- sway --------------------------------------------------------------------
function folhasSway(no, lista = [], ws = null) {
  const aqui = no.type === 'workspace' ? no.name : ws;
  if ((no.type === 'con' || no.type === 'floating_con') && no.pid) lista.push({ ...no, ws: aqui });
  for (const f of [...(no.nodes || []), ...(no.floating_nodes || [])]) folhasSway(f, lista, aqui);
  return lista;
}
function estadoSway(arvore, pids) {
  const folhas = folhasSway(arvore);
  const app = folhas.find((n) => pids.includes(n.pid));
  const focada = folhas.find((n) => n.focused);
  const foco = !focada ? 'nenhum' : pids.includes(focada.pid) ? 'app' : 'outro';
  // O sway já diz se a janela está à vista (área de trabalho visível, não escondida em abas).
  return { foco, visivel: !!(app && app.visible), via: 'sway' };
}
async function sway(pids) {
  if (!process.env.SWAYSOCK) return null;
  const s = await rodar('swaymsg', ['-t', 'get_tree', '-r']);
  if (!s) return null;
  try { return estadoSway(JSON.parse(s), pids); } catch { return null; }
}

// --- Hyprland ------------------------------------------------------------------
function estadoHyprland(ativa, clientes, area, pids) {
  const app = clientes.find((c) => pids.includes(c.pid) && c.mapped !== false);
  const foco = !ativa || !ativa.pid ? 'nenhum' : pids.includes(ativa.pid) ? 'app' : 'outro';
  if (!app || app.hidden || !area || app.workspace.id !== area.id) return { foco, visivel: false, via: 'hyprland' };
  const r = { x: app.at[0], y: app.at[1], w: app.size[0], h: app.size[1] };
  // Por cima do app: as flutuantes da mesma área, e a que está em foco.
  const deCima = clientes.filter((c) => c !== app && !c.hidden && c.workspace.id === area.id && (c.floating || c.address === (ativa && ativa.address)))
    .map((c) => ({ x: c.at[0], y: c.at[1], w: c.size[0], h: c.size[1] }));
  return { foco, visivel: fracaoCoberta(r, deCima) < LIMITE_COBERTA, via: 'hyprland' };
}
async function hyprland(pids) {
  if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return null;
  const [a, c, w] = await Promise.all([rodar('hyprctl', ['-j', 'activewindow']), rodar('hyprctl', ['-j', 'clients']), rodar('hyprctl', ['-j', 'activeworkspace'])]);
  if (!c || !w) return null;
  try { return estadoHyprland(a ? JSON.parse(a) : null, JSON.parse(c), JSON.parse(w), pids); } catch { return null; }
}

// --- X11 (qualquer gerenciador que siga o padrão EWMH) -----------------------
const lerProp = (s, nome) => { const m = new RegExp(`^${nome}\\([^)]*\\)[^=]*=\\s*(.*)$`, 'm').exec(s || ''); return m ? m[1].trim() : null; };
async function x11(pids) {
  if (process.env.XDG_SESSION_TYPE !== 'x11' || !process.env.DISPLAY) return null;
  const raiz = await rodar('xprop', ['-root', '_NET_ACTIVE_WINDOW', '_NET_CLIENT_LIST_STACKING', '_NET_CURRENT_DESKTOP']);
  if (!raiz) return null;
  const ativa = (lerProp(raiz, '_NET_ACTIVE_WINDOW') || '').match(/0x[0-9a-f]+/i);
  const pilha = (lerProp(raiz, '_NET_CLIENT_LIST_STACKING') || '').match(/0x[0-9a-f]+/gi) || [];
  const area = Number(lerProp(raiz, '_NET_CURRENT_DESKTOP'));
  const info = async (id) => {
    const p = await rodar('xprop', ['-id', id, '_NET_WM_PID', '_NET_WM_DESKTOP', '_NET_WM_STATE']);
    const g = await rodar('xwininfo', ['-id', id]);
    const num = (re) => { const m = re.exec(g || ''); return m ? Number(m[1]) : 0; };
    return {
      id, pid: Number(lerProp(p, '_NET_WM_PID')), area: Number(lerProp(p, '_NET_WM_DESKTOP')),
      escondida: /_NET_WM_STATE_HIDDEN/.test(lerProp(p, '_NET_WM_STATE') || ''),
      r: { x: num(/Absolute upper-left X:\s+(-?\d+)/), y: num(/Absolute upper-left Y:\s+(-?\d+)/), w: num(/Width:\s+(\d+)/), h: num(/Height:\s+(\d+)/) },
    };
  };
  const janelas = await Promise.all(pilha.slice(-30).map(info)); // de baixo para cima
  const i = janelas.findIndex((j) => pids.includes(j.pid));
  const focada = ativa ? janelas.find((j) => j.id.toLowerCase() === ativa[0].toLowerCase()) : null;
  const foco = !focada ? 'nenhum' : pids.includes(focada.pid) ? 'app' : 'outro';
  if (i < 0) return { foco, visivel: false, via: 'x11' };
  const app = janelas[i];
  const naArea = (j) => j.area === area || j.area === 0xFFFFFFFF || j.area === -1;
  if (app.escondida || !naArea(app)) return { foco, visivel: false, via: 'x11' };
  const deCima = janelas.slice(i + 1).filter((j) => !j.escondida && naArea(j) && !pids.includes(j.pid)).map((j) => j.r);
  return { foco, visivel: fracaoCoberta(app.r, deCima) < LIMITE_COBERTA, via: 'x11' };
}

// Ordem: o que só responde no ambiente certo primeiro.
const CAMADAS = { sway, hyprland, gnome, x11 };
let qualFunciona; // nome da camada que respondeu (undefined = ainda não testado; null = nenhuma)
async function estado(pids) {
  if (qualFunciona) {
    const r = await CAMADAS[qualFunciona](pids);
    if (r) return r;
    qualFunciona = undefined; // parou de responder (extensão desligada?): procura de novo
  }
  if (qualFunciona === null) return null;
  for (const [nome, f] of Object.entries(CAMADAS)) {
    const r = await f(pids);
    if (r) { qualFunciona = nome; return r; }
  }
  qualFunciona = null;
  setTimeout(() => { if (qualFunciona === null) qualFunciona = undefined; }, 5 * 60 * 1000).unref?.(); // tenta de novo daqui a pouco
  return null;
}

module.exports = { estado, fracaoCoberta, estadoSway, estadoHyprland, LIMITE_COBERTA, _zerar: () => { qualFunciona = undefined; } };
