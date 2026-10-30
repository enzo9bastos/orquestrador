// Aba Workflows, no jeito do n8n. A entrada tem três listas — Workflows,
// Credenciais e Execuções. Abrir um workflow mostra o quadro em tela cheia:
// arrastar o fundo move, Ctrl+roda dá zoom, dois cliques num passo abre os
// ajustes dele, o "+" (no canto ou na saída de um passo) acrescenta passos.
// Tudo grava sozinho; o relógio roda no processo principal.
(() => {
  const $ = (id) => document.getElementById(id);
  const W = window.orq.workflows;
  if (!W) return; // ponte antiga (app aberto antes desta versão)
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LARGURA = 190;
  const Y_PORTA = 21;
  let tipos = {};
  let tiposCred = { tipos: {}, camposBw: [] };
  let lista = [];
  let creds = [];
  let todas = [];          // execuções de todos os workflows
  let abaInicio = 'workflows';
  let atual = null;        // workflow aberto no editor (cópia editável)
  let modo = 'editor';     // 'editor' | 'execucoes' (dentro do workflow)
  let sel = null;          // { no } | { lig }
  let viva = null;         // execução em andamento do workflow aberto
  let execs = [];          // execuções do workflow aberto
  let execAberta = null;
  let depoisDe = null;     // passo de onde saiu o "+" da gaveta
  const vistas = new Map(); // id do workflow → { x, y, z }
  let vista = { x: 0, y: 0, z: 1 };

  const ICONES = { agenda: '⏱', manual: '▶', orquestrador: '✦', claude: '◆', comando: '›_', condicao: '⑂', notificar: '🔔' };
  const curto = (t, n = 70) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  const quando = (ms) => {
    if (!ms) return '—';
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return 'agora há pouco';
    if (s < 3600) return `há ${Math.round(s / 60)} min`;
    if (s < 86400) return `há ${Math.round(s / 3600)} h`;
    return new Date(ms).toLocaleDateString('pt-BR');
  };
  const hora = (ms) => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function resumo(n) {
    const c = n.config || {};
    switch (n.tipo) {
      case 'agenda': return c.modo === 'diario' ? `todo dia às ${c.horario}${c.diasUteis ? ' (seg a sex)' : ''}` : `a cada ${c.minutos} min`;
      case 'manual': return 'quando você aperta Rodar';
      case 'orquestrador': return curto(c.texto) || 'sem texto';
      case 'claude': return `${c.modelo} · ${curto(c.prompt, 50) || 'sem pedido'}`;
      case 'comando': return (curto(c.comando) || 'sem comando') + (c.credenciais?.length ? ` · 🔑${c.credenciais.length}` : '');
      case 'condicao': return c.modo === 'naoVazia' ? 'entrada não vazia' : `${{ contem: 'contém', naoContem: 'não contém', regex: 'combina com' }[c.modo]} “${curto(c.valor, 30)}”`;
      case 'notificar': return curto(c.titulo);
      default: return '';
    }
  }
  const nomeNo = (w, id) => { const n = w?.nos.find((x) => x.id === id); return n ? tipos[n.tipo]?.nome || n.tipo : id; };

  // --- gravar --------------------------------------------------------------
  let tGravar = null, gravando = Promise.resolve();
  function salvar(ja = false) {
    clearTimeout(tGravar);
    const fazer = () => {
      const w = JSON.parse(JSON.stringify(atual));
      gravando = gravando.then(() => W.gravar(w)).then((g) => { const i = lista.findIndex((x) => x.id === g.id); if (i >= 0) lista[i] = { ...lista[i], ...g }; else lista.push(g); });
      return gravando;
    };
    if (ja) return fazer();
    tGravar = setTimeout(fazer, 300);
    return null;
  }

  // ==========================================================================
  // Entrada: Workflows | Credenciais | Execuções
  // ==========================================================================
  function mostrarInicio() {
    atual = null;
    $('wf-editor').hidden = true;
    $('wf-inicio').hidden = false;
    fecharModal();
    desenharInicio();
  }
  function desenharInicio() {
    for (const b of document.querySelectorAll('[data-wf-aba]')) b.setAttribute('aria-selected', String(b.dataset.wfAba === abaInicio));
    $('wf-criar').hidden = abaInicio === 'execucoes';
    $('wf-criar').textContent = abaInicio === 'credenciais' ? 'Criar credencial' : 'Criar workflow';
    const f = $('wf-busca').value.trim().toLowerCase();
    const casa = (t) => !f || t.toLowerCase().includes(f);
    const corpo = $('wf-lista-corpo');
    if (abaInicio === 'workflows') {
      const l = lista.filter((w) => casa(`${w.nome} ${w.descricao}`)).sort((a, b) => (b.atualizado || 0) - (a.atualizado || 0));
      corpo.innerHTML = l.map((w) => {
        const ult = todas.find((e) => e.wf === w.id);
        return `<div class="wf-linha-lista" data-wf="${esc(w.id)}" tabindex="0" role="button">
          <div class="wf-linha-texto"><strong>${esc(w.nome)}</strong><span>${esc(curto(w.descricao, 120) || 'Sem descrição')}</span></div>
          <span class="wf-linha-meta">${w.nos.length} passo${w.nos.length === 1 ? '' : 's'} · atualizado ${quando(w.atualizado)}</span>
          <span class="wf-linha-meta">${ult ? `última execução ${quando(ult.inicio)} · ${esc(situacao(ult)[1])}` : 'nunca rodou'}</span>
          <label class="wf-ligado" title="Ligado: o relógio dispara sozinho enquanto o app estiver aberto"><span class="chave"><input type="checkbox" data-ligar="${esc(w.id)}"${w.ativo ? ' checked' : ''}><span></span></span> ${w.ativo ? 'Ligado' : 'Desligado'}</label>
        </div>`;
      }).join('') || vazio(lista.length ? 'Nada com esse nome.' : 'Nenhum workflow ainda.', 'Um workflow junta um gatilho (relógio ou botão) e os passos que vêm depois.', lista.length ? '' : 'Criar o primeiro workflow');
    } else if (abaInicio === 'credenciais') {
      const usos = (id) => lista.filter((w) => w.nos.some((n) => (n.config.credenciais || []).includes(id))).length;
      const l = creds.filter((c) => casa(`${c.nome} ${c.ref} ${c.variavel}`));
      corpo.innerHTML = l.map((c) => `<div class="wf-linha-lista" data-cred="${esc(c.id)}" tabindex="0" role="button">
          <div class="wf-linha-texto"><strong>🔑 ${esc(c.nome)}</strong><span>${esc(tiposCred.tipos[c.tipo]?.nome || c.tipo)} · ${esc(c.ref || 'sem referência')}</span></div>
          <span class="wf-linha-meta mono">$${esc(c.variavel)}</span>
          <span class="wf-linha-meta">usada em ${usos(c.id)} workflow${usos(c.id) === 1 ? '' : 's'} · atualizada ${quando(c.atualizado)}</span>
        </div>`).join('') || vazio(creds.length ? 'Nada com esse nome.' : 'Nenhuma credencial ainda.', 'Aqui fica só ONDE a credencial mora (item do cofre, arquivo ou variável de ambiente), nunca o valor. Ela é lida na hora de rodar e chega ao comando como variável de ambiente.', creds.length ? '' : 'Criar a primeira credencial');
    } else {
      const l = todas.filter((e) => casa(`${lista.find((w) => w.id === e.wf)?.nome || ''} ${e.motivo}`));
      corpo.innerHTML = l.length ? `<div class="wf-execs">${l.slice(0, 100).map((e) => linhaExecucao(e, true)).join('')}</div>` : vazio('Nenhuma execução ainda.', 'Cada vez que um workflow roda (pelo relógio ou pelo botão), aparece aqui com o que cada passo respondeu.');
    }
  }
  const vazio = (titulo, texto, acao) => `<div class="wf-vazio"><p><strong>${esc(titulo)}</strong></p><p class="nota">${esc(texto)}</p>${acao ? `<button type="button" class="botao primario" data-wf-criar-vazio>${esc(acao)}</button>` : ''}</div>`;

  function situacao(e) {
    if (!e.fim) return ['rodando', 'rodando…'];
    if (!e.ok) return ['erro', 'erro'];
    if (e.passos.some((p) => p.estado === 'parou')) return ['parou', 'parou no meio'];
    return ['ok', 'ok'];
  }
  function linhaExecucao(e, comNome) {
    const w = lista.find((x) => x.id === e.wf);
    const [cls, rot] = situacao(e);
    const dur = e.fim ? `${((e.fim - e.inicio) / 1000).toFixed(1)} s` : '';
    return `<div class="wf-exec${execAberta === e.id ? ' aberta' : ''}"><button type="button" class="wf-exec-linha" data-exec="${esc(e.id)}">
        <span class="ponto ${cls === 'ok' ? 'trabalhando' : cls === 'erro' ? 'esperando' : 'parado'}"></span>
        <span class="mono">${hora(e.inicio)}</span>${comNome ? `<strong>${esc(w ? w.nome : 'workflow apagado')}</strong>` : ''}<span>${esc(e.motivo)}</span><span class="wf-exec-sit">${rot}${dur ? ` · ${dur}` : ''}</span></button>
      ${execAberta === e.id ? `<ol class="wf-exec-passos">${e.passos.map((p) => `<li class="estado-${p.estado}"><strong>${esc(nomeNo(w, p.no))}</strong> · ${esc(p.estado)}${p.saida ? `<pre>${esc(p.saida)}</pre>` : ''}</li>`).join('')}</ol>` : ''}</div>`;
  }

  async function carregar() {
    [lista, creds, todas] = await Promise.all([W.lista(), W.credenciais(), W.execucoes()]);
  }

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('#aba-workflows [data-wf-aba]');
    if (b) { abaInicio = b.dataset.wfAba; execAberta = null; desenharInicio(); }
  });
  $('wf-busca').addEventListener('input', desenharInicio);
  async function criar() {
    if (abaInicio === 'credenciais') return abrirCredencial(null);
    const g = await W.gravar({ nome: 'Novo workflow', descricao: '', ativo: false, nos: [{ id: 'n1', tipo: 'manual', x: 80, y: 120 }], ligacoes: [] });
    lista.push(g);
    await abrirEditor(g.id);
    $('wf-nome').focus(); $('wf-nome').select();
    return null;
  }
  $('wf-criar').addEventListener('click', criar);
  $('wf-lista-corpo').addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-wf-criar-vazio]')) return criar();
    if (ev.target.closest('.wf-ligado')) return null; // o interruptor tem o seu próprio "change"
    const ex = ev.target.closest('[data-exec]');
    if (ex) { execAberta = execAberta === ex.dataset.exec ? null : ex.dataset.exec; desenharInicio(); return null; }
    const w = ev.target.closest('[data-wf]');
    if (w) return abrirEditor(w.dataset.wf);
    const c = ev.target.closest('[data-cred]');
    if (c) return abrirCredencial(c.dataset.cred);
    return null;
  });
  $('wf-lista-corpo').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.matches('[data-wf], [data-cred]')) ev.target.click(); });
  $('wf-lista-corpo').addEventListener('change', async (ev) => {
    const id = ev.target.dataset.ligar;
    if (!id) return;
    const w = lista.find((x) => x.id === id);
    const g = await W.gravar({ ...w, ativo: ev.target.checked });
    Object.assign(w, g);
    desenharInicio();
  });

  // ==========================================================================
  // Credenciais (só a referência; o valor nunca passa pela tela)
  // ==========================================================================
  function abrirCredencial(id) {
    const c = creds.find((x) => x.id === id) || { id: '', nome: '', tipo: 'bitwarden', ref: '', campo: 'password', variavel: '' };
    const t = tiposCred.tipos;
    abrirModal(`<form class="wf-form" data-cred-form="${esc(c.id)}">
      <h3>${c.id ? 'Credencial' : 'Nova credencial'}</h3>
      <p class="nota">Aqui fica só onde a credencial mora — nunca o valor. Ela é lida na hora de rodar e chega ao comando como variável de ambiente; se aparecer na saída, vira ••••.</p>
      <label class="wf-campo">Nome<input name="nome" value="${esc(c.nome)}" placeholder="ex.: Token da API" required></label>
      <label class="wf-campo">Onde ela mora<select name="tipo">${Object.entries(t).map(([k, x]) => `<option value="${k}"${k === c.tipo ? ' selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></label>
      <label class="wf-campo"><span data-rotulo-ref>${esc(t[c.tipo]?.ref || 'Referência')}</span><input name="ref" value="${esc(c.ref)}" spellcheck="false" autocomplete="off"></label>
      <label class="wf-campo" data-so-bw${c.tipo === 'bitwarden' ? '' : ' hidden'}>Campo do item<select name="campo">${tiposCred.camposBw.map(([k, r]) => `<option value="${k}"${k === c.campo ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
      <label class="wf-campo">Variável que o comando recebe<input name="variavel" class="mono" value="${esc(c.variavel)}" placeholder="ex.: API_TOKEN" pattern="[A-Za-z_][A-Za-z0-9_]*" title="Letras, números e _" spellcheck="false"></label>
      <p class="nota" data-dica-cred>${esc(t[c.tipo]?.dica || '')}</p>
      <p class="wf-teste" data-resultado-teste hidden></p>
      <div class="wf-form-acoes">
        <button type="submit" class="botao primario">Salvar</button>
        ${c.id ? '<button type="button" class="botao-texto" data-testar-cred>Testar</button><button type="button" class="botao-texto perigo" data-apagar-cred>Apagar credencial</button>' : ''}
        <button type="button" class="botao-texto" data-fechar-modal>Fechar</button>
      </div></form>`);
  }
  $('wf-modal-corpo').addEventListener('change', (ev) => {
    const f = ev.target.closest('[data-cred-form]');
    if (!f || ev.target.name !== 'tipo') return;
    const t = tiposCred.tipos[ev.target.value];
    f.querySelector('[data-rotulo-ref]').textContent = t.ref;
    f.querySelector('[data-dica-cred]').textContent = t.dica;
    f.querySelector('[data-so-bw]').hidden = ev.target.value !== 'bitwarden';
  });
  $('wf-modal-corpo').addEventListener('submit', async (ev) => {
    const f = ev.target.closest('[data-cred-form]');
    if (!f) return;
    ev.preventDefault();
    const g = await W.gravarCredencial({ id: f.dataset.credForm || undefined, nome: f.nome.value, tipo: f.tipo.value, ref: f.ref.value, campo: f.campo.value, variavel: f.variavel.value.trim().toUpperCase() });
    creds = await W.credenciais();
    if (atual && sel?.no) abrirPasso(sel.no); else { abrirCredencial(g.id); desenharInicio(); }
  });
  $('wf-modal-corpo').addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-fechar-modal]')) { fecharModal(); return; }
    const f = ev.target.closest('[data-cred-form]');
    if (f && ev.target.closest('[data-testar-cred]')) {
      const r = await W.testarCredencial(f.dataset.credForm);
      const p = f.querySelector('[data-resultado-teste]');
      p.hidden = false;
      p.className = `wf-teste ${r.ok ? 'ok' : 'erro'}`;
      p.textContent = r.ok ? `Leu: ${r.tamanho} caracteres.${r.aviso ? ` Atenção: ${r.aviso}.` : ''}` : r.erro;
      return;
    }
    const ap = ev.target.closest('[data-apagar-cred]');
    if (f && ap) {
      if (!ap.dataset.confirmando) { ap.dataset.confirmando = '1'; ap.textContent = 'Confirmar: apagar a referência'; return; }
      await W.apagarCredencial(f.dataset.credForm);
      creds = await W.credenciais();
      fecharModal();
      desenharInicio();
      return;
    }
    if (ev.target.closest('[data-nova-cred]')) { abrirCredencial(null); return; }
    if (ev.target.closest('[data-wf-remover]')) { fecharModal(); remover(); }
  });

  // --- janela por cima (ajustes do passo, credencial, descrição) -----------
  function abrirModal(html) {
    $('wf-modal-corpo').innerHTML = html;
    $('wf-modal').hidden = false;
    $('wf-modal-corpo').querySelector('input, textarea, select')?.focus();
  }
  function fecharModal() { $('wf-modal').hidden = true; $('wf-modal-corpo').innerHTML = ''; }
  $('wf-modal').addEventListener('pointerdown', (ev) => { if (ev.target === $('wf-modal')) fecharModal(); });

  // ==========================================================================
  // Editor
  // ==========================================================================
  async function abrirEditor(id) {
    const w = lista.find((x) => x.id === id);
    if (!w) return mostrarInicio();
    atual = JSON.parse(JSON.stringify(w));
    delete atual.rodando;
    sel = null; viva = null; execAberta = null; modo = 'editor';
    execs = await W.execucoes(id);
    $('wf-inicio').hidden = true;
    $('wf-editor').hidden = false;
    $('wf-gaveta').hidden = true;
    fecharModal();
    desenharEditor();
    if (vistas.has(id)) aplicarVista(vistas.get(id)); else ajustarVista();
    return null;
  }
  function desenharEditor() {
    if (document.activeElement !== $('wf-nome')) $('wf-nome').value = atual.nome;
    $('wf-ativo').checked = !!atual.ativo;
    $('wf-ativo-rotulo').textContent = atual.ativo ? 'Ligado' : 'Desligado';
    for (const b of document.querySelectorAll('[data-wf-modo]')) b.setAttribute('aria-selected', String(b.dataset.wfModo === modo));
    $('wf-tela-editor').hidden = modo !== 'editor';
    $('wf-execs-editor').hidden = modo !== 'execucoes';
    const rod = !!lista.find((x) => x.id === atual.id)?.rodando;
    $('wf-rodar').disabled = rod;
    $('wf-rodar').textContent = rod ? 'Rodando…' : '▶ Rodar workflow';
    if (modo === 'editor') desenharQuadro(); else desenharExecsEditor();
  }
  function desenharExecsEditor() {
    const l = viva && !execs.some((x) => x.id === viva.id) ? [viva, ...execs] : execs;
    $('wf-execs-editor').innerHTML = l.length ? `<div class="wf-execs">${l.map((e) => linhaExecucao(e, false)).join('')}</div>` : vazio('Ainda não rodou.', 'Use “Rodar workflow” no quadro para testar; o relógio também registra aqui cada vez que dispara.');
  }
  $('wf-execs-editor').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-exec]');
    if (b) { execAberta = execAberta === b.dataset.exec ? null : b.dataset.exec; desenharExecsEditor(); }
  });
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('#aba-workflows [data-wf-modo]');
    if (b && atual) { modo = b.dataset.wfModo; desenharEditor(); }
  });
  $('wf-voltar').addEventListener('click', async () => { await salvar(true); await carregar(); mostrarInicio(); });
  $('wf-nome').addEventListener('input', () => { atual.nome = $('wf-nome').value; salvar(); });
  $('wf-ativo').addEventListener('change', () => { atual.ativo = $('wf-ativo').checked; $('wf-ativo-rotulo').textContent = atual.ativo ? 'Ligado' : 'Desligado'; salvar(true); });
  $('wf-rodar').addEventListener('click', async () => {
    await salvar(true);
    const r = await W.rodar(atual.id);
    if (r && r.execucao) { execAberta = r.execucao.id; execs = await W.execucoes(atual.id); }
  });

  // menu ⋯ : descrição, duplicar, apagar
  $('wf-mais').addEventListener('click', (ev) => {
    ev.stopPropagation();
    $('wf-menu-mais').hidden = !$('wf-menu-mais').hidden;
    const a = $('wf-menu-mais').querySelector('[data-wf-acao=apagar]');
    delete a.dataset.confirmando; a.textContent = 'Apagar workflow';
  });
  document.addEventListener('click', (ev) => { if (!ev.target.closest('#wf-menu-mais, #wf-mais')) $('wf-menu-mais').hidden = true; });
  $('wf-menu-mais').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-wf-acao]');
    if (!b) return;
    const acao = b.dataset.wfAcao;
    if (acao === 'apagar' && !b.dataset.confirmando) { b.dataset.confirmando = '1'; b.textContent = 'Confirmar: apagar'; return; }
    $('wf-menu-mais').hidden = true;
    if (acao === 'descricao') {
      abrirModal(`<div class="wf-form"><h3>Descrição</h3><p class="nota">Aparece na lista e vai junto quando você menciona @workflow: na conversa.</p>
        <label class="wf-campo"><textarea data-wf-prop="descricao" rows="6" placeholder="Para que serve">${esc(atual.descricao)}</textarea></label>
        <div class="wf-form-acoes"><button type="button" class="botao primario" data-fechar-modal>Pronto</button></div></div>`);
    } else if (acao === 'duplicar') {
      await salvar(true);
      const g = await W.gravar({ ...atual, id: undefined, nome: `${atual.nome} (cópia)`, ativo: false });
      lista.push(g);
      await abrirEditor(g.id);
    } else if (acao === 'apagar') {
      await W.apagar(atual.id);
      lista = lista.filter((x) => x.id !== atual.id);
      await carregar();
      mostrarInicio();
    }
  });

  // --- quadro: desenho ----------------------------------------------------
  const estadoNo = (id) => { const p = viva && [...viva.passos].reverse().find((x) => x.no === id); return p ? p.estado : ''; };
  function desenharQuadro() {
    if (!atual) return;
    $('wf-nos').innerHTML = atual.nos.map((n) => {
      const t = tipos[n.tipo] || { nome: n.tipo, grupo: 'acao' };
      const st = estadoNo(n.id);
      return `<div class="wf-no grupo-${t.grupo}${sel && sel.no === n.id ? ' selecionado' : ''}${st ? ` estado-${st}` : ''}" data-no="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px;width:${LARGURA}px" tabindex="0" title="Dois cliques para ajustar">
        ${t.grupo === 'gatilho' ? '' : '<span class="porta entrada"></span>'}
        <div class="wf-no-topo"><span class="wf-icone">${ICONES[n.tipo] || '•'}</span><strong>${esc(t.nome)}</strong>${st ? `<span class="wf-estado">${{ rodando: 'rodando…', ok: 'ok', parou: 'parou', erro: 'erro' }[st]}</span>` : ''}</div>
        <div class="wf-no-resumo">${esc(resumo(n))}</div>
        <span class="porta saida" title="Puxe até outro passo para ligar"></span>
        <button type="button" class="wf-mais-saida" data-mais-depois="${esc(n.id)}" title="Acrescentar um passo depois deste" aria-label="Acrescentar passo depois">+</button>
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

  // --- quadro: mover e zoom ------------------------------------------------
  function aplicarVista(v) {
    vista = { x: v.x, y: v.y, z: Math.min(2, Math.max(0.3, v.z)) };
    if (atual) vistas.set(atual.id, vista);
    $('wf-area').style.transform = `translate(${vista.x}px, ${vista.y}px) scale(${vista.z})`;
    $('wf-quadro').style.backgroundPosition = `${vista.x}px ${vista.y}px`;
    $('wf-quadro').style.backgroundSize = `${20 * vista.z}px ${20 * vista.z}px`;
    $('wf-zoom-valor').textContent = `${Math.round(vista.z * 100)}%`;
  }
  // Zoom para caber todos os passos (como o n8n faz ao abrir).
  function ajustarVista() {
    const q = $('wf-quadro').getBoundingClientRect();
    if (!atual || !atual.nos.length || !q.width) { aplicarVista({ x: 40, y: 40, z: 1 }); return; }
    const x0 = Math.min(...atual.nos.map((n) => n.x)), y0 = Math.min(...atual.nos.map((n) => n.y));
    const x1 = Math.max(...atual.nos.map((n) => n.x + LARGURA)), y1 = Math.max(...atual.nos.map((n) => n.y + 90));
    const z = Math.max(0.3, Math.min(1.1, (q.width - 160) / (x1 - x0), (q.height - 200) / (y1 - y0)));
    aplicarVista({ z, x: (q.width - (x1 - x0) * z) / 2 - x0 * z, y: (q.height - (y1 - y0) * z) / 2 - y0 * z - 20 });
  }
  function zoom(fator, cx, cy) {
    const q = $('wf-quadro').getBoundingClientRect();
    const px = cx ?? q.width / 2, py = cy ?? q.height / 2;
    const z = Math.min(2, Math.max(0.3, vista.z * fator));
    aplicarVista({ z, x: px - (px - vista.x) * (z / vista.z), y: py - (py - vista.y) * (z / vista.z) });
  }
  $('wf-quadro').addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const q = $('wf-quadro').getBoundingClientRect();
    if (ev.ctrlKey || ev.metaKey) zoom(ev.deltaY < 0 ? 1.1 : 1 / 1.1, ev.clientX - q.left, ev.clientY - q.top);
    else aplicarVista({ ...vista, x: vista.x - ev.deltaX, y: vista.y - ev.deltaY });
  }, { passive: false });
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('#aba-workflows [data-zoom]');
    if (!b) return;
    if (b.dataset.zoom === 'mais') zoom(1.2); else if (b.dataset.zoom === 'menos') zoom(1 / 1.2); else ajustarVista();
  });
  // Ponto do mouse em coordenadas do desenho (descontando posição e zoom).
  function noDesenho(ev) {
    const q = $('wf-quadro').getBoundingClientRect();
    return [(ev.clientX - q.left - vista.x) / vista.z, (ev.clientY - q.top - vista.y) / vista.z];
  }
  // Segura o ponteiro no quadro enquanto arrasta (sem ponteiro de verdade,
  // como num clique simulado, só segue sem segurar).
  const prender = (ev) => { try { $('wf-quadro').setPointerCapture(ev.pointerId); } catch { /* sem ponteiro ativo */ } };
  function arrastar(ev, mover, soltar) {
    prender(ev);
    const m = (e) => mover(e);
    const s = (e) => { $('wf-quadro').removeEventListener('pointermove', m); $('wf-quadro').removeEventListener('pointerup', s); soltar(e); };
    $('wf-quadro').addEventListener('pointermove', m);
    $('wf-quadro').addEventListener('pointerup', s);
  }

  $('wf-quadro').addEventListener('pointerdown', (ev) => {
    if (!atual || ev.button !== 0 || ev.target.closest('.wf-controles, .wf-rodar-caixa, .wf-mais-saida, #wf-mais-passo')) return;
    const linha = ev.target.closest('.wf-linha-toque');
    if (linha) { sel = { lig: Number(linha.dataset.lig) }; desenharQuadro(); return; }
    const el = ev.target.closest('.wf-no');
    if (!el) {
      // Fundo: arrasta o quadro inteiro.
      if (sel) { sel = null; desenharQuadro(); }
      const ini = { cx: ev.clientX, cy: ev.clientY, x: vista.x, y: vista.y };
      $('wf-quadro').classList.add('movendo');
      arrastar(ev, (e) => aplicarVista({ ...vista, x: ini.x + e.clientX - ini.cx, y: ini.y + e.clientY - ini.cy }), () => $('wf-quadro').classList.remove('movendo'));
      return;
    }
    const n = atual.nos.find((x) => x.id === el.dataset.no);
    ev.preventDefault();
    if (ev.target.classList.contains('saida')) {
      arrastar(ev, (e) => desenharLinhas([pontoSaida(n), noDesenho(e)]), (e) => {
        const alvo = document.elementFromPoint(e.clientX, e.clientY)?.closest('.wf-no');
        if (alvo) ligar(n.id, alvo.dataset.no);
        desenharLinhas();
      });
      return;
    }
    sel = { no: n.id };
    const [px, py] = noDesenho(ev);
    const dx = px - n.x, dy = py - n.y;
    let mexeu = false;
    desenharQuadro();
    const card = () => $('wf-nos').querySelector(`[data-no="${CSS.escape(n.id)}"]`);
    card()?.focus();
    arrastar(ev, (e) => {
      const [x, y] = noDesenho(e);
      n.x = Math.round(x - dx); n.y = Math.round(y - dy);
      const c = card();
      if (c) { c.style.left = `${n.x}px`; c.style.top = `${n.y}px`; }
      mexeu = true;
      desenharLinhas();
    }, () => { if (mexeu) salvar(); });
  });
  $('wf-quadro').addEventListener('dblclick', (ev) => {
    const el = ev.target.closest('.wf-no');
    if (el) abrirPasso(el.dataset.no);
  });
  $('wf-quadro').addEventListener('keydown', (ev) => {
    if (ev.target.closest('input, textarea, select')) return;
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && sel) { ev.preventDefault(); remover(); }
    if (ev.key === 'Enter' && sel?.no) { ev.preventDefault(); abrirPasso(sel.no); }
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || $('wf-editor').hidden) return;
    if (!$('wf-modal').hidden) fecharModal(); else if (!$('wf-gaveta').hidden) $('wf-gaveta').hidden = true;
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
  }

  // --- gaveta de passos (o "+") -------------------------------------------
  function abrirGaveta(depois) {
    depoisDe = depois;
    const grupos = [['gatilho', 'Gatilhos'], ['acao', 'Ações'], ['logica', 'Lógica']];
    $('wf-gaveta').innerHTML = `<header><strong>${depois ? 'O que acontece depois?' : 'Acrescentar passo'}</strong><button type="button" class="botao-icone" data-fechar-gaveta aria-label="Fechar">✕</button></header>
      ${grupos.map(([g, r]) => `<div class="menu-titulo">${r}</div>${Object.entries(tipos).filter(([, t]) => t.grupo === g && !(depois && g === 'gatilho')).map(([k, t]) =>
        `<button type="button" class="menu-item" data-novo-no="${k}"><span class="wf-icone">${ICONES[k] || ''}</span><span><strong>${esc(t.nome)}</strong><small>${esc(t.descricao)}</small></span></button>`).join('')}`).join('')}`;
    $('wf-gaveta').hidden = false;
  }
  $('wf-mais-passo').addEventListener('click', () => abrirGaveta(sel?.no || null));
  $('wf-nos').addEventListener('click', (ev) => { const b = ev.target.closest('[data-mais-depois]'); if (b) abrirGaveta(b.dataset.maisDepois); });
  $('wf-gaveta').addEventListener('click', (ev) => {
    if (ev.target.closest('[data-fechar-gaveta]')) { $('wf-gaveta').hidden = true; return; }
    const b = ev.target.closest('[data-novo-no]');
    if (!b) return;
    $('wf-gaveta').hidden = true;
    novoNo(b.dataset.novoNo, depoisDe);
  });
  function novoNo(tipo, depois) {
    if (!atual || !tipos[tipo]) return;
    const config = {};
    for (const c of tipos[tipo].campos) config[c.k] = Array.isArray(c.padrao) ? [] : c.padrao;
    let k = atual.nos.length + 1;
    while (atual.nos.some((n) => n.id === `n${k}`)) k++;
    const anterior = depois ? atual.nos.find((n) => n.id === depois) : null;
    const q = $('wf-quadro').getBoundingClientRect();
    const n = anterior
      ? { id: `n${k}`, tipo, x: anterior.x + LARGURA + 70, y: anterior.y, config }
      : { id: `n${k}`, tipo, x: Math.round((q.width / 2 - vista.x) / vista.z - LARGURA / 2), y: Math.round((q.height / 3 - vista.y) / vista.z), config };
    while (atual.nos.some((o) => Math.abs(o.x - n.x) < 60 && Math.abs(o.y - n.y) < 60)) n.y += 110;
    atual.nos.push(n);
    if (anterior && tipos[tipo].grupo !== 'gatilho') atual.ligacoes.push({ de: anterior.id, para: n.id });
    sel = { no: n.id };
    salvar();
    desenharQuadro();
    abrirPasso(n.id); // como no n8n: o passo novo já abre para ajustar
  }

  // --- ajustes de um passo (janela por cima) ------------------------------
  const visivelCampo = (c, cfg) => !c.se || Object.entries(c.se).every(([k, v]) => (Array.isArray(v) ? v.includes(cfg[k]) : cfg[k] === v));
  function abrirPasso(id) {
    const n = atual && atual.nos.find((x) => x.id === id);
    if (!n) return;
    sel = { no: n.id };
    const t = tipos[n.tipo];
    const ult = [viva, ...execs].filter(Boolean).flatMap((e) => e.passos.filter((p) => p.no === n.id))[0];
    abrirModal(`<div class="wf-form wf-passo" data-passo="${esc(n.id)}">
      <h3><span class="wf-icone">${ICONES[n.tipo] || ''}</span> ${esc(t.nome)}</h3><p class="nota">${esc(t.descricao)}</p>
      ${t.campos.filter((c) => visivelCampo(c, n.config)).map((c) => campoHtml(c, n.config[c.k])).join('') || '<p class="nota">Este passo não tem ajustes.</p>'}
      ${n.tipo !== 'agenda' && n.tipo !== 'manual' ? '<p class="nota"><strong>{{entrada}}</strong> vira a saída do passo anterior; <strong>{{data}}</strong>, a data e a hora.</p>' : ''}
      ${ult ? `<div class="wf-ultima"><span class="menu-titulo">Última saída (${esc(ult.estado)})</span><pre>${esc(ult.saida || '(vazia)')}</pre></div>` : ''}
      <div class="wf-form-acoes"><button type="button" class="botao primario" data-fechar-modal>Pronto</button><button type="button" class="botao-texto perigo" data-wf-remover>Tirar este passo</button></div></div>`);
    desenharQuadro();
  }
  function campoHtml(c, v) {
    if (c.tipo === 'sim') return `<label class="wf-campo marcar"><input type="checkbox" data-cfg-no="${c.k}"${v ? ' checked' : ''}> ${esc(c.rotulo)}</label>`;
    if (c.tipo === 'lista') return `<label class="wf-campo">${esc(c.rotulo)}<select data-cfg-no="${c.k}">${c.opcoes.map(([k, r]) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></label>`;
    if (c.tipo === 'longo') return `<label class="wf-campo">${esc(c.rotulo)}<textarea data-cfg-no="${c.k}" rows="7">${esc(v)}</textarea></label>`;
    if (c.tipo === 'credenciais') {
      return `<fieldset class="wf-campo wf-creds"><legend>${esc(c.rotulo)}</legend>${creds.map((cr) => `<label class="marcar"><input type="checkbox" data-cred-no="${esc(cr.id)}"${(v || []).includes(cr.id) ? ' checked' : ''}> 🔑 ${esc(cr.nome)} <span class="mono nota">$${esc(cr.variavel)}</span></label>`).join('') || '<p class="nota">Nenhuma credencial criada.</p>'}
        <button type="button" class="botao-texto" data-nova-cred>+ Nova credencial</button></fieldset>`;
    }
    return `<label class="wf-campo">${esc(c.rotulo)}<input data-cfg-no="${c.k}" type="${c.tipo === 'numero' ? 'number' : 'text'}"${c.tipo === 'numero' ? ' min="1"' : ''} value="${esc(v)}"></label>`;
  }
  $('wf-modal-corpo').addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.wfProp && atual) { atual[el.dataset.wfProp] = el.value; salvar(); return; }
    const caixa = el.closest('[data-passo]');
    if (!caixa || !atual) return;
    const n = atual.nos.find((x) => x.id === caixa.dataset.passo);
    if (!n) return;
    if (el.dataset.credNo) {
      const l = new Set(n.config.credenciais || []);
      if (el.checked) l.add(el.dataset.credNo); else l.delete(el.dataset.credNo);
      n.config.credenciais = [...l];
    } else if (el.dataset.cfgNo) {
      n.config[el.dataset.cfgNo] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
    } else return;
    salvar();
    desenharQuadro();
    if (el.tagName === 'SELECT') abrirPasso(n.id); // campos que dependem da escolha
  });

  // --- execução ao vivo ----------------------------------------------------
  W.aoExecucao(async (e) => {
    const w = lista.find((x) => x.id === e.wf);
    if (w) w.rodando = !e.fim;
    if (e.fim) todas = await W.execucoes();
    if (!atual) { if (!$('wf-inicio').hidden) desenharInicio(); return; }
    if (e.wf !== atual.id) return;
    viva = e;
    if (e.fim) { execs = await W.execucoes(atual.id); setTimeout(() => { if (viva === e && atual) { viva = null; desenharQuadro(); } }, 6000); }
    desenharEditor();
  });

  // --- conversa e paleta ---------------------------------------------------
  // @workflow:nome manda a descrição e os passos junto.
  function descrever(nome) {
    const w = lista.find((x) => x.nome === nome);
    if (!w) return null;
    const passos = w.nos.map((n) => `- ${tipos[n.tipo]?.nome || n.tipo} (${n.id}): ${resumo(n)}${n.config.texto || n.config.prompt || n.config.comando ? `\n  texto: ${String(n.config.texto || n.config.prompt || n.config.comando).replace(/\n/g, '\n  ')}` : ''}`).join('\n');
    const ligs = w.ligacoes.map((l) => `${l.de} → ${l.para}`).join(', ');
    return `Workflow «${w.nome}» do App de Orquestração (${w.ativo ? 'ligado' : 'desligado'}).\n${w.descricao || ''}\n\nPassos:\n${passos}\nLigações: ${ligs || 'nenhuma'}`;
  }
  const irParaAba = () => document.querySelector('[data-aba="aba-workflows"]')?.click();
  window.orqWorkflows = {
    listar: () => lista.map((w) => ({ id: w.id, nome: w.nome, descricao: w.descricao })),
    descrever,
    abrir: async (id) => { irParaAba(); await abrirEditor(id); },
  };
  window.orqPaleta?.registrar(() => [
    { grupo: 'Workflows', titulo: 'Novo workflow', faz: async () => { irParaAba(); abaInicio = 'workflows'; await criar(); } },
    ...lista.map((w) => ({ grupo: 'Workflows', titulo: w.nome, sub: w.ativo ? 'ligado' : 'desligado', faz: () => window.orqWorkflows.abrir(w.id) })),
  ]);

  // Abrir a aba relê tudo: o que mudou fora daqui aparece sem reiniciar.
  document.querySelector('[data-aba="aba-workflows"]')?.addEventListener('click', async () => {
    await carregar();
    if (atual && lista.some((x) => x.id === atual.id)) return;
    if (atual) mostrarInicio(); else desenharInicio();
  });

  Promise.all([W.tipos(), W.tiposCred(), carregar()]).then(([t, tc]) => {
    tipos = t; tiposCred = tc;
    mostrarInicio();
  });
})();
