// Aba Navegador: até 4 janelas de navegador lado a lado, cada uma com o seu
// endereço e a sua identidade (Chrome, Firefox, Edge, celulares). As janelas
// voltam abertas na próxima vez. O orquestrador controla as mesmas janelas
// pelo orq-nav e a janela mostra, ao vivo, quando está sendo controlada.
(() => {
  const $ = (id) => document.getElementById(id);
  const MAX = 4;
  const CHAVE = 'orq-navegador';
  const janelas = new Map(); // id → { el, wv, preset, url, titulo, registrada }
  let presets = [{ id: 'padrao', nome: 'Padrão (Chromium)', celular: null }];
  let seq = 0;

  const guardar = () => {
    try { localStorage.setItem(CHAVE, JSON.stringify([...janelas].map(([id, j]) => ({ id, url: j.url, preset: j.preset })))); } catch { /* sem armazenamento */ }
  };
  const lidas = () => { try { return JSON.parse(localStorage.getItem(CHAVE)) || []; } catch { return []; } };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // O que foi digitado na barra: endereço (com ou sem https://) ou busca.
  function endereco(t) {
    t = t.trim();
    if (!t) return null;
    if (/^(https?:\/\/|about:)/i.test(t)) return t;
    if (/^(localhost|127\.\d+\.\d+\.\d+|\d+\.\d+\.\d+\.\d+)(:\d+)?(\/.*)?$/i.test(t)) return `http://${t}`;
    if (!/\s/.test(t) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(t)) return `https://${t}`;
    return `https://www.google.com/search?q=${encodeURIComponent(t)}`;
  }

  const opcoes = (atual) => {
    const grupo = (cel) => presets.filter((p) => !!p.celular === cel).map((p) => `<option value="${p.id}"${p.id === atual ? ' selected' : ''}>${esc(p.nome)}</option>`).join('');
    return `<optgroup label="Computador">${grupo(false)}</optgroup><optgroup label="Celular">${grupo(true)}</optgroup>`;
  };

  // Celular: a página fica do tamanho da tela do aparelho, no meio do painel.
  function ajustar(j) {
    const p = presets.find((x) => x.id === j.preset);
    const m = j.el.querySelector('.moldura');
    j.el.classList.toggle('celular', !!p?.celular);
    m.style.width = p?.celular ? `${p.celular.largura}px` : '';
    m.style.height = p?.celular ? `${p.celular.altura}px` : '';
  }

  function contar() {
    const n = janelas.size;
    $('navegadores').dataset.n = String(n);
    $('n-navegadores').textContent = n ? `${n} de ${MAX} janelas` : '';
    $('nova-janela-nav').disabled = n >= MAX;
    if (!n) $('navegadores').innerHTML = '<div class="vazio-nav"><p>Nenhuma janela aberta.</p><p class="nota">Abra uma para navegar. O orquestrador também abre e usa estas janelas, e você vê tudo o que ele faz.</p><button type="button" class="botao-texto" data-nav-nova>+ Nova janela</button></div>';
    else $('navegadores').querySelector('.vazio-nav')?.remove();
  }

  function atualizarUrl(j, url) {
    // A página em branco do começo não apaga o endereço que vai abrir.
    if (url === 'about:blank' && j.esperando) return;
    j.esperando = false;
    j.url = url;
    const campo = j.el.querySelector('.endereco');
    if (document.activeElement !== campo) campo.value = url === 'about:blank' ? '' : url;
    guardar();
  }

  function abrir({ url = 'about:blank', preset = 'padrao', id } = {}) {
    if (janelas.size >= MAX) return null;
    if (!id || janelas.has(id)) id = `n${++seq}`;
    seq = Math.max(seq, Number(id.slice(1)) || 0);
    if (!presets.some((p) => p.id === preset)) preset = 'padrao';
    const el = document.createElement('section');
    el.className = 'painel-navegador';
    el.dataset.id = id;
    el.innerHTML = `<header class="barra-navegador">
        <button type="button" class="botao-icone" data-nav="voltar" title="Voltar" aria-label="Voltar">←</button>
        <button type="button" class="botao-icone" data-nav="avancar" title="Avançar" aria-label="Avançar">→</button>
        <button type="button" class="botao-icone" data-nav="recarregar" title="Recarregar" aria-label="Recarregar">↻</button>
        <input class="endereco mono" type="text" spellcheck="false" placeholder="Endereço ou busca" aria-label="Endereço">
        <select class="preset" title="Como o site enxerga esta janela" aria-label="Navegador e aparelho">${opcoes(preset)}</select>
        <button type="button" class="botao-icone" data-nav="fora" title="Abrir no navegador do sistema" aria-label="Abrir fora"><svg class="ico"><use href="#i-abrir"/></svg></button>
        <button type="button" class="botao-icone" data-nav="fechar" title="Fechar esta janela" aria-label="Fechar janela">✕</button>
      </header>
      <div class="corpo-navegador"><div class="moldura"></div><span class="selo-controle" hidden></span></div>`;
    const wv = document.createElement('webview');
    wv.setAttribute('partition', 'persist:navegador');
    wv.setAttribute('src', 'about:blank');
    el.querySelector('.moldura').append(wv);
    const j = { el, wv, preset, url, titulo: '', registrada: false, esperando: url !== 'about:blank' };
    janelas.set(id, j);
    $('navegadores').querySelector('.vazio-nav')?.remove();
    $('navegadores').append(el);
    el.querySelector('.endereco').value = url === 'about:blank' ? '' : url;
    ajustar(j);
    contar();
    wv.addEventListener('dom-ready', () => {
      if (j.registrada) return;
      j.registrada = true;
      window.orq.navegador.registrar(id, wv.getWebContentsId(), j.preset, url !== 'about:blank' ? url : null);
    });
    wv.addEventListener('did-navigate', (e) => atualizarUrl(j, e.url));
    wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) atualizarUrl(j, e.url); });
    wv.addEventListener('page-title-updated', (e) => { j.titulo = e.title; el.title = e.title; });
    wv.addEventListener('did-start-loading', () => el.classList.add('carregando'));
    wv.addEventListener('did-stop-loading', () => el.classList.remove('carregando'));
    wv.addEventListener('focus', () => focar(id));
    guardar();
    return id;
  }

  function fechar(id) {
    const j = janelas.get(id);
    if (!j) return false;
    j.el.remove();
    janelas.delete(id);
    contar();
    guardar();
    return true;
  }

  function focar(id) {
    for (const [k, j] of janelas) j.el.classList.toggle('focado', k === id);
  }

  async function trocarPreset(id, preset) {
    const j = janelas.get(id);
    if (!j) return false;
    j.preset = preset;
    j.el.querySelector('.preset').value = preset;
    ajustar(j);
    guardar();
    return window.orq.navegador.preset(id, preset);
  }

  // --- cliques e teclas da barra ---------------------------------------------
  document.addEventListener('click', (ev) => {
    if (ev.target.closest('#nova-janela-nav, [data-nav-nova]')) {
      const id = abrir();
      if (id) janelas.get(id).el.querySelector('.endereco').focus();
      return;
    }
    const b = ev.target.closest('[data-nav]');
    if (!b) return;
    const id = b.closest('.painel-navegador')?.dataset.id;
    const j = janelas.get(id);
    if (!j) return;
    focar(id);
    const acao = b.dataset.nav;
    if (acao === 'voltar' && j.wv.canGoBack()) j.wv.goBack();
    else if (acao === 'avancar' && j.wv.canGoForward()) j.wv.goForward();
    else if (acao === 'recarregar') j.wv.reload();
    else if (acao === 'fora' && /^https?:/.test(j.url)) window.orq.abrirLink(j.url);
    else if (acao === 'fechar') fechar(id);
  });
  document.addEventListener('keydown', (ev) => {
    const campo = ev.target.closest?.('.painel-navegador .endereco');
    if (!campo || ev.key !== 'Enter') return;
    const j = janelas.get(campo.closest('.painel-navegador').dataset.id);
    const url = endereco(campo.value);
    if (!j || !url) return;
    campo.value = url;
    j.wv.loadURL(url).catch(() => {});
    j.wv.focus();
  });
  document.addEventListener('change', (ev) => {
    const sel = ev.target.closest?.('.painel-navegador .preset');
    if (sel) trocarPreset(sel.closest('.painel-navegador').dataset.id, sel.value);
  });

  // --- pedidos do processo principal (orq-nav e links que abrem janela) -----
  window.orq.navegador.aoPedido(async (p) => {
    let r = null;
    if (p.acao === 'abrir') { const id = abrir({ url: p.url, preset: p.preset }); r = id ? { id } : { erro: `já há ${MAX} janelas abertas; feche uma antes` }; }
    else if (p.acao === 'fechar') r = fechar(p.id);
    else if (p.acao === 'preset') r = await trocarPreset(p.id, p.preset);
    window.orq.navegador.responder(p.n, r);
  });
  window.orq.navegador.aoAbrir(({ url }) => abrir({ url }));
  const ROTULOS = { ir: 'abrindo página', clicar: 'clicando', digitar: 'digitando', tecla: 'apertando tecla', texto: 'lendo a página', elementos: 'lendo a página', print: 'tirando print', js: 'rodando script', voltar: 'voltando', avancar: 'avançando', recarregar: 'recarregando', abrir: 'abriu esta janela', preset: 'trocando o aparelho' };
  window.orq.navegador.aoControlado((id, acao) => {
    const j = janelas.get(id);
    if (!j) return;
    const selo = j.el.querySelector('.selo-controle');
    selo.textContent = `Orquestrador: ${ROTULOS[acao] || acao}`;
    selo.hidden = false;
    j.el.classList.add('controlada');
    clearTimeout(j.tSelo);
    j.tSelo = setTimeout(() => { selo.hidden = true; j.el.classList.remove('controlada'); }, 4000);
  });

  // Paleta Ctrl+K: as janelas abertas e "Nova janela".
  window.orqPaleta?.registrar(() => [
    { grupo: 'Navegador', titulo: 'Nova janela do navegador', faz: () => { document.querySelector('[data-aba="aba-navegador"]').click(); $('nova-janela-nav').click(); } },
    ...[...janelas].map(([id, j]) => ({ grupo: 'Navegador', titulo: j.titulo || j.url || 'Janela em branco', sub: j.url, faz: () => { document.querySelector('[data-aba="aba-navegador"]').click(); focar(id); } })),
  ]);

  window.orqNavegador = { abrir, fechar, janelas: () => [...janelas].map(([id, j]) => ({ id, url: j.url, preset: j.preset })) };

  // Começo: as janelas da última vez voltam abertas.
  window.orq.navegador.presets().then((l) => {
    presets = l;
    for (const s of lidas().slice(0, MAX)) abrir(s);
    contar();
  });
})();
