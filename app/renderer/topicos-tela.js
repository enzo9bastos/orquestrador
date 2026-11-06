// Tópicos (coluna da direita): cada demanda em andamento, com o checklist do
// que falta. O orquestrador mantém pelo orq-topico; aqui dá para criar, marcar
// item, pôr em espera e concluir. A lista chega pronta do processo principal
// sempre que o arquivo muda. O que o orquestrador sugere aparece primeiro, com
// Aprovar e Recusar; recusado vai para "Recusados (N)" e nunca some.
(() => {
  const $ = (id) => document.getElementById(id);
  const T = window.orq.topicos;
  if (!T) return;

  const ROTULO = { sugerido: 'Sugerido', aberto: 'Aberto', esperando: 'Esperando você', concluido: 'Concluído', recusado: 'Recusado' };
  let lista = [];
  let erro = null;
  let pendente = false; // chegou mudança enquanto alguém digitava num tópico
  // Título de sugestão corrigido na tela e ainda não aprovado: sobrevive a um
  // redesenho e vai junto no Aprovar.
  const titulosEditados = new Map();

  const { esc } = window.orqUtil;
  const VAZIO = `<div class="vazio"><span class="ico-caixa"><svg class="ico"><use href="#i-lista"/></svg></span>
    <strong>Nenhuma demanda em andamento</strong>
    <span>Uma demanda é um pedido sendo feito: o que pediram, quem está nela e o checklist do que falta. O orquestrador abre e atualiza pelo comando <code data-sem-traducao>orq-topico</code>; você também pode criar uma em "+ Nova demanda".</span></div>`;

  // Conteúdo do usuário (título, código, itens) leva data-sem-traducao: o
  // tradutor da tela não mexe nele.
  // Resumo: um parágrafo sob o título; clicar edita ali mesmo.
  function resumoHtml(t, editavel) {
    if (t.resumo) return `<p class="topico-resumo" data-sem-traducao${editavel ? ` data-editar-resumo="${esc(t.id)}" tabindex="0" role="button" title="Editar resumo"` : ''}>${esc(t.resumo)}</p>`;
    return editavel ? `<button type="button" class="botao-texto topico-sem-resumo" data-editar-resumo="${esc(t.id)}">+ Resumo</button>` : '';
  }

  // Sugestão do orquestrador: título editável antes de aprovar, resumo, as
  // etapas previstas e os botões Aprovar / Recusar.
  function cartaoSugerido(t) {
    return `<article class="topico estado-sugerido" data-topico="${esc(t.id)}">
      <p class="topico-sugerido-por">Sugerido pelo orquestrador</p>
      <header class="topico-cab">
        <span class="chip-topico chip-sugerido">${ROTULO.sugerido}</span>
        <input type="text" class="topico-titulo topico-titulo-editavel" data-titulo-sugerido="${esc(t.id)}" data-sem-traducao maxlength="200" value="${esc(titulosEditados.has(t.id) ? titulosEditados.get(t.id) : t.titulo)}" aria-label="Título da demanda sugerida" title="Dá para corrigir o título antes de aprovar">
      </header>
      ${resumoHtml(t, true)}
      <div class="topico-meta">
        <span class="topico-id" data-sem-traducao>#${esc(t.id)}</span>
        ${t.codigo ? `<span class="topico-codigo" data-sem-traducao title="Código">${esc(t.codigo)}</span>` : ''}
        ${t.agentes.length ? `<span class="topico-agentes" data-sem-traducao>${esc(t.agentes.join(', '))}</span>` : ''}
      </div>
      ${t.itens.length ? `<p class="topico-etapas-rotulo">Etapas previstas</p><ol class="etapas-sugeridas">${t.itens.map((i) => `<li data-sem-traducao>${esc(i.texto)}</li>`).join('')}</ol>` : ''}
      <form class="novo-item-topico" data-novo-item="${esc(t.id)}" autocomplete="off">
        <input type="text" maxlength="1000" placeholder="+ Etapa prevista" aria-label="Nova etapa prevista">
      </form>
      <div class="acoes">
        <button type="button" class="botao secundario" data-recusar-topico="${esc(t.id)}">Recusar</button>
        <button type="button" class="botao primario" data-aprovar-topico="${esc(t.id)}">Aprovar</button>
      </div>
    </article>`;
  }

  function cartaoRecusado(t) {
    return `<article class="topico estado-recusado" data-topico="${esc(t.id)}">
      <header class="topico-cab">
        <span class="chip-topico chip-recusado">${ROTULO.recusado}</span>
        <strong class="topico-titulo" data-sem-traducao>${esc(t.titulo)}</strong>
      </header>
      ${resumoHtml(t, false)}
      <div class="acoes"><button type="button" class="botao secundario" data-reconsiderar-topico="${esc(t.id)}">Reconsiderar</button></div>
    </article>`;
  }

  function cartao(t) {
    if (t.estado === 'sugerido') return cartaoSugerido(t);
    if (t.estado === 'recusado') return cartaoRecusado(t);
    const feitos = t.itens.filter((i) => i.feito).length;
    const total = t.itens.length;
    const concluido = t.estado === 'concluido';
    // Demanda com nota (.md na pasta Demandas): cartão resumido; o clique abre
    // a nota na aba Notas, onde estão o resumo, as etapas e as anotações.
    if (t.arquivo) {
      return `<article class="topico topico-resumido estado-${esc(t.estado)}" data-topico="${esc(t.id)}" data-abrir-nota="${esc(t.id)}" role="button" tabindex="0" title="Abrir a demanda na aba Notas">
      <header class="topico-cab">
        <span class="chip-topico chip-${esc(t.estado)}">${ROTULO[t.estado]}</span>
        <strong class="topico-titulo" data-sem-traducao>${esc(t.titulo)}</strong>
      </header>
      <div class="topico-meta">
        ${t.codigo ? `<span class="topico-codigo" data-sem-traducao title="Código">${esc(t.codigo)}</span>` : ''}
        ${t.agentes.length ? `<span class="topico-agentes" data-sem-traducao>${esc(t.agentes.join(', '))}</span>` : ''}
        ${total ? `<span class="topico-progresso" title="${feitos} de ${total} feitos"><span data-sem-traducao>${feitos}/${total}</span><span class="barra-topico"><i style="width:${Math.round((feitos / total) * 100)}%"></i></span></span>` : ''}
      </div>
    </article>`;
    }
    return `<article class="topico estado-${esc(t.estado)}" data-topico="${esc(t.id)}">
      <header class="topico-cab">
        <span class="chip-topico chip-${esc(t.estado)}">${ROTULO[t.estado]}</span>
        <strong class="topico-titulo" data-sem-traducao>${esc(t.titulo)}</strong>
      </header>
      ${resumoHtml(t, !concluido)}
      <div class="topico-meta">
        <span class="topico-id" data-sem-traducao>#${esc(t.id)}</span>
        ${t.codigo ? `<span class="topico-codigo" data-sem-traducao title="Código">${esc(t.codigo)}</span>` : ''}
        ${t.agentes.length ? `<span class="topico-agentes" data-sem-traducao>${esc(t.agentes.join(', '))}</span>` : ''}
        ${total ? `<span class="topico-progresso" title="${feitos} de ${total} feitos"><span data-sem-traducao>${feitos}/${total}</span><span class="barra-topico"><i style="width:${Math.round((feitos / total) * 100)}%"></i></span></span>` : ''}
      </div>
      ${total ? `<ul class="itens-topico">${t.itens.map((i) => `<li><label class="${i.feito ? 'feito' : ''}">
        <input type="checkbox" data-item-topico="${esc(i.id)}"${i.feito ? ' checked' : ''}${concluido ? ' disabled' : ''}>
        <span data-sem-traducao>${esc(i.texto)}</span></label></li>`).join('')}</ul>` : ''}
      ${t.notas ? `<div class="topico-notas" data-sem-traducao>${esc(t.notas)}</div>` : ''}
      ${concluido ? `<div class="acoes"><button type="button" class="botao secundario" data-reabrir-topico="${esc(t.id)}">Reabrir</button></div>` : `
      <form class="novo-item-topico" data-novo-item="${esc(t.id)}" autocomplete="off">
        <input type="text" maxlength="1000" placeholder="+ Item do checklist" aria-label="Novo item do checklist">
      </form>
      <div class="acoes">
        <button type="button" class="botao secundario" data-esperar-topico="${esc(t.id)}">${t.estado === 'esperando' ? 'Voltar a aberto' : 'Marcar esperando'}</button>
        <button type="button" class="botao primario" data-concluir-topico="${esc(t.id)}" data-faltam="${total - feitos}">Concluir</button>
      </div>`}
    </article>`;
  }

  function desenhar() {
    // Não redesenha debaixo de quem está digitando: espera sair do campo.
    const ativo = document.activeElement;
    if ($('topicos').contains(ativo) && ((ativo.tagName === 'INPUT' && ativo.type === 'text') || ativo.tagName === 'TEXTAREA')) { pendente = true; return; }
    pendente = false;
    const abertos = lista.filter((t) => t.estado !== 'concluido' && t.estado !== 'recusado');
    const concluidos = lista.filter((t) => t.estado === 'concluido').sort((a, b) => (b.concluido || 0) - (a.concluido || 0));
    const recusados = lista.filter((t) => t.estado === 'recusado').sort((a, b) => (b.recusado || 0) - (a.recusado || 0));
    // Sugeridos primeiro (esperam a sua decisão), depois esperando você; no
    // fim os mais recentes.
    const peso = (t) => (t.estado === 'sugerido' ? 0 : t.estado === 'esperando' ? 1 : 2);
    abertos.sort((a, b) => peso(a) - peso(b) || b.atualizado - a.atualizado);
    $('n-topicos').textContent = abertos.length ? String(abertos.length) : '';
    const html = erro
      ? `<div class="vazio"><strong>Não consegui ler as demandas</strong><span data-sem-traducao>${esc(erro)}</span></div>`
      : abertos.length ? abertos.map(cartao).join('') : VAZIO;
    if ($('topicos')._html !== html) { $('topicos')._html = html; $('topicos').innerHTML = html; }
    $('topicos-concluidos').hidden = !concluidos.length;
    $('resumo-concluidos').textContent = `Concluídos (${concluidos.length})`;
    const htmlC = concluidos.map(cartao).join('');
    if ($('lista-concluidos')._html !== htmlC) { $('lista-concluidos')._html = htmlC; $('lista-concluidos').innerHTML = htmlC; }
    $('topicos-recusados').hidden = !recusados.length;
    $('resumo-recusados').textContent = `Recusados (${recusados.length})`;
    const htmlR = recusados.map(cartao).join('');
    if ($('lista-recusados')._html !== htmlR) { $('lista-recusados')._html = htmlR; $('lista-recusados').innerHTML = htmlR; }
  }

  // Edição do resumo no próprio cartão: Enter (sem Shift) ou sair do campo
  // grava; Esc desiste.
  function editarResumo(alvo) {
    const id = alvo.dataset.editarResumo;
    const t = lista.find((x) => x.id === id);
    if (!t) return;
    const area = document.createElement('textarea');
    area.className = 'topico-resumo-edicao';
    area.maxLength = 2000;
    area.rows = 3;
    area.value = t.resumo || '';
    area.placeholder = 'Resumo da demanda (um parágrafo curto)';
    area.setAttribute('aria-label', 'Resumo da demanda');
    area.setAttribute('data-sem-traducao', '');
    let feito = false;
    const fim = async (gravar) => {
      if (feito) return;
      feito = true;
      const novo = area.value.replace(/\s+/g, ' ').trim();
      if (gravar && novo !== (t.resumo || '')) { area.disabled = true; receber(await T.resumo(id, novo)); }
      // Volta a desenhar (com o resumo novo, ou o antigo se desistiu).
      $('topicos')._html = null; $('lista-concluidos')._html = null;
      area.blur();
      desenhar();
    };
    area.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); fim(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); fim(false); }
    });
    area.addEventListener('blur', () => fim(true));
    alvo.replaceWith(area);
    area.focus();
  }

  function receber(r) {
    if (!r) return;
    if (r.erro && !r.topicos) { erro = r.erro; desenhar(); return false; }
    if (r.erro) { mostrarErro(r.erro); return false; }
    erro = null;
    lista = r.topicos || [];
    desenhar();
    return true;
  }
  // Erro de uma ação (ex.: título vazio) aparece por um instante no topo da lista.
  function mostrarErro(msg) {
    let el = $('erro-topico');
    if (!el) { el = document.createElement('p'); el.id = 'erro-topico'; el.className = 'nota erro-topico'; el.setAttribute('role', 'alert'); $('topicos').before(el); }
    el.textContent = msg;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.remove(), 5000);
  }

  // --- novo tópico ----------------------------------------------------------
  const form = $('form-topico');
  function mostrarForm(sim) {
    form.hidden = !sim;
    $('novo-topico').hidden = sim;
    if (sim) $('topico-titulo').focus(); else form.reset();
  }
  $('novo-topico').addEventListener('click', () => mostrarForm(true));
  $('cancelar-topico').addEventListener('click', () => mostrarForm(false));
  form.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') mostrarForm(false); });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const titulo = $('topico-titulo').value.trim();
    if (!titulo) { $('topico-titulo').focus(); return; }
    if (receber(await T.abrir({ titulo, codigo: $('topico-codigo').value.trim(), agente: $('topico-agente').value.trim() }))) mostrarForm(false);
  });

  // --- ações nos cartões ----------------------------------------------------
  const coluna = document.querySelector('.bloco-topicos');
  coluna.addEventListener('change', async (ev) => {
    const cb = ev.target.closest('[data-item-topico]');
    if (!cb) return;
    const id = cb.closest('[data-topico]').dataset.topico;
    cb.disabled = true;
    receber(await T.marcar(id, cb.dataset.itemTopico, cb.checked));
  });
  coluna.addEventListener('submit', async (ev) => {
    const f = ev.target.closest('[data-novo-item]');
    if (!f) return;
    ev.preventDefault();
    const campo = f.querySelector('input');
    const txt = campo.value.trim();
    if (!txt) return;
    campo.value = '';
    campo.blur();
    receber(await T.item(f.dataset.novoItem, txt));
  });
  coluna.addEventListener('focusout', () => setTimeout(() => { if (pendente) desenhar(); }, 0));
  coluna.addEventListener('input', (ev) => {
    const c = ev.target.closest('[data-titulo-sugerido]');
    if (c) titulosEditados.set(c.dataset.tituloSugerido, c.value);
  });
  // Cartão resumido: clique (ou Enter) abre a nota da demanda na aba Notas.
  async function abrirNota(id) {
    const r = await T.nota(id);
    if (!r || r.erro) { mostrarErro(`Não consegui abrir a nota: ${(r && r.erro) || 'erro desconhecido'}`); return; }
    document.querySelector('[data-aba="aba-notas"]')?.click();
    if (window.orqNotas && window.orqNotas.abrir) await window.orqNotas.abrir(r.i, r.rel);
  }
  coluna.addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-abrir-nota]');
    if (c && !ev.target.closest('button, a, input')) abrirNota(c.dataset.abrirNota);
  });
  coluna.addEventListener('keydown', (ev) => {
    const c = ev.target.closest('[data-abrir-nota]');
    if (c && ev.target === c && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); abrirNota(c.dataset.abrirNota); }
  });
  // Resumo em parágrafo: clique ou Enter abre a edição.
  coluna.addEventListener('click', (ev) => {
    const p = ev.target.closest('p[data-editar-resumo]');
    if (p) editarResumo(p);
  });
  coluna.addEventListener('keydown', (ev) => {
    const p = ev.target.closest('p[data-editar-resumo]');
    if (p && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); editarResumo(p); }
    // Enter no título sugerido não envia nada: só sai do campo.
    if (ev.target.matches && ev.target.matches('[data-titulo-sugerido]') && ev.key === 'Enter') { ev.preventDefault(); ev.target.blur(); }
  });
  coluna.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.editarResumo) {
      editarResumo(b);
    } else if (b.dataset.aprovarTopico) {
      const id = b.dataset.aprovarTopico;
      const campo = b.closest('[data-topico]').querySelector('[data-titulo-sugerido]');
      const t = lista.find((x) => x.id === id);
      const titulo = campo && campo.value.trim();
      b.disabled = true;
      if (receber(await T.aprovar(id, titulo && t && titulo !== t.titulo ? titulo : undefined))) titulosEditados.delete(id);
    } else if (b.dataset.recusarTopico) {
      b.disabled = true;
      receber(await T.recusar(b.dataset.recusarTopico));
    } else if (b.dataset.reconsiderarTopico) {
      b.disabled = true;
      receber(await T.reconsiderar(b.dataset.reconsiderarTopico));
    } else if (b.dataset.concluirTopico) {
      // Confirma no segundo clique (nada de janela de confirmação); avisa se
      // ainda tem item por fazer.
      if (!b.dataset.confirmando) {
        const faltam = Number(b.dataset.faltam) || 0;
        b.dataset.confirmando = '1';
        b.textContent = faltam ? `Faltam ${faltam}. Concluir mesmo assim?` : 'Confirmar conclusão';
        b._t = setTimeout(() => { if (b.isConnected) { delete b.dataset.confirmando; b.textContent = 'Concluir'; } }, 4000);
        return;
      }
      clearTimeout(b._t);
      b.disabled = true;
      receber(await T.concluir(b.dataset.concluirTopico));
    } else if (b.dataset.esperarTopico) {
      const t = lista.find((x) => x.id === b.dataset.esperarTopico);
      receber(await T.estado(b.dataset.esperarTopico, t && t.estado === 'esperando' ? 'aberto' : 'esperando'));
    } else if (b.dataset.reabrirTopico) {
      receber(await T.estado(b.dataset.reabrirTopico, 'aberto'));
    }
  });

  T.aoMudar(receber);
  T.lista().then(receber);
})();
