// Idioma da tela. O app é escrito em português; em inglês, este tradutor
// troca na tela tudo o que for texto do app (textos, dicas, placeholders) pelo
// dicionário em i18n/en.json — inclusive o que aparece depois, conforme a tela
// muda. Não toca no que é conteúdo (conversa com o Claude, notas, terminal,
// código). Trocar o idioma recarrega a tela.
(() => {
  const CHAVE = 'orq-idioma';
  const ATRIBUTOS = ['title', 'placeholder', 'aria-label', 'alt'];
  // Conteúdo, não texto do app: nunca traduzir.
  const CONTEUDO = '.md, .balao, pre, code, .xterm, textarea, [contenteditable="true"], .ProseMirror, .resposta, .aj-resposta, .tarefa, .texto-status, .nome-arquivo-nota, [data-sem-traducao]';
  let dic = null;
  let padroes = [];
  let idioma = 'pt-BR';
  let observador = null;
  const originais = new WeakMap(); // nó → texto já traduzido (não traduz de novo)

  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  function t(s) {
    if (!dic || s == null) return s;
    const k = norm(String(s));
    if (!k) return s;
    let v = dic[k];
    if (v === undefined) for (const [re, rep] of padroes) if (re.test(k)) { v = k.replace(re, rep); break; }
    if (v === undefined) return s;
    const ini = String(s).match(/^\s*/)[0], fim = String(s).match(/\s*$/)[0];
    return ini + v + fim;
  }
  const excluido = (el) => !!(el && el.closest && el.closest(CONTEUDO));

  function traduzirTexto(no) {
    if (!no.nodeValue || !no.nodeValue.trim() || originais.get(no) === no.nodeValue) return;
    if (excluido(no.parentElement)) return;
    const novo = t(no.nodeValue);
    originais.set(no, novo);
    if (novo !== no.nodeValue) no.nodeValue = novo;
  }
  function traduzirAtributos(el) {
    if (excluido(el) && el.tagName !== 'TEXTAREA') return;
    for (const a of ATRIBUTOS) {
      const v = el.getAttribute(a);
      if (!v) continue;
      const novo = t(v);
      if (novo !== v) el.setAttribute(a, novo);
    }
  }
  function traduzirArvore(raiz) {
    if (raiz.nodeType === 3) { traduzirTexto(raiz); return; }
    if (raiz.nodeType !== 1) return;
    if (excluido(raiz) && raiz.tagName !== 'TEXTAREA') return;
    traduzirAtributos(raiz);
    for (const el of raiz.querySelectorAll('[title], [placeholder], [aria-label], [alt]')) traduzirAtributos(el);
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) traduzirTexto(n);
  }

  async function carregar(base) {
    try {
      const r = await fetch(`${base}en.json`);
      const j = await r.json();
      dic = j.textos || {};
      padroes = (j.padroes || []).map(([src, rep]) => { try { return [new RegExp(src, 'u'), rep]; } catch { return null; } }).filter(Boolean);
    } catch { dic = null; }
  }

  async function definir(novo, base = 'i18n/') {
    idioma = novo === 'en' ? 'en' : 'pt-BR';
    try { localStorage.setItem(CHAVE, idioma); } catch { /* sem armazenamento */ }
    document.documentElement.lang = idioma;
    if (idioma !== 'en') return;
    await carregar(base);
    if (!dic) return;
    document.title = t(document.title);
    traduzirArvore(document.body);
    if (observador) observador.disconnect();
    observador = new MutationObserver((mudancas) => {
      for (const m of mudancas) {
        if (m.type === 'characterData') traduzirTexto(m.target);
        else if (m.type === 'attributes') traduzirAtributos(m.target);
        else for (const n of m.addedNodes) traduzirArvore(n);
      }
    });
    observador.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATRIBUTOS });
  }

  window.orqI18n = { definir, t, idioma: () => idioma };
  // O location.reload é barrado pelo app (nenhuma navegação da página): pede ao processo principal.
  const recarregar = () => (window.orq && window.orq.app && window.orq.app.recarregarTela ? window.orq.app.recarregarTela() : location.reload());

  // Tela principal do app: o idioma vem da configuração; mudou, recarrega.
  if (window.orq && window.orq.config) {
    let atual = null;
    try { atual = localStorage.getItem(CHAVE); } catch { /* sem armazenamento */ }
    if (atual === 'en') definir('en');
    window.orq.config.ler().then((c) => {
      const quer = c.idioma === 'en' ? 'en' : 'pt-BR';
      if (quer !== (atual || 'pt-BR')) { if (quer === 'en') definir('en'); else { try { localStorage.setItem(CHAVE, 'pt-BR'); } catch { /* sem armazenamento */ } recarregar(); } }
    }).catch(() => {});
    window.addEventListener('orq:config', (ev) => {
      const quer = ev.detail && ev.detail.idioma;
      if (!quer || quer === idioma) return;
      try { localStorage.setItem(CHAVE, quer); } catch { /* sem armazenamento */ }
      recarregar();
    });
  }
})();
