// Barra de formatação das Notas: nunca quebra em duas linhas. O que não cabe
// sai da barra, do fim para o começo (as cores primeiro), e vira item do "⋯"
// que já existe; o clique segue o mesmo caminho de antes (data-cmd e
// data-cor-nota), então a função de cada botão não muda.
(() => {
  const barra = document.getElementById('barra-nota');
  if (!barra) return;
  const menu = barra.querySelector('.mais-nota');
  const mais = barra.querySelector('[data-cmd="mais"]');
  let ajustando = false;

  const unidades = () => [...barra.children].filter((el) => el !== mais && (el.matches('button[data-cmd]') || el.matches('.cores-nota') || el.matches('.sep')));

  function ajustar() {
    if (ajustando || barra.hidden || !barra.clientWidth) return;
    ajustando = true;
    try {
      barra.querySelectorAll('.transbordou').forEach((el) => el.classList.remove('transbordou'));
      menu.querySelectorAll('[data-transbordo]').forEach((el) => el.remove());
      const fim = unidades().reverse();
      const fora = [];
      for (const el of fim) {
        if (barra.scrollWidth <= barra.clientWidth + 1) break;
        el.classList.add('transbordou');
        fora.push(el);
      }
      // Separador solto no fim não serve de nada.
      const visiveis = unidades().filter((el) => !el.classList.contains('transbordou'));
      for (let i = visiveis.length - 1; i >= 0 && visiveis[i].matches('.sep'); i--) visiveis[i].classList.add('transbordou');
      const itens = [];
      for (const el of fora.reverse()) {
        if (el.matches('.sep')) continue;
        if (el.matches('.cores-nota')) {
          for (const b of el.querySelectorAll('[data-cor-nota]')) itens.push(item({ 'data-cor-nota': b.dataset.corNota }, b.title, true));
        } else {
          itens.push(item({ 'data-cmd': el.dataset.cmd }, el.title || el.textContent.trim()));
        }
      }
      if (itens.length) {
        const sep = Object.assign(document.createElement('li'), { className: 'sep' });
        sep.dataset.transbordo = '1';
        menu.append(sep, ...itens);
      }
    } finally { ajustando = false; }
  }

  function item(attrs, rotulo, cor) {
    const li = document.createElement('li');
    li.setAttribute('role', 'menuitem');
    li.dataset.transbordo = '1';
    for (const [k, v] of Object.entries(attrs)) li.setAttribute(k, v);
    if (cor) li.append(Object.assign(document.createElement('i'), { className: 'bolinha-cor' }));
    li.append(document.createTextNode(rotulo));
    return li;
  }

  new ResizeObserver(ajustar).observe(barra);
  new MutationObserver(() => { if (!barra.hidden) ajustar(); }).observe(barra, { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('resize', ajustar);
  window.__orqBarraNota = { ajustar };
})();
