// Conversas anteriores e o ⋯ de cada conversa (planos 3.2 e 3.3).
//
// "Anteriores": uma janela (no jeito da paleta) com as conversas que o Claude guardou neste
// computador. Dá para buscar, reabrir, arquivar e apagar. A lista, as marcas (aberta agora,
// do orquestrador, arquivada) e todas as conferências vêm do motor (conversa.js,
// anteriores.js, apagar-conversa.js); a tela só mostra e manda o que a pessoa escolheu.
// Apagar é em dois tempos: primeiro o custo (o que some, para onde vai, o que fica), depois
// o botão, que só vale com um clique de verdade.
//
// O ⋯ de cada conversa da lista da esquerda (no lugar do ✕): Renomear, Arquivar, Ramificar,
// Terminal nesta pasta. Apagar fica em Anteriores, onde aparece o que some.
(() => {
  const $ = (id) => document.getElementById(id);
  const A = window.orq && window.orq.anteriores;
  const C = window.orq && window.orq.conversa;
  if (!A || !C) return;
  const { esc } = window.orqUtil;
  const V = () => window.orqConversa;

  // --- a janela "Anteriores" ---------------------------------------------------------------
  const el = document.createElement('div');
  el.className = 'paleta-fundo anteriores-fundo';
  el.id = 'anteriores';
  el.hidden = true;
  el.innerHTML = `<div class="paleta anteriores" role="dialog" aria-label="Conversas anteriores">
      <div class="paleta-busca"><svg class="ico"><use href="#i-busca"/></svg>
        <input type="text" id="anteriores-busca" placeholder="Buscar nas conversas anteriores…" aria-label="Buscar nas conversas anteriores" autocomplete="off" spellcheck="false">
        <button type="button" class="paleta-filtro" id="anteriores-arquivadas" aria-pressed="false">Arquivadas</button></div>
      <ul class="paleta-lista anteriores-lista" role="listbox" id="anteriores-lista"></ul>
      <div class="anteriores-saida" id="anteriores-saida" role="status" aria-live="polite"></div>
      <div class="paleta-rodape"><span>A busca roda só neste computador</span><span>Enter reabre</span><span>Esc fecha</span></div>
    </div>`;
  document.body.append(el);
  const campo = $('anteriores-busca');
  const lista = $('anteriores-lista');
  const saida = $('anteriores-saida');
  const filtro = $('anteriores-arquivadas');
  let conversas = [];
  let soArquivadas = false;
  let escolhido = 0;
  let custo = null; // o cartão de apagar aberto: { sessao, comprovante }
  let vez = 0;

  const tamanho = (b) => (b == null ? '' : b >= 1048576 ? `${(b / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024)).toLocaleString('pt-BR')} KB`);
  function quando(ms) {
    const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (min < 2) return 'agora há pouco';
    if (min < 60) return `há ${min} min`;
    if (min < 60 * 24) return `há ${Math.round(min / 60)} h`;
    if (min < 60 * 48) return 'ontem';
    return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }
  const linha = (html, classe = '') => { saida.innerHTML = `<p class="anteriores-linha ${classe}">${html}</p>`; };
  const vistas = () => {
    const q = campo.value.trim().toLocaleLowerCase();
    return conversas.filter((s) => !!s.arquivada === soArquivadas && (!q || `${s.titulo} ${s.pasta}`.toLocaleLowerCase().includes(q)));
  };
  function desenhar() {
    const l = vistas();
    escolhido = Math.max(0, Math.min(escolhido, l.length - 1));
    const q = campo.value.trim();
    lista.innerHTML = l.map((s, i) => `<li class="paleta-item anteriores-item" role="option" data-sessao="${esc(s.sessao)}" aria-selected="${i === escolhido}">
        <div class="ant-cima"><strong class="titulo" data-sem-traducao>${esc(s.titulo)}</strong><span class="ant-quando">${esc(quando(s.quando))}</span></div>
        <div class="ant-baixo"><code data-sem-traducao>${esc(s.pasta || '~')}</code>${s.bytes == null ? '' : `<span data-sem-traducao>${esc(tamanho(s.bytes))}</span>`}<span data-sem-traducao>${s.motor === 'codex' ? 'Codex' : 'Claude'}</span>
          ${s.aberta != null ? '<span class="ant-marca aberta">aberta agora</span>' : ''}${s.orquestrador ? '<span class="ant-marca">orquestrador</span>' : ''}${s.pastaExiste === false ? '<span class="ant-marca sumiu">a pasta não existe mais</span>' : ''}
          ${s.orquestrador ? '' : `<span class="ant-acoes"><button type="button" class="botao-texto" data-ant="arquivar"${s.aberta != null && !s.arquivada ? ' disabled title="Está aberta: arquive pelo ⋯ dela, na lista da esquerda"' : ''}>${s.arquivada ? 'Desarquivar' : 'Arquivar'}</button>${s.motor === 'codex' ? '' : '<button type="button" class="botao-texto" data-ant="apagar">Apagar…</button>'}</span>`}</div>
      </li>`).join('')
      || `<li class="paleta-vazio"><span>${soArquivadas ? 'Nenhuma conversa arquivada' : 'Nenhuma conversa'}</span>${q ? ` <span data-sem-traducao>“${esc(q)}”</span>` : ''}</li>`;
    const sel = lista.querySelector('[aria-selected="true"]');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
  async function carregar() {
    const minha = ++vez;
    const r = await A.listar().catch((e) => ({ erro: String((e && e.message) || e) }));
    if (minha !== vez || el.hidden) return;
    if (!r || r.erro) { linha(`<span>Não consegui ler as conversas anteriores:</span> <span data-sem-traducao>${esc((r && r.erro) || '')}</span>`, 'erro'); return; }
    conversas = Array.isArray(r.conversas) ? r.conversas : [];
    desenhar();
  }
  const aberta = () => !el.hidden;
  function abrir({ arquivadas = false } = {}) {
    soArquivadas = arquivadas;
    filtro.setAttribute('aria-pressed', String(soArquivadas));
    campo.value = '';
    escolhido = 0;
    custo = null;
    saida.innerHTML = '';
    lista.innerHTML = '<li class="paleta-vazio">Lendo as conversas…</li>';
    el.hidden = false;
    campo.focus();
    carregar();
  }
  function fechar() {
    if (!aberta()) return false;
    if (custo && custo.comprovante) A.cancelarApagar(custo.comprovante);
    custo = null;
    el.hidden = true;
    vez++;
    if ($('entrada')) $('entrada').focus();
    return true;
  }

  async function reabrir(s) {
    const r = await A.reabrir(s.sessao);
    if (!r || r.erro) { linha(`<span>Não reabri:</span> <span data-sem-traducao>${esc((r && r.erro) || '')}</span>`, 'erro'); return; }
    fechar();
    await V().trocar(r.id);
    if (r.jaAberta) V().aviso('Esta conversa já estava aberta: fui para ela.');
  }
  async function arquivar(s) {
    const r = await A.arquivar(s.sessao, !s.arquivada);
    if (!r || r.erro) { linha(`<span>Não deu:</span> <span data-sem-traducao>${esc((r && r.erro) || '')}</span>`, 'erro'); return; }
    linha(`<span>${s.arquivada ? 'Desarquivada:' : 'Arquivada (nada foi apagado):'}</span> <span data-sem-traducao>“${esc(s.titulo)}”</span>`);
    await carregar();
  }
  // O cartão do custo: o que some, para onde vai e o que fica. Sem comprovante (conversa
  // aberta ou do orquestrador), só explica e não oferece o botão.
  async function pedirApagar(s) {
    if (custo && custo.comprovante) A.cancelarApagar(custo.comprovante);
    custo = null;
    const r = await A.prepararApagar(s.sessao);
    const titulo = `<div class="titulo-pedido"><span><span>Apagar</span> <strong data-sem-traducao>“${esc(s.titulo)}”</strong> <span>do histórico?</span></span></div>`;
    if (!r || r.erro) {
      saida.innerHTML = `<div class="cartao-pedido anteriores-custo">${titulo}<p class="anteriores-trava" data-sem-traducao>${esc((r && r.erro) || 'sem resposta do app')}</p>
        <div class="acoes"><button type="button" class="botao secundario" data-custo="fechar">Fechar</button></div></div>`;
      return;
    }
    custo = { sessao: s.sessao, titulo: s.titulo, comprovante: r.comprovante, arquivos: r.custo.arquivos, bytes: r.custo.bytes };
    const k = r.custo;
    const orfaos = (k.orfaos || []).map((o) => `<li><code data-sem-traducao>${esc(o.quem)}</code> <small data-sem-traducao>${esc(o.porque || '')}</small></li>`).join('');
    saida.innerHTML = `<div class="cartao-pedido anteriores-custo">${titulo}
      <dl class="custo-lista">
        <dt>O que some</dt><dd><span data-sem-traducao>${k.arquivos}</span> <span>${k.arquivos === 1 ? 'arquivo de histórico do Claude' : 'arquivos de histórico do Claude'}</span> <span data-sem-traducao>(${esc(tamanho(k.bytes))})</span>${k.comSubagentes ? '<span>, com as conversas dos subagentes desta conversa</span>' : ''}</dd>
        <dt>Para onde vai</dt><dd>Para a lixeira do sistema. Dá para restaurar de lá enquanto a lixeira não for esvaziada.</dd>
        <dt>O que fica</dt><dd>Os arquivos do projeto e todas as outras conversas.</dd>
        ${orfaos ? `<dt>Fica sem dono</dt><dd><span>O Claude guarda isto fora dali, e o app não apaga:</span><ul class="custo-orfaos">${orfaos}</ul></dd>` : ''}
      </dl>
      <div class="acoes"><button type="button" class="botao perigo" data-custo="apagar">Apagar</button><button type="button" class="botao secundario" data-custo="cancelar">Cancelar</button></div></div>`;
    saida.querySelector('[data-custo="cancelar"]').focus();
  }

  campo.addEventListener('input', () => { escolhido = 0; desenhar(); });
  filtro.addEventListener('click', () => { soArquivadas = !soArquivadas; filtro.setAttribute('aria-pressed', String(soArquivadas)); escolhido = 0; desenhar(); campo.focus(); });
  lista.addEventListener('click', (ev) => {
    const li = ev.target.closest('.anteriores-item');
    if (!li) return;
    const s = conversas.find((x) => x.sessao === li.dataset.sessao);
    if (!s) return;
    const b = ev.target.closest('[data-ant]');
    if (b && b.disabled) return;
    if (b && b.dataset.ant === 'apagar') { pedirApagar(s); return; }
    if (b) { arquivar(s); return; }
    reabrir(s);
  });
  saida.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-custo]');
    if (!b) return;
    const k = custo;
    if (b.dataset.custo === 'fechar') { saida.innerHTML = ''; campo.focus(); return; }
    if (!k) return;
    if (b.dataset.custo === 'cancelar') {
      A.cancelarApagar(k.comprovante);
      custo = null;
      linha('Cancelado: nada foi apagado.');
      campo.focus();
      return;
    }
    // Apagar é decisão da pessoa: só um clique de verdade vale.
    if (!ev.isTrusted) return;
    b.disabled = true;
    custo = null;
    const r = await A.apagar(k.sessao, k.comprovante);
    if (!r || r.erro) { linha(`<span>Não apaguei:</span> <span data-sem-traducao>${esc((r && r.erro) || '')}</span>`, 'erro'); return; }
    linha(`<span>Apagada:</span> <span data-sem-traducao>“${esc(k.titulo)}”</span> · <span data-sem-traducao>${k.arquivos}</span> <span>${k.arquivos === 1 ? 'arquivo foi' : 'arquivos foram'} para a lixeira do sistema</span> <span data-sem-traducao>(${esc(tamanho(k.bytes))})</span>`);
    await carregar();
    campo.focus();
  });
  el.addEventListener('mousedown', (ev) => { if (ev.target === el) fechar(); });
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault(); ev.stopPropagation();
      // Com o cartão de apagar aberto, o primeiro Esc desiste de apagar; o segundo fecha a janela.
      if (custo) { A.cancelarApagar(custo.comprovante); custo = null; linha('Cancelado: nada foi apagado.'); campo.focus(); return; }
      fechar();
      return;
    }
    if (ev.target !== campo) return;
    const l = vistas();
    if (ev.key === 'ArrowDown') { ev.preventDefault(); escolhido = Math.min(escolhido + 1, l.length - 1); desenhar(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); escolhido = Math.max(escolhido - 1, 0); desenhar(); }
    else if (ev.key === 'Enter' && l[escolhido]) { ev.preventDefault(); reabrir(l[escolhido]); }
  });
  if ($('abrir-anteriores')) $('abrir-anteriores').addEventListener('click', () => abrir());

  // --- o ⋯ de cada conversa da lista ------------------------------------------------------
  const menu = $('menu-conversa');
  const avisoLateral = $('aviso-lateral');
  let dona = null; // a conversa do menu aberto
  let tAviso = null;
  const menuAberto = () => !!menu && !menu.hidden;
  function fecharMenu() {
    if (!menuAberto()) return false;
    menu.hidden = true;
    for (const b of document.querySelectorAll('[data-mais-conversa][aria-expanded="true"]')) b.setAttribute('aria-expanded', 'false');
    dona = null;
    return true;
  }
  function avisarNaLateral(html, ms = 9000) {
    clearTimeout(tAviso);
    avisoLateral.innerHTML = html;
    avisoLateral.hidden = false;
    tAviso = setTimeout(() => { avisoLateral.hidden = true; avisoLateral.innerHTML = ''; }, ms);
  }
  function desenharMenu(c) {
    menu.innerHTML = `<button type="button" role="menuitem" data-m="renomear"><span>Renomear</span><small>O nome muda aqui e no histórico do Claude.</small></button>
      <button type="button" role="menuitem" data-m="arquivar"><span>Arquivar</span><small>Sai da lista; fica em Anteriores › Arquivadas.</small></button>
      <button type="button" role="menuitem" data-m="ramificar"><span>Ramificar</span><small>Abre outra conversa com uma cópia desta até aqui.</small></button>
      <button type="button" role="menuitem" data-m="terminal"><span>Terminal nesta pasta</span><small data-sem-traducao>${esc(c.pasta || '~')}</small></button>
      <hr>
      <button type="button" role="menuitem" data-m="apagar"><span>Apagar…</span><small>Só em Anteriores, mostrando o que some.</small></button>`;
  }
  function abrirMenu(botao) {
    const id = botao.dataset.maisConversa;
    if (menuAberto() && dona === id) { fecharMenu(); return; }
    const c = V().lista().find((x) => x.id === id);
    if (!c) return;
    fecharMenu();
    dona = id;
    desenharMenu(c);
    menu.hidden = false;
    botao.setAttribute('aria-expanded', 'true');
    // Ao lado da lista, para não cobrir as outras conversas.
    const r = botao.closest('.item-conversa').getBoundingClientRect();
    menu.style.left = `${Math.min(r.right + 8, innerWidth - menu.offsetWidth - 8)}px`;
    menu.style.top = `${Math.max(8, Math.min(r.top, innerHeight - menu.offsetHeight - 8))}px`;
    menu.querySelector('button').focus();
  }
  // Renomear: o menu vira um campo com o nome de agora (a lista é redesenhada a todo momento,
  // então o campo mora no menu e não na linha da conversa).
  function pedirNome(c) {
    menu.innerHTML = `<form class="menu-renomear" autocomplete="off"><label for="nome-conversa">Nome da conversa</label>
      <input type="text" id="nome-conversa" maxlength="200" value="${esc(c.titulo)}">
      <p class="menu-nota menu-erro" role="status" hidden></p>
      <div class="acoes"><button type="submit" class="botao primario">Renomear</button><button type="button" class="botao secundario" data-m="cancelar">Cancelar</button></div></form>`;
    const campoNome = $('nome-conversa');
    campoNome.focus(); campoNome.select();
    // Enter no campo grava (sem depender do envio implícito do formulário).
    campoNome.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); menu.querySelector('form').requestSubmit(); } });
    menu.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const r = await C.renomear(c.id, campoNome.value);
      if (!r || r.erro) { const e = menu.querySelector('.menu-erro'); e.textContent = `Não renomeei: ${(r && r.erro) || 'sem resposta do app'}`; e.hidden = false; return; }
      fecharMenu();
      avisarNaLateral(`<span>Renomeada para</span> <span data-sem-traducao>“${esc(r.titulo)}”</span>`, 5000);
    });
  }
  if (menu) {
    document.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-mais-conversa]');
      if (b) { ev.stopPropagation(); abrirMenu(b); }
    }, true);
    menu.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-m]');
      if (!b) return;
      const id = dona;
      const c = V().lista().find((x) => x.id === id);
      if (b.dataset.m === 'cancelar' || !c) { fecharMenu(); return; }
      if (b.dataset.m === 'renomear') { pedirNome(c); return; }
      fecharMenu();
      if (b.dataset.m === 'arquivar') {
        const eraAtiva = V().ativa() === id;
        const r = await C.arquivar(id);
        if (!r || r.erro) { avisarNaLateral(`<span>Não arquivei:</span> <span data-sem-traducao>${esc((r && r.erro) || '')}</span>`); return; }
        if (eraAtiva) await V().trocar('orquestrador');
        if (!r.arquivada) { avisarNaLateral('A conversa ainda não tinha começado: só saiu da lista.', 5000); return; }
        avisarNaLateral(`<span>Arquivada:</span> <span data-sem-traducao>“${esc(r.titulo)}”</span><span>. Está em Anteriores › Arquivadas; nada foi apagado.</span> <button type="button" class="botao-texto" data-desfazer="${esc(r.sessao)}">Desfazer</button>`);
      } else if (b.dataset.m === 'ramificar') {
        const r = await window.orq.comandos.ramificar(id, '');
        if (!r || r.erro) { avisarNaLateral(`<span>Não ramifiquei:</span> <span data-sem-traducao>${esc((r && r.erro) || '')}</span>`); return; }
        await V().trocar(r.id);
      } else if (b.dataset.m === 'terminal') {
        const ok = window.orqTerminal && window.orqTerminal.abrirNaPasta ? await window.orqTerminal.abrirNaPasta(id) : false;
        if (!ok) avisarNaLateral('Não consegui abrir o terminal nesta pasta.');
      } else if (b.dataset.m === 'apagar') abrir();
    });
    menu.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fecharMenu(); } });
    document.addEventListener('mousedown', (ev) => { if (menuAberto() && !ev.target.closest('#menu-conversa, [data-mais-conversa]')) fecharMenu(); });
    avisoLateral.addEventListener('click', async (ev) => {
      const d = ev.target.closest('[data-desfazer]');
      if (!d) return;
      const r = await A.reabrir(d.dataset.desfazer);
      if (!r || r.erro) { avisarNaLateral(`<span>Não reabri:</span> <span data-sem-traducao>${esc((r && r.erro) || '')}</span>`); return; }
      clearTimeout(tAviso);
      avisoLateral.hidden = true;
      await V().trocar(r.id);
    });
  }

  window.orqAnteriores = { abrir, fechar, aberta, fecharMenu, menuAberto };
})();
