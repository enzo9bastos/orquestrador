// Aparência do bichinho: o desenho (pixel art em SVG), as cores do corpo e o
// guarda-roupa — 30 itens em 6 partes do corpo. Usado dentro do app e na
// janelinha do ajudante que anda pela área de trabalho.
//
// Coordenadas: o corpo ocupa x 2–10, y 0–5; olhos em x 3 e 8 (y 1–2);
// braços em x 0–1 e 10–11 (y 2–3); pernas em y 5–7. Itens de cabeça sobem até
// y −7; o da mão fica à direita (x 11–15).
(() => {
  // Cores do Clássico (as outras espécies têm cor própria). "Cor do app" segue
  // a cor de destaque das configurações.
  const CORES = [
    ['padrao', 'Cor do app', null],
    ['coral', 'Coral', '#d97757'],
    ['vermelho', 'Vermelho', '#e5484d'],
    ['laranja', 'Laranja', '#f08c2e'],
    ['amarelo', 'Amarelo', '#e5b31a'],
    ['lima', 'Lima', '#84cc16'],
    ['verde', 'Verde', '#22a06b'],
    ['agua', 'Verde-água', '#14b8a6'],
    ['ciano', 'Ciano', '#06b6d4'],
    ['azul', 'Azul', '#3b82f6'],
    ['anil', 'Anil', '#6366f1'],
    ['lilas', 'Lilás', '#c084fc'],
    ['rosa', 'Rosa', '#e8559a'],
    ['marrom', 'Marrom', '#9a6b4f'],
    ['cinza', 'Cinza', '#8a8f98'],
    ['grafite', 'Grafite', '#4b5060'],
    ['branco', 'Branco', '#e8eaf0'],
  ];
  // Espécies: o mesmo "esqueleto" (olhos perto de x 3 e 8, braços nas
  // laterais, mão direita em x 10–11), então todas vestem os mesmos 30 itens.
  // corpo: retângulos da pele; pernas (animam ao andar: p1 com p3, p2 com p4);
  // braços: [x, y, l, a] (ou lista deles); olhos: [[x, y, l, a]…] (padrão:
  // risquinhos em x 3 e 8). detalhe: [x, y, l, a, classe] — brilho, sombra,
  // bolha, claro, acento, rosado, escuro, por cima da pele.
  // fixa: cor própria da espécie (a cor escolhida no guarda-roupa vale só para o
  // Clássico). A nuvem usa a cor do humor (null = não pinta).
  const ESPECIES = {
    // O Clássico: homenagem de fã ao mascote do Claude Code. O único que muda de cor.
    bicho: { nome: 'Clássico', jeito: 'anda', corpo: [[2, 0, 8, 5]], pernas: [[2, 5, 1, 2], [4, 5, 1, 2], [7, 5, 1, 2], [9, 5, 1, 2]], bracoE: [0, 2, 2, 2], bracoD: [10, 2, 2, 2] },
    // Gatinho: orelhas com o interior rosado, rabinho, focinho; laranja rajado.
    gatinho: { nome: 'Gatinho', jeito: 'anda', fixa: '#f0a35e', corpo: [[3, 0, 6, 1], [2, 1, 8, 4]], pernas: [[3, 5, 1, 2], [4.5, 5, 1, 2], [6.5, 5, 1, 2], [8, 5, 1, 2]], bracoE: [1, 2.5, 1, 1.5], bracoD: [10, 2.5, 1, 1.5],
      olhos: [[3, 1.5, 1.5, 1.5], [7.5, 1.5, 1.5, 1.5]],
      detalhe: [[2, -1, 2, 1, 'pele'], [2, -2, 1, 1, 'pele'], [8, -1, 2, 1, 'pele'], [9, -2, 1, 1, 'pele'], [2.5, -1, 0.6, 0.6, 'rosado'], [8.9, -1, 0.6, 0.6, 'rosado'], [0.5, 2, 1, 1, 'pele rabo'], [0, 0, 1, 2, 'pele rabo'], [5.5, 3, 1, 0.6, 'rosado'], [4, 0, 1, 0.6, 'escuro'], [6.5, 0, 1, 0.6, 'escuro'], [3.5, 3.6, 5, 1.4, 'claro']] },
    // Pinguim: máscara e barriga brancas, bico e pés amarelos, asinhas.
    pinguim: { nome: 'Pinguim', jeito: 'anda', fixa: '#2f3242', corpo: [[3, -1, 6, 1], [2, 0, 8, 6]], pernas: [[3, 6, 2, 1], [7, 6, 2, 1]], bracoE: [1, 2, 1, 3], bracoD: [10, 2, 1, 3],
      olhos: [[3.8, 1, 1, 1.4], [7.2, 1, 1, 1.4]],
      detalhe: [[3, 0.5, 2.6, 2.2, 'claro'], [6.4, 0.5, 2.6, 2.2, 'claro'], [4, 1.5, 4, 4.5, 'claro'], [3.5, 2.5, 5, 3.5, 'claro'], [5, 2.6, 2, 0.8, 'acento'], [3, 6, 2, 1, 'acento'], [7, 6, 2, 1, 'acento']] },
    // Passarinho: amarelo, topete, bico laranja, peito claro; voa.
    passarinho: { nome: 'Passarinho', jeito: 'voa', fixa: '#f2c230', corpo: [[3, 0, 6, 1], [2, 1, 8, 4]], pernas: [[4, 5, 0.6, 2], [7.4, 5, 0.6, 2]], bracoE: [1, 2.5, 1, 1.5], bracoD: [10, 2.5, 1, 1.5],
      olhos: [[3.2, 1.3, 1, 1.3], [7.8, 1.3, 1, 1.3]],
      detalhe: [[5, -1, 1, 1, 'pele'], [6, -2, 1, 1.5, 'pele'], [3, 3.5, 6, 1.5, 'claro'], [5.2, 2.5, 1.6, 0.9, 'acento'], [4, 5, 0.6, 2, 'acento'], [7.4, 5, 0.6, 2, 'acento']] },
    // Sapinho: olhos no alto da cabeça, boca larga, barriga clara; anda pulando.
    sapinho: { nome: 'Sapinho', jeito: 'pula', fixa: '#5cb85c', corpo: [[2, 1, 8, 4], [2, 0, 3, 1], [7, 0, 3, 1]], pernas: [[1, 5, 3, 2], [8, 5, 3, 2]], bracoE: [1, 3, 1, 1], bracoD: [10, 3, 1, 1],
      olhos: [[3, 0, 1, 1.5], [8, 0, 1, 1.5]],
      detalhe: [[4, 3.4, 4, 1.6, 'claro papo'], [4, 2.4, 4, 0.4, 'escuro'], [6, 2.4, 6, 0.4, 'lingua'], [2.6, 2, 0.8, 0.5, 'rosado'], [8.6, 2, 0.8, 0.5, 'rosado']] },
    // Cogumelo: chapéu vermelho de pintas brancas, corpo creme.
    cogumelo: { nome: 'Cogumelo', jeito: 'anda', fixa: '#e5484d', corpo: [[3, -1, 6, 1], [1, 0, 10, 2], [3, 2, 6, 3]], pernas: [[4, 5, 1.5, 2], [6.5, 5, 1.5, 2]], bracoE: [2, 3, 1, 1], bracoD: [9, 3, 1, 1],
      olhos: [[4, 2.6, 1, 1.4], [7, 2.6, 1, 1.4]],
      detalhe: [[3, 2, 6, 3, 'claro'], [4, 5, 1.5, 2, 'claro'], [6.5, 5, 1.5, 2, 'claro'], [2, 3, 1, 1, 'claro'], [9, 3, 1, 1, 'claro'], [2.5, 0.3, 1.5, 1, 'claro'], [7, -0.6, 1.5, 1, 'claro'], [5.5, 0.8, 1, 0.8, 'claro']] },
    // Fantasminha: cabeça redonda, rabo em três pontas, meio transparente; voa.
    fantasma: { nome: 'Fantasminha', jeito: 'voa', fixa: '#eef0f5', corpo: [[3, 0, 6, 1], [2, 1, 8, 4]], pernas: [[2, 5, 2, 1.5], [4, 5, 1, 0.6], [5, 5, 2, 1.5], [8, 5, 2, 1.5]], bracoE: [0.5, 3, 1.5, 1], bracoD: [10, 3, 1.5, 1],
      detalhe: [[3, 1, 1, 1, 'brilho'], [4, 0.4, 1, 0.6, 'brilho'], [2, 4, 8, 1, 'sombra']] },
    // Nuvem: fofa e meio transparente; voa e muda de branco para cinza
    // conforme o humor (pensando, trabalhando, triste — aí chove).
    nuvem: { nome: 'Nuvem', jeito: 'voa', fixa: null, corpo: [[3, 0, 3, 1], [7, 0, 2, 1], [2, 1, 8, 1], [1, 2, 10, 2], [2, 4, 8, 1]], pernas: [[3, 6, 0.6, 1], [5, 6.6, 0.6, 1], [7, 6, 0.6, 1], [9, 6.6, 0.6, 1]], bracoE: [0, 2.5, 1, 1], bracoD: [11, 2.5, 1, 1],
      detalhe: [[3, 1, 2, 0.6, 'brilho'], [7, 0.3, 1, 0.5, 'brilho'], [2, 4, 8, 1, 'sombra']] },
    // Gosminha: gelatina verde transparente com brilho e bolhinha; anda pulando.
    gosma: { nome: 'Gosminha', jeito: 'pula', fixa: '#3fbf7f', corpo: [[4, 0, 4, 1], [3, 1, 6, 1], [2, 2, 8, 3]], pernas: [[1, 5, 3, 2], [4, 5, 2, 2], [6, 5, 2, 2], [8, 5, 3, 2]], bracoE: [1, 3, 1, 1], bracoD: [10, 3, 1, 1],
      detalhe: [[3, 1, 1, 1, 'brilho'], [2, 2, 1, 1, 'brilho'], [7, 4, 1, 1, 'bolha'], [5.5, 5.5, 0.6, 0.6, 'bolha'], [1, 6, 10, 1, 'sombra']] },
  };
  const PARTES = [
    ['cabeca', 'Cabeça'], ['olhos', 'Olhos'], ['rosto', 'Rosto'],
    ['pescoco', 'Pescoço'], ['corpo', 'Roupa'], ['mao', 'Na mão'],
  ];
  // [x, y, largura, altura, cor, opacidade?]
  const ITENS = {
    // --- cabeça (11) -------------------------------------------------------
    cartola: { parte: 'cabeca', nome: 'Cartola', px: [[1, -1, 10, 1, '#1b1b1f'], [3, -5, 6, 4, '#1b1b1f'], [3, -2, 6, 1, '#c0392b']] },
    bone: { parte: 'cabeca', nome: 'Boné', px: [[2, -2, 8, 2, '#2e86de'], [9, -1, 4, 1, '#1e5fa8'], [5, -3, 2, 1, '#2e86de']] },
    gorro: { parte: 'cabeca', nome: 'Gorro de lã', px: [[2, -3, 8, 2, '#e74c3c'], [2, -1, 8, 1, '#ecf0f1'], [5, -5, 2, 2, '#ecf0f1']] },
    cowboy: { parte: 'cabeca', nome: 'Chapéu de cowboy', px: [[0, -1, 12, 1, '#8e5b2e'], [3, -4, 6, 3, '#8e5b2e'], [3, -2, 6, 1, '#3d2412'], [2, -2, 1, 1, '#8e5b2e'], [9, -2, 1, 1, '#8e5b2e']] },
    coroa: { parte: 'cabeca', nome: 'Coroa', px: [[2, -2, 8, 2, '#f1c40f'], [2, -4, 1, 2, '#f1c40f'], [5, -4, 2, 2, '#f1c40f'], [9, -4, 1, 2, '#f1c40f'], [5, -2, 2, 1, '#e74c3c'], [3, -1, 1, 1, '#3498db'], [8, -1, 1, 1, '#3498db']] },
    festa: { parte: 'cabeca', nome: 'Chapéu de festa', px: [[5, -6, 2, 1, '#fdcb6e'], [4, -5, 4, 1, '#e84393'], [4, -4, 4, 1, '#fdcb6e'], [3, -3, 6, 1, '#e84393'], [3, -2, 6, 1, '#fdcb6e'], [2, -1, 8, 1, '#e84393'], [5, -7, 2, 1, '#00cec9']] },
    obra: { parte: 'cabeca', nome: 'Capacete de obra', px: [[2, -3, 8, 3, '#f39c12'], [1, -1, 10, 1, '#e67e22'], [5, -4, 2, 1, '#f39c12'], [3, -2, 1, 1, '#ffeaa7']] },
    mago: { parte: 'cabeca', nome: 'Chapéu de mago', px: [[6, -7, 2, 1, '#5b3fa8'], [5, -6, 3, 1, '#5b3fa8'], [4, -5, 4, 1, '#5b3fa8'], [4, -4, 5, 1, '#5b3fa8'], [3, -3, 6, 1, '#5b3fa8'], [3, -2, 6, 1, '#5b3fa8'], [1, -1, 10, 1, '#4a3290'], [6, -4, 1, 1, '#f1c40f'], [4, -2, 1, 1, '#f1c40f']] },
    fones: { parte: 'cabeca', nome: 'Fones de ouvido', px: [[2, -2, 8, 1, '#2d3436'], [1, -1, 1, 2, '#2d3436'], [10, -1, 1, 2, '#2d3436'], [0, 0, 2, 2, '#636e72'], [10, 0, 2, 2, '#636e72']] },
    tiara: { parte: 'cabeca', nome: 'Tiara de flores', px: [[2, -1, 8, 1, '#27ae60'], [3, -2, 1, 1, '#ff6b9d'], [5, -2, 1, 1, '#fdcb6e'], [7, -2, 1, 1, '#ff6b9d'], [9, -2, 1, 1, '#a29bfe']] },
    antena: { parte: 'cabeca', nome: 'Antena', px: [[6, -3, 1, 3, '#2d3436'], [5, -5, 3, 2, '#e74c3c'], [5, -5, 1, 1, '#ff7675']] },
    // --- olhos (4) ---------------------------------------------------------
    oculos: { parte: 'olhos', nome: 'Óculos', px: [[2, 1, 3, 2, '#dfe6e9', 0.45], [7, 1, 3, 2, '#dfe6e9', 0.45], [5, 1, 2, 1, '#2d3436'], [2, 0.6, 3, 0.4, '#2d3436'], [7, 0.6, 3, 0.4, '#2d3436']] },
    escuros: { parte: 'olhos', nome: 'Óculos escuros', px: [[2, 1, 3, 2, '#111'], [7, 1, 3, 2, '#111'], [5, 1, 2, 1, '#111'], [2, 1, 1, 1, '#555']] },
    monoculo: { parte: 'olhos', nome: 'Monóculo', px: [[7, 1, 3, 2, '#dfe6e9', 0.5], [7, 0.6, 3, 0.4, '#f1c40f'], [9, 3, 1, 2, '#f1c40f']] },
    tapaolho: { parte: 'olhos', nome: 'Tapa-olho', px: [[7, 1, 3, 2, '#111'], [2, 0, 5, 1, '#111'], [10, 0, 1, 1, '#111']] },
    // --- rosto (3) ---------------------------------------------------------
    bigode: { parte: 'rosto', nome: 'Bigode', px: [[3, 3, 6, 1, '#3d2412'], [2, 4, 2, 1, '#3d2412'], [8, 4, 2, 1, '#3d2412']] },
    enrolado: { parte: 'rosto', nome: 'Bigode enrolado', px: [[4, 3, 4, 1, '#3d2412'], [3, 4, 1, 1, '#3d2412'], [8, 4, 1, 1, '#3d2412'], [2, 3, 1, 1, '#3d2412'], [9, 3, 1, 1, '#3d2412']] },
    bochechas: { parte: 'rosto', nome: 'Bochechas coradas', px: [[2, 3, 1, 1, '#ff7675', 0.85], [9, 3, 1, 1, '#ff7675', 0.85]] },
    // --- pescoço (3) -------------------------------------------------------
    gravata: { parte: 'pescoco', nome: 'Gravata', px: [[5, 4, 2, 1, '#922b21'], [5, 5, 2, 1, '#c0392b'], [5, 6, 2, 1, '#c0392b']] },
    borboleta: { parte: 'pescoco', nome: 'Gravata-borboleta', px: [[3, 4, 2, 1, '#c0392b'], [5, 4, 2, 1, '#922b21'], [7, 4, 2, 1, '#c0392b']] },
    cachecol: { parte: 'pescoco', nome: 'Cachecol', px: [[2, 4, 8, 1, '#e74c3c'], [8, 5, 2, 2, '#e74c3c'], [8, 6, 2, 1, '#ecf0f1']] },
    // --- roupa (5) ---------------------------------------------------------
    capa: { parte: 'corpo', nome: 'Capa de herói', atras: true, px: [[1, 0, 10, 5, '#c0392b'], [1, 5, 1, 1, '#c0392b'], [10, 5, 1, 1, '#c0392b'], [4, 4, 4, 1, '#f1c40f']] },
    colete: { parte: 'corpo', nome: 'Colete', px: [[2, 2, 2, 3, '#6c5ce7'], [8, 2, 2, 3, '#6c5ce7'], [7, 3, 1, 1, '#f1c40f']] },
    avental: { parte: 'corpo', nome: 'Avental', px: [[3, 2, 6, 3, '#ecf0f1'], [3, 1, 1, 1, '#ecf0f1'], [8, 1, 1, 1, '#ecf0f1'], [5, 3, 2, 1, '#b2bec3']] },
    jaleco: { parte: 'corpo', nome: 'Jaleco', px: [[2, 2, 2, 3, '#ffffff'], [8, 2, 2, 3, '#ffffff'], [8, 3, 1, 1, '#74b9ff'], [3, 3, 1, 1, '#0984e3']] },
    camisa: { parte: 'corpo', nome: 'Camisa de time', px: [[2, 3, 8, 2, '#00b894'], [2, 3, 8, 0.5, '#ffffff'], [5, 3.5, 2, 1, '#ffffff']] },
    // --- na mão (4) --------------------------------------------------------
    caneca: { parte: 'mao', nome: 'Caneca de café', px: [[12, 1, 2, 3, '#ecf0f1'], [14, 2, 1, 1, '#ecf0f1'], [12, 1, 2, 1, '#6d4c41'], [12, -1, 1, 1, '#b2bec3', 0.6], [13, -2, 1, 1, '#b2bec3', 0.4]] },
    varinha: { parte: 'mao', nome: 'Varinha mágica', px: [[12, -1, 1, 4, '#5d4037'], [12, -2, 1, 1, '#f1c40f'], [13, -3, 1, 1, '#fdcb6e'], [11, -3, 1, 1, '#fdcb6e']] },
    notebook: { parte: 'mao', nome: 'Notebook', px: [[12, 0, 3, 3, '#636e72'], [12.4, 0.4, 2.2, 2.2, '#74b9ff'], [11, 3, 4, 1, '#b2bec3']] },
    balao: { parte: 'mao', nome: 'Balão', px: [[12, 0, 0.5, 3, '#b2bec3'], [11, -4, 3, 3, '#e84393'], [11, -4, 1, 1, '#fd79a8'], [12, -1, 1, 1, '#e84393']] },
  };

  const rects = (lista) => lista.map(([x, y, w, h, c, o]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"${o ? ` opacity="${o}"` : ''}/>`).join('');
  const item = (id) => (ITENS[id] ? `<g class="item item-${id}">${rects(ITENS[id].px)}</g>` : '');

  // visual: { cor, itens: { parte: id } }
  function limpar(v) {
    const itens = {};
    for (const [p] of PARTES) { const id = v && v.itens && v.itens[p]; if (ITENS[id] && ITENS[id].parte === p) itens[p] = id; }
    return { especie: ESPECIES[v?.especie] ? v.especie : 'bicho', cor: CORES.some((c) => c[0] === v?.cor) ? v.cor : 'padrao', itens };
  }

  function svg(visual) {
    const v = limpar(visual);
    const e0 = ESPECIES[v.especie];
    // Cor própria da espécie; só o Clássico usa a cor escolhida.
    const cor = 'fixa' in e0 ? e0.fixa : CORES.find((c) => c[0] === v.cor)[2];
    const it = (p) => item(v.itens[p]);
    const atras = v.itens.corpo && ITENS[v.itens.corpo].atras;
    const e = ESPECIES[v.especie];
    // O rabo (peças com a classe "rabo") vai num grupo só, para balançar inteiro.
    const rabo = (e.detalhe || []).filter((d) => /\brabo\b/.test(d[4]));
    const r = ([x, y, w, h], cls) => `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
    return `<svg class="pet-svg especie-${v.especie}${'fixa' in e ? ' cor-fixa' : ''}" viewBox="-3 -7 18 14" shape-rendering="crispEdges" aria-hidden="true"${cor ? ` style="--pet-cor:${cor}"` : ''}>
      ${atras ? it('corpo') : ''}
      ${e.pernas.map((p, i) => r(p, `perna p${i + 1}`)).join('')}
      <g class="pet-corpo">
        ${(Array.isArray(e.bracoE[0]) ? e.bracoE : [e.bracoE]).map((p) => r(p, 'braco braco-e pele')).join('')}
        ${e.corpo.map((c) => r(c, 'pele')).join('')}
        ${(e.detalhe || []).filter((d) => !/\brabo\b/.test(d[4])).map(([x, y, w, h, cls]) => r([x, y, w, h], cls)).join('')}
        ${rabo.length ? `<g class="rabo">${rabo.map(([x, y, w, h, cls]) => r([x, y, w, h], cls.replace(/\s*\brabo\b/, ''))).join('')}</g>` : ''}
        ${atras ? '' : it('corpo')}
        <g class="olhos">${(e.olhos || [[3, 1, 1, 2], [8, 1, 1, 2]]).map(([x, y, w, h]) => `<rect class="olho" x="${x}" y="${y}" width="${w}" height="${h}"/>`).join('')}</g>
        ${it('rosto')}${it('pescoco')}${it('olhos')}${it('cabeca')}
        <g class="braco braco-d">${(Array.isArray(e.bracoD[0]) ? e.bracoD : [e.bracoD]).map((p) => r(p, 'pele')).join('')}${it('mao')}</g>
      </g>
    </svg>`;
  }

  // Miniatura de um item sozinho (para o guarda-roupa).
  function miniatura(id) {
    const i = ITENS[id];
    if (!i) return '';
    return `<svg class="pet-mini" viewBox="-3 -7 18 14" shape-rendering="crispEdges" aria-hidden="true"><rect x="2" y="0" width="8" height="5" class="pele fantasma"/>${rects(i.px)}</svg>`;
  }

  window.petVisual = { CORES, PARTES, ITENS, ESPECIES, svg, miniatura, limpar };
})();
