// Tela do App de Orquestração. Lê o retrato do coletor a cada 2 s e redesenha.
const $ = (id) => document.getElementById(id);

// Estados que o próprio agente publica (orq-status).
const ROTULO_STATUS = { trabalhando: 'Trabalhando', travado: 'Travado', revisao: 'Em revisão', pronto: 'Pronto' };

const ROTULO = {
  trabalhando: 'Trabalhando',
  esperando: 'Espera você',
  permissao: 'Pede permissão',
  encerrado: 'Encerrado',
  desconhecido: 'Sem sinal',
};

let selecionada = null;
let ultimo = null;
const espelhos = new Map();

function lerPreferencia(k) { try { return localStorage.getItem(k); } catch { return null; } }
function gravarPreferencia(k, v) { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function haQuanto(ms) {
  if (!ms) return '';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

function hora(ms) {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function descreverEvento(e) {
  switch (e.evento) {
    case 'SessionStart': return `Conversa aberta${e.source && e.source !== 'startup' ? ` (${e.source})` : ''}`;
    case 'UserPromptSubmit': return `Recebeu: ${(e.prompt || '').split('\n')[0]}`;
    case 'PostToolUse': {
      let det = '';
      try {
        const t = JSON.parse(e.resumo);
        det = t.description || t.command || t.file_path || t.pattern || '';
      } catch { det = e.resumo || ''; }
      return `${e.tool_name}: ${det}`;
    }
    case 'PermissionRequest': return `Pediu permissão para ${e.tool_name}`;
    case 'Notification':
      if (e.notification_type === 'permission_prompt') return 'Avisou que precisa de permissão';
      if (e.notification_type === 'idle_prompt') return 'Avisou que está esperando você';
      return e.message || 'Notificação';
    case 'Stop': return `Respondeu: ${(e.last_assistant_message || '').split('\n')[0]}`;
    case 'SessionEnd': return 'Conversa encerrada';
    default: return e.evento;
  }
}

// --- terminais de reserva (até 4, em grade) ---------------------------------
// Cada terminal é um shell no processo principal; aqui só o desenho. Abrem
// quando a aba é mostrada: medido escondido, o xterm nasceria do tamanho errado.
const MAX_TERMINAIS = 4;
const terminais = new Map(); // id → { term, ajuste, painel, sessao }
let proximoTerminal = 1;

function novoXterm() {
  return new Terminal({
    fontFamily: "'JetBrains Mono', 'Cascadia Mono', 'DejaVu Sans Mono', monospace",
    fontSize: 13,
    cursorBlink: true,
    theme: { background: '#101114', foreground: '#f3f4f6', cursor: '#f3f4f6', selectionBackground: '#8b5cf666' },
  });
}

function arrumarGrade() {
  const g = $('terminais');
  g.dataset.n = terminais.size;
  $('n-terminais').textContent = `${terminais.size} de ${MAX_TERMINAIS}`;
  $('novo-terminal').disabled = terminais.size >= MAX_TERMINAIS;
  let n = 0;
  for (const t of terminais.values()) {
    if (t.sessao) {
      const fs = (ultimo && ultimo.frentes) || [];
      const i = fs.findIndex((f) => f.sessaoTmux === t.sessao);
      t.painel.querySelector('.nome-terminal').textContent = i >= 0 ? `${nomeDaFrente(fs[i], i)} · ${t.sessao}` : t.sessao;
    } else t.painel.querySelector('.nome-terminal').textContent = `Terminal ${++n}`;
  }
  requestAnimationFrame(() => { for (const [id, t] of terminais) { t.ajuste.fit(); window.orq.pty.tamanho(id, t.term.cols, t.term.rows); } });
}

// Copiar e colar no terminal, como no terminal do Linux:
//   Ctrl+Shift+C copia · Ctrl+Shift+V cola · Ctrl+C com seleção copia
//   (sem seleção continua sendo o Ctrl+C de interromper) · botão direito: menu.
async function copiarDoTerminal(term) {
  const sel = term.getSelection();
  if (!sel) return false;
  try { await navigator.clipboard.writeText(sel); } catch { return false; }
  term.clearSelection();
  return true;
}
async function colarNoTerminal(id) {
  try { const t = await navigator.clipboard.readText(); if (t) window.orq.pty.escrever(id, t); } catch { /* sem área de transferência */ }
}
function ligarCopiarColar(term, id, painel) {
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown') return true;
    const k = ev.key.toLowerCase();
    if (ev.ctrlKey && ev.shiftKey && k === 'c') { copiarDoTerminal(term); return false; }
    // Ctrl+Shift+V: o próprio navegador já dispara o "colar" no terminal; colar
    // aqui também duplicava o texto. Só impede o xterm de tratar a tecla.
    if (ev.ctrlKey && ev.shiftKey && k === 'v') return false;
    if (ev.ctrlKey && !ev.shiftKey && k === 'c' && term.hasSelection()) { copiarDoTerminal(term); return false; }
    return true;
  });
  painel.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    document.querySelector('.menu-terminal')?.remove();
    const menu = document.createElement('ul');
    menu.className = 'menu-contexto menu-terminal';
    menu.innerHTML = `<li role="menuitem" data-f="copiar"${term.hasSelection() ? '' : ' class="desligado"'}>Copiar<span>Ctrl+Shift+C</span></li>
      <li role="menuitem" data-f="colar">Colar<span>Ctrl+Shift+V</span></li>
      <li role="menuitem" data-f="tudo">Selecionar tudo</li>`;
    document.body.append(menu);
    menu.style.left = `${Math.min(ev.clientX, innerWidth - menu.offsetWidth - 8)}px`;
    menu.style.top = `${Math.min(ev.clientY, innerHeight - menu.offsetHeight - 8)}px`;
    const fechar = () => { menu.remove(); document.removeEventListener('mousedown', fora); };
    const fora = (e) => { if (!menu.contains(e.target)) fechar(); };
    setTimeout(() => document.addEventListener('mousedown', fora), 0);
    menu.addEventListener('click', async (e) => {
      const f = e.target.closest('li')?.dataset.f;
      if (f === 'copiar') await copiarDoTerminal(term);
      else if (f === 'colar') await colarNoTerminal(id);
      else if (f === 'tudo') term.selectAll();
      fechar();
      term.focus();
    });
  });
}

