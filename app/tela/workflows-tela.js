// Aba Workflows: automações desenhadas em nós ligados (no jeito do n8n).
// Lista à esquerda, quadro no meio (arrastar nós; puxar da bolinha da direita
// de um nó até outro para ligar), ajustes do nó à direita e as últimas
// execuções embaixo. Tudo grava sozinho; o relógio roda no processo principal.
(() => {
  const $ = (id) => document.getElementById(id);
  const W = window.orq.workflows;
  if (!W) return; // ponte antiga (app aberto antes desta versão)
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LARGURA = 190;
  const Y_PORTA = 21;
  let tipos = {};
  let lista = [];
  let atual = null;      // workflow aberto (cópia editável)
  let sel = null;        // { no: id } | { lig: índice }
  let viva = null;       // execução em andamento do workflow aberto
  let execs = [];
  let execAberta = null;

  const ICONES = { agenda: '⏱', manual: '▶', orquestrador: '✦', claude: '◆', comando: '›_', condicao: '⑂', notificar: '🔔' };
  const curto = (t, n = 70) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  function resumo(n) {
    const c = n.config || {};
    switch (n.tipo) {
      case 'agenda': return c.modo === 'diario' ? `todo dia às ${c.horario}${c.diasUteis ? ' (seg a sex)' : ''}` : `a cada ${c.minutos} min`;
      case 'manual': return 'quando você aperta Rodar';
      case 'orquestrador': return curto(c.texto) || 'sem texto';
      case 'claude': return `${c.modelo} · ${curto(c.prompt, 50) || 'sem pedido'}`;
      case 'comando': return curto(c.comando) || 'sem comando';
      case 'condicao': return c.modo === 'naoVazia' ? 'entrada não vazia' : `${{ contem: 'contém', naoContem: 'não contém', regex: 'combina com' }[c.modo]} “${curto(c.valor, 30)}”`;
      case 'notificar': return curto(c.titulo);
      default: return '';
    }
  }

  // --- gravar --------------------------------------------------------------
  let tGravar = null, gravando = Promise.resolve();
  function salvar(ja = false) {
    clearTimeout(tGravar);
    const fazer = () => { const w = JSON.parse(JSON.stringify(atual)); gravando = gravando.then(() => W.gravar(w)).then((g) => { const i = lista.findIndex((x) => x.id === g.id); if (i >= 0) lista[i] = { ...lista[i], ...g }; else lista.push(g); desenharLista(); }); return gravando; };
    if (ja) return fazer();
    tGravar = setTimeout(fazer, 300);
    return null;
  }

  // --- lista ----------------------------------------------------------------
  function desenharLista() {
    $('lista-workflows').innerHTML = lista.map((w) => `<button type="button" class="item-workflow${atual && atual.id === w.id ? ' ativo' : ''}" data-wf="${esc(w.id)}">
        <span class="ponto ${w.ativo ? 'trabalhando' : 'parado'}" title="${w.ativo ? 'Ligado' : 'Desligado'}"></span>
        <span class="nome" title="${esc(w.nome)}">${esc(w.nome)}</span></button>`).join('')
      || '<p class="nota">Nenhum workflow ainda.</p>';
  }

  async function abrir(id) {
    const w = lista.find((x) => x.id === id);
    if (!w) { atual = null; desenharTudo(); return; }
    atual = JSON.parse(JSON.stringify(w));
    delete atual.rodando;
    sel = null; viva = null; execAberta = null;
    execs = await W.execucoes(id);
    desenharTudo();
  }

  // --- quadro ---------------------------------------------------------------
  const estadoNo = (id) => { const p = viva && [...viva.passos].reverse().find((x) => x.no === id); return p ? p.estado : ''; };
  function desenharQuadro() {
    const q = $('wf-nos');
    if (!atual) { q.innerHTML = ''; $('wf-linhas').innerHTML = ''; return; }
    q.innerHTML = atual.nos.map((n) => {
      const t = tipos[n.tipo] || { nome: n.tipo, grupo: 'acao' };
      const st = estadoNo(n.id);
      return `<div class="wf-no grupo-${t.grupo}${sel && sel.no === n.id ? ' selecionado' : ''}${st ? ` estado-${st}` : ''}" data-no="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px;width:${LARGURA}px" tabindex="0">
        ${t.grupo === 'gatilho' ? '' : '<span class="porta entrada" title="Entrada"></span>'}
        <div class="wf-no-topo"><span class="wf-icone">${ICONES[n.tipo] || '•'}</span><strong>${esc(t.nome)}</strong>${st ? `<span class="wf-estado">${{ rodando: 'rodando…', ok: 'ok', parou: 'parou', erro: 'erro' }[st]}</span>` : ''}</div>
        <div class="wf-no-resumo">${esc(resumo(n))}</div>
        <span class="porta saida" title="Puxe até outro passo para ligar"></span>
      </div>`;
    }).join('');
    desenharLinhas();
  }

  const pontoSaida = (n) => [n.x + LARGURA, n.y + Y_PORTA];
  const pontoEntrada = (n) => [n.x, n.y + Y_PORTA];
  const curva = ([x1, y1], [x2, y2]) => { const d = Math.max(40, Math.abs(x2 - x1) / 2); return `M${x1},${y1} C${x1 + d},${y1} ${x2 - d},${y2} ${x2},${y2}`; };
  function desenharLinhas(temp) {
    if (!atual) return;
    const porId = new Map(atual.nos.map((n) => [n.id, n]));
    $('wf-linhas').innerHTML = atual.ligacoes.map((l, i) => {
      const a = porId.get(l.de), b = porId.get(l.para);
      if (!a || !b) return '';
      const d = curva(pontoSaida(a), pontoEntrada(b));
      return `<path class="wf-linha-toque" data-lig="${i}" d="${d}"/><path class="wf-linha${sel && sel.lig === i ? ' selecionada' : ''}" d="${d}"/>`;
    }).join('') + (temp ? `<path class="wf-linha temporaria" d="${curva(temp[0], temp[1])}"/>` : '');
  }

  function posicaoNoQuadro(ev) {
    const r = $('wf-area').getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }

  // Segura o ponteiro no quadro enquanto arrasta (sem ponteiro de verdade,
  // como num clique simulado, só segue sem segurar).
  const prender = (ev) => { try { $('wf-area').setPointerCapture(ev.pointerId); } catch { /* sem ponteiro ativo */ } };
  // Arrastar nó, puxar ligação, selecionar.
  $('wf-area').addEventListener('pointerdown', (ev) => {
    if (!atual || ev.button !== 0) return;
    const linha = ev.target.closest('.wf-linha-toque');
    if (linha) { sel = { lig: Number(linha.dataset.lig) }; desenharQuadro(); desenharInspetor(); return; }
    const el = ev.target.closest('.wf-no');
    if (!el) { if (sel) { sel = null; desenharQuadro(); desenharInspetor(); } return; }
    const n = atual.nos.find((x) => x.id === el.dataset.no);
    ev.preventDefault();
    if (ev.target.classList.contains('saida')) {
      prender(ev);
      const mover = (e) => desenharLinhas([pontoSaida(n), posicaoNoQuadro(e)]);
      const soltar = (e) => {
        $('wf-area').removeEventListener('pointermove', mover);
        $('wf-area').removeEventListener('pointerup', soltar);
        const alvo = document.elementFromPoint(e.clientX, e.clientY)?.closest('.wf-no');
        if (alvo) ligar(n.id, alvo.dataset.no);
        desenharLinhas();
      };
      $('wf-area').addEventListener('pointermove', mover);
      $('wf-area').addEventListener('pointerup', soltar);
      return;
    }
    sel = { no: n.id };
    el.focus();
    const [px, py] = posicaoNoQuadro(ev);
    const dx = px - n.x, dy = py - n.y;
    let mexeu = false;
    prender(ev);
    const mover = (e) => {
      const [x, y] = posicaoNoQuadro(e);
      n.x = Math.max(0, Math.round(x - dx)); n.y = Math.max(0, Math.round(y - dy));
      el.style.left = `${n.x}px`; el.style.top = `${n.y}px`;
      mexeu = true;
      desenharLinhas();
    };
    const soltar = () => {
      $('wf-area').removeEventListener('pointermove', mover);
      $('wf-area').removeEventListener('pointerup', soltar);
      if (mexeu) salvar();
    };
    $('wf-area').addEventListener('pointermove', mover);
    $('wf-area').addEventListener('pointerup', soltar);
    desenharQuadro();
    desenharInspetor();
    $('wf-area').querySelector(`[data-no="${CSS.escape(n.id)}"]`)?.focus();
  });

  function ligar(de, para) {
    if (de === para) return false;
    const b = atual.nos.find((x) => x.id === para);
    if (!b || tipos[b.tipo]?.grupo === 'gatilho') return false;
    if (atual.ligacoes.some((l) => l.de === de && l.para === para)) return false;
    atual.ligacoes.push({ de, para });
    salvar();
    return true;
  }

  function remover() {
    if (!atual || !sel) return;
    if (sel.lig !== undefined) atual.ligacoes.splice(sel.lig, 1);
    else {
      atual.nos = atual.nos.filter((n) => n.id !== sel.no);
      atual.ligacoes = atual.ligacoes.filter((l) => l.de !== sel.no && l.para !== sel.no);
    }
    sel = null;
    salvar();
    desenharQuadro();
    desenharInspetor();
  }
  $('wf-area').addEventListener('keydown', (ev) => {
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && sel && !ev.target.closest('input, textarea, select')) { ev.preventDefault(); remover(); }
  });

  function novoNo(tipo) {
    if (!atual || !tipos[tipo]) return;
    const config = {};
    for (const c of tipos[tipo].campos) config[c.k] = c.padrao;
    let k = atual.nos.length + 1;
    while (atual.nos.some((n) => n.id === `n${k}`)) k++;
    const anterior = sel && sel.no ? atual.nos.find((n) => n.id === sel.no) : atual.nos[atual.nos.length - 1];
    const n = { id: `n${k}`, tipo, x: anterior ? anterior.x + LARGURA + 60 : 40, y: anterior ? anterior.y : 60, config };
    while (atual.nos.some((o) => Math.abs(o.x - n.x) < 40 && Math.abs(o.y - n.y) < 40)) n.y += 110;
    atual.nos.push(n);
    // Passo novo já entra ligado depois do selecionado (ou do último).
    if (anterior && tipos[tipo].grupo !== 'gatilho') atual.ligacoes.push({ de: anterior.id, para: n.id });
    sel = { no: n.id };
    salvar();
    desenharQuadro();
    desenharInspetor();
  }

  // --- inspetor (ajustes) --------------------------------------------------
  const visivelCampo = (c, cfg) => !c.se || Object.entries(c.se).every(([k, v]) => (Array.isArray(v) ? v.includes(cfg[k]) : cfg[k] === v));
  function desenharInspetor() {
    const ins = $('wf-inspetor');
    if (!atual) { ins.innerHTML = ''; return; }
    const n = sel && sel.no ? atual.nos.find((x) => x.id === sel.no) : null;
    if (sel && sel.lig !== undefined) {
      ins.innerHTML = `<h3>Ligação</h3><p class="nota">A saída de um passo vira a entrada do seguinte.</p><button type="button" class="botao-texto perigo" data-wf-remover>Tirar a ligação</button>`;
      return;
    }
    if (!n) {
      ins.innerHTML = `<h3>Este workflow</h3>
        <label class="wf-campo">Descrição<textarea data-wf-prop="descricao" rows="4" placeholder="Para que serve (aparece no @workflow: da conversa)">${esc(atual.descricao)}</textarea></label>
        <div class="nota wf-ajuda"><p><strong>Como montar:</strong> “+ Passo” acrescenta depois do passo selecionado. Arraste os passos pelo quadro; puxe da bolinha da direita de um passo até outro para ligar. Delete tira o que estiver selecionado.</p>
        <p><strong>{{entrada}}</strong> no texto de um passo vira a saída do passo anterior; <strong>{{data}}</strong>, a data e a hora.</p>
        <p>Ligado, o relógio dispara sozinho enquanto o app estiver aberto.</p></div>`;
      return;
    }
    const t = tipos[n.tipo];
    ins.innerHTML = `<h3><span class="wf-icone">${ICONES[n.tipo] || ''}</span> ${esc(t.nome)}</h3><p class="nota">${esc(t.descricao)}</p>
      ${t.campos.filter((c) => visivelCampo(c, n.config)).map((c) => {
        const v = n.config[c.k];
        if (c.tipo === 'sim') return `<label class="wf-campo marcar"><input type="checkbox" data-cfg-no="${c.k}"${v ? ' checked' : ''}> ${esc(c.rotulo)}</label>`;
        if (c.tipo === 'lista') return `<label class="wf-campo">${esc(c.rotulo)}<select data-cfg-no="${c.k}">${c.opcoes.map(([k, r]) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></label>`;
        if (c.tipo === 'longo') return `<label class="wf-campo">${esc(c.rotulo)}<textarea data-cfg-no="${c.k}" rows="7">${esc(v)}</textarea></label>`;
        return `<label class="wf-campo">${esc(c.rotulo)}<input data-cfg-no="${c.k}" type="${c.tipo === 'numero' ? 'number' : 'text'}"${c.tipo === 'numero' ? ' min="1"' : ''} value="${esc(v)}"></label>`;
      }).join('')}
      <button type="button" class="botao-texto perigo" data-wf-remover>Tirar este passo</button>`;
  }
  $('wf-inspetor').addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.wfProp) { atual[el.dataset.wfProp] = el.value; salvar(); return; }
    if (!el.dataset.cfgNo) return;
    const n = atual.nos.find((x) => x.id === sel?.no);
    if (!n) return;
    n.config[el.dataset.cfgNo] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
    salvar();
    const card = $('wf-area').querySelector(`[data-no="${CSS.escape(n.id)}"] .wf-no-resumo`);
    if (card) card.textContent = resumo(n);
    if (el.tagName === 'SELECT') desenharInspetor(); // campos que dependem da escolha
  });
  $('wf-inspetor').addEventListener('click', (ev) => { if (ev.target.closest('[data-wf-remover]')) remover(); });

  // --- execuções -----------------------------------------------------------
  const hora = (ms) => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function situacao(e) {
    if (!e.fim) return ['rodando', 'rodando…'];
    if (!e.ok) return ['erro', 'erro'];
    if (e.passos.some((p) => p.estado === 'parou')) return ['parou', 'parou no meio'];
    return ['ok', 'ok'];
  }
  function desenharExecucoes() {
    const caixa = $('wf-execucoes');
    if (!atual) { caixa.innerHTML = ''; return; }
    const nomeNo = (id) => { const n = atual.nos.find((x) => x.id === id); return n ? tipos[n.tipo]?.nome || n.tipo : id; };
    const todas = viva && !execs.some((x) => x.id === viva.id) ? [viva, ...execs] : execs;
    caixa.innerHTML = `<div class="secao-titulo">Últimas execuções <span class="contador">${todas.length}</span></div>` + (todas.slice(0, 15).map((e) => {
      const [cls, rot] = situacao(e);
      return `<div class="wf-exec${execAberta === e.id ? ' aberta' : ''}"><button type="button" class="wf-exec-linha" data-exec="${esc(e.id)}">
          <span class="ponto ${cls === 'ok' ? 'trabalhando' : cls === 'erro' ? 'esperando' : 'parado'}"></span>
          <span class="mono">${hora(e.inicio)}</span><span>${esc(e.motivo)}</span><span class="wf-exec-sit">${rot}</span></button>
        ${execAberta === e.id ? `<ol class="wf-exec-passos">${e.passos.map((p) => `<li class="estado-${p.estado}"><strong>${esc(nomeNo(p.no))}</strong> · ${esc(p.estado)}${p.saida ? `<pre>${esc(p.saida)}</pre>` : ''}</li>`).join('')}</ol>` : ''}</div>`;
    }).join('') || '<p class="nota">Ainda não rodou. Use “Rodar agora” para testar.</p>');
  }
  $('wf-execucoes').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-exec]');
    if (!b) return;
    execAberta = execAberta === b.dataset.exec ? null : b.dataset.exec;
    desenharExecucoes();
  });
  W.aoExecucao(async (e) => {
    const w = lista.find((x) => x.id === e.wf);
    if (w) w.rodando = !e.fim;
    if (!atual || e.wf !== atual.id) return;
    viva = e;
    if (e.fim) { execs = await W.execucoes(atual.id); setTimeout(() => { if (viva === e) { viva = null; desenharQuadro(); } }, 6000); }
    desenharQuadro();
    desenharExecucoes();
    desenharBarra();
  });

  // --- barra ---------------------------------------------------------------
  function desenharBarra() {
    const tem = !!atual;
    $('wf-barra').hidden = !tem;
    $('wf-vazio').hidden = tem;
    if (!tem) return;
    if (document.activeElement !== $('wf-nome')) $('wf-nome').value = atual.nome;
    $('wf-ativo').checked = !!atual.ativo;
    const rod = !!lista.find((x) => x.id === atual.id)?.rodando;
    $('wf-rodar').disabled = rod;
    $('wf-rodar').textContent = rod ? 'Rodando…' : 'Rodar agora';
  }
  function desenharMenuPassos() {
    const grupos = [['gatilho', 'Gatilhos'], ['acao', 'Ações'], ['logica', 'Lógica']];
    $('wf-menu-passos').innerHTML = grupos.map(([g, r]) => `<div class="menu-titulo">${r}</div>${Object.entries(tipos).filter(([, t]) => t.grupo === g).map(([k, t]) =>
      `<button type="button" class="menu-item" data-novo-no="${k}"><span class="wf-icone">${ICONES[k] || ''}</span><span><strong>${esc(t.nome)}</strong><small>${esc(t.descricao)}</small></span></button>`).join('')}`).join('');
  }
  function desenharTudo() { desenharLista(); desenharBarra(); desenharQuadro(); desenharInspetor(); desenharExecucoes(); }

  $('lista-workflows').addEventListener('click', (ev) => { const b = ev.target.closest('[data-wf]'); if (b) abrir(b.dataset.wf); });
  $('novo-workflow').addEventListener('click', async () => {
    const g = await W.gravar({ nome: 'Novo workflow', descricao: '', ativo: false, nos: [{ id: 'n1', tipo: 'manual', x: 40, y: 60 }], ligacoes: [] });
    lista.push(g);
    await abrir(g.id);
    $('wf-nome').focus(); $('wf-nome').select();
  });
  $('wf-nome').addEventListener('input', () => { atual.nome = $('wf-nome').value; salvar(); });
  $('wf-ativo').addEventListener('change', () => { atual.ativo = $('wf-ativo').checked; salvar(true); });
  $('wf-rodar').addEventListener('click', async () => {
    await salvar(true);
    const r = await W.rodar(atual.id);
    if (r && r.execucao) { execAberta = r.execucao.id; execs = await W.execucoes(atual.id); desenharExecucoes(); }
  });
  $('wf-mais-passo').addEventListener('click', (ev) => { ev.stopPropagation(); $('wf-menu-passos').hidden = !$('wf-menu-passos').hidden; });
  $('wf-menu-passos').addEventListener('click', (ev) => { const b = ev.target.closest('[data-novo-no]'); if (!b) return; $('wf-menu-passos').hidden = true; novoNo(b.dataset.novoNo); });
  document.addEventListener('click', (ev) => { if (!ev.target.closest('#wf-menu-passos, #wf-mais-passo')) $('wf-menu-passos').hidden = true; });
  $('wf-apagar').addEventListener('click', async (ev) => {
    const b = ev.currentTarget;
    if (!b.dataset.confirmando) {
      b.dataset.confirmando = '1'; b.textContent = 'Confirmar apagar';
      clearTimeout(b._t); b._t = setTimeout(() => { delete b.dataset.confirmando; b.textContent = 'Apagar'; }, 4000);
      return;
    }
    delete b.dataset.confirmando; b.textContent = 'Apagar';
    await W.apagar(atual.id);
    lista = lista.filter((x) => x.id !== atual.id);
    await abrir(lista[0]?.id);
  });

  // Conversa: @workflow:nome manda a descrição e os passos junto.
  function descrever(nome) {
    const w = lista.find((x) => x.nome === nome);
    if (!w) return null;
    const passos = w.nos.map((n) => `- ${tipos[n.tipo]?.nome || n.tipo} (${n.id}): ${resumo(n)}${n.config.texto || n.config.prompt || n.config.comando ? `\n  texto: ${String(n.config.texto || n.config.prompt || n.config.comando).replace(/\n/g, '\n  ')}` : ''}`).join('\n');
    const ligs = w.ligacoes.map((l) => `${l.de} → ${l.para}`).join(', ');
    return `Workflow «${w.nome}» do App de Orquestração (${w.ativo ? 'ligado' : 'desligado'}).\n${w.descricao || ''}\n\nPassos:\n${passos}\nLigações: ${ligs || 'nenhuma'}`;
  }
  window.orqWorkflows = {
    listar: () => lista.map((w) => ({ id: w.id, nome: w.nome, descricao: w.descricao })),
    descrever,
    abrir: async (id) => { document.querySelector('[data-aba="aba-workflows"]')?.click(); await abrir(id); },
  };
  window.orqPaleta?.registrar(() => [
    { grupo: 'Workflows', titulo: 'Novo workflow', faz: () => { document.querySelector('[data-aba="aba-workflows"]').click(); $('novo-workflow').click(); } },
    ...lista.map((w) => ({ grupo: 'Workflows', titulo: w.nome, sub: w.ativo ? 'ligado' : 'desligado', faz: () => window.orqWorkflows.abrir(w.id) })),
  ]);

  // Abrir a aba relê a lista: um workflow criado ou mudado fora daqui (por
  // outro caminho que grave o arquivo) aparece sem reiniciar o app.
  document.querySelector('[data-aba="aba-workflows"]')?.addEventListener('click', async () => {
    lista = await W.lista();
    if (atual && lista.some((x) => x.id === atual.id)) desenharLista(); else await abrir(lista[0]?.id);
  });

  Promise.all([W.tipos(), W.lista()]).then(async ([t, l]) => {
    tipos = t; lista = l;
    desenharMenuPassos();
    await abrir(lista[0]?.id);
  });
})();
