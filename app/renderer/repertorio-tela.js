// Aba Repertório: skills de todas as ferramentas (só leitura, mostradas) e os
// atalhos do usuário (criar, editar, apagar). Na conversa: "//nome".
(() => {
  const $ = (id) => document.getElementById(id);
  const R = window.orq.repertorio;
  if (!R) return; // ponte antiga (app aberto antes desta versão)
  const { esc } = window.orqUtil;
  const md = (t) => DOMPurify.sanitize(marked.parse(t || '', { gfm: true }));
  let dados = { skills: [], atalhos: [] };
  let aberto = null; // { tipo: 'skill'|'atalho', id }

  async function carregar() { dados = await R.lista(); desenharLista(); }

  function desenharLista() {
    const f = $('filtro-repertorio').value.trim().toLowerCase();
    const casa = (x) => !f || `${x.nome} ${x.descricao || ''} ${x.texto || ''}`.toLowerCase().includes(f);
    const grupos = new Map([['Seus atalhos', dados.atalhos.filter(casa).map((a) => ({ ...a, tipo: 'atalho' }))]]);
    for (const s of dados.skills.filter(casa)) {
      if (!grupos.has(s.fonte)) grupos.set(s.fonte, []);
      grupos.get(s.fonte).push({ ...s, tipo: 'skill' });
    }
    const tipos = (t) => Object.entries(t).map(([k, n]) => `${n} ${k}${n > 1 ? (k.endsWith('m') ? 'ns' : 's') : ''}`).join(', ');
    $('lista-repertorio').innerHTML = `<div class="conectadas"><span class="secao-titulo">Ferramentas conectadas</span>${(dados.conectadas || []).map((c) =>
      `<span class="conectada"><span class="ponto trabalhando"></span>${esc(c.nome)} <small>${esc(tipos(c.tipos))}</small></span>`).join('') || '<p class="nota">Nenhuma ferramenta de IA achada nesta máquina.</p>'}</div>` + [...grupos].map(([g, l]) => `<div class="secao-titulo">${esc(g)} <span class="contador">${l.length}</span></div>
      ${l.map((x) => `<button type="button" class="item-repertorio${aberto && aberto.id === x.id ? ' ativo' : ''}" data-tipo="${x.tipo}" data-id="${esc(x.id)}">
        <span class="nome">//${esc(x.nome)}</span>${x.tecla ? `<kbd>Ctrl+Alt+${esc(x.tecla)}</kbd>` : ''}${x.tipo !== 'atalho' && x.tipo !== 'skill' ? `<span class="tipo-item">${esc(x.tipo)}</span>` : ''}</button>`).join('') || '<p class="nota">Nenhum ainda.</p>'}`).join('');
  }

  async function abrirSkill(id) {
    const s = dados.skills.find((x) => x.id === id);
    if (!s) return;
    aberto = { tipo: 'skill', id };
    const conteudo = await R.conteudo(id);
    $('detalhe-repertorio').innerHTML = `<header class="detalhe-repertorio-topo"><div><h2>//${esc(s.nome)}</h2>
        <span class="origem-sugestao">${esc(s.fonte)} · ${esc(s.tipo)}</span><span class="nota">${s.ferramenta !== 'claude' ? 'Vai com as instruções junto, para qualquer modelo seguir.' : s.tipo === 'subagente' ? 'O Claude chama este subagente pelo nome.' : 'O Claude executa direto (/' + esc(s.nome) + ').'}</span></div>
        <button type="button" class="botao primario" data-usar="//${esc(s.nome)}">Usar na conversa</button></header>
      <div class="md">${md(String(conteudo || '').replace(/^---[\s\S]*?---\n/, ''))}</div>`;
    desenharLista();
  }

  function abrirAtalho(id) {
    const a = dados.atalhos.find((x) => x.id === id) || { id: '', nome: '', descricao: '', texto: '', tecla: '', enviar: false };
    aberto = { tipo: 'atalho', id: a.id };
    const usadas = new Set(dados.atalhos.filter((x) => x.id !== a.id && x.tecla).map((x) => x.tecla));
    $('detalhe-repertorio').innerHTML = `<form class="form-atalho" data-id="${esc(a.id)}">
      <h2>${a.id ? 'Editar atalho' : 'Novo atalho'}</h2>
      <label>Nome (vira //nome)<input name="nome" value="${esc(a.nome)}" placeholder="ex.: antes-e-depois" required></label>
      <label>Descrição<input name="descricao" value="${esc(a.descricao)}" placeholder="Para que serve"></label>
      <label>Texto que vai para o Claude<textarea name="texto" rows="8" placeholder="ex.: Siga //verificar-antes-e-depois: inventário antes, o mesmo depois…" required>${esc(a.texto)}</textarea></label>
      <div class="linha-form">
        <label>Tecla<select name="tecla"><option value="">Nenhuma</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<option value="${n}"${String(a.tecla) === String(n) ? ' selected' : ''}${usadas.has(String(n)) ? ' disabled' : ''}>Ctrl+Alt+${n}${usadas.has(String(n)) ? ' (em uso)' : ''}</option>`).join('')}</select></label>
        <label class="marcar"><input type="checkbox" name="enviar"${a.enviar ? ' checked' : ''}> Enviar direto (sem passar pela caixa)</label>
      </div>
      <div class="acoes-form">
        <button type="submit" class="botao primario">Salvar</button>
        ${a.id ? `<button type="button" class="botao-texto" data-usar="//${esc(a.nome)}">Usar na conversa</button>
          <button type="button" class="botao-texto perigo" data-apagar="${esc(a.id)}">Apagar atalho</button>` : ''}
      </div>
      <p class="nota">Dentro do texto dá para usar //outras-skills e @nota:. Cada mudança guarda a versão anterior.</p></form>`;
    desenharLista();
  }

  $('lista-repertorio').addEventListener('click', (ev) => {
    const b = ev.target.closest('.item-repertorio');
    if (!b) return;
    if (b.dataset.tipo === 'skill') abrirSkill(b.dataset.id); else abrirAtalho(b.dataset.id);
  });
  $('novo-atalho').addEventListener('click', () => abrirAtalho(''));
  $('filtro-repertorio').addEventListener('input', desenharLista);

  $('detalhe-repertorio').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const novo = { id: f.dataset.id || undefined, nome: f.nome.value, descricao: f.descricao.value, texto: f.texto.value, tecla: f.tecla.value, enviar: f.enviar.checked };
    const lista = f.dataset.id ? dados.atalhos.map((a) => (a.id === f.dataset.id ? { ...a, ...novo } : a)) : [...dados.atalhos, novo];
    const salvos = await R.gravarAtalhos(lista);
    dados.atalhos = salvos;
    const achado = salvos.find((a) => a.nome === novo.nome.trim().replace(/\s+/g, '-').toLowerCase());
    abrirAtalho(achado ? achado.id : '');
  });
  $('detalhe-repertorio').addEventListener('click', async (ev) => {
    const usar = ev.target.closest('[data-usar]');
    if (usar) { document.querySelector('[data-aba="aba-orquestrador"]').click(); window.orqConversa?.inserir(usar.dataset.usar + ' '); return; }
    const ap = ev.target.closest('[data-apagar]');
    if (ap) {
      // Apagar atalho: confirma no segundo clique; a versão anterior fica guardada.
      if (!ap.dataset.confirmando) { ap.dataset.confirmando = '1'; ap.textContent = 'Confirmar: apagar este atalho'; return; }
      dados.atalhos = await R.gravarAtalhos(dados.atalhos.filter((a) => a.id !== ap.dataset.apagar));
      aberto = null;
      $('detalhe-repertorio').innerHTML = '';
      desenharLista();
    }
  });

  document.addEventListener('click', (ev) => { if (ev.target.closest('[data-aba="aba-repertorio"]')) carregar(); });
  window.orqPaleta?.registrar(() => [
    ...dados.atalhos.map((a) => ({ grupo: 'Repertório', titulo: `//${a.nome}`, sub: a.descricao, faz: () => { document.querySelector('[data-aba="aba-orquestrador"]').click(); window.orqConversa?.inserir(`//${a.nome} `); } })),
    ...dados.skills.map((s) => ({ grupo: 'Repertório', titulo: `//${s.nome}`, sub: s.fonte, faz: () => { document.querySelector('[data-aba="aba-repertorio"]').click(); setTimeout(() => abrirSkill(s.id), 200); } })),
  ]);
  carregar().catch(() => {});
})();
