// Aba Notas: árvore de todas as pastas configuradas (config.pastasNotas), abas das notas abertas e o editor
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
    if (!sim) return;
    $('caminho-nota').textContent = ''; // sem nota aberta, o caminho da anterior não fica escrito em cima
    $('vazio-nota').innerHTML = `<div class="vazio"><span class="ico-caixa"><svg class="ico"><use href="#i-notas"/></svg></span>
      <strong>${pastas.length ? 'Nenhuma nota aberta' : 'Nenhuma pasta de notas'}</strong>
      <span>${pastas.length ? 'Escolha uma nota à esquerda ou crie uma com o +.' : 'Abra uma pasta do computador para começar.'}</span>
      ${pastas.length ? '' : '<div class="vazio-acoes"><button type="button" class="botao-texto" data-abrir-pasta-vazio>Abrir uma pasta do computador…</button></div>'}</div>`;
  }

  // --- abas das notas abertas (em cima) e explorador (à esquerda) -------------
  // Como no Obsidian: a árvore mostra sempre todas as pastas do app, e as abas de cima são as
  // notas abertas. O ✕ da aba fecha só a nota: os arquivos continuam na árvore. (Antes as abas eram
  // as pastas, e fechar a aba escondia a árvore inteira: parecia que tudo tinha sumido.)
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
  // A pasta do app onde a próxima nota nasce: a do último clique na árvore ou a da nota aberta.
  let ativa = Number(lerPref('notas-pasta-ativa')) || 0;
  const definirAtiva = (i) => { if (pastas[i] && ativa !== i) { ativa = i; gravarPref('notas-pasta-ativa', ativa); selecionada = null; } };
  // Pastas do app recolhidas na árvore (com mais de uma pasta, cada uma é uma linha que abre e fecha).
  const raizesFechadas = new Set(lerPref('notas-raizes-fechadas') || []);
  // As abas: [{ i, rel, id }] (id da pasta: a posição dela muda quando outra sai do app).
  let abas = [];
  let abasLidas = false;
  const gravarAbas = () => gravarPref('notas-abas', abas.map(({ id, rel }) => ({ id, rel })));
  const posicaoDaAba = (i, rel) => abas.findIndex((a) => a.i === i && a.rel === rel);
  // Depois de reler as pastas: as abas guardadas voltam (na primeira vez) e seguem a pasta pelo id.
  function ajustarAbas() {
    if (!abasLidas) { abasLidas = true; abas = (lerPref('notas-abas') || []).filter((a) => a && a.id && typeof a.rel === 'string').map((a) => ({ id: a.id, rel: a.rel, i: -1 })); }
    abas = abas.map((a) => ({ ...a, i: pastas.findIndex((p) => p.id === a.id) })).filter((a) => a.i >= 0);
    if (!pastas[ativa]) ativa = pastas.length ? 0 : -1;
  }
  // Tira da faixa as abas que casam (nota apagada, pasta apagada); devolve se a nota aberta estava entre elas.
  function tirarAbas(casa) {
    const eraAberta = !!aberta && abas.some((a) => casa(a) && a.i === aberta.i && a.rel === aberta.rel);
    abas = abas.filter((a) => !casa(a));
    gravarAbas();
    return eraAberta;
  }
  // A nota aberta saiu (fechada ou apagada): a aba vizinha assume; sem nenhuma, a tela fica vazia.
  async function proximaOuVazio(k = abas.length - 1) {
    aberta = null; sujo = false; N.vigiar(0, null);
    const prox = abas[Math.max(0, Math.min(k, abas.length - 1))];
    if (prox) { try { await abrir(prox.i, prox.rel); return; } catch { tirarAbas((a) => a === prox); return proximaOuVazio(k); } }
    gravarPref('nota-aberta', null);
    vazio(true);
    desenharArvore();
  }
  async function fecharAba(k) {
    const a = abas[k];
    if (!a) return;
    const eraAberta = aberta && aberta.i === a.i && aberta.rel === a.rel;
    if (eraAberta && sujo) { clearTimeout(timer); await salvar(); }
    abas.splice(k, 1); gravarAbas();
    if (eraAberta) await proximaOuVazio(k); else desenharAbas();
  }
  // Traz a pasta i do app para a frente na árvore (aberta) e faz dela a pasta das próximas notas.
  function focarPasta(i) {
    if (!pastas[i]) return;
    if (raizesFechadas.delete(pastas[i].id)) gravarPref('notas-raizes-fechadas', [...raizesFechadas]);
    definirAtiva(i);
    desenharArvore();
    if (!aberta) vazio(true);
  }
  async function abrirOutraPasta() {
    const i = await N.adicionarPasta();
    if (i == null) return;
    await carregarArvore();
    if (i >= 0) focarPasta(i);
  }
  let selecionada = null; // pasta (rel) onde a próxima nota nasce

  const ICO_PASTA = '<svg class="ico ico-arvore" viewBox="0 0 16 16"><path d="M2 4.5h4.2l1.3 1.5H14v6.5H2z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  const ICO_NOTA = '<svg class="ico ico-arvore" viewBox="0 0 16 16"><path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';

  function desenharAbas() {
    $('abas-notas').innerHTML = abas.map((a, k) => {
      const naFrente = !!aberta && aberta.i === a.i && aberta.rel === a.rel;
      return `<div class="aba-nota${naFrente ? ' ativa' : ''}" role="tab" aria-selected="${naFrente}">
        <button type="button" data-aba-nota="${k}" title="${esc(`${pastas[a.i] ? pastas[a.i].nome : ''} / ${a.rel.replace(/\.md$/i, '')}`)}">${ICO_NOTA}<span data-sem-traducao>${esc(a.rel.split('/').pop().replace(/\.md$/i, ''))}</span></button>
        <button type="button" class="fechar-aba-nota" data-fechar-aba="${k}" title="Fechar esta nota (ela continua na pasta)" aria-label="Fechar nota">✕</button>
      </div>`;
    }).join('');
    $('nome-pasta-ativa').textContent = pastas.length === 1 ? pastas[0].nome : 'Notas';
  }

  // Diários (AAAA-MM-DD.md) aparecem como antes: por mês, com dia e dia da semana.
  function linhasDaPasta(filhos, nivel, filtro, i) {
    const pastasF = filhos.filter((n) => n.tipo === 'pasta');
    const notas = filhos.filter((n) => n.tipo === 'nota');
    const datadas = notas.filter((n) => DATA.test(n.nome)).sort((a, b) => b.nome.localeCompare(a.nome));
    const outras = notas.filter((n) => !DATA.test(n.nome));
    let html = pastasF.map((n) => linhaPasta(n, nivel, filtro, i)).join('');
    html += outras.filter((n) => !filtro || n.rel.toLowerCase().includes(filtro)).map((n) => linhaNota(n, nivel, n.nome, false, i)).join('');
    let mes = '';
    for (const n of datadas) {
      const [, a, m, d] = n.nome.match(DATA);
      const data = new Date(Number(a), Number(m) - 1, Number(d));
      const rotulo = `${d} · ${SEMANA[data.getDay()]}`;
      if (filtro && !`${n.rel} ${rotulo} ${MESES[data.getMonth()]}`.toLowerCase().includes(filtro)) continue;
      const titulo = `${MESES[data.getMonth()]} de ${a}`;
      if (titulo !== mes) { html += `<div class="linha-mes" style="--nivel:${nivel}">${titulo}</div>`; mes = titulo; }
      html += linhaNota(n, nivel, rotulo, true, i);
    }
    return html;
  }
  function linhaPasta(n, nivel, filtro, i) {
    const chave = `${i}:${n.rel}`;
    const dentro = linhasDaPasta(n.filhos, nivel + 1, filtro, i);
    if (filtro && !dentro) return '';
    const aberta = !!filtro || abertasNaArvore.has(chave);
    return `<div class="no-pasta${aberta ? ' aberta' : ''}">
      <button type="button" class="linha-arvore linha-pasta${i === ativa && selecionada === n.rel ? ' selecionada' : ''}" data-pasta-rel="${esc(n.rel)}" style="--nivel:${nivel}" role="treeitem" aria-expanded="${aberta}">
        <span class="chevron">›</span>${ICO_PASTA}<span class="nome">${esc(n.nome)}</span></button>
      <div class="filhos" style="--nivel:${nivel}">${aberta ? dentro : ''}</div></div>`;
  }
  function linhaNota(n, nivel, rotulo, data, i) {
    const ativo = aberta && aberta.i === i && aberta.rel === n.rel;
    return `<button type="button" class="linha-arvore linha-nota${ativo ? ' ativo' : ''}${data ? ' data' : ''}" data-rel="${esc(n.rel)}" style="--nivel:${nivel}" title="${esc(n.rel)}" role="treeitem">
      <span class="chevron vazio"></span>${ICO_NOTA}<span class="nome">${esc(rotulo)}</span></button>`;
  }

  function desenharArvore() {
    desenharAbas();
    if (!pastas.length) {
      $('arvore-notas').innerHTML = '<p class="nota explorador-vazio">Nenhuma pasta de notas. Abra uma com o botão de pasta, aqui em cima.</p>';
      return;
    }
    const filtro = $('filtro-notas').value.trim().toLowerCase();
    const semNotas = '<p class="nota explorador-vazio">Nenhuma nota .md aqui.</p>';
    // Uma pasta só: a árvore dela direto, como sempre. Mais de uma: cada pasta do app é uma linha que abre e fecha.
    $('arvore-notas').innerHTML = pastas.map((p, i) => {
      const dentro = linhasDaPasta(arvores[i] || [], pastas.length > 1 ? 1 : 0, filtro, i);
      if (pastas.length === 1) return `<div class="raiz-notas" data-raiz="${i}">${dentro || semNotas}</div>`;
      const aberta_ = !!filtro || !raizesFechadas.has(p.id);
      return `<div class="raiz-notas no-pasta${aberta_ ? ' aberta' : ''}" data-raiz="${i}">
        <button type="button" class="linha-arvore linha-pasta linha-raiz${i === ativa && selecionada === null ? ' selecionada' : ''}" data-raiz-linha="${i}" style="--nivel:0" role="treeitem" aria-expanded="${aberta_}" title="${esc(p.caminho || p.nome)}">
          <span class="chevron">›</span>${ICO_PASTA}<span class="nome" data-sem-traducao>${esc(p.nome)}</span></button>
        <div class="filhos" style="--nivel:0">${aberta_ ? (dentro || (filtro ? '' : semNotas)) : ''}</div></div>`;
    }).join('');
  }

  async function carregarArvore() {
    pastas = await N.pastas();
    ajustarAbas();
    arvores = await Promise.all(pastas.map((_, i) => N.arvore(i).catch(() => [])));
    desenharArvore();
    if (!aberta) vazio(true);
  }

  $('vazio-nota').addEventListener('click', (ev) => { if (ev.target.closest('[data-abrir-pasta-vazio]')) abrirOutraPasta(); });

  // Faixa das abas: clique traz a nota para a frente; ✕ (ou o botão do meio) fecha só a nota.
  $('abas-notas').addEventListener('click', (ev) => {
    const f = ev.target.closest('[data-fechar-aba]');
    if (f) { fecharAba(Number(f.dataset.fecharAba)); return; }
    const b = ev.target.closest('[data-aba-nota]');
    const a = b && abas[Number(b.dataset.abaNota)];
    if (a && !(aberta && aberta.i === a.i && aberta.rel === a.rel)) abrir(a.i, a.rel).catch(() => { tirarAbas((x) => x === a); desenharAbas(); });
  });
  $('abas-notas').addEventListener('auxclick', (ev) => {
    const b = ev.button === 1 && ev.target.closest('.aba-nota');
    if (!b) return;
    ev.preventDefault();
    fecharAba(Number(b.querySelector('[data-aba-nota]').dataset.abaNota));
  });

  // De que pasta do app é a linha clicada (com uma pasta só, é sempre ela).
  const raizDe = (el) => { const r = el && el.closest && el.closest('[data-raiz]'); return r ? Number(r.dataset.raiz) : ativa; };
  $('arvore-notas').addEventListener('click', (ev) => {
    const i = raizDe(ev.target);
    const raiz = ev.target.closest('.linha-raiz');
    if (raiz) {
      // A linha de uma pasta do app: abre ou recolhe, e ela vira a pasta das próximas notas.
      const id = pastas[i].id;
      if (raizesFechadas.has(id)) raizesFechadas.delete(id); else raizesFechadas.add(id);
      gravarPref('notas-raizes-fechadas', [...raizesFechadas]);
      definirAtiva(i); selecionada = null;
      desenharArvore();
      return;
    }
    const nota = ev.target.closest('.linha-nota');
    // Como no Obsidian: o clique abre na aba da frente; Ctrl+clique abre em outra aba.
    if (nota) { definirAtiva(i); return abrir(i, nota.dataset.rel, { novaAba: ev.ctrlKey || ev.metaKey }); }
    const p = ev.target.closest('.linha-pasta');
    // Clique no espaço vazio da lista: desmarca a pasta (a próxima nota nasce na raiz).
    if (!p && selecionada !== null) { selecionada = null; desenharArvore(); return; }
    if (p) {
      definirAtiva(i);
      const chave = `${ativa}:${p.dataset.pastaRel}`;
      if (abertasNaArvore.has(chave)) abertasNaArvore.delete(chave); else abertasNaArvore.add(chave);
      selecionada = p.dataset.pastaRel;
      gravarPref('notas-pastas-abertas', [...abertasNaArvore]);
      desenharArvore();
    }
  });

  $('arvore-notas').addEventListener('auxclick', (ev) => {
    const nota = ev.button === 1 && ev.target.closest('.linha-nota');
    if (!nota) return;
    ev.preventDefault();
    const i = raizDe(ev.target);
    definirAtiva(i);
    abrir(i, nota.dataset.rel, { novaAba: true });
  });

  document.querySelector('.explorador-topo').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-acao]');
    if (!b) return;
    if (b.dataset.acao === 'abrir-pasta') {
      // Abre uma pasta que já existe no computador (entra na árvore, com as outras).
      await abrirOutraPasta();
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
      abertasNaArvore.clear(); // todas as pastas estão à vista: recolhe tudo
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
          const i = ativa;
          if (tirarAbas((a) => a.i === i && a.rel === rel)) { clearTimeout(timer); await proximaOuVazio(); }
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
          const i = ativa;
          if (tirarAbas((a) => a.i === i && a.rel.startsWith(`${rel}/`))) { clearTimeout(timer); await proximaOuVazio(); }
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
        else {
          // As abas acompanham o nome novo (da nota, ou das notas de dentro da pasta renomeada).
          const i = ativa;
          for (const a of abas) {
            if (a.i !== i) continue;
            if (a.rel === rel) a.rel = r.rel; else if (a.rel.startsWith(`${rel}/`)) a.rel = r.rel + a.rel.slice(rel.length);
          }
          gravarAbas();
          if (aberta && aberta.i === i && aberta.rel === rel) { aberta.rel = r.rel; $('titulo-nota').textContent = novo; N.vigiar(i, r.rel); gravarPref('nota-aberta', { i, rel: r.rel }); }
          else if (aberta && aberta.i === i && aberta.rel.startsWith(`${rel}/`)) { aberta.rel = r.rel + aberta.rel.slice(rel.length); N.vigiar(i, aberta.rel); gravarPref('nota-aberta', { i, rel: aberta.rel }); }
        }
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
    definirAtiva(raizDe(ev.target));
    if (!pastas[ativa]) return;
    const nota = ev.target.closest('.linha-nota');
    const pasta = ev.target.closest('.linha-pasta:not(.linha-raiz)');
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
        { nome: 'Abrir', faz: () => abrir(ativa, rel) },
        { nome: 'Abrir em outra aba', atalho: 'Ctrl+clique', faz: () => abrir(ativa, rel, { novaAba: true }) }, '-', ...comuns, '-',
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
        '-', { nome: 'Abrir outra pasta do computador…', faz: abrirOutraPasta },
      ]);
    }
  });
  $('arvore-notas').addEventListener('keydown', (ev) => {
    const l = ev.target.closest('.linha-arvore');
    if (ev.key === 'F2' && l && (l.dataset.rel || l.dataset.pastaRel)) renomearItem(l.dataset.rel || l.dataset.pastaRel);
  });

  // --- abrir e salvar -------------------------------------------------------------
  // Markdown que o editor não consegue montar (ex.: milhares de ">" aninhados
  // estouram a pilha): em vez de travar com o editor meio carregado, onde o que
  // se digitava se perdia, a nota abre só para leitura, como texto puro.
  const AVISO_SEM_MONTAR = 'Esta nota tem Markdown que o editor não consegue montar (aninhado fundo demais): aberta só para leitura, como texto puro, para nada se perder.';
  // Antes de montar: citação ou lista aninhada fundo demais nem vai ao editor
  // (o parser leva segundos até estourar, com a tela parada).
  function fundoDemais(md) {
    for (const [p] of String(md || '').matchAll(/^[ \t>]{100,}/gm)) {
      if ((p.match(/>/g) || []).length > 100 || p.length > 400) return true;
    }
    return false;
  }
  function definirSeguro(md) {
    if (fundoDemais(md)) { editor.definir(''); return false; }
    try { editor.definir(md); return true; } catch {
      try { editor.definir(''); } catch { /* fica como está; a nota abre só leitura */ }
      return false;
    }
  }
  function mostrarCru(md) {
    let c = document.querySelector('.nota-crua');
    if (md == null) { if (c) c.remove(); $('editor-nota').hidden = false; return; }
    if (!c) {
      c = document.createElement('textarea');
      c.className = 'editor-md-puro nota-crua';
      c.readOnly = true; c.spellcheck = false;
      // Sem ligaduras: a fonte mono junta ">>>" e, com milhares deles, montar a linha levava segundos.
      c.style.fontVariantLigatures = 'none';
      $('editor-nota').after(c);
    }
    c.value = md;
    $('editor-nota').hidden = true;
  }

  // novaAba: abre em outra aba (Ctrl+clique, botão do meio). Sem isso a nota entra na aba da
  // frente, no lugar da que estava (como no Obsidian); nota que já tem aba só vem para a frente.
  async function abrir(i, rel, { manterRolagem = false, novaAba = false } = {}) {
    if (sujo) { clearTimeout(timer); await salvar(); }
    const r = await N.ler(i, rel);
    if (posicaoDaAba(i, rel) < 0) {
      const daFrente = aberta ? posicaoDaAba(aberta.i, aberta.rel) : -1;
      const nova = { i, rel, id: pastas[i].id };
      if (novaAba || daFrente < 0) abas.splice(daFrente < 0 ? abas.length : daFrente + 1, 0, nova); else abas[daFrente] = nova;
      gravarAbas();
    }
    aberta = { i, rel, mtime: r.mtime, base: r.conteudo };
    sujo = false;
    soLeitura = r.bytes > GRANDE;
    const folha = $('folha-nota'), rolagem = folha.scrollTop;
    vazio(false);
    editor.contexto(i, rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
    const montou = definirSeguro(r.conteudo);
    if (!montou) soLeitura = true;
    mostrarCru(montou ? null : r.conteudo);
    aplicarEstilo();
    editor.editavel(!soLeitura);
    if (manterRolagem) folha.scrollTop = rolagem; else folha.scrollTop = 0;
    $('titulo-nota').textContent = rel.split('/').pop().replace(/\.md$/i, '');
    $('titulo-nota').contentEditable = soLeitura ? 'false' : 'plaintext-only';
    $('caminho-nota').textContent = `${pastas[i].nome} / ${rel.replace(/\.md$/i, '').split('/').join(' / ')}`;
    if (ativa !== i) { ativa = i; gravarPref('notas-pasta-ativa', ativa); }
    estado(soLeitura ? 'Só leitura' : 'Salvo');
    aviso(!montou ? AVISO_SEM_MONTAR : soLeitura ? `Arquivo grande (${(r.bytes / 1024 / 1024).toFixed(1)} MB): aberto só para leitura, porque editar deixaria tudo lento.
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
        if (!definirSeguro(junto)) { soLeitura = true; mostrarCru(junto); editor.editavel(false); estado('Só leitura'); aviso(AVISO_SEM_MONTAR); return; }
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
      if (!definirSeguro(fora.conteudo)) { soLeitura = true; mostrarCru(fora.conteudo); editor.editavel(false); estado('Só leitura'); delete aberta.conflito; aviso(AVISO_SEM_MONTAR); return; }
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
  // Demanda apagada pelo painel: fecha a nota se estiver aberta e atualiza a árvore.
  const fecharSe = async (i, rel) => {
    if (tirarAbas((a) => a.i === i && a.rel === rel)) { clearTimeout(timer); await proximaOuVazio(); }
    await carregarArvore();
  };
  window.orqNotas = { fecharSe, abrir: async (i, rel) => { await carregarArvore(); await abrir(i, rel); }, listar: () => pastas.flatMap((p, i) => todasAsNotas(arvores[i], i)).map(({ i, n }) => ({ i, rel: n.rel, pasta: pastas[i].nome, caminho: `${pastas[i].nome}/${n.rel.replace(/\.md$/i, '')}` })) };
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
      else if (!aberta && abas.length) abrir(abas[0].i, abas[0].rel).catch(() => vazio(true));
    });
    else if (sujo) { clearTimeout(timer); salvar(); }
  });
})();
