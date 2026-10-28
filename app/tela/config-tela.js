// Configurações do app (tema e cor de destaque), guardadas em
// ~/.config/orq-app/config.json pelo processo principal.
(() => {
  const $ = (id) => document.getElementById(id);
  const CORES = [
    ['Roxo', '#8b5cf6'], ['Laranja', '#ec9333'], ['Azul', '#3b82f6'],
    ['Verde-água', '#14b8a6'], ['Rosa', '#ec4899'], ['Âmbar', '#eab308'],
  ];
  let config = { tema: 'dark', destaque: '#8b5cf6' };

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function aplicar() {
    const raiz = document.documentElement;
    raiz.dataset.theme = config.tema;
    // --claude é o nome antigo da cor de destaque, usado no CSS inteiro.
    raiz.style.setProperty('--claude', config.destaque);
    raiz.style.setProperty('--claude-suave', rgba(config.destaque, config.tema === 'light' ? 0.12 : 0.15));
    // "Espera você" e pedido de permissão também seguem o destaque.
    raiz.style.setProperty('--esperando', config.destaque);
    raiz.style.setProperty('--esperando-suave', rgba(config.destaque, 0.16));
    document.querySelectorAll('#config-tema button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tema === config.tema));
    document.querySelectorAll('#config-cores .amostra').forEach((b) => b.setAttribute('aria-pressed', b.dataset.cor === config.destaque));
    $('cor-livre').value = config.destaque;
  }

  async function mudar(m) {
    config = { ...config, ...m };
    aplicar();
    config = await window.orq.config.gravar(m);
  }

  $('config-cores').innerHTML = CORES.map(([nome, cor]) =>
    `<button type="button" class="amostra" data-cor="${cor}" title="${nome}" aria-label="${nome}" style="--cor:${cor}"></button>`).join('') +
    '<label class="amostra livre" title="Outra cor"><input id="cor-livre" type="color" aria-label="Outra cor"></label>';

  $('config-cores').addEventListener('click', (ev) => {
    const b = ev.target.closest('.amostra[data-cor]');
    if (b) mudar({ destaque: b.dataset.cor });
  });
  $('cor-livre').addEventListener('change', (ev) => mudar({ destaque: ev.target.value }));
  $('config-tema').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tema]');
    if (b) mudar({ tema: b.dataset.tema });
  });
  $('tema').addEventListener('click', () => mudar({ tema: config.tema === 'dark' ? 'light' : 'dark' }));

  const painel = $('config');
  $('abrir-config').addEventListener('click', () => { painel.hidden = false; });
  $('fechar-config').addEventListener('click', () => { painel.hidden = true; });
  painel.addEventListener('click', (ev) => { if (ev.target === painel) painel.hidden = true; });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') painel.hidden = true; });


  // Botões da janela (sem moldura do sistema). Duplo clique no topo maximiza.
  const J = window.orq.janela;
  if (J) {
    $('janela-min').addEventListener('click', () => J.minimizar());
    $('janela-max').addEventListener('click', () => J.maximizar());
    $('janela-fechar').addEventListener('click', () => J.fechar());
    document.querySelectorAll('.topo .arrasta').forEach((el) => el.addEventListener('dblclick', () => J.maximizar()));
    J.aoMaximizar((sim) => {
      $('janela-max').innerHTML = sim
        ? '<svg viewBox="0 0 12 12"><rect x="2.5" y="4" width="5.5" height="5.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4.5 4V3a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5H8" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>'
        : '<svg viewBox="0 0 12 12"><rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
      $('janela-max').title = sim ? 'Restaurar' : 'Maximizar';
    });
  } else {
    // Ponte antiga (app ainda não reaberto): esconde os botões.
    document.querySelector('.controles-janela').hidden = true;
  }

  aplicar();
  window.orq.config.ler().then((c) => { config = c; aplicar(); });
})();
