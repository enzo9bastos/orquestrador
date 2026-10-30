// O bichinho do app: menu do botão direito, guarda-roupa (30 itens e cores),
// chamar o ajudante (dois cliques ou Ctrl+Alt+Espaço) e o "passeio" pela
// área de trabalho. Quando ele está lá fora, some daqui de dentro.
(() => {
  const $ = (id) => document.getElementById(id);
  const P = window.orq.pet;
  const V = window.petVisual;
  const pet = window.orqPetAtual;
  if (!P || !V || !pet) return; // ponte antiga ou sem bichinho
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let visual = V.limpar(null);

  P.prefs().then((p) => { visual = V.limpar(p.visual); pet.vestir(visual); pet.esconder(!!p.fora); }).catch(() => {});
  P.aoVisual((v) => { visual = V.limpar(v); pet.vestir(visual); if (!$('guarda-roupa').hidden) desenhar(); });
  P.aoFora((f) => pet.esconder(!!f));

  const chamar = (capturar = false) => { pet.falar(capturar ? 'Recorta aí!' : 'Já vou!', 900); P.chamar({ capturar }); };
  pet.aoChamar = () => chamar();

  // --- menu do botão direito -------------------------------------------------
  const menu = document.createElement('ul');
  menu.className = 'menu-contexto pet-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  menu.innerHTML = `<li role="menuitem" data-pm="conversar">Conversar com ele<span>2 cliques</span></li>
    <li role="menuitem" data-pm="print">📷 Mostrar um pedaço da tela</li>
    <li role="menuitem" data-pm="roupa">Guarda-roupa…</li>
    <li role="menuitem" data-pm="passear">Passear pela área de trabalho</li>
    <li role="menuitem" data-pm="esconder">Esconder o bichinho</li>`;
  document.body.append(menu);
  pet.aoMenu = (ev) => {
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(ev.clientX, innerWidth - r.width - 8)}px`;
    menu.style.top = `${Math.min(ev.clientY, innerHeight - r.height - 8)}px`;
  };
  document.addEventListener('pointerdown', (ev) => { if (!menu.hidden && !menu.contains(ev.target)) menu.hidden = true; });
  menu.addEventListener('click', (ev) => {
    const m = ev.target.closest('[data-pm]')?.dataset.pm;
    if (!m) return;
    menu.hidden = true;
    if (m === 'conversar') chamar();
    else if (m === 'print') chamar(true);
    else if (m === 'roupa') abrir();
    else if (m === 'passear') { pet.falar('Vou dar uma volta lá fora!', 1200); setTimeout(() => P.passear(), 600); }
    else if (m === 'esconder') window.orq.config.gravar({ mostrarBichinho: false }).then(() => window.dispatchEvent(new CustomEvent('orq:config', { detail: { mostrarBichinho: false } })));
  });

  // Ctrl+Alt+Espaço dentro do app também chama (fora, é o atalho do sistema).
  document.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey && ev.altKey && ev.code === 'Space') { ev.preventDefault(); chamar(); }
  });

  // --- guarda-roupa --------------------------------------------------------
  const caixa = document.createElement('div');
  caixa.className = 'gr-fundo';
  caixa.id = 'guarda-roupa';
  caixa.hidden = true;
  caixa.innerHTML = '<div class="gr" role="dialog" aria-modal="true" aria-label="Guarda-roupa do bichinho"></div>';
  document.body.append(caixa);
  const gr = caixa.firstChild;

  async function abrir() {
    caixa.hidden = false;
    desenhar();
    const [p, atalho] = await Promise.all([P.prefs(), P.atalhoInstalado().catch(() => false)]);
    gr.querySelector('[data-avisar-fora]').checked = p.avisarFora;
    gr.querySelector('[data-atalho-status]').textContent = atalho ? 'Atalho do sistema criado: Ctrl+Alt+Espaço chama ele de qualquer lugar.' : 'Ainda sem atalho do sistema.';
    gr.querySelector('[data-criar-atalho]').hidden = atalho;
  }
  const fechar = () => { caixa.hidden = true; };
  function desenhar() {
    const contagem = Object.keys(visual.itens).length;
    gr.innerHTML = `<header class="gr-topo"><h3>Guarda-roupa</h3><span class="nota">${contagem ? `${contagem} ${contagem === 1 ? 'item' : 'itens'} vestido${contagem === 1 ? '' : 's'}` : 'sem roupa nenhuma'}</span>
        <button type="button" class="botao-texto" data-gr-sortear title="Uma combinação ao acaso">🎲 Surpresa</button>
        <button type="button" class="botao-texto" data-gr-tirar>Tirar tudo</button>
        <button type="button" class="botao-icone" data-gr-fechar aria-label="Fechar">✕</button></header>
      <div class="gr-corpo">
        <div class="gr-vitrine"><div class="pet gr-pet"><div class="pet-vira">${V.svg(visual)}</div></div>
          <div class="gr-especies">${Object.entries(V.ESPECIES).map(([k, e]) => `<button type="button" class="gr-especie${visual.especie === k ? ' ativa' : ''}" data-gr-especie="${k}" title="${esc(e.nome)}"><span class="gr-especie-mini">${V.svg({ ...visual, especie: k })}</span><span>${esc(e.nome)}</span></button>`).join('')}</div>
          <div class="gr-cores">${V.CORES.map(([k, nome, cor]) => `<button type="button" class="gr-cor${visual.cor === k ? ' ativa' : ''}" data-gr-cor="${k}" title="${esc(nome)}" aria-label="${esc(nome)}" style="--c:${cor || 'var(--claude)'}"></button>`).join('')}</div></div>
        <div class="gr-partes">${V.PARTES.map(([parte, rot]) => `<section><div class="menu-titulo">${rot}</div><div class="gr-itens">
          <button type="button" class="gr-item${visual.itens[parte] ? '' : ' ativo'}" data-gr-parte="${parte}" data-gr-item=""><span class="gr-nada">—</span><span>Nenhum</span></button>
          ${Object.entries(V.ITENS).filter(([, i]) => i.parte === parte).map(([id, i]) => `<button type="button" class="gr-item${visual.itens[parte] === id ? ' ativo' : ''}" data-gr-parte="${parte}" data-gr-item="${id}" title="${esc(i.nome)}">${V.miniatura(id)}<span>${esc(i.nome)}</span></button>`).join('')}
        </div></section>`).join('')}
        <section class="gr-fora"><div class="menu-titulo">Fora do app</div>
          <label class="marcar"><input type="checkbox" data-avisar-fora> Vir à tela quando houver pendência e o app estiver fora de foco</label>
          <p class="nota" data-atalho-status></p>
          <button type="button" class="botao-texto" data-criar-atalho>Criar atalho Ctrl+Alt+Espaço no sistema</button>
          <p class="nota">Ctrl+Alt+Espaço (ou dois cliques nele) abre a conversa com ele; “📷 Pedaço da tela” recorta o que você está vendo e manda junto. As conversas ficam na conversa “Ajudante” do app.</p>
        </section></div>
      </div>`;
  }
  async function vestir(novo) {
    visual = V.limpar(novo);
    pet.vestir(visual);
    desenhar();
    await P.gravarVisual(visual);
    if (!caixa.hidden) abrirAjustesDepois();
  }
  // Os ajustes de "Fora do app" vêm do processo principal: relê depois de redesenhar.
  const abrirAjustesDepois = () => P.prefs().then((p) => { const c = gr.querySelector('[data-avisar-fora]'); if (c) c.checked = p.avisarFora; return P.atalhoInstalado(); }).then((a) => {
    const s = gr.querySelector('[data-atalho-status]'); if (s) s.textContent = a ? 'Atalho do sistema criado: Ctrl+Alt+Espaço chama ele de qualquer lugar.' : 'Ainda sem atalho do sistema.';
    const b = gr.querySelector('[data-criar-atalho]'); if (b) b.hidden = !!a;
  }).catch(() => {});
  caixa.addEventListener('pointerdown', (ev) => { if (ev.target === caixa) fechar(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !caixa.hidden) fechar(); });
  gr.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.grFechar !== undefined) return fechar();
    if (b.dataset.grCor) return vestir({ ...visual, cor: b.dataset.grCor });
    if (b.dataset.grEspecie) { pet.classe('feliz'); setTimeout(() => pet.classe('feliz', false), 700); return vestir({ ...visual, especie: b.dataset.grEspecie }); }
    if (b.dataset.grParte) {
      const itens = { ...visual.itens };
      if (b.dataset.grItem) itens[b.dataset.grParte] = b.dataset.grItem; else delete itens[b.dataset.grParte];
      pet.classe('feliz'); setTimeout(() => pet.classe('feliz', false), 700);
      return vestir({ ...visual, itens });
    }
    if (b.dataset.grTirar !== undefined) return vestir({ especie: visual.especie, cor: visual.cor, itens: {} });
    if (b.dataset.grSortear !== undefined) {
      const itens = {};
      for (const [parte] of V.PARTES) {
        if (Math.random() < 0.45) continue;
        const ops = Object.keys(V.ITENS).filter((id) => V.ITENS[id].parte === parte);
        itens[parte] = ops[Math.floor(Math.random() * ops.length)];
      }
      const cor = V.CORES[Math.floor(Math.random() * V.CORES.length)][0];
      const especies = Object.keys(V.ESPECIES);
      return vestir({ especie: especies[Math.floor(Math.random() * especies.length)], cor, itens });
    }
    if (b.dataset.criarAtalho !== undefined) {
      b.disabled = true;
      const r = await P.instalarAtalho();
      b.disabled = false;
      gr.querySelector('[data-atalho-status]').textContent = r.ok ? 'Atalho criado: Ctrl+Alt+Espaço chama ele de qualquer lugar.' : r.erro;
      if (r.ok) b.hidden = true;
    }
    return null;
  });
  gr.addEventListener('change', (ev) => {
    if (ev.target.matches('[data-avisar-fora]')) P.gravarPrefs({ avisarFora: ev.target.checked });
  });

  window.orqPaleta?.registrar(() => [
    { grupo: 'Bichinho', titulo: 'Guarda-roupa do bichinho', faz: abrir },
    { grupo: 'Bichinho', titulo: 'Chamar o ajudante', sub: 'Ctrl+Alt+Espaço', faz: () => chamar() },
    { grupo: 'Bichinho', titulo: 'Mostrar um pedaço da tela ao ajudante', faz: () => chamar(true) },
  ]);
  window.orqGuardaRoupa = { abrir, fechar, visual: () => visual };
})();
