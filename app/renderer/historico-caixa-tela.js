// O que a pessoa já escreveu, na caixa de mensagem (plano 4.4): a seta ↑ com a caixa vazia e a
// busca do Ctrl+R, como no terminal. O atalho da busca é dos que a pessoa troca ou desliga em
// Configurações › Atalhos (colunas-tela.js guarda a combinação).
//
// De onde vem: do que foi mandado desde que o app abriu (conversa-tela.js) e das conversas que o
// Claude guarda da mesma pasta (o motor lê só o fim dos arquivos mais novos; nada é gravado
// pelo app). Esse texto pode ter colagens da pessoa: ele só aparece na caixa e nesta busca,
// nunca em aviso, no bichinho ou em notificação.
(() => {
  const C = window.orq && window.orq.conversa;
  if (!C || !C.promptsAnteriores) return;
  const { esc } = window.orqUtil;
  const V = () => window.orqConversa;
  const guardados = new Map(); // conversa → o que veio das conversas guardadas (da mais nova para a mais antiga)
  const pedidos = new Map(); // conversa → pedido em andamento

  // Busca (uma vez por conversa, de novo só se pedirem) o que a pessoa escreveu naquela pasta.
  function buscar(id, { deNovo = false } = {}) {
    if (!id) return Promise.resolve([]);
    if (!deNovo && guardados.has(id)) return Promise.resolve(guardados.get(id));
    if (pedidos.has(id)) return pedidos.get(id);
    const p = C.promptsAnteriores(id).then((l) => {
      const limpa = Array.isArray(l) ? l.filter((t) => typeof t === 'string' && t) : [];
      guardados.set(id, limpa);
      return limpa;
    }).catch(() => []).finally(() => pedidos.delete(id));
    pedidos.set(id, p);
    return p;
  }
  // Para a seta ↑: do mais antigo para o mais novo, sem repetir. O que foi mandado nesta
  // abertura do app fica por último (é o mais novo), na ordem em que foi mandado.
  function paraASeta(enviados) {
    const daSessao = enviados.filter((t, i) => enviados.lastIndexOf(t) === i);
    const ja = new Set(daSessao);
    const antigos = (guardados.get(V().ativa()) || []).filter((t) => !ja.has(t)).reverse();
    return [...antigos, ...daSessao];
  }

  // --- a busca (Ctrl+R) -----------------------------------------------------------------
  const el = document.createElement('div');
  el.className = 'paleta-fundo historico-fundo';
  el.id = 'busca-historico';
  el.hidden = true;
  el.innerHTML = `<div class="paleta historico" role="dialog" aria-label="Buscar no que você já escreveu">
      <div class="paleta-busca"><svg class="ico"><use href="#i-busca"/></svg>
        <input type="text" id="busca-historico-texto" placeholder="Buscar no que você já escreveu…" aria-label="Buscar no que você já escreveu" autocomplete="off" spellcheck="false"></div>
      <ul class="paleta-lista historico-lista" role="listbox" id="busca-historico-lista"></ul>
      <div class="paleta-rodape"><span>↑↓ navega</span><span>Enter põe na caixa (não envia)</span><span>Esc fecha</span></div>
    </div>`;
  document.body.append(el);
  const campo = document.getElementById('busca-historico-texto');
  const lista = document.getElementById('busca-historico-lista');
  let todos = []; // da mais nova para a mais antiga
  let escolhido = 0;
  const vistos = () => {
    const q = campo.value.trim().toLocaleLowerCase();
    return (q ? todos.filter((t) => t.toLocaleLowerCase().includes(q)) : todos).slice(0, 100);
  };
  function desenhar() {
    const l = vistos();
    escolhido = Math.max(0, Math.min(escolhido, l.length - 1));
    lista.innerHTML = l.map((t, i) => `<li class="paleta-item historico-item" role="option" data-i="${i}" aria-selected="${i === escolhido}"><span class="historico-texto" data-sem-traducao>${esc(t.length > 300 ? `${t.slice(0, 300)}…` : t)}</span></li>`).join('')
      || `<li class="paleta-vazio">${todos.length ? 'Nada encontrado.' : 'Você ainda não escreveu nada nesta pasta.'}</li>`;
    const sel = lista.querySelector('[aria-selected="true"]');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
  const aberta = () => !el.hidden;
  function fechar() {
    if (!aberta()) return false;
    el.hidden = true;
    const entrada = document.getElementById('entrada');
    if (entrada) entrada.focus();
    return true;
  }
  function escolher(t) {
    fechar();
    if (t != null) V().porNaCaixa(t);
  }
  async function abrir() {
    const enviados = V().enviados();
    const montar = () => { todos = paraASeta(enviados).reverse(); };
    montar();
    campo.value = '';
    escolhido = 0;
    el.hidden = false;
    desenhar();
    campo.focus();
    // O que está guardado nas conversas da pasta chega em seguida (lido de novo a cada abertura).
    const id = V().ativa();
    await buscar(id, { deNovo: true });
    if (aberta() && id === V().ativa()) { montar(); desenhar(); }
  }
  campo.addEventListener('input', () => { escolhido = 0; desenhar(); });
  lista.addEventListener('click', (ev) => {
    const li = ev.target.closest('.historico-item');
    if (li) escolher(vistos()[Number(li.dataset.i)]);
  });
  el.addEventListener('mousedown', (ev) => { if (ev.target === el) fechar(); });
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fechar(); return; }
    const l = vistos();
    if (ev.key === 'ArrowDown') { ev.preventDefault(); escolhido = Math.min(escolhido + 1, l.length - 1); desenhar(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); escolhido = Math.max(escolhido - 1, 0); desenhar(); }
    else if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); if (l[escolhido] != null) escolher(l[escolhido]); }
  });
  // O atalho (Ctrl+R, se a pessoa não trocou) vale com a conversa na frente e o teclado na caixa
  // de mensagem. Fora disso a tecla segue o caminho dela: no terminal é do terminal e, no resto
  // do app, o Ctrl+R de fábrica recarrega a tela. O preventDefault é o que impede esse recarregar.
  const A = window.orqAtalhos;
  const atalho = () => (window.orqColunas && window.orqColunas.atalhoEscritos ? window.orqColunas.atalhoEscritos() : A.PADRAO_ESCRITOS);
  document.addEventListener('keydown', (ev) => {
    const combinacao = atalho();
    if (!combinacao || A.deEvento(ev) !== combinacao) return;
    if (!document.getElementById('aba-orquestrador').classList.contains('ativa')) return;
    if (aberta()) { ev.preventDefault(); return; }
    if (document.querySelector('#popup:not([hidden]), #config:not([hidden]), .paleta-fundo:not([hidden]), #visor-imagem:not([hidden])')) return;
    const foco = document.activeElement;
    if (foco && foco !== document.body && foco.id !== 'entrada') return;
    ev.preventDefault();
    abrir();
  });

  window.orqHistorico = { buscar, paraASeta, abrir, fechar, aberta };
  // A conversa que já está na tela quando o app abre: busca por trás, para o primeiro ↑ já achar.
  setTimeout(() => { if (V()) buscar(V().ativa()); }, 0);
})();
