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

  // --- árvore -----------------------------------------------------------------
  function desenharArvore() {
    const filtro = $('filtro-notas').value.trim().toLowerCase();
    const item = (n, i, nivel) => {
      if (n.tipo === 'pasta') {
        const chave = `${i}:${n.rel}`;
        const dentro = n.filhos.map((f) => item(f, i, nivel + 1)).join('');
        if (filtro && !dentro) return '';
        const aberto = filtro || abertasNaArvore.has(chave);
        return `<details class="pasta-nota" data-chave="${esc(chave)}"${aberto ? ' open' : ''}>
          <summary style="padding-left:${8 + nivel * 12}px"><span class="seta-pasta">▸</span>${esc(n.nome)}</summary>${dentro}</details>`;
      }
      if (filtro && !n.rel.toLowerCase().includes(filtro)) return '';
      const ativo = aberta && aberta.i === i && aberta.rel === n.rel;
      return `<button type="button" class="item-arvore${ativo ? ' ativo' : ''}" data-i="${i}" data-rel="${esc(n.rel)}"
        style="padding-left:${20 + nivel * 12}px" title="${esc(n.rel)}"><svg class="ico"><use href="#i-notas"/></svg><span>${esc(n.nome)}</span></button>`;
    };
    $('arvore-notas').innerHTML = pastas.map((p, i) => `
      <section class="raiz-notas">
        <header><strong>${esc(p.nome)}</strong>
          <button type="button" class="botao-icone" data-nova="${i}" title="Nova nota em ${esc(p.nome)}" aria-label="Nova nota">+</button></header>
        <div class="nova-nota" data-form="${i}" hidden><input type="text" placeholder="Nome da nota (Enter)" aria-label="Nome da nota"></div>
        ${(arvores[i] || []).map((n) => item(n, i, 0)).join('') || '<p class="nota">Nenhuma nota .md aqui.</p>'}
      </section>`).join('');
  }

  async function carregarArvore() {
    pastas = await N.pastas();
    arvores = await Promise.all(pastas.map((_, i) => N.arvore(i).catch(() => [])));
    desenharArvore();
    if (!aberta) vazio(true);
  }

  $('arvore-notas').addEventListener('toggle', (ev) => {
    const d = ev.target.closest('details[data-chave]');
    if (!d || $('filtro-notas').value) return;
    if (d.open) abertasNaArvore.add(d.dataset.chave); else abertasNaArvore.delete(d.dataset.chave);
    gravarPref('notas-pastas-abertas', [...abertasNaArvore]);
  }, true);

  $('arvore-notas').addEventListener('click', (ev) => {
    const b = ev.target.closest('.item-arvore');
    if (b) return abrir(Number(b.dataset.i), b.dataset.rel);
    const nova = ev.target.closest('[data-nova]');
    if (nova) {
      const f = document.querySelector(`[data-form="${nova.dataset.nova}"]`);
      f.hidden = !f.hidden;
      if (!f.hidden) f.querySelector('input').focus();
    }
  });
  $('arvore-notas').addEventListener('keydown', async (ev) => {
    const f = ev.target.closest('[data-form]');
    if (!f) return;
    if (ev.key === 'Escape') { f.hidden = true; return; }
    if (ev.key !== 'Enter') return;
    const nome = ev.target.value.trim();
    if (!nome) return;
    const i = Number(f.dataset.form);
    const r = await N.criar(i, '', nome);
    f.hidden = true; ev.target.value = '';
    await carregarArvore();
    abrir(i, r.rel);
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
    $('caminho-nota').textContent = `${pastas[i].nome} / ${rel.replace(/\.md$/i, '')}`;
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
