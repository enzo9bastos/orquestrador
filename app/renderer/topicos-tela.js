// Tópicos (coluna da direita): cada demanda em andamento, com o checklist do
// que falta. O orquestrador mantém pelo orq-topico; aqui dá para criar, marcar
// item, pôr em espera e concluir. A lista chega pronta do processo principal
// sempre que o arquivo muda.
(() => {
  const $ = (id) => document.getElementById(id);
  const T = window.orq.topicos;
  if (!T) return;

  const ROTULO = { aberto: 'Aberto', esperando: 'Esperando você', concluido: 'Concluído' };
  let lista = [];
  let erro = null;
  let pendente = false; // chegou mudança enquanto alguém digitava num tópico

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const VAZIO = `<div class="vazio"><span class="ico-caixa"><svg class="ico"><use href="#i-lista"/></svg></span>
    <strong>Nenhum tópico em andamento</strong>
    <span>Um tópico é uma demanda sendo feita: o que pediram, quem está nela e o checklist do que falta. O orquestrador abre e atualiza pelo comando <code data-sem-traducao>orq-topico</code>; você também pode criar um em "+ Novo tópico".</span></div>`;

  // Conteúdo do usuário (título, código, itens) leva data-sem-traducao: o
  // tradutor da tela não mexe nele.
  function cartao(t) {
    const feitos = t.itens.filter((i) => i.feito).length;
    const total = t.itens.length;
    const concluido = t.estado === 'concluido';
    return `<article class="topico estado-${esc(t.estado)}" data-topico="${esc(t.id)}">
      <header class="topico-cab">
        <span class="chip-topico chip-${esc(t.estado)}">${ROTULO[t.estado]}</span>
        <strong class="topico-titulo" data-sem-traducao>${esc(t.titulo)}</strong>
      </header>
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
    if ($('topicos').contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'text') { pendente = true; return; }
    pendente = false;
    const abertos = lista.filter((t) => t.estado !== 'concluido');
    const concluidos = lista.filter((t) => t.estado === 'concluido').sort((a, b) => (b.concluido || 0) - (a.concluido || 0));
    // Esperando você primeiro; depois os mais recentes.
    abertos.sort((a, b) => (a.estado === 'esperando' ? 0 : 1) - (b.estado === 'esperando' ? 0 : 1) || b.atualizado - a.atualizado);
    $('n-topicos').textContent = abertos.length ? String(abertos.length) : '';
    const html = erro
      ? `<div class="vazio"><strong>Não consegui ler os tópicos</strong><span data-sem-traducao>${esc(erro)}</span></div>`
      : abertos.length ? abertos.map(cartao).join('') : VAZIO;
    if ($('topicos')._html !== html) { $('topicos')._html = html; $('topicos').innerHTML = html; }
    $('topicos-concluidos').hidden = !concluidos.length;
    $('resumo-concluidos').textContent = `Concluídos (${concluidos.length})`;
    const htmlC = concluidos.map(cartao).join('');
    if ($('lista-concluidos')._html !== htmlC) { $('lista-concluidos')._html = htmlC; $('lista-concluidos').innerHTML = htmlC; }
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
  coluna.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.concluirTopico) {
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