async function criarTerminal(id, sessao) {
  if (terminais.size >= MAX_TERMINAIS) return false;
  id = id || `t${proximoTerminal}`;
  proximoTerminal = Math.max(proximoTerminal, Number(id.slice(1)) + 1);
  const painel = document.createElement('div');
  painel.className = 'painel-terminal';
  painel.innerHTML = `<header><svg class="ico"><use href="#i-terminal"/></svg><span class="nome-terminal"></span>
    <button class="botao-icone" type="button" data-fechar-terminal="${id}" title="Fechar este terminal" aria-label="Fechar terminal">✕</button></header>
    <div class="corpo-terminal"></div>`;
  $('terminais').append(painel);
  const term = novoXterm();
  const ajuste = new FitAddon.FitAddon();
  term.loadAddon(ajuste);
  term.open(painel.querySelector('.corpo-terminal'));
  terminais.set(id, { term, ajuste, painel, sessao: sessao || null });
  if (sessao) painel.classList.add('de-agente');
  term.onData((d) => window.orq.pty.escrever(id, d));
  ligarCopiarColar(term, id, painel);
  term.textarea.addEventListener('focus', () => { document.querySelectorAll('.painel-terminal').forEach((p) => p.classList.remove('focado')); painel.classList.add('focado'); });
  new ResizeObserver(() => {
    if (!$('aba-terminal').classList.contains('ativa')) return;
    ajuste.fit();
    window.orq.pty.tamanho(id, term.cols, term.rows);
  }).observe(painel.querySelector('.corpo-terminal'));
  arrumarGrade();
  ajuste.fit();
  await window.orq.pty.abrir(id, term.cols, term.rows, sessao);
  term.focus();
  return true;
}

