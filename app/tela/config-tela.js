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

  // Exit: fecha a janela (o app sai junto). As conversas só pausam; nada é desligado.
  $('sair-app').addEventListener('click', () => window.close());

  aplicar();
  window.orq.config.ler().then((c) => { config = c; aplicar(); });
})();
