// Paleta Ctrl+K: acha e abre qualquer coisa do app. Cada parte da tela
// registra uma "fonte" (função que devolve itens); a paleta junta, filtra e
// executa. Filtro "Esperando você": só o que precisa do usuário.
// Item: { grupo, titulo, sub?, atencao?, faz() }
(() => {
  const fontes = [];
  window.orqPaleta = { registrar: (fn) => fontes.push(fn) };

  const el = document.createElement('div');
  el.className = 'paleta-fundo';
  el.hidden = true;
  el.innerHTML = `<div class="paleta" role="dialog" aria-label="Paleta de comandos">
      <div class="paleta-busca"><svg class="ico"><use href="#i-busca"/></svg>
        <input type="text" placeholder="Buscar conversa, agente, nota, ação…" aria-label="Buscar">
        <button type="button" class="paleta-filtro" aria-pressed="false" title="Só o que está esperando você">Esperando você</button></div>
      <ul class="paleta-lista" role="listbox"></ul>
      <div class="paleta-rodape"><span>↑↓ navega</span><span>Enter abre</span><span>Esc fecha</span></div>
    </div>`;
  document.body.append(el);
  const campo = el.querySelector('input'), lista = el.querySelector('.paleta-lista'), filtro = el.querySelector('.paleta-filtro');
  let itens = [], vistos = [], escolhido = 0;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function desenhar() {
    const q = normal(campo.value.trim());
    const so = filtro.getAttribute('aria-pressed') === 'true';
    vistos = itens.filter((i) => (!so || i.atencao) && (!q || normal(`${i.titulo} ${i.sub || ''} ${i.grupo}`).includes(q)))
      .sort((a, b) => (b.atencao ? 1 : 0) - (a.atencao ? 1 : 0)).slice(0, 80);
    escolhido = Math.min(escolhido, Math.max(0, vistos.length - 1));
    let grupo = '';
    lista.innerHTML = vistos.map((i, k) => {
      const cab = i.grupo !== grupo ? `<li class="paleta-grupo">${esc(i.grupo)}</li>` : '';
      grupo = i.grupo;
      return `${cab}<li class="paleta-item${i.atencao ? ' atencao' : ''}" data-k="${k}" aria-selected="${k === escolhido}">
        <span class="titulo">${esc(i.titulo)}</span>${i.sub ? `<span class="sub">${esc(i.sub)}</span>` : ''}</li>`;
    }).join('') || '<li class="paleta-vazio">Nada encontrado.</li>';
    lista.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  function abrir(soAtencao = false) {
    itens = fontes.flatMap((f) => { try { return f() || []; } catch { return []; } });
    filtro.setAttribute('aria-pressed', String(soAtencao));
    campo.value = ''; escolhido = 0;
    el.hidden = false;
    desenhar();
    campo.focus();
  }
  const fechar = () => { el.hidden = true; };
  function executar(k) {
    const i = vistos[k];
    if (!i) return;
    fechar();
    i.faz();
  }

  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); if (el.hidden) abrir(); else fechar(); return; }
    if (el.hidden) return;
    if (ev.key === 'Escape') { ev.preventDefault(); fechar(); }
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); escolhido = (escolhido + (ev.key === 'ArrowDown' ? 1 : -1) + vistos.length) % Math.max(1, vistos.length); desenhar(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); executar(escolhido); }
  }, true);
  campo.addEventListener('input', () => { escolhido = 0; desenhar(); });
  filtro.addEventListener('click', () => { filtro.setAttribute('aria-pressed', String(filtro.getAttribute('aria-pressed') !== 'true')); escolhido = 0; desenhar(); campo.focus(); });
  lista.addEventListener('click', (ev) => { const li = ev.target.closest('.paleta-item'); if (li) executar(Number(li.dataset.k)); });
  el.addEventListener('mousedown', (ev) => { if (ev.target === el) fechar(); });

  // Fonte própria: abas e ações gerais.
  const clicar = (sel) => () => document.querySelector(sel)?.click();
  window.orqPaleta.registrar(() => [
    { grupo: 'Abas', titulo: 'Orquestrador', faz: clicar('[data-aba="aba-orquestrador"]') },
    { grupo: 'Abas', titulo: 'Terminais (espelho dos agentes)', faz: clicar('[data-aba="aba-grade"]') },
    { grupo: 'Abas', titulo: 'Notas', faz: clicar('[data-aba="aba-notas"]') },
    { grupo: 'Abas', titulo: 'Navegador', faz: clicar('[data-aba="aba-navegador"]') },
    { grupo: 'Abas', titulo: 'Terminal', faz: clicar('[data-aba="aba-terminal"]') },
    { grupo: 'Ações', titulo: 'Nova conversa', faz: clicar('#nova-conversa') },
    { grupo: 'Ações', titulo: 'Novo terminal', faz: () => { clicar('[data-aba="aba-terminal"]')(); setTimeout(clicar('#novo-terminal'), 300); } },
    { grupo: 'Ações', titulo: 'Configurações', faz: clicar('#abrir-config') },
    { grupo: 'Ações', titulo: 'Reiniciar o app mantendo as conversas', faz: () => window.orq.app && window.orq.app.reiniciar() },
    { grupo: 'Ações', titulo: 'Alternar tema claro/escuro', faz: clicar('#tema') },
    { grupo: 'Ações', titulo: 'Trocar modelo e esforço', faz: () => { clicar('[data-aba="aba-orquestrador"]')(); setTimeout(clicar('#botao-modelo'), 100); } },
  ]);
  window.orqPaleta.abrir = abrir;
})();
