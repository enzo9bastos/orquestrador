// Tela da janelinha do ajudante: desenha o bichinho, o balão, o menu e a
// conversa. Quem anda pela tela é o processo (pet/main.js); aqui só se pede.
(() => {
  const $ = (id) => document.getElementById(id);
  const A = window.ajudante;
  const pet = $('pet');
  const vira = pet.querySelector('.pet-vira');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sorteia = (l) => l[Math.floor(Math.random() * l.length)];
  let imagem = null; // caminho do recorte que vai junto da próxima pergunta
  let tBolha = null;
  let alvoPendencia = null; // conversa a abrir no "Ver no app"

  const classe = (c, sim = true) => pet.classList.toggle(c, sim);
  // Floreios de cada espécie (janela.css) e quanto duram, em ms. Os de saída
  // ficam até a próxima chegada (o bichinho já sumiu quando acabam).
  const FLOREIOS = { oi: 1000, espreguica: 1500, levanta: 950, looping: 1050, quica: 750, brota: 1000, pirueta: 1050, rolinho: 1300 };
  const PERSISTENTES = ['desvanece', 'dissolve', 'afunda'];
  // Balão fixo (ms = 0: um aviso esperando você) e falas passageiras: a fala
  // passageira aparece por cima e, quando some, o aviso fixo volta.
  let fixo = null;
  function mostrarBolha(texto, acoes) {
    $('bolha-texto').textContent = texto;
    $('bolha-acoes').innerHTML = acoes.map((a, i) => `<button type="button" class="${i ? 'botao-texto' : 'botao primario'}" data-acao="${a[0]}">${esc(a[1])}</button>`).join('');
    $('bolha').hidden = false;
  }
  function falar(texto, ms = 2200, acoes = []) {
    clearTimeout(tBolha);
    if (!ms) fixo = { texto, acoes };
    mostrarBolha(texto, acoes);
    if (ms) tBolha = setTimeout(() => { if (fixo) mostrarBolha(fixo.texto, fixo.acoes); else $('bolha').hidden = true; }, ms);
  }
  const calar = () => { clearTimeout(tBolha); fixo = null; $('bolha').hidden = true; };

  // Texto da resposta: parágrafos, **negrito** e `código` (o resto, texto puro).
  function formatar(t) {
    return String(t || '').trim().split(/\n{2,}/).map((p) => `<p>${esc(p)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>')}</p>`).join('');
  }

  // --- conversa -------------------------------------------------------------
  function abrirConversa() {
    calar();
    $('menu').hidden = true;
    $('conversa').hidden = false;
    A.enviar({ t: 'abrirConversa' });
    setTimeout(() => $('texto').focus(), 50);
  }
  function fecharConversa() {
    $('conversa').hidden = true;
    A.enviar({ t: 'fecharConversa' });
  }
  function capturar() {
    falar('Recorte o pedaço da tela…', 0);
    A.enviar({ t: 'capturar' });
  }
  $('fechar').addEventListener('click', fecharConversa);
  $('capturar').addEventListener('click', capturar);
  $('abrir-app').addEventListener('click', () => A.enviar({ t: 'abrirApp', conversa: 'ajudante' }));
  $('tirar-anexo').addEventListener('click', () => { imagem = null; $('anexo').hidden = true; });
  $('form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const texto = $('texto').value.trim();
    if (!texto && !imagem) return;
    $('resposta').innerHTML = `<p class="pergunta">${esc(texto || '(só a imagem)')}</p><p class="nota pensando-pontos">Pensando</p>`;
    A.enviar({ t: 'perguntar', texto, imagem });
    $('texto').value = '';
    imagem = null; $('anexo').hidden = true;
    classe('pensando'); pet.querySelector('.pet-nuvem').hidden = false;
  });
  $('texto').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); $('form').requestSubmit(); }
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!$('menu').hidden) $('menu').hidden = true;
    else if (!$('conversa').hidden) fecharConversa();
  });

  // --- bichinho: clique, dois cliques, arrastar, botão direito -------------
  let apertou = null;
  pet.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    apertou = { x: ev.screenX, y: ev.screenY, ux: ev.screenX, uy: ev.screenY, t: Date.now(), moveu: false };
    pet.setPointerCapture(ev.pointerId);
  });
  pet.addEventListener('pointermove', (ev) => {
    if (!apertou) return;
    const dx = ev.screenX - apertou.ux, dy = ev.screenY - apertou.uy;
    if (!apertou.moveu && Math.hypot(ev.screenX - apertou.x, ev.screenY - apertou.y) < 5) return;
    if (!apertou.moveu) { apertou.moveu = true; classe('arrastado'); falar(sorteia(['Uiii!', 'Para onde vamos?', 'Ei!']), 1200); }
    apertou.ux = ev.screenX; apertou.uy = ev.screenY;
    A.enviar({ t: 'arrastar', dx, dy });
  });
  pet.addEventListener('pointerup', () => {
    if (!apertou) return;
    const foi = apertou;
    apertou = null;
    classe('arrastado', false);
    if (foi.moveu) { classe('voando'); A.enviar({ t: 'soltar' }); return; }
    // Clique: pula e fala.
    classe('feliz'); setTimeout(() => classe('feliz', false), 900);
    if ($('conversa').hidden) falar(sorteia(['Oi! Dois cliques para conversar.', 'Tô aqui!', 'Precisa de mim?', 'Hehe']), 1600);
  });
  pet.addEventListener('dblclick', abrirConversa);
  pet.addEventListener('contextmenu', (ev) => { ev.preventDefault(); $('menu').hidden = !$('menu').hidden; });
  $('menu').addEventListener('click', (ev) => {
    const m = ev.target.closest('[data-m]')?.dataset.m;
    if (!m) return;
    $('menu').hidden = true;
    if (m === 'conversar') abrirConversa();
    else if (m === 'capturar') { abrirConversa(); capturar(); }
    else if (m === 'passear') A.enviar({ t: 'passear' });
    else if (m === 'voltar') A.enviar({ t: 'voltar' });
    else if (m === 'embora') A.enviar({ t: 'irEmbora' });
  });
  $('bolha').addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-acao]')?.dataset.acao;
    if (!a) return;
    calar(); classe('chamando', false);
    A.enviar({ t: 'avisoFechado' });
    if (a === 'ver') { A.enviar({ t: 'abrirApp', conversa: alvoPendencia }); A.enviar({ t: 'irEmbora' }); }
    else if (a === 'depois') A.enviar({ t: 'irEmbora' });
    else if (a === 'abrir') A.enviar({ t: 'abrirApp', conversa: 'ajudante' });
  });
  let tCarinho = null;
  pet.addEventListener('pointerenter', () => { tCarinho = setTimeout(() => { classe('feliz'); const c = pet.querySelector('.pet-coracao'); c.hidden = false; c.classList.remove('sobe'); void c.offsetWidth; c.classList.add('sobe'); }, 600); });
  pet.addEventListener('pointerleave', () => { clearTimeout(tCarinho); classe('feliz', false); });

  // --- pergunta trazida do app: responder aqui mesmo -------------------------
  let pg = null; // { id, item, i, respostas, marcadas }
  function abrirPergunta(id, item) {
    calar(); $('menu').hidden = true; $('conversa').hidden = true;
    pg = { id, item, i: 0, respostas: {}, marcadas: new Set() };
    $('pergunta').hidden = false;
    A.enviar({ t: 'abrirConversa' });
    desenharPergunta();
  }
  function fecharPergunta() { pg = null; $('pergunta').hidden = true; A.enviar({ t: 'fecharConversa' }); }
  function desenharPergunta(erro) {
    if (!pg) return;
    const it = pg.item;
    $('pg-quem').textContent = it.quem || 'Pergunta';
    if (it.tipo === 'pergunta') {
      const q = it.perguntas[pg.i];
      $('pg-passo').textContent = [it.perguntas.length > 1 ? `pergunta ${pg.i + 1} de ${it.perguntas.length}` : '', q.multiSelect ? 'pode marcar mais de uma' : ''].filter(Boolean).join(' · ');
      $('pg-corpo').innerHTML = `${q.header ? `<p class="aj-cabeca">${esc(q.header)}</p>` : ''}<p class="pergunta">${esc(q.question)}</p>
        <div class="aj-opcoes">${(q.options || []).map((o) => `<button type="button" class="aj-opcao${pg.marcadas.has(o.label) ? ' marcada' : ''}" data-op="${esc(o.label)}"><strong>${esc(o.label)}</strong>${o.description ? `<small>${esc(o.description)}</small>` : ''}</button>`).join('')}</div>
        <textarea id="pg-outra" rows="2" placeholder="Outra resposta… (Enter envia)"></textarea>${erro ? `<p class="aj-erro">${esc(erro)}</p>` : ''}`;
      $('pg-acoes').innerHTML = `<button type="button" class="botao-texto" data-pg="app">Abrir no app</button>${q.multiSelect ? '<button type="button" class="botao primario" data-pg="confirmar">Confirmar</button>' : ''}`;
    } else if (it.tipo === 'aprovacao') {
      // Algo que só sai (ou só roda) com o seu sim: decide aqui mesmo.
      $('pg-passo').textContent = 'espera você aprovar';
      $('pg-corpo').innerHTML = `<p class="pergunta">${it.canal ? `Recado para ${esc(it.quem)}` : `Pedido ao ${esc(it.quem)}`}</p>${it.titulo ? `<p><strong>${esc(it.titulo)}</strong></p>` : ''}<pre class="aj-comando aj-recado">${esc(it.texto)}</pre>${it.motivo ? `<p class="aj-motivo">${esc(it.motivo)}</p>` : ''}
        <textarea id="pg-nota" rows="2" placeholder="Orientação ou motivo (opcional)"></textarea>${erro ? `<p class="aj-erro">${esc(erro)}</p>` : ''}`;
      $('pg-acoes').innerHTML = '<button type="button" class="botao-texto" data-pg="app">Abrir no app</button><button type="button" class="botao-texto" data-pg="negar">Negar</button><button type="button" class="botao primario" data-pg="permitir">Aprovar</button>';
    } else if (it.tipo === 'acao') {
      // O orquestrador pediu para rodar algo: mostra os comandos para copiar.
      $('pg-passo').textContent = 'pede uma ação sua';
      $('pg-corpo').innerHTML = `<p class="pergunta">Pediu para você rodar no seu computador:</p>${it.resumo ? `<p>${esc(it.resumo)}</p>` : ''}${it.comandos.map((c, i) => `<pre class="aj-comando">${esc(c)}</pre><button type="button" class="botao-texto" data-copiar="${i}">Copiar</button>`).join('')}`;
      $('pg-acoes').innerHTML = '<button type="button" class="botao-texto" data-pg="app">Abrir no app</button><button type="button" class="botao primario" data-pg="feito">Feito</button>';
    } else {
      $('pg-passo').textContent = 'pede permissão';
      $('pg-corpo').innerHTML = `<p class="pergunta">Quer usar ${esc(it.ferramenta || 'uma ferramenta')}</p>${it.descricao ? `<p>${esc(it.descricao)}</p>` : ''}${it.comando ? `<pre class="aj-comando">${esc(it.comando)}</pre>` : ''}${erro ? `<p class="aj-erro">${esc(erro)}</p>` : ''}`;
      $('pg-acoes').innerHTML = '<button type="button" class="botao-texto" data-pg="app">Abrir no app</button><button type="button" class="botao-texto" data-pg="negar">Negar</button><button type="button" class="botao primario" data-pg="permitir">Permitir</button>';
    }
  }
  // Uma resposta por pergunta; na última, manda tudo.
  function proxima(resposta) {
    const q = pg.item.perguntas[pg.i];
    pg.respostas[q.question] = resposta;
    pg.marcadas = new Set();
    if (pg.i + 1 < pg.item.perguntas.length) { pg.i++; desenharPergunta(); return; }
    enviarResposta({ respostas: pg.respostas });
  }
  function enviarResposta(r) {
    $('pg-acoes').innerHTML = '<span class="nota pensando-pontos">Enviando</span>';
    A.enviar({ t: 'responder', id: pg.id, ...r });
  }
  $('pergunta').addEventListener('click', (ev) => {
    if (!pg) return;
    if (ev.target.closest('#pg-fechar')) { fecharPergunta(); A.enviar({ t: 'avisoFechado' }); A.enviar({ t: 'irEmbora' }); return; }
    const op = ev.target.closest('[data-op]');
    if (op) {
      const q = pg.item.perguntas[pg.i];
      if (!q.multiSelect) { proxima(op.dataset.op); return; }
      if (pg.marcadas.has(op.dataset.op)) pg.marcadas.delete(op.dataset.op); else pg.marcadas.add(op.dataset.op);
      op.classList.toggle('marcada');
      return;
    }
    const cp = ev.target.closest('[data-copiar]');
    if (cp) { A.enviar({ t: 'copiar', texto: pg.item.comandos[Number(cp.dataset.copiar)] }); cp.textContent = 'Copiado'; setTimeout(() => { cp.textContent = 'Copiar'; }, 1500); return; }
    const a = ev.target.closest('[data-pg]')?.dataset.pg;
    if (a === 'feito') { enviarResposta({ feito: true }); return; }
    if (a === 'app') A.enviar({ t: 'abrirApp', conversa: alvoPendencia });
    else if (a === 'permitir' || a === 'negar') enviarResposta({ permitir: a === 'permitir', ...($('pg-nota') ? { nota: $('pg-nota').value.trim() } : {}) });
    else if (a === 'confirmar') {
      const outra = $('pg-outra')?.value.trim();
      const r = outra || [...pg.marcadas].join(', ');
      if (!r) { desenharPergunta('Marque uma opção ou escreva a resposta.'); return; }
      proxima(r);
    }
  });
  $('pergunta').addEventListener('keydown', (ev) => {
    if (ev.target.id === 'pg-outra' && ev.key === 'Enter' && !ev.shiftKey && ev.target.value.trim()) { ev.preventDefault(); proxima(ev.target.value.trim()); }
  });

  // --- mensagens do processo -----------------------------------------------
  A.aoMsg((m) => {
    if (m.t === 'visual') {
      if (m.idioma && window.orqI18n && window.orqI18n.idioma() !== m.idioma) window.orqI18n.definir(m.idioma, '../renderer/i18n/');
      vira.innerHTML = window.petVisual.svg(m.visual);
      pet.dataset.especie = window.petVisual.limpar(m.visual).especie;
      document.documentElement.dataset.theme = m.tema || 'dark';
      if (m.destaque) document.documentElement.style.setProperty('--claude', m.destaque);
    } else if (m.t === 'entrar') {
      // Começa escondido atrás da borda e sai de lá andando (o cogumelo não:
      // brota do chão onde está). Tira o que ficou da última saída.
      pet.style.transition = 'none';
      pet.classList.remove('fora-dir', 'fora-esq', ...PERSISTENTES, 'deslizando', 'pulando');
      if (m.estilo !== 'brota') pet.classList.add(m.lado === 'esq' ? 'fora-esq' : 'fora-dir');
      void pet.offsetWidth;
      pet.style.transition = '';
      pet.classList.remove('fora-dir', 'fora-esq');
    } else if (m.t === 'sair') {
      // Fica atrás da borda até a próxima chegada (que o tira de lá): assim
      // não aparece um quadro fora do lugar quando a janela volta a aparecer.
      pet.classList.add(m.lado === 'esq' ? 'fora-esq' : 'fora-dir');
    } else if (m.t === 'andando') {
      classe('andando', m.ligado);
      if (!m.ligado) classe('pulando', false);
      if (m.lado) vira.classList.toggle('virado', m.lado === 'esq');
    } else if (m.t === 'pulos') {
      // Duração de cada pulo: amassa ao tomar impulso e ao pousar, estica no ar.
      pet.style.setProperty('--pulo-ms', `${m.ms}ms`);
      classe('pulando');
    } else if (m.t === 'deslizar') {
      classe('deslizando', m.ligado);
    } else if (m.t === 'conversar') {
      classe('acenando'); setTimeout(() => classe('acenando', false), 1200);
      abrirConversa();
      if (m.capturar) capturar();
    } else if (m.t === 'pendencia' && m.item && (m.item.tipo !== 'pergunta' || (m.item.perguntas || []).length) && (m.item.tipo !== 'acao' || (m.item.comandos || []).length)) {
      alvoPendencia = m.conversa;
      classe('chamando'); setTimeout(() => classe('chamando', false), 1500);
      abrirPergunta(m.id, m.item);
    } else if (m.t === 'respondido') {
      if (!pg) return;
      if (!m.ok) { desenharPergunta(m.erro); return; }
      fecharPergunta();
      classe('feliz'); falar('Respondido! 👍', 1400);
      setTimeout(() => { A.enviar({ t: 'avisoFechado' }); A.enviar({ t: 'irEmbora' }); }, 1500);
    } else if (m.t === 'pendencia') {
      alvoPendencia = m.conversa;
      classe('chamando');
      // Só avisar: OK dispensa; abrir o app é opcional.
      falar(m.texto, 0, [['depois', 'OK'], ['ver', 'Abrir no app']]);
    } else if (m.t === 'falar') falar(m.texto, 1800);
    else if (m.t === 'tchau') { calar(); pg = null; $('pergunta').hidden = true; $('menu').hidden = true; $('conversa').hidden = true; classe('chamando', false); classe('acenando'); falar('Tchau!', 900); setTimeout(() => classe('acenando', false), 1400); }
    else if (m.t === 'gesto') { const g = sorteia(['dancando', 'acenando', 'sentado', 'espreguicando']); classe(g); setTimeout(() => classe(g, false), 2000); }
    else if (m.t === 'pousou') classe('voando', false);
    else if (m.t === 'floreio' && PERSISTENTES.includes(m.tipo)) classe(m.tipo); // fica até a próxima chegada
    else if (m.t === 'floreio' && FLOREIOS[m.tipo]) {
      classe(m.tipo, false); void pet.offsetWidth; classe(m.tipo);
      setTimeout(() => classe(m.tipo, false), FLOREIOS[m.tipo]);
      if (m.tipo === 'oi') { classe('acenando'); setTimeout(() => classe('acenando', false), 1300); }
    }
    else if (m.t === 'pensando') { classe('pensando'); pet.querySelector('.pet-nuvem').hidden = false; }
    else if (m.t === 'resposta') {
      classe('pensando', false); pet.querySelector('.pet-nuvem').hidden = true;
      if ($('conversa').hidden) abrirConversa();
      const pergunta = $('resposta').querySelector('.pergunta');
      $('resposta').innerHTML = (pergunta ? pergunta.outerHTML : '') + formatar(m.texto);
      if (m.abrir) falar('Preciso de você no app.', 0, [['abrir', 'Abrir no app']]);
      classe('feliz'); setTimeout(() => classe('feliz', false), 900);
    } else if (m.t === 'imagem') {
      calar();
      if (m.erro) { falar(m.erro, 3500); return; }
      imagem = m.caminho;
      $('miniatura').src = `file://${encodeURI(m.caminho)}`;
      $('anexo').hidden = false;
      if ($('conversa').hidden) abrirConversa();
      $('texto').focus();
      falar('Recebi! O que você quer saber disso?', 2200);
    }
  });
  A.enviar({ t: 'pronto' });
})();
