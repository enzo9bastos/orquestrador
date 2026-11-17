// Buscar na conversa (Ctrl+F). Olha só o texto das mensagens (#mensagens), marca
// tudo o que achou com a API de realce do navegador (CSS Custom Highlight: nada
// muda no DOM das mensagens) e anda com Enter / Shift+Enter. O Esc fecha a barra
// sem interromper o motor (conversa-tela.js consulta window.orqBusca.aberta()).
(() => {
  const $ = (id) => document.getElementById(id);
  const barra = $('busca-conversa');
  const campo = $('busca-conversa-texto');
  const conta = $('busca-conversa-conta');
  const caixa = $('mensagens');
  if (!barra || !campo || !caixa || !window.CSS || !CSS.highlights || typeof Highlight !== 'function') return;
  const T = (t) => (window.orqI18n ? window.orqI18n.t(t) : t);
  const LIMITE = 2000; // marcas: conversa enorme com palavra comum não trava a tela
  let achados = [];
  let atual = -1;
  let tBusca = null;
  let tMudou = null; // busca de novo, marcada para daqui a pouco, porque a conversa mudou

  function limpar() {
    CSS.highlights.delete('busca-conversa');
    CSS.highlights.delete('busca-conversa-atual');
    achados = []; atual = -1;
  }
  function pintarAtual({ rolar = true } = {}) {
    CSS.highlights.delete('busca-conversa-atual');
    if (atual < 0 || !achados[atual]) return;
    const r = achados[atual];
    CSS.highlights.set('busca-conversa-atual', new Highlight(r));
    const el = r.startContainer.parentElement;
    if (!el) return;
    // Trecho dentro de um bloco recolhido (saída de ferramenta, mensagem por trás): abre para dar para ver.
    for (let d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
    if (rolar) el.scrollIntoView({ block: 'center' });
  }
  function dizer() {
    // "2/7": igual em qualquer idioma.
    conta.textContent = !campo.value ? '' : achados.length ? `${atual + 1}/${achados.length}${achados.length >= LIMITE ? '+' : ''}` : T('Nada encontrado');
    barra.classList.toggle('sem-resultado', !!campo.value && !achados.length);
  }
  // manter: a busca roda de novo porque a conversa mudou; a posição fica onde estava.
  function buscar({ manter = false } = {}) {
    const antes = atual;
    limpar();
    if (barra.hidden) return; // barra fechada não marca nada (uma busca marcada antes de fechar não volta)
    const q = campo.value.toLocaleLowerCase();
    if (q) {
      const andar = document.createTreeWalker(caixa, NodeFilter.SHOW_TEXT);
      for (let n = andar.nextNode(); n && achados.length < LIMITE; n = andar.nextNode()) {
        const texto = n.nodeValue.toLocaleLowerCase();
        for (let i = texto.indexOf(q); i >= 0 && achados.length < LIMITE; i = texto.indexOf(q, i + q.length)) {
          const r = new Range();
          r.setStart(n, i); r.setEnd(n, i + q.length);
          achados.push(r);
        }
      }
      if (achados.length) {
        CSS.highlights.set('busca-conversa', new Highlight(...achados));
        atual = manter && antes >= 0 ? Math.min(antes, achados.length - 1) : 0;
        pintarAtual({ rolar: !manter });
      }
    }
    dizer();
  }
  function andar(passo) {
    if (!achados.length) return;
    atual = (atual + passo + achados.length) % achados.length;
    pintarAtual();
    dizer();
  }
  function abrir() {
    barra.hidden = false;
    campo.focus(); campo.select();
    if (campo.value) buscar();
  }
  function fechar({ foco = true } = {}) {
    if (barra.hidden) return false;
    barra.hidden = true;
    clearTimeout(tBusca); clearTimeout(tMudou);
    limpar();
    conta.textContent = '';
    if (foco) $('entrada').focus();
    return true;
  }

  campo.addEventListener('input', () => { clearTimeout(tBusca); tBusca = setTimeout(() => buscar(), 120); });
  campo.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); clearTimeout(tBusca); if (!achados.length && campo.value) buscar(); else andar(ev.shiftKey ? -1 : 1); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fechar(); }
  });
  $('busca-conversa-antes').addEventListener('click', () => { andar(-1); campo.focus(); });
  $('busca-conversa-depois').addEventListener('click', () => { andar(1); campo.focus(); });
  $('busca-conversa-fechar').addEventListener('click', () => fechar());
  // Mensagem nova (ou outra conversa na tela) com a barra aberta: a busca roda de novo.
  new MutationObserver(() => {
    if (barra.hidden || !campo.value) return;
    clearTimeout(tMudou);
    tMudou = setTimeout(() => buscar({ manter: true }), 200);
  }).observe(caixa, { childList: true, subtree: true, characterData: true });
  // Ctrl+F com a aba da conversa na frente (as notas e os terminais têm a própria tela).
  document.addEventListener('keydown', (ev) => {
    if (!ev.ctrlKey || ev.altKey || ev.shiftKey || ev.metaKey || ev.code !== 'KeyF') return;
    if (!$('aba-orquestrador').classList.contains('ativa')) return;
    if (document.querySelector('#popup:not([hidden]), #config:not([hidden]), .paleta-fundo:not([hidden])')) return;
    ev.preventDefault();
    abrir();
  });
  window.orqBusca = { abrir, fechar, aberta: () => !barra.hidden };
})();
