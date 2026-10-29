// Configurações do app (aba da engrenagem): tudo o que é configurável fica
// aqui. Grava em ~/.config/orq-app/config.json pelo processo principal, que
// valida chave por chave. Avisa as outras partes da tela com o evento
// "orq:config".
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
    config = { ...config, ...(await window.orq.config.gravar(m)) };
    if (config.recusado && config.recusado.length) avisoConfig(`Não gravei: ${config.recusado.join(', ')} (valor inválido).`);
    preencher();
    window.dispatchEvent(new CustomEvent('orq:config', { detail: config }));
  }

  // --- campos das outras seções -------------------------------------------------
  const pegar = (k) => k.split('.').reduce((o, p) => (o == null ? o : o[p]), config);
  function avisoConfig(t) { const el = $('config-arquivo'); el.textContent = t; el.classList.add('erro'); setTimeout(() => { el.classList.remove('erro'); preencher(); }, 4000); }
  function preencher() {
    for (const el of document.querySelectorAll('#config [data-cfg]')) {
      if (el === document.activeElement) continue;
      const v = pegar(el.dataset.cfg);
      if (el.type === 'checkbox') el.checked = v !== false;
      else if (el.dataset.cfg === 'ambiente') el.value = Object.entries(v || {}).map(([a, b]) => `${a}=${b}`).join('\n');
      else el.value = v == null ? '' : v;
    }
    for (const seg of document.querySelectorAll('#config [data-segmento]')) {
      for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.v) === pegar(seg.dataset.segmento)));
    }
    $('config-pastas').innerHTML = (config.pastasNotas || []).map((p, i) => `<li><span class="nome">${esc(p.nome || p.caminho.split('/').pop())}</span>
      <code>${esc(p.caminho)}</code><button type="button" class="botao-icone" data-tirar-pasta="${i}" title="Tirar do app (nada é apagado)">✕</button></li>`).join('')
      || '<li class="vazio-regra">Nenhuma pasta.</li>';
    $('config-arquivo').textContent = config.arquivo ? `Arquivo: ${config.arquivo}` : '';
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function valorDe(el) {
    const k = el.dataset.cfg;
    if (el.type === 'checkbox') {
      if (k.startsWith('notificacoes.')) return { notificacoes: { ...(config.notificacoes || {}), [k.split('.')[1]]: el.checked } };
      return { [k]: el.checked };
    }
    if (k === 'ambiente') {
      const amb = {};
      for (const l of el.value.split('\n')) { const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=(.*)$/); if (m) amb[m[1]] = m[2].trim(); }
      return { ambiente: amb };
    }
    return { [k]: el.value };
  }
  $('config').addEventListener('change', (ev) => {
    const el = ev.target.closest('[data-cfg]');
    if (el) mudar(valorDe(el));
  });
  $('config').addEventListener('click', async (ev) => {
    const seg = ev.target.closest('[data-segmento] button');
    if (seg) { mudar({ [seg.parentElement.dataset.segmento]: Number(seg.dataset.v) }); return; }
    const tirar = ev.target.closest('[data-tirar-pasta]');
    if (tirar) {
      if (!tirar.dataset.confirmando) { tirar.dataset.confirmando = '1'; tirar.textContent = 'Tirar?'; return; }
      const lista = (config.pastasNotas || []).filter((_, i) => i !== Number(tirar.dataset.tirarPasta));
      mudar({ pastasNotas: lista });
      return;
    }
    if (ev.target.closest('#config-pasta-mais') && window.orq.notas) {
      const i = await window.orq.notas.adicionarPasta();
      if (i != null) { config = await window.orq.config.ler(); preencher(); window.dispatchEvent(new CustomEvent('orq:config', { detail: config })); }
    }
  });

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
  $('abrir-config').addEventListener('click', async () => { config = await window.orq.config.ler(); preencher(); painel.hidden = false; });
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
  window.orq.config.ler().then((c) => { config = c; aplicar(); preencher(); window.dispatchEvent(new CustomEvent('orq:config', { detail: config })); });
})();
