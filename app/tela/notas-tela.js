// Aba Notas: árvore das pastas configuradas (config.pastasNotas) e o editor
// no estilo Notion (editor.bundle.js). Salva sozinho; o processo principal
// guarda a versão anterior a cada gravação e recusa gravar por cima de uma
// mudança feita por fora (agente, outra sessão, Obsidian).
(() => {
  const $ = (id) => document.getElementById(id);
  const N = window.orq.notas;
  if (!N || !window.EditorNotas) return; // app ainda não reaberto com a ponte nova
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lerPref = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const gravarPref = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } };

  const GRANDE = 400 * 1024; // acima disso abre só para leitura (o editor fica lento)
  let pastas = [];
  let arvores = [];
  let aberta = null;          // { i, rel, mtime, base }
  let sujo = false;
  let soLeitura = false;
  let timer = null;
  const abertasNaArvore = new Set(lerPref('notas-pastas-abertas') || []);

  const editor = window.EditorNotas.criar({
    el: $('editor-nota'),
    aoMudar: () => { if (soLeitura || !aberta) return; sujo = true; estado('Editando…'); clearTimeout(timer); timer = setTimeout(salvar, 1200); },
    aoSalvarJa: () => { clearTimeout(timer); salvar(); },
  });

  function estado(t) { $('estado-nota').textContent = t; }
  function aviso(html) { const a = $('aviso-nota'); a.innerHTML = html || ''; a.hidden = !html; }
  function vazio(sim) {
    $('editor-nota').hidden = sim;
    $('vazio-nota').hidden = !sim;
    if (sim) $('vazio-nota').innerHTML = `<div class="vazio"><span class="ico-caixa"><svg class="ico"><use href="#i-notas"/></svg></span>
      <strong>${pastas.length ? 'Nenhuma nota aberta' : 'Nenhuma pasta de notas'}</strong>
      <span>${pastas.length ? 'Escolha uma nota à esquerda ou crie uma com o +.' : 'Configure "pastasNotas" em ~/.config/orq-app/config.json.'}</span></div>`;
  }

  // --- abas das pastas (em cima) e explorador (à esquerda) --------------------
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
  let ativa = Number(lerPref('notas-pasta-ativa')) || 0;
  let selecionada = null; // pasta (rel) onde a próxima nota nasce

  const ICO_PASTA = '<svg class="ico ico-arvore" viewBox="0 0 16 16"><path d="M2 4.5h4.2l1.3 1.5H14v6.5H2z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  const ICO_NOTA = '<svg class="ico ico-arvore" viewBox="0 0 16 16"><path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';

  function desenharAbas() {
    $('abas-pastas').innerHTML = pastas.map((p, i) => `
      <div class="aba-pasta${i === ativa ? ' ativa' : ''}" role="tab" aria-selected="${i === ativa}">
        <button type="button" data-pasta="${i}" title="${esc(p.nome)}">${ICO_PASTA}<span>${esc(p.nome)}</span></button>
        <button type="button" class="tirar-pasta" data-tirar="${i}" title="Tirar esta pasta do app (nada é apagado do disco)" aria-label="Tirar pasta">✕</button>
      </div>`).join('') +
      '<button type="button" class="aba-pasta-mais" data-mais title="Abrir outra pasta">+ Pasta</button>';
    $('nome-pasta-ativa').textContent = pastas[ativa] ? pastas[ativa].nome : 'Notas';
  }

  // Diários (AAAA-MM-DD.md) aparecem como antes: por mês, com dia e dia da semana.
  function linhasDaPasta(filhos, nivel, filtro) {
    const pastasF = filhos.filter((n) => n.tipo === 'pasta');
    const notas = filhos.filter((n) => n.tipo === 'nota');
    const datadas = notas.filter((n) => DATA.test(n.nome)).sort((a, b) => b.nome.localeCompare(a.nome));
    const outras = notas.filter((n) => !DATA.test(n.nome));
    let html = pastasF.map((n) => linhaPasta(n, nivel, filtro)).join('');
    html += outras.filter((n) => !filtro || n.rel.toLowerCase().includes(filtro)).map((n) => linhaNota(n, nivel, n.nome)).join('');
    let mes = '';
    for (const n of datadas) {
      const [, a, m, d] = n.nome.match(DATA);
      const data = new Date(Number(a), Number(m) - 1, Number(d));
      const rotulo = `${d} · ${SEMANA[data.getDay()]}`;
      if (filtro && !`${n.rel} ${rotulo} ${MESES[data.getMonth()]}`.toLowerCase().includes(filtro)) continue;
      const titulo = `${MESES[data.getMonth()]} de ${a}`;
      if (titulo !== mes) { html += `<div class="linha-mes" style="--nivel:${nivel}">${titulo}</div>`; mes = titulo; }
      html += linhaNota(n, nivel, rotulo, true);
    }
    return html;
  }
  function linhaPasta(n, nivel, filtro) {
    const chave = `${ativa}:${n.rel}`;
    const dentro = linhasDaPasta(n.filhos, nivel + 1, filtro);
    if (filtro && !dentro) return '';
    const aberta = !!filtro || abertasNaArvore.has(chave);
    return `<div class="no-pasta${aberta ? ' aberta' : ''}">
      <button type="button" class="linha-arvore linha-pasta${selecionada === n.rel ? ' selecionada' : ''}" data-pasta-rel="${esc(n.rel)}" style="--nivel:${nivel}" role="treeitem" aria-expanded="${aberta}">
        <span class="chevron">›</span>${ICO_PASTA}<span class="nome">${esc(n.nome)}</span></button>
      <div class="filhos" style="--nivel:${nivel}">${aberta ? dentro : ''}</div></div>`;
  }
  function linhaNota(n, nivel, rotulo, data = false) {
    const ativo = aberta && aberta.i === ativa && aberta.rel === n.rel;
    return `<button type="button" class="linha-arvore linha-nota${ativo ? ' ativo' : ''}${data ? ' data' : ''}" data-rel="${esc(n.rel)}" style="--nivel:${nivel}" title="${esc(n.rel)}" role="treeitem">
      <span class="chevron vazio"></span>${ICO_NOTA}<span class="nome">${esc(rotulo)}</span></button>`;
  }

  function desenharArvore() {
    desenharAbas();
    if (!pastas.length) {
      $('arvore-notas').innerHTML = '<p class="nota explorador-vazio">Nenhuma pasta aberta. Use "+ Pasta" em cima para abrir uma.</p>';
      return;
    }
    const filtro = $('filtro-notas').value.trim().toLowerCase();
    $('arvore-notas').innerHTML = linhasDaPasta(arvores[ativa] || [], 0, filtro) || '<p class="nota explorador-vazio">Nenhuma nota .md aqui.</p>';
  }

  async function carregarArvore() {
    pastas = await N.pastas();
    if (ativa >= pastas.length) ativa = 0;
    arvores = await Promise.all(pastas.map((_, i) => N.arvore(i).catch(() => [])));
    desenharArvore();
    if (!aberta) vazio(true);
  }

  $('abas-pastas').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-pasta]');
    if (b) { ativa = Number(b.dataset.pasta); gravarPref('notas-pasta-ativa', ativa); selecionada = null; desenharArvore(); return; }
    if (ev.target.closest('[data-mais]')) {
      const i = await N.adicionarPasta();
      if (i == null) return;
      await carregarArvore();
      if (i >= 0) { ativa = i; gravarPref('notas-pasta-ativa', ativa); desenharArvore(); }
      return;
    }
    const t = ev.target.closest('[data-tirar]');
    if (t) {
      // Confirma no segundo clique; tirar a pasta do app não apaga nada do disco.
      if (!t.dataset.confirmando) {
        t.dataset.confirmando = '1'; t.textContent = 'Tirar?';
        setTimeout(() => { if (t.isConnected) { delete t.dataset.confirmando; t.textContent = '✕'; } }, 3500);
        return;
      }
      const i = Number(t.dataset.tirar);
      if (aberta && aberta.i === i) { if (sujo) { clearTimeout(timer); await salvar(); } aberta = null; N.vigiar(0, null); vazio(true); }
      await N.removerPasta(i);
      ativa = 0; gravarPref('notas-pasta-ativa', 0);
      await carregarArvore();
    }
  });

  $('arvore-notas').addEventListener('click', (ev) => {
    const nota = ev.target.closest('.linha-nota');
    if (nota) return abrir(ativa, nota.dataset.rel);
    const p = ev.target.closest('.linha-pasta');
    if (p) {
      const chave = `${ativa}:${p.dataset.pastaRel}`;
      if (abertasNaArvore.has(chave)) abertasNaArvore.delete(chave); else abertasNaArvore.add(chave);
      selecionada = p.dataset.pastaRel;
      gravarPref('notas-pastas-abertas', [...abertasNaArvore]);
      desenharArvore();
    }
  });

  document.querySelector('.explorador-topo').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-acao]');
    if (!b) return;
    if (b.dataset.acao === 'nova' || b.dataset.acao === 'nova-pasta') {
      // O mesmo campo serve para nota e para pasta; o tipo fica marcado nele.
      const f = $('nova-nota-form');
      const tipo = b.dataset.acao === 'nova' ? 'nota' : 'pasta';
      f.hidden = !f.hidden && f.dataset.tipo === tipo;
      f.dataset.tipo = tipo;
      f.querySelector('input').placeholder = `Nome da ${tipo} em ${selecionada || pastas[ativa]?.nome || ''} (Enter)`;
      if (!f.hidden) f.querySelector('input').focus();
    } else if (b.dataset.acao === 'recolher') {
      for (const k of [...abertasNaArvore]) if (k.startsWith(`${ativa}:`)) abertasNaArvore.delete(k);
      gravarPref('notas-pastas-abertas', [...abertasNaArvore]);
      desenharArvore();
    } else if (b.dataset.acao === 'atualizar') {
      carregarArvore();
    }
  });
  $('nova-nota-form').addEventListener('keydown', async (ev) => {
    const f = $('nova-nota-form');
    if (ev.key === 'Escape') { f.hidden = true; return; }
    if (ev.key !== 'Enter' || !pastas[ativa]) return;
    const nome = ev.target.value.trim();
    if (!nome) return;
    const pasta = f.dataset.tipo === 'pasta';
    const r = pasta ? await N.criarPasta(ativa, selecionada || '', nome) : await N.criar(ativa, selecionada || '', nome);
    f.hidden = true; ev.target.value = '';
    if (selecionada) abertasNaArvore.add(`${ativa}:${selecionada}`);
    if (pasta) { abertasNaArvore.add(`${ativa}:${r.rel}`); selecionada = r.rel; gravarPref('notas-pastas-abertas', [...abertasNaArvore]); }
    await carregarArvore();
    if (!pasta) abrir(ativa, r.rel);
  });
  $('filtro-notas').addEventListener('input', desenharArvore);

  // --- abrir e salvar -------------------------------------------------------------
  async function abrir(i, rel, { manterRolagem = false } = {}) {
    if (sujo) { clearTimeout(timer); await salvar(); }
    const r = await N.ler(i, rel);
    aberta = { i, rel, mtime: r.mtime, base: r.conteudo };
    sujo = false;
    soLeitura = r.bytes > GRANDE;
    const folha = $('folha-nota'), rolagem = folha.scrollTop;
    vazio(false);
    editor.definir(r.conteudo);
    editor.editavel(!soLeitura);
    if (manterRolagem) folha.scrollTop = rolagem; else folha.scrollTop = 0;
    $('caminho-nota').textContent = `${pastas[i].nome} / ${rel.replace(/\.md$/i, '').split('/').join(' / ')}`;
    if (ativa !== i) { ativa = i; gravarPref('notas-pasta-ativa', ativa); }
    estado(soLeitura ? 'Só leitura' : 'Salvo');
    aviso(soLeitura ? `Arquivo grande (${(r.bytes / 1024 / 1024).toFixed(1)} MB): aberto só para leitura, porque editar deixaria tudo lento.
      <button type="button" class="botao-texto" data-editar-mesmo>Editar mesmo assim</button>` : '');
    gravarPref('nota-aberta', { i, rel });
    N.vigiar(i, rel);
    desenharArvore();
  }

  async function salvar() {
    if (!aberta || !sujo || soLeitura) return;
    const md = editor.markdown();
    estado('Salvando…');
    const r = await N.gravar(aberta.i, aberta.rel, md, aberta.mtime);
    if (!r.conflito) {
      aberta.mtime = r.mtime; aberta.base = md; sujo = false;
      estado('Salvo');
      return;
    }
    // Mudou por fora desde que abriu. Se foi só acréscimo no fim (o jeito de
    // agentes e do diário escreverem), junta sozinho: o seu texto + o que entrou.
    if (r.conteudo.startsWith(aberta.base)) {
      const acrescimo = r.conteudo.slice(aberta.base.length);
      const junto = md.replace(/\s*$/, '\n') + acrescimo.replace(/^\n+/, '\n');
      const g = await N.gravar(aberta.i, aberta.rel, junto, r.mtime);
      if (!g.conflito) {
        aberta.mtime = g.mtime; aberta.base = junto; sujo = false;
        editor.definir(junto);
        estado('Salvo');
        aviso('Alguém acrescentou texto no fim desta nota enquanto você editava; juntei as duas coisas.');
        setTimeout(() => aviso(''), 6000);
        return;
      }
    }
    estado('Conflito');
    aviso(`Esta nota mudou por fora enquanto você editava (um agente, outra sessão ou o Obsidian).
      <button type="button" class="botao-texto" data-conflito="meu">Ficar com o meu</button>
      <button type="button" class="botao-texto" data-conflito="fora">Usar a de fora</button>
      <span class="nota">As duas versões ficam guardadas.</span>`);
    aberta.conflito = r;
  }

  $('aviso-nota').addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-editar-mesmo]')) {
      soLeitura = false; editor.editavel(true); estado('Salvo'); aviso('');
      return;
    }
    const b = ev.target.closest('[data-conflito]');
    if (!b || !aberta || !aberta.conflito) return;
    const fora = aberta.conflito;
    if (b.dataset.conflito === 'meu') {
      // A versão de fora vira versão guardada (o gravar guarda o arquivo atual antes).
      const g = await N.gravar(aberta.i, aberta.rel, editor.markdown(), fora.mtime);
      if (!g.conflito) { aberta.mtime = g.mtime; aberta.base = editor.markdown(); sujo = false; estado('Salvo'); }
    } else {
      // A sua edição não some: vai para as versões antes de trocar o texto.
      await N.guardarCopia(aberta.i, aberta.rel, editor.markdown());
      aberta.mtime = fora.mtime; aberta.base = fora.conteudo; sujo = false;
      editor.definir(fora.conteudo);
      estado('Salvo');
    }
    delete aberta.conflito;
    aviso('');
  });

  // Mudança por fora no arquivo aberto: sem edição pendente, só recarrega.
  N.aoMudar(async (m) => {
    if (!aberta || m.i !== aberta.i || m.rel !== aberta.rel || Math.abs(m.mtime - aberta.mtime) < 2) return;
    if (!sujo) { await abrir(m.i, m.rel, { manterRolagem: true }); estado('Atualizado por fora'); }
  });

  // Ao sair da aba ou fechar, nada fica sem salvar.
  window.addEventListener('beforeunload', () => { if (sujo) salvar(); });
  document.addEventListener('click', (ev) => {
    const aba = ev.target.closest('[data-aba]');
    if (!aba) return;
    if (aba.dataset.aba === 'aba-notas') carregarArvore().then(() => {
      const ultima = lerPref('nota-aberta');
      if (!aberta && ultima && pastas[ultima.i]) abrir(ultima.i, ultima.rel).catch(() => vazio(true));
    });
    else if (sujo) { clearTimeout(timer); salvar(); }
  });
})();