function tirarTerminal(id) {
  const t = terminais.get(id);
  if (!t) return;
  t.term.dispose();
  t.painel.remove();
  terminais.delete(id);
  arrumarGrade();
}

window.orq.pty.aoReceber((id, d) => { const t = terminais.get(id); if (t) t.term.write(d); });
window.orq.pty.aoSair((id) => tirarTerminal(id));

let terminaisIniciados = false;
async function abrirTerminal() {
  if (!terminaisIniciados) {
    terminaisIniciados = true;
    // Tela recarregada: os shells continuam no processo principal; reconecta.
    const vivos = await window.orq.pty.lista();
    if (vivos.length) for (const v of vivos) await criarTerminal(v.id, v.sessao);
    else await criarTerminal();
    return;
  }
  arrumarGrade();
  const primeiro = terminais.values().next().value;
  if (primeiro) primeiro.term.focus();
}
$('novo-terminal').addEventListener('click', () => criarTerminal());

// "Abrir terminal" de uma frente: anexa a sessão tmux dela aqui dentro, na aba
// Terminal, em vez de abrir uma janela solta do sistema.
async function abrirTerminalDoAgente(sessao) {
  const aba = document.querySelector('[data-aba="aba-terminal"]');
  if (!terminaisIniciados) { terminaisIniciados = true; for (const v of await window.orq.pty.lista()) await criarTerminal(v.id, v.sessao); }
  if (!aba.classList.contains('ativa')) aba.click();
  const ja = [...terminais.values()].find((t) => t.sessao === sessao);
  if (ja) { ja.term.focus(); return; }
  if (!(await criarTerminal(null, sessao))) {
    $('n-terminais').textContent = `${terminais.size} de ${MAX_TERMINAIS} — feche um para abrir o terminal do agente`;
  }
}

// --- desenho --------------------------------------------------------------
const VAZIO = (icone, titulo, texto) =>
  `<div class="vazio"><span class="ico-caixa"><svg class="ico"><use href="#${icone}"/></svg></span><strong>${titulo}</strong><span>${texto}</span></div>`;

function nomeDaFrente(f, i) {
  return /^Agente \d+/.test(f.nome) ? f.nome : `Agente ${i + 1} — ${f.nome}`;
}

function desenharTopo(r) {
  const n = (est) => r.frentes.filter((f) => f.estado === est).length;
  const pilula = (classe, num, texto) => `<span class="pilula"><span class="ponto ${classe}"></span>${num} ${texto}</span>`;
  $('contagem').innerHTML =
    pilula('trabalhando', n('trabalhando'), 'trabalhando') +
    pilula('esperando', n('esperando'), 'esperando') +
    pilula('permissao', n('permissao') + r.fila.filter((p) => p.tipo === 'pedido').length, 'pendências');
}

