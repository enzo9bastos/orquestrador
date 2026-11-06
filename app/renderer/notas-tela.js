// Aba Notas: árvore das pastas configuradas (config.pastasNotas) e o editor
// no estilo Notion (editor.bundle.js). Salva sozinho; o processo principal
// guarda a versão anterior a cada gravação e recusa gravar por cima de uma
// mudança feita por fora (agente, outra sessão, Obsidian).
(() => {
  const $ = (id) => document.getElementById(id);
  const N = window.orq.notas;
  if (!N || !window.EditorNotas) return; // app ainda não reaberto com a ponte nova
  const { esc } = window.orqUtil;
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
    // Imagem colada/arrastada/escolhida: salva em anexos/ ao lado da nota.
    aoImagem: (arquivo) => new Promise((ok) => {
      if (!aberta || soLeitura) return ok(null);
      if (arquivo.size > 15 * 1024 * 1024) { aviso('Imagem acima de 15 MB não entra na nota.'); return ok(null); }
      const r = new FileReader();
      r.onload = async () => {
        try { ok(await N.salvarImagem(aberta.i, aberta.rel, String(r.result).split(',')[1], arquivo.type)); }
        catch (e) { aviso(esc(e.message)); ok(null); }
      };
      r.readAsDataURL(arquivo);
    }),
    aoMudar: () => { if (soLeitura || !aberta) return; sujo = true; estado('Editando…'); clearTimeout(timer); timer = setTimeout(salvar, 1200); },
    aoSalvarJa: () => { clearTimeout(timer); salvar(); },
  });

  function estado(t) { $('estado-nota').textContent = t; }
  function aviso(html) { const a = $('aviso-nota'); a.innerHTML = html || ''; a.hidden = !html; }
  function vazio(sim) {
    $('pagina-nota').hidden = sim;
    if (sim) $('barra-nota').hidden = true;
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
    // Clique no espaço vazio da lista: desmarca a pasta (a próxima nota nasce na raiz).
    if (!p && selecionada !== null) { selecionada = null; desenharArvore(); return; }
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
    if (b.dataset.acao === 'abrir-pasta') {
      // Abre uma pasta que já existe no computador (vira uma aba em cima).
      const i = await N.adicionarPasta();
      if (i == null) return;
      await carregarArvore();
      if (i >= 0) { ativa = i; gravarPref('notas-pasta-ativa', ativa); desenharArvore(); }
      return;
    }
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

  // --- barra fixa da nota -------------------------------------------------------
  // Fonte, tamanho e cor ficam guardados por nota (preferência deste computador).
  const chaveEstilo = () => (aberta ? `nota-estilo:${aberta.i}:${aberta.rel}` : null);
  function aplicarEstilo() {
    const e = (chaveEstilo() && lerPref(chaveEstilo())) || {};
    const pag = $('pagina-nota');
    // Notas antigas guardavam "serifa"/"mono" e "p"/"g": traduz para o jeito novo.
    const fonte = { serifa: 'Noto Serif', mono: 'JetBrains Mono' }[e.fonte] ?? e.fonte ?? '';
    const tamanho = { p: '13', g: '17' }[e.tamanho] ?? e.tamanho ?? '';
    e.fonte = fonte; e.tamanho = tamanho;
    pag.style.setProperty('--fonte-nota', fonte ? `'${fonte}', var(--sans)` : 'var(--sans)');
    pag.style.setProperty('--tamanho-nota', tamanho ? `${tamanho}px` : '15px');
    pag.dataset.fonte = fonte; pag.dataset.cor = e.cor || '';
    $('folha-nota').dataset.cor = e.cor || '';
    document.querySelector('[data-estilo="fonte"]').value = e.fonte || '';
    document.querySelector('[data-estilo="tamanho"]').value = e.tamanho || '';
    document.querySelectorAll('[data-cor-nota]').forEach((b) => b.setAttribute('aria-pressed', String((e.cor || '') === b.dataset.corNota)));
    $('barra-nota').hidden = !aberta;
    marcarAtivos();
  }
  function mudarEstilo(m) {
    if (!chaveEstilo()) return;
    gravarPref(chaveEstilo(), { ...(lerPref(chaveEstilo()) || {}), ...m });
    aplicarEstilo();
  }
  function marcarAtivos() {
    const a = editor.ativos();
    document.querySelectorAll('#barra-nota [data-cmd]').forEach((b) => b.classList.toggle('ligado', !!a[b.dataset.cmd]));
  }
  editor.aoMudarSelecao(marcarAtivos);
  const barra = $('barra-nota');
  barra.addEventListener('change', (ev) => { const s = ev.target.closest('[data-estilo]'); if (s) mudarEstilo({ [s.dataset.estilo]: s.value }); });
  barra.addEventListener('mousedown', (ev) => { if (ev.target.closest('button,li')) ev.preventDefault(); }); // não tira o foco do texto
  barra.addEventListener('click', (ev) => {
    const cor = ev.target.closest('[data-cor-nota]');
    if (cor) { mudarEstilo({ cor: cor.dataset.corNota }); return; }
    const b = ev.target.closest('[data-cmd]');
    if (!b || soLeitura) return;
    const cmd = b.dataset.cmd;
    barra.querySelector('.mais-nota').hidden = cmd === 'mais' ? !barra.querySelector('.mais-nota').hidden : true;
    if (cmd === 'mais') return;
    if (cmd === 'imagem') { $('arquivo-imagem-nota').click(); return; }
    if (cmd === 'link') {
      const l = barra.querySelector('.link-nota');
      // Sem texto selecionado não há o que virar link: avisa em vez de abrir o campo.
      if (!editor.comandos.temSelecao() && !editor.comandos.linkAtual()) { aviso('Selecione o texto que vai virar link e clique de novo.'); setTimeout(() => aviso(''), 3500); return; }
      l.hidden = !l.hidden;
      if (!l.hidden) { const inp = l.querySelector('input'); inp.value = editor.comandos.linkAtual(); inp.focus(); }
      return;
    }
    editor.comandos[cmd]();
    marcarAtivos();
  });
  barra.querySelector('.link-nota input').addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.target.parentElement.hidden = true; return; }
    if (ev.key !== 'Enter') return;
    editor.comandos.link(ev.target.value.trim());
    ev.target.parentElement.hidden = true;
  });
  $('arquivo-imagem-nota').addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (f) editor.comandos.imagem(f);
    ev.target.value = '';
  });

  // Ctrl+clique num link da nota abre no navegador do sistema (só http/https).
  $('folha-nota').addEventListener('click', (ev) => {
    const a = ev.target.closest('.tiptap a[href]');
    if (!a) return;
    ev.preventDefault();
    if ((ev.ctrlKey || ev.metaKey) && window.orq.abrirLink) window.orq.abrirLink(a.getAttribute('href'));
  });

  // --- título da página = nome do arquivo (editar renomeia) ---------------------
  async function renomearAberta() {
    if (!aberta) return;
    const novo = $('titulo-nota').textContent.trim();
    const atual = aberta.rel.split('/').pop().replace(/\.md$/i, '');
    if (!novo || novo === atual) { $('titulo-nota').textContent = atual; return; }
    if (sujo) { clearTimeout(timer); await salvar(); }
    const r = await N.renomear(aberta.i, aberta.rel, novo);
    if (r.erro) { $('titulo-nota').textContent = atual; aviso(esc(r.erro)); setTimeout(() => aviso(''), 4000); return; }
    aberta.rel = r.rel;
    gravarPref('nota-aberta', { i: aberta.i, rel: r.rel });
    N.vigiar(aberta.i, r.rel);
    $('caminho-nota').textContent = `${pastas[aberta.i].nome} / ${r.rel.replace(/\.md$/i, '').split('/').join(' / ')}`;
    await carregarArvore();
  }
  $('titulo-nota').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); $('titulo-nota').blur(); editor.focar(); }
    if (ev.key === 'Escape') { $('titulo-nota').textContent = (aberta?.rel || '').split('/').pop().replace(/\.md$/i, ''); $('titulo-nota').blur(); }
  });
  $('titulo-nota').addEventListener('blur', renomearAberta);

  // --- menu do botão direito no explorador (como no VS Code) --------------------
  const menuCtx = $('menu-contexto');
  function abrirMenu(x, y, itens) {
    menuCtx.innerHTML = itens.map((it, k) => (it === '-' ? '<li class="sep" role="separator"></li>'
      : `<li role="menuitem" data-k="${k}">${esc(it.nome)}${it.atalho ? `<span>${esc(it.atalho)}</span>` : ''}</li>`)).join('');
    menuCtx._itens = itens;
    menuCtx.hidden = false;
    const w = menuCtx.offsetWidth, h = menuCtx.offsetHeight;
    menuCtx.style.left = `${Math.min(x, innerWidth - w - 8)}px`;
    menuCtx.style.top = `${Math.min(y, innerHeight - h - 8)}px`;
  }
  const fecharMenu = () => { menuCtx.hidden = true; };
  document.addEventListener('mousedown', (ev) => { if (!ev.target.closest('#menu-contexto')) fecharMenu(); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!menuCtx.hidden) { fecharMenu(); return; }
    // Esc na lista de notas: desmarca a pasta selecionada.
    if (selecionada !== null && ev.target.closest && ev.target.closest('#arvore-notas, .explorador')) { selecionada = null; desenharArvore(); }
  });
  menuCtx.addEventListener('click', (ev) => {
    const li = ev.target.closest('li[data-k]');
    if (!li) return;
    fecharMenu();
    menuCtx._itens[Number(li.dataset.k)].faz();
  });

  // Apagar = lixeira do sistema (dá para recuperar de lá). Confirma num
  // segundo menu, com o nome da nota, antes de mandar.
  function confirmarLixeira(x, y, rel) {
    const nome = rel.split('/').pop().replace(/\.md$/i, '');
    abrirMenu(x, y, [
      { nome: `Confirmar: mover «${nome}» para a lixeira`, faz: async () => {
        try {
          await N.lixeira(ativa, rel);
          if (aberta && aberta.i === ativa && aberta.rel === rel) { clearTimeout(timer); sujo = false; aberta = null; N.vigiar(0, null); vazio(true); }
          estado(`«${nome}» foi para a lixeira (dá para recuperar de lá).`);
          await carregarArvore();
        } catch (e) { estado(`Não consegui mover para a lixeira: ${e.message}`); }
      } },
      { nome: 'Cancelar', faz: () => {} },
    ]);
  }

  // Pasta: lixeira do sistema (recuperável), com a contagem do que vai junto
  // na confirmação. Nota aberta lá dentro é fechada.
  async function confirmarLixeiraPasta(x, y, rel) {
    const nome = rel.split('/').pop();
    let c;
    try { c = await N.contarPasta(ativa, rel); } catch (e) { estado(`Não consegui ler a pasta: ${e.message}`); return; }
    const partes = [`${c.notas} ${c.notas === 1 ? 'nota' : 'notas'}`, `${c.arquivos} ${c.arquivos === 1 ? 'arquivo' : 'arquivos'} no total`];
    if (c.pastas) partes.push(`${c.pastas} ${c.pastas === 1 ? 'subpasta' : 'subpastas'}`);
    abrirMenu(x, y, [
      { nome: `Confirmar: mover a pasta «${nome}» para a lixeira (${partes.join(', ')})`, faz: async () => {
        try {
          await N.lixeiraPasta(ativa, rel);
          if (aberta && aberta.i === ativa && aberta.rel.startsWith(`${rel}/`)) { clearTimeout(timer); sujo = false; aberta = null; N.vigiar(0, null); vazio(true); }
          if (selecionada === rel || (selecionada || '').startsWith(`${rel}/`)) selecionada = null;
          estado(`A pasta «${nome}» foi para a lixeira (dá para recuperar de lá).`);
          await carregarArvore();
        } catch (e) { estado(`Não consegui mover para a lixeira: ${e.message}`); }
      } },
      { nome: 'Cancelar', faz: () => {} },
    ]);
  }
  async function esconderPasta(rel) {
    try { await N.esconder(ativa, rel); } catch (e) { estado(`Não consegui esconder: ${e.message}`); return; }
    if (selecionada === rel) selecionada = null;
    estado(`A pasta «${rel.split('/').pop()}» foi escondida das notas (continua no computador). Para mostrar de novo: botão direito no espaço vazio › Pastas escondidas.`);
    await carregarArvore();
  }
  async function menuEscondidas(x, y, lista) {
    abrirMenu(x, y, [
      ...lista.map((rel) => ({ nome: `Mostrar «${rel}» de novo`, faz: async () => { await N.mostrar(ativa, rel); estado(`«${rel}» voltou para as notas.`); await carregarArvore(); } })),
      '-', { nome: 'Cancelar', faz: () => {} },
    ]);
  }

  function pedirNome(tipo, pai) {
    selecionada = pai || null;
    const f = $('nova-nota-form');
    f.dataset.tipo = tipo; f.hidden = false;
    f.querySelector('input').placeholder = `Nome da ${tipo} em ${pai || pastas[ativa]?.nome || ''} (Enter)`;
    f.querySelector('input').focus();
  }
  async function copiar(texto) { try { await navigator.clipboard.writeText(texto); estado('Caminho copiado'); } catch { /* sem área de transferência */ } }
  function renomearItem(rel) {
    const linha = document.querySelector(`.linha-arvore[data-rel="${CSS.escape(rel)}"], .linha-pasta[data-pasta-rel="${CSS.escape(rel)}"]`);
    const nome = linha && linha.querySelector('.nome');
    if (!nome) return;
    nome.contentEditable = 'plaintext-only';
    nome.textContent = rel.split('/').pop().replace(/\.md$/i, '');
    nome.focus();
    document.getSelection().selectAllChildren(nome);
    const fim = async (salvarNome) => {
      nome.contentEditable = 'false';
      const novo = nome.textContent.trim();
      if (salvarNome && novo) {
        const r = await N.renomear(ativa, rel, novo);
        if (r.erro) { aviso(esc(r.erro)); setTimeout(() => aviso(''), 4000); }
        else if (aberta && aberta.i === ativa && aberta.rel === rel) { aberta.rel = r.rel; $('titulo-nota').textContent = novo; N.vigiar(ativa, r.rel); }
      }
      carregarArvore();
    };
    nome.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); nome.blur(); }
      if (ev.key === 'Escape') { ev.preventDefault(); nome.dataset.cancelar = '1'; nome.blur(); }
    });
    nome.addEventListener('blur', () => fim(!nome.dataset.cancelar), { once: true });
  }

  $('arvore-notas').addEventListener('contextmenu', async (ev) => {
    ev.preventDefault();
    if (!pastas[ativa]) return;
    const nota = ev.target.closest('.linha-nota');
    const pasta = ev.target.closest('.linha-pasta');
    const raiz = await N.caminho(ativa, '');
    const escondidasAgora = !nota && !pasta ? await N.escondidas(ativa).catch(() => []) : [];
    const rel = nota ? nota.dataset.rel : pasta ? pasta.dataset.pastaRel : '';
    const abs = rel ? `${raiz}/${rel}` : raiz;
    const comuns = [
      { nome: 'Abrir no gerenciador de arquivos', faz: () => N.revelar(ativa, rel) },
      { nome: 'Copiar caminho', faz: () => copiar(abs) },
      { nome: 'Copiar caminho relativo', faz: () => copiar(rel || '.') },
    ];
    if (nota) {
      abrirMenu(ev.clientX, ev.clientY, [
        { nome: 'Abrir', faz: () => abrir(ativa, rel) }, '-', ...comuns, '-',
        { nome: 'Renomear', atalho: 'F2', faz: () => renomearItem(rel) }, '-',
        { nome: 'Mover para a lixeira…', faz: () => confirmarLixeira(ev.clientX, ev.clientY, rel) },
      ]);
    } else {
      const pai = pasta ? rel : '';
      abrirMenu(ev.clientX, ev.clientY, [
        { nome: 'Nova nota', faz: () => pedirNome('nota', pai) },
        { nome: 'Nova pasta', faz: () => pedirNome('pasta', pai) }, '-', ...comuns,
        ...(pasta ? ['-', { nome: 'Renomear', atalho: 'F2', faz: () => renomearItem(rel) }, '-',
          { nome: 'Esconder das notas (não apaga nada)', faz: () => esconderPasta(rel) },
          { nome: 'Mover para a lixeira… (apaga do computador)', faz: () => confirmarLixeiraPasta(ev.clientX, ev.clientY, rel) }] : []),
        ...(!pasta && escondidasAgora.length ? ['-', { nome: `Pastas escondidas (${escondidasAgora.length})…`, faz: () => menuEscondidas(ev.clientX, ev.clientY, escondidasAgora) }] : []),
        '-', { nome: 'Abrir outra pasta do computador…', faz: async () => {
          const i = await N.adicionarPasta(); if (i == null) return; await carregarArvore(); if (i >= 0) { ativa = i; gravarPref('notas-pasta-ativa', ativa); desenharArvore(); }
        } },
      ]);
    }
  });
  $('arvore-notas').addEventListener('keydown', (ev) => {
    const l = ev.target.closest('.linha-arvore');
    if (ev.key === 'F2' && l) renomearItem(l.dataset.rel || l.dataset.pastaRel);
  });

  // --- abrir e salvar -------------------------------------------------------------
  async function abrir(i, rel, { manterRolagem = false } = {}) {
    if (sujo) { clearTimeout(timer); await salvar(); }
    const r = await N.ler(i, rel);
    aberta = { i, rel, mtime: r.mtime, base: r.conteudo };
    sujo = false;
    soLeitura = r.bytes > GRANDE;
    const folha = $('folha-nota'), rolagem = folha.scrollTop;
    vazio(false);
    editor.contexto(i, rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
    editor.definir(r.conteudo);
    aplicarEstilo();
    editor.editavel(!soLeitura);
    if (manterRolagem) folha.scrollTop = rolagem; else folha.scrollTop = 0;
    $('titulo-nota').textContent = rel.split('/').pop().replace(/\.md$/i, '');
    $('titulo-nota').contentEditable = soLeitura ? 'false' : 'plaintext-only';
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

  // Paleta Ctrl+K: todas as notas das pastas abertas.
  const todasAsNotas = (nos, i, l = []) => { for (const n of nos || []) { if (n.tipo === 'nota') l.push({ i, n }); else todasAsNotas(n.filhos, i, l); } return l; };
  window.orqPaleta?.registrar(() => pastas.flatMap((p, i) => todasAsNotas(arvores[i], i)).map(({ i, n }) => ({
    grupo: 'Notas', titulo: n.nome, sub: `${pastas[i].nome} / ${n.rel}`,
    faz: () => { document.querySelector('[data-aba="aba-notas"]').click(); setTimeout(() => abrir(i, n.rel), 300); },
  })));
  // Menções @nota: na conversa: "Pasta/caminho/sem .md".
  window.orqNotas = { abrir: async (i, rel) => { await carregarArvore(); await abrir(i, rel); }, listar: () => pastas.flatMap((p, i) => todasAsNotas(arvores[i], i)).map(({ i, n }) => ({ i, rel: n.rel, pasta: pastas[i].nome, caminho: `${pastas[i].nome}/${n.rel.replace(/\.md$/i, '')}` })) };
  // A paleta precisa da lista de notas mesmo sem a aba ter sido aberta.
  carregarArvore().catch(() => {});

  // Pastas mudadas na engrenagem: a aba Notas acompanha.
  window.addEventListener('orq:config', () => { if (document.getElementById('aba-notas').classList.contains('ativa')) carregarArvore(); });

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
