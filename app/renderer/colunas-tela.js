// Colunas laterais recolhíveis, no estilo do Obsidian: a de agentes (esquerda)
// e a de demandas (direita) recolhem por um botão discreto no topo, ou por
// Ctrl+Alt+, e Ctrl+Alt+. (esquerda e direita). Aberta, a coluna é a mesma de
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
    agentes: { botao: 'alternar-agentes', coluna: 'coluna-agentes', classe: 'sem-agentes', tecla: ',', nome: 'agentes' },
    demandas: { botao: 'alternar-demandas', coluna: 'coluna-demandas', classe: 'sem-demandas', tecla: '.', nome: 'demandas' },
  };

  let salvo = {}; // aba → { agentes, demandas }: só o que o usuário mexeu
  let aba = (document.querySelector('.sub-aba.ativa') || {}).dataset?.aba || ABA_CONVERSA;
  let estado = { ...(salvo[aba] || padrao(aba)) };
  let sinais = { agentes: 0, demandas: 0 };
  let ultimoEstado = null;

  const texto = (lado) => {
    const L = LADOS[lado];
    const n = sinais[lado];
    const aberta = estado[lado];
    const base = `${aberta ? 'Recolher' : 'Abrir'} a coluna de ${L.nome} (Ctrl+Alt+${L.tecla})`;
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

  // Atalhos: Ctrl+Alt+, e Ctrl+Alt+. (pelo código da tecla, igual em qualquer teclado).
  // Não colidem com Ctrl+B (negrito), Ctrl+Alt+1..9 (atalhos do repertório), Ctrl+K nem Ctrl+Alt+Espaço.
  document.addEventListener('keydown', (ev) => {
    if (!ev.ctrlKey || !ev.altKey || ev.shiftKey || ev.metaKey) return;
    const lado = ev.code === 'Comma' ? 'agentes' : ev.code === 'Period' ? 'demandas' : null;
    if (!lado) return;
    ev.preventDefault();
    definir(lado, !estado[lado]);
  }, true);

  // A transição só liga depois da primeira pintura (sem animar a abertura do
  // app) e nunca nos testes de tela, cuja janela não anima.
  function liberarAnimacao() {
    if (window.orq.teste) return;
    requestAnimationFrame(() => document.body.classList.add('colunas-prontas'));
  }

  // O que ficou gravado na última vez. Antes de chegar, valem os padrões (abertas).
  window.orq.config.ler().then((c) => {
    if (c && c.colunas && typeof c.colunas === 'object') salvo = c.colunas;
    const novo = salvo[aba] || padrao(aba);
    estado = { ...novo };
    desenhar();
    liberarAnimacao();
  }).catch(liberarAnimacao);

  // Os testes e quem precisar ler o estado.
  window.orqColunas = { estado: () => ({ aba, ...estado }), sinais: () => ({ ...sinais }), definir };
  desenhar();
})();