function desenharFrentes(r) {
  const filtro = $('filtro').value.trim().toLowerCase();
  const numeradas = r.frentes.map((f, i) => ({ ...f, rotulo: nomeDaFrente(f, i) }));
  const visiveis = numeradas.filter((f) => !filtro || `${f.rotulo} ${f.proj} ${f.tarefa || ''}`.toLowerCase().includes(filtro));
  const caixa = $('projetos');
  if (!r.frentes.length) {
    caixa.innerHTML = VAZIO('i-terminal', 'Nenhuma frente aberta', 'Peça ao orquestrador para abrir uma frente.');
  } else if (!visiveis.length) {
    caixa.innerHTML = VAZIO('i-busca', 'Nada encontrado', `Nenhuma frente com "${esc(filtro)}".`);
  } else {
    // Um cartão por agente: "Agente N" em cima, o que ele está fazendo embaixo.
    const numero = (f) => Number((f.rotulo.match(/^Agente (\d+)/) || [])[1] || 999);
    caixa.innerHTML = [...visiveis].sort((a, b) => numero(a) - numero(b)).map((f) => `
      <button type="button" class="cartao-agente" data-chave="${esc(f.chave)}" aria-pressed="${f.chave === selecionada}"
          title="${esc(ROTULO[f.estado])}${f.fonte === 'tela' ? ' (lido pela tela)' : ''}">
        <span class="linha-agente">
          <span class="ponto ${f.estado}" aria-hidden="true"></span>
          <span class="nome">${esc(f.rotulo)}</span>
          <span class="tempo-curto">${f.desde ? haQuanto(f.desde) : esc(ROTULO[f.estado].toLowerCase())}</span>
        </span>
        <span class="tarefa${f.tarefa ? '' : ' sem-tarefa'}">${esc(f.tarefa || 'Tarefa não registrada no topicos.md')}</span>
        ${f.statusAgente ? `<span class="status-agente status-${esc(f.statusAgente.estado)}" title="Publicado pelo agente há ${haQuanto(f.statusAgente.ts)}">
          <span class="rotulo-status">${esc(ROTULO_STATUS[f.statusAgente.estado] || f.statusAgente.estado)}</span>${esc(f.statusAgente.texto)}
          ${f.statusAgente.progresso ? (() => { const [a, b] = f.statusAgente.progresso.split('/').map(Number); return `<span class="progresso-agente" title="${a} de ${b}"><i style="width:${Math.min(100, (a / (b || 1)) * 100)}%"></i></span>`; })() : ''}</span>` : ''}
        <span class="proj" title="${esc(f.proj)}">${f.modeloAgente ? `<span class="modelo-agente">✳ ${esc(f.modeloAgente)}</span>` : esc(f.proj)}</span>
      </button>`).join('');
  }
  $('sem-terminal').textContent = r.semTerminal ? `${r.semTerminal} projeto(s) sem agente aberto` : '';
}

// --- protótipo: "Agente N terminou" com resumo e próximos passos -----------------
// Quando um agente passa de trabalhando para parado, vira um cartão na fila
// com um resumo e 3 botões que mandam um pedido pronto ao orquestrador.
const estadoAnterior = new Map(); // chave → estado da leitura passada
const terminaram = new Map();     // chave → { nome, resumo, em }
function resumoDe(f) {
  if (f.statusAgente && f.statusAgente.texto) return f.statusAgente.texto;
  if (f.ultimaResposta) return f.ultimaResposta.replace(/\s+/g, ' ').slice(0, 220);
  // Sem hook nem status: as últimas linhas de texto da tela, sem a caixa de digitar.
  const linhas = String(f.fimDaTela || '').split('\n').map((l) => l.trim())
    .filter((l) => l && !/^[─━-]{5,}|^❯|⏵⏵|shift\+tab/.test(l));
  return linhas.slice(-2).join(' ').slice(0, 220) || 'Sem resumo disponível.';
}
function notarTerminos(r) {
  r.frentes.forEach((f, i) => {
    const antes = estadoAnterior.get(f.chave);
    if (antes === 'trabalhando' && (f.estado === 'esperando' || f.estado === 'permissao')) {
      terminaram.set(f.chave, { nome: nomeDaFrente(f, i), resumo: resumoDe(f), em: Date.now() });
    }
    if (f.estado === 'trabalhando') terminaram.delete(f.chave);
    estadoAnterior.set(f.chave, f.estado);
  });
}
const PASSOS = [
  ['conferir', 'Conferir', (n, r) => `O ${n} terminou: "${r}". Confira o que ele fez e me traga o antes × depois, em poucas linhas.`],
  ['documentar', 'Documentar', (n) => `Peça ao ${n} para documentar no vault o que acabou de fazer, no mesmo turno.`],
  ['seguir', 'Próximo passo', (n, r) => `O ${n} terminou: "${r}". Qual deve ser o próximo passo dele? Me proponha antes de mandar.`],
];
function cartoesTerminou() {
  return [...terminaram].map(([chave, t]) => `<li class="item-fila item-terminou">
    <span class="quem"><span class="ponto trabalhando" aria-hidden="true"></span>${esc(t.nome)} terminou<span class="proj">há ${haQuanto(t.em)}</span>
      <button type="button" class="botao-icone dispensar" data-dispensar="${esc(chave)}" title="Dispensar">✕</button></span>
    <span class="resumo-terminou">${esc(t.resumo)}</span>
    <span class="acoes">${PASSOS.map(([k, rot]) => `<button type="button" class="botao secundario" data-passo="${k}" data-chave="${esc(chave)}">${rot}</button>`).join('')}</span>
  </li>`).join('');
}
document.addEventListener('click', (ev) => {
  const d = ev.target.closest('[data-dispensar]');
  if (d) { terminaram.delete(d.dataset.dispensar); if (ultimo) desenharFila(ultimo); return; }
  const b = ev.target.closest('[data-passo]');
  if (!b) return;
  const t = terminaram.get(b.dataset.chave);
  if (!t) return;
  const passo = PASSOS.find(([k]) => k === b.dataset.passo);
  window.orq.conversa.mandar('orquestrador', passo[2](t.nome, t.resumo));
  document.querySelector('[data-conversa="orquestrador"]')?.click();
  terminaram.delete(b.dataset.chave);
  if (ultimo) desenharFila(ultimo);
}, true);

