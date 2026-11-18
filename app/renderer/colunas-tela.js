// Colunas laterais recolhíveis, no estilo do Obsidian: a de agentes (esquerda)
// e a de demandas (direita) recolhem por um botão discreto no topo, ou por
// atalho (padrão: Ctrl+Alt+, e Ctrl+Alt+.; dá para trocar, desligar e voltar ao
// padrão em Configurações › Atalhos). Aberta, a coluna é a mesma de
// sempre; recolhida, nada some: o botão da lateral mostra quantos pedidos
// esperam você, e os chips do topo abrem a coluna onde está o que contam.
//
// Foco ao trocar de aba: no Orquestrador as colunas ficam como o usuário
// deixou (padrão: abertas); nas outras abas (Notas, Repertório, Workflows,
// Recados, Terminais) elas recolhem ao entrar, e o que o usuário reabrir fica
// lembrado para aquela aba. O estado vai em config.json (chave "colunas").
(() => {
  const $ = (id) => document.getElementById(id);
  const ABA_CONVERSA = 'aba-orquestrador';
  const padrao = (aba) => (aba === ABA_CONVERSA ? { agentes: true, demandas: true } : { agentes: false, demandas: false });
  const LADOS = {
    agentes: { botao: 'alternar-agentes', coluna: 'coluna-agentes', classe: 'sem-agentes', nome: 'agentes' },
    demandas: { botao: 'alternar-demandas', coluna: 'coluna-demandas', classe: 'sem-demandas', nome: 'demandas' },
  };
  const A = window.orqAtalhos;
  // Os atalhos que a pessoa pode trocar: os dois das colunas e os soltos da lista (pergunta
  // rápida, busca no que já escreveu, guardar o rascunho, editor de texto).
  const SOLTOS = Object.entries(A.SOLTOS); // [nome, { chave, padrao }], na ordem da tela
  const PADROES = { ...A.PADRAO, ...Object.fromEntries(SOLTOS.map(([n, s]) => [n, s.padrao])) };
  const TROCAVEIS = Object.keys(PADROES);
  let atalhos = { ...PADROES }; // nome → combinação ("" = desligado)

  let salvo = {}; // aba → { agentes, demandas }: só o que o usuário mexeu
  let aba = (document.querySelector('.sub-aba.ativa') || {}).dataset?.aba || ABA_CONVERSA;
  let estado = { ...(salvo[aba] || padrao(aba)) };
  let sinais = { agentes: 0, demandas: 0 };
  let ultimoEstado = null;
  const vistos = { agentes: 0, demandas: 0 }; // último número mostrado no sinal de cada lado

  const texto = (lado) => {
    const L = LADOS[lado];
    const n = sinais[lado];
    const aberta = estado[lado];
    const base = `${aberta ? 'Recolher' : 'Abrir'} a coluna de ${L.nome}${atalhos[lado] ? ` (${A.mostrar(atalhos[lado])})` : ''}`;
    return !aberta && n ? `${base} · ${n} ${n === 1 ? 'precisa' : 'precisam'} de você` : base;
  };

  function desenhar() {
    for (const lado of Object.keys(LADOS)) {
      const L = LADOS[lado];
      document.body.classList.toggle(L.classe, !estado[lado]);
      const b = $(L.botao);
      const t = texto(lado);
      b.title = t;
      b.setAttribute('aria-label', t);
      b.setAttribute('aria-expanded', String(!!estado[lado]));
      b.classList.toggle('recolhida', !estado[lado]);
      // O sinal só aparece com a coluna fechada: aberta, o que espera já está à vista.
      const sinal = b.querySelector('.sinal-coluna');
      const mostrar = !estado[lado] && sinais[lado] > 0;
      // Pulsa 3 vezes quando aparece ou o número sobe, e fica parado.
      if (mostrar && (sinal.hidden || sinais[lado] > vistos[lado])) { sinal.classList.remove('novo'); void sinal.offsetWidth; sinal.classList.add('novo'); }
      vistos[lado] = mostrar ? sinais[lado] : 0;
      sinal.hidden = !mostrar;
      sinal.textContent = mostrar ? (sinais[lado] > 9 ? '9+' : String(sinais[lado])) : '';
      b.classList.toggle('com-sinal', mostrar);
      $(L.coluna).toggleAttribute('inert', !estado[lado]);
    }
  }

  function gravar() {
    salvo = { ...salvo, [aba]: { agentes: !!estado.agentes, demandas: !!estado.demandas } };
    try { window.orq.config.gravar({ colunas: salvo }).catch(() => {}); } catch { /* sem o processo principal: vale só nesta abertura */ }
  }

  function definir(lado, aberta, { guardar = true } = {}) {
    if (!!estado[lado] === !!aberta) return;
    estado = { ...estado, [lado]: !!aberta };
    // Foco dentro da coluna que recolhe iria para o nada: volta ao botão.
    if (!aberta && $(LADOS[lado].coluna).contains(document.activeElement)) $(LADOS[lado].botao).focus();
    desenhar();
    if (guardar) gravar();
    window.dispatchEvent(new CustomEvent('orq:colunas', { detail: { aba, ...estado } }));
  }

  function entrarNaAba(nova) {
    if (nova === aba) return;
    aba = nova;
    const novo = salvo[aba] || padrao(aba);
    for (const lado of Object.keys(LADOS)) {
      if (!!estado[lado] === !!novo[lado]) continue;
      if (!novo[lado] && $(LADOS[lado].coluna).contains(document.activeElement)) $(LADOS[lado].botao).focus();
    }
    estado = { ...novo };
    desenhar();
    window.dispatchEvent(new CustomEvent('orq:colunas', { detail: { aba, ...estado } }));
  }

  // O que espera você em cada lado: agentes pedindo permissão ou esperando e
  // perguntas de conversas (esquerda); a fila "Precisa de você" (direita).
  function contar() {
    const r = ultimoEstado;
    const conversas = document.querySelectorAll('#conversas .ponto.permissao').length;
    sinais = {
      agentes: (r ? r.frentes.filter((f) => f.estado === 'permissao' || f.estado === 'esperando').length : 0) + conversas,
      demandas: r ? r.fila.length : 0,
    };
    desenhar();
  }
  window.addEventListener('orq:estado', (ev) => { ultimoEstado = ev.detail; contar(); });
  new MutationObserver(contar).observe($('conversas'), { childList: true, subtree: true });

  // Botões, chips do topo e escolha de uma frente (o detalhe mora na direita).
  document.addEventListener('click', (ev) => {
    const alternar = ev.target.closest('.alternar-coluna');
    if (alternar) {
      const lado = alternar.id === LADOS.agentes.botao ? 'agentes' : 'demandas';
      definir(lado, !estado[lado]);
      return;
    }
    const chip = ev.target.closest('[data-abrir-coluna]');
    if (chip) { definir(chip.dataset.abrirColuna, true); return; }
    const aba2 = ev.target.closest('[data-aba]');
    if (aba2 && aba2.classList.contains('sub-aba')) entrarNaAba(aba2.dataset.aba);
  });
  window.addEventListener('orq:detalhe', () => definir('demandas', true));

  // Atalhos: pelo código da tecla (igual em qualquer teclado). Enquanto a
  // engrenagem captura uma combinação nova, eles ficam quietos.
  let capturando = false;
  document.addEventListener('keydown', (ev) => {
    if (capturando) return;
    const c = A.deEvento(ev);
    if (!c) return;
    const lado = Object.keys(LADOS).find((l) => atalhos[l] && atalhos[l] === c);
    if (lado) { ev.preventDefault(); definir(lado, !estado[lado]); return; }
    // Pergunta rápida: só com a conversa na frente e sem janela por cima.
    if (!atalhos.pergunta || atalhos.pergunta !== c || !window.orqConversa || !window.orqConversa.perguntaRapida) return;
    if (!$('aba-orquestrador').classList.contains('ativa')) return;
    if (document.querySelector('#popup:not([hidden]), #config:not([hidden]), .paleta-fundo:not([hidden]), #visor-imagem:not([hidden])')) return;
    ev.preventDefault();
    window.orqConversa.perguntaRapida();
  }, true);

  // --- Configurações › Atalhos -------------------------------------------------
  const aviso = (...frases) => {
    const el = $('atalhos-aviso');
    el.classList.toggle('erro', frases.length > 0);
    el.replaceChildren(...frases.flatMap((f, i) => [...(i ? [' '] : []), Object.assign(document.createElement('span'), { textContent: f })]));
  };
  function desenharAtalhos() {
    for (const lado of TROCAVEIS) {
      const b = document.querySelector(`[data-atalho-mudar="${lado}"]`);
      b.textContent = atalhos[lado] ? A.mostrar(atalhos[lado]) : 'Desligado';
      b.classList.toggle('desligado', !atalhos[lado]);
      document.querySelector(`[data-atalho-desligar="${lado}"]`).disabled = !atalhos[lado];
      document.querySelector(`[data-atalho-padrao="${lado}"]`).disabled = atalhos[lado] === PADROES[lado];
    }
    desenhar();
  }
  async function gravarAtalhos(novos) {
    const antes = atalhos;
    atalhos = novos;
    desenharAtalhos();
    try {
      const r = await window.orq.config.gravar({ atalhosColunas: { agentes: novos.agentes, demandas: novos.demandas }, ...Object.fromEntries(SOLTOS.map(([n, s]) => [s.chave, novos[n]])) });
      if (r && r.recusado && ['atalhosColunas', ...SOLTOS.map(([, s]) => s.chave)].some((k) => r.recusado.includes(k))) { atalhos = antes; desenharAtalhos(); aviso('Não gravei: combinação inválida.'); }
    } catch { /* sem o processo principal: vale só nesta abertura */ }
  }
  function motivo(c, lado) {
    const outros = TROCAVEIS.filter((l) => l !== lado && atalhos[l]);
    const r = A.conferir(c, outros.map((l) => atalhos[l]));
    if (!r) return [];
    if (r.motivo === 'em-uso') return ['Esta combinação já é usada por', r.usadoPor];
    if (r.motivo === 'repetida') {
      const igual = outros.find((l) => atalhos[l] === c);
      return [lado in LADOS && igual in LADOS ? 'As duas colunas não podem ter o mesmo atalho.' : 'Esta combinação já é de outro atalho desta lista.'];
    }
    if (r.motivo === 'sem-modificador') return ['Use Ctrl, Alt ou Cmd junto com outra tecla.'];
    return ['Combinação inválida.'];
  }
  function capturar(lado, botao) {
    capturando = true;
    botao.classList.add('capturando');
    botao.textContent = 'Aperte as teclas… (Esc cancela)';
    aviso();
    const sair = () => { capturando = false; botao.classList.remove('capturando'); document.removeEventListener('keydown', ao, true); botao.removeEventListener('blur', sair); desenharAtalhos(); };
    function ao(ev) {
      ev.preventDefault(); ev.stopImmediatePropagation();
      if (ev.key === 'Escape') { sair(); return; }
      const c = A.deEvento(ev);
      if (!c) return; // só um modificador: espera o resto
      const m = motivo(c, lado);
      if (m.length) { aviso(...m); botao.textContent = 'Aperte as teclas… (Esc cancela)'; return; }
      sair();
      gravarAtalhos({ ...atalhos, [lado]: c });
    }
    document.addEventListener('keydown', ao, true);
    botao.addEventListener('blur', sair);
  }
  document.addEventListener('click', (ev) => {
    const mudar = ev.target.closest('[data-atalho-mudar]');
    if (mudar) { capturar(mudar.dataset.atalhoMudar, mudar); return; }
    const desligar = ev.target.closest('[data-atalho-desligar]');
    if (desligar) { aviso(); gravarAtalhos({ ...atalhos, [desligar.dataset.atalhoDesligar]: '' }); return; }
    const padrao = ev.target.closest('[data-atalho-padrao]');
    if (padrao) {
      const lado = padrao.dataset.atalhoPadrao;
      const m = motivo(PADROES[lado], lado);
      if (m.length) { aviso(...m); return; }
      aviso();
      gravarAtalhos({ ...atalhos, [lado]: PADROES[lado] });
    }
  });

  // A transição só liga depois da primeira pintura (sem animar a abertura do
  // app) e nunca nos testes de tela, cuja janela não anima.
  function liberarAnimacao() {
    if (window.orq.teste) { document.documentElement.classList.add('sem-transicao'); return; }
    requestAnimationFrame(() => document.body.classList.add('colunas-prontas'));
  }

  // O que ficou gravado na última vez. Antes de chegar, valem os padrões (abertas).
  window.orq.config.ler().then((c) => {
    if (c && c.colunas && typeof c.colunas === 'object') salvo = c.colunas;
    if (c && c.atalhosColunas && typeof c.atalhosColunas === 'object') atalhos = { ...atalhos, ...c.atalhosColunas };
    // Configuração antiga em que outro atalho já usava a combinação de um mais novo: quem já
    // tinha a combinação fica com ela (as colunas primeiro, depois os soltos na ordem da lista).
    const tomadas = [atalhos.agentes, atalhos.demandas];
    for (const [nome, s] of SOLTOS) {
      if (c && typeof c[s.chave] === 'string') atalhos[nome] = c[s.chave];
      if (atalhos[nome] && tomadas.includes(atalhos[nome])) atalhos[nome] = '';
      tomadas.push(atalhos[nome]);
    }
    const novo = salvo[aba] || padrao(aba);
    estado = { ...novo };
    desenharAtalhos();
    liberarAnimacao();
  }).catch(liberarAnimacao);

  // Os testes e quem precisar ler o estado.
  window.orqColunas = { estado: () => ({ aba, ...estado }), sinais: () => ({ ...sinais }), atalhos: () => ({ agentes: atalhos.agentes, demandas: atalhos.demandas }), atalhoPergunta: () => atalhos.pergunta, atalhoEscritos: () => atalhos.escritos, atalho: (nome) => (nome in PADROES ? atalhos[nome] : ''), definir };
  desenharAtalhos();
})();