function desenharFila(r) {
  const extras = cartoesTerminou();
  $('n-fila').textContent = (r.fila.length + terminaram.size) ? String(r.fila.length + terminaram.size) : '';
  const ul = $('fila');
  if (!r.fila.length && !extras) {
    ul.innerHTML = `<li>${VAZIO('i-sino', 'Nada esperando por você', 'Permissões e pedidos ao servidor aparecem aqui.')}</li>`;
    return;
  }
  ul.innerHTML = r.fila.map((p) => {
    if (p.tipo === 'permissao') {
      const cmd = p.entrada?.command || p.entrada?.file_path || JSON.stringify(p.entrada ?? {}, null, 1);
      return `<li class="item-fila">
        <span class="quem"><span class="ponto permissao" aria-hidden="true"></span>Quer usar ${esc(p.ferramenta)}<span class="proj">${esc(p.proj)}</span></span>
        <code class="codigo">${esc(cmd)}</code>
        ${p.entrada?.description ? `<span class="nota">${esc(p.entrada.description)}</span>` : ''}
        <span class="acoes">
          <button type="button" class="botao primario" data-resp="permitir" data-emp="${esc(p.emp)}" data-proj="${esc(p.proj)}" data-id="${esc(p.id)}">Permitir</button>
          <button type="button" class="botao secundario" data-resp="negar" data-emp="${esc(p.emp)}" data-proj="${esc(p.proj)}" data-id="${esc(p.id)}">Negar</button>
          <span class="nota">há ${haQuanto(p.desde)}</span>
        </span></li>`;
    }
    return `<li class="item-fila">
      <span class="quem"><span class="ponto esperando" aria-hidden="true"></span>Pedido ao servidor<span class="proj">${esc(p.proj)}</span></span>
      <code class="codigo">${esc(p.conteudo)}</code>
      <span class="nota">Quem avalia e roda é o orquestrador: diga a ele "olha o pedido ${esc(p.id)}".</span>
    </li>`;
  }).join('') + extras;
}

function desenharDetalhe(r) {
  const i = r.frentes.findIndex((x) => x.chave === selecionada);
  const f = r.frentes[i];
  if (!f) {
    $('titulo-detalhe').textContent = 'Frente';
    $('detalhe').innerHTML = VAZIO('i-lista', 'Nenhuma frente selecionada', 'Clique numa frente à esquerda.');
    return;
  }
  $('titulo-detalhe').textContent = nomeDaFrente(f, i);
  const eventos = [...f.linhaDoTempo].reverse();
  $('detalhe').innerHTML = `
    <div class="detalhe-meta">
      <span class="estado ${f.estado}">${ROTULO[f.estado]}</span>
      ${f.modelo ? `<span class="modelo">${esc(f.modelo)}</span>` : ''}
      ${f.fonte === 'tela' ? '<span class="modelo">lido pela tela</span>' : ''}
      <button type="button" class="botao secundario" data-abrir="${esc(f.sessaoTmux)}"><svg class="ico"><use href="#i-abrir"/></svg>Abrir terminal</button>
    </div>
    <div class="rotulo-pequeno">Última resposta</div>
    ${f.ultimaResposta
      ? `<div class="resposta">${esc(f.ultimaResposta)}</div>`
      : `<p class="nota">${f.fonte === 'tela' ? 'Esta frente ainda não tem o hook de sinais: o estado vem da tela e a resposta inteira não fica disponível.' : 'Sem resposta registrada ainda.'}</p>`}
    ${eventos.length ? `<div class="rotulo-pequeno">Atividade</div><ul class="tempo">${eventos.slice(0, 25).map((e) => `<li><span class="hora">${hora(e.ts)}</span><span class="o-que" title="${esc(descreverEvento(e))}">${esc(descreverEvento(e))}</span></li>`).join('')}</ul>` : ''}`;
}

// Cores do terminal (sequências SGR do `tmux capture-pane -e`) para HTML.
// Só cor, negrito e esmaecido — o espelho é um retrato, não um terminal.
const PALETA = ['#1b2636', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#d7deea',
  '#5c6370', '#ff7b86', '#b5e890', '#ffd68a', '#82c4ff', '#de9cf5', '#7fd6e0', '#ffffff'];
function cor256(n) {
  if (n < 16) return PALETA[n];
  if (n >= 232) { const v = 8 + (n - 232) * 10; return `rgb(${v},${v},${v})`; }
  n -= 16;
  const c = (x) => (x ? 55 + x * 40 : 0);
  return `rgb(${c(Math.floor(n / 36))},${c(Math.floor(n / 6) % 6)},${c(n % 6)})`;
}
function ansiParaHtml(texto) {
  let fg = null, bg = null, negrito = false, fraco = false, saida = '';
  const partes = texto.split(/\x1b\[([\d;]*)m/);
  for (let i = 0; i < partes.length; i++) {
    if (i % 2 === 0) {
      if (!partes[i]) continue;
      const estilo = [fg && `color:${fg}`, bg && `background:${bg}`, negrito && 'font-weight:600', fraco && 'opacity:.6']
        .filter(Boolean).join(';');
      saida += estilo ? `<span style="${estilo}">${esc(partes[i])}</span>` : esc(partes[i]);
      continue;
    }
    const cod = partes[i].split(';').map(Number);
    for (let k = 0; k < cod.length; k++) {
      const c = cod[k] || 0;
      if (c === 0) { fg = bg = null; negrito = fraco = false; }
      else if (c === 1) negrito = true;
      else if (c === 2) fraco = true;
      else if (c === 22) negrito = fraco = false;
      else if (c === 39) fg = null;
      else if (c === 49) bg = null;
      else if (c >= 30 && c <= 37) fg = PALETA[c - 30];
      else if (c >= 90 && c <= 97) fg = PALETA[c - 82];
      else if (c >= 40 && c <= 47) bg = PALETA[c - 40];
      else if (c >= 100 && c <= 107) bg = PALETA[c - 92];
      else if ((c === 38 || c === 48) && cod[k + 1] === 5) { const v = cor256(cod[k + 2]); c === 38 ? fg = v : bg = v; k += 2; }
      else if ((c === 38 || c === 48) && cod[k + 1] === 2) { const v = `rgb(${cod[k + 2]},${cod[k + 3]},${cod[k + 4]})`; c === 38 ? fg = v : bg = v; k += 4; }
    }
  }
  return saida;
}

async function atualizarEspelhos(r) {
  if (!$('aba-grade').classList.contains('ativa')) return;
  const grade = $('grade');
  const vivos = new Set(r.frentes.map((f) => f.pane));
  for (const [pane, el] of espelhos) {
    if (!vivos.has(pane)) { el.remove(); espelhos.delete(pane); }
  }
  if (!r.frentes.length) { grade.innerHTML = VAZIO('i-grade', 'Nenhuma frente aberta', 'Os terminais das frentes aparecem aqui.'); return; }
  grade.querySelector('.vazio')?.remove();
  for (const f of r.frentes) {
    let el = espelhos.get(f.pane);
    if (!el) {
      el = document.createElement('article');
      el.className = 'espelho';
      el.innerHTML = `<header><span class="ponto"></span><span class="nome"></span><span class="proj">${esc(f.proj)}</span>
        <button type="button" class="botao-icone" data-abrir="${esc(f.sessaoTmux)}" title="Abrir terminal" aria-label="Abrir terminal"><svg class="ico"><use href="#i-abrir"/></svg></button></header><pre></pre>`;
      grade.appendChild(el);
      espelhos.set(f.pane, el);
    }
    el.querySelector('.nome').textContent = f.nome;
    el.querySelector('.ponto').className = `ponto ${f.estado}`;
    el.querySelector('.ponto').title = ROTULO[f.estado];
    // Só as últimas linhas com conteúdo: o fim da tela é o que diz o estado.
    const linhas = (await window.orq.espelho(f.pane)).split('\n');
    while (linhas.length && !linhas[linhas.length - 1].replace(/\x1b\[[\d;]*m/g, '').trim()) linhas.pop();
    const pre = el.querySelector('pre');
    pre.innerHTML = ansiParaHtml(linhas.slice(-24).join('\n'));
  }
}

// --- notas -------------------------------------------------------------------
// O editor de notas mora em notas-tela.js.

async function atualizar() {
  try {
    // Testes de tela podem pôr um estado falso (agentes, fila) no lugar do real.
    const r = (window.orq.teste && window.__estadoFalso) || await window.orq.estado();
    ultimo = r;
    if (selecionada && !r.frentes.some((f) => f.chave === selecionada)) selecionada = null;
    if (!selecionada && r.frentes.length) selecionada = r.frentes[0].chave;
    notarTerminos(r);
    desenharTopo(r);
    desenharFrentes(r);
    desenharFila(r);
    desenharDetalhe(r);
    await atualizarEspelhos(r);
  } catch (err) {
    $('projetos').innerHTML = VAZIO('i-terminal', 'Não consegui ler as frentes', `${esc(err.message)}. Tento de novo em 2 s.`);
  }
}

// --- interação --------------------------------------------------------------
document.addEventListener('click', async (ev) => {
  const alvo = ev.target.closest('button');
  if (!alvo) return;
  if (alvo.dataset.chave) {
    selecionada = alvo.dataset.chave;
    if (ultimo) { desenharFrentes(ultimo); desenharDetalhe(ultimo); }
  } else if (alvo.dataset.resp) {
    alvo.disabled = true;
    const ok = await window.orq.responder(alvo.dataset.emp, alvo.dataset.proj, alvo.dataset.id, alvo.dataset.resp);
    if (!ok) alvo.closest('li').innerHTML = '<span class="nota">Já tinha sido respondido no terminal.</span>';
    atualizar();
  } else if (alvo.dataset.fecharTerminal) {
    window.orq.pty.fechar(alvo.dataset.fecharTerminal);
  } else if (alvo.dataset.abrir) {
    abrirTerminalDoAgente(alvo.dataset.abrir);
  } else if (alvo.dataset.aba) {
    document.querySelectorAll('.aba, .sub-aba').forEach((el) => el.classList.remove('ativa'));
    alvo.classList.add('ativa');
    $(alvo.dataset.aba).classList.add('ativa');
    if (alvo.dataset.aba === 'aba-terminal') abrirTerminal();
    if (alvo.dataset.aba === 'aba-orquestrador') $('entrada').focus();
    atualizar();
  }
});

$('filtro').addEventListener('input', () => ultimo && desenharFrentes(ultimo));

// Paleta Ctrl+K: agentes (pedindo permissão ou esperando = esperando você).
window.orqPaleta?.registrar(() => (ultimo ? ultimo.frentes : []).map((f, i) => ({
  grupo: 'Agentes', titulo: nomeDaFrente(f, i), sub: `${ROTULO[f.estado]}${f.tarefa ? ' · ' + f.tarefa : ''}`,
  atencao: f.estado === 'permissao' || f.estado === 'esperando',
  faz: () => { selecionada = f.chave; desenharFrentes(ultimo); desenharDetalhe(ultimo); },
})));

atualizar();
setInterval(atualizar, 2000);
