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
  // Anexos do recado que espera aprovação: miniatura pequena de cada imagem (clique amplia dentro
  // do balão), nome e tamanho do PDF e o aviso do link. Imagem que não deu para montar: manda abrir
  // a aba Recados e não oferece Aprovar (nunca aprova às cegas). O #pg-corpo não é traduzido
  // sozinho, então cada texto passa por tr().
  const tr = (x) => (window.orqI18n ? window.orqI18n.t(x) : x);
  const tam = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 102.4) / 10} KB` : `${Math.round(b / 104857.6) / 10} MB`);
  function blocoAnexos(it) {
    if (!it.anexos || !it.anexos.length) return { html: '', semMiniatura: false };
    const semMiniatura = it.anexos.some((x) => x.imagem && !x.dataUrl);
    const d = (it.avisoAnexo || {}).dias || 7;
    const mb = (it.avisoAnexo || {}).mb || 5;
    const itens = it.anexos.map((x) => (x.imagem && x.dataUrl
      ? `<figure class="aj-rc-anexo"><img class="aj-rc-mini" src="${esc(x.dataUrl)}" alt="" data-ampliar title="${esc(tr('Clique para ampliar'))}"><figcaption>${esc(x.nome)} · ${esc(tam(x.bytes))}</figcaption></figure>`
      : x.imagem ? `<p class="aj-motivo">${esc(x.nome)} — ${esc(tr('não deu para mostrar a imagem'))}</p>`
      : `<p class="aj-motivo">📄 ${esc(x.nome)} · ${esc(tam(x.bytes))}</p>`)).join('');
    const aviso = d === 1 ? 'Quem tiver o link abre por 1 dia: não mande print com senha, token ou dado pessoal ou de cliente; recorte a tela antes.' : `Quem tiver o link abre por ${d} dias: não mande print com senha, token ou dado pessoal ou de cliente; recorte a tela antes.`;
    return { semMiniatura, html: `<div class="aj-rc-anexos">${itens}</div><p class="aj-rc-aviso"><strong>${esc(tr(aviso))}</strong> ${esc(tr(`Cada arquivo pode ter até ${mb} MB. Das imagens, o app tira os metadados (EXIF, GPS, texto); o PDF vai como está.`))}</p>`
      + (semMiniatura ? `<p class="aj-erro">${esc(tr('Abra na aba Recados para ver a imagem antes de aprovar.'))}</p>` : '') };
  }
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
    else if (!$('reuniao').hidden) fecharReuniao();
    else if (!$('conversa').hidden) fecharConversa();
  });

  // --- bichinho: clique, dois cliques, arrastar, botão direito -------------
  let apertou = null;
  pet.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    apertou = { x: ev.screenX, y: ev.screenY, ux: ev.screenX, uy: ev.screenY, t: Date.now(), moveu: false, rastro: [{ x: ev.screenX, y: ev.screenY, t: performance.now() }] };
    pet.setPointerCapture(ev.pointerId);
  });
  pet.addEventListener('pointermove', (ev) => {
    if (!apertou) return;
    const dx = ev.screenX - apertou.ux, dy = ev.screenY - apertou.uy;
    if (!apertou.moveu && Math.hypot(ev.screenX - apertou.x, ev.screenY - apertou.y) < 5) return;
    if (!apertou.moveu) { apertou.moveu = true; classe('arrastado'); falar(sorteia(['Uiii!', 'Para onde vamos?', 'Ei!']), 1200); }
    apertou.ux = ev.screenX; apertou.uy = ev.screenY;
    // O rastro dos últimos 120 ms dá a velocidade do arremesso ao soltar.
    const agora = performance.now();
    apertou.rastro.push({ x: ev.screenX, y: ev.screenY, t: agora });
    while (apertou.rastro.length > 2 && agora - apertou.rastro[0].t > 120) apertou.rastro.shift();
    A.enviar({ t: 'arrastar', dx, dy });
  });
  pet.addEventListener('pointerup', () => {
    if (!apertou) return;
    const foi = apertou;
    apertou = null;
    classe('arrastado', false);
    if (foi.moveu) {
      // Velocidade do gesto (px/s): parou antes de soltar, sai sem impulso e só cai.
      const r = foi.rastro, a = r[0], b = r[r.length - 1];
      const dt = (b.t - a.t) / 1000;
      const parou = performance.now() - b.t > 120;
      const vx = dt > 0.008 && !parou ? (b.x - a.x) / dt : 0;
      const vy = dt > 0.008 && !parou ? (b.y - a.y) / dt : 0;
      classe('voando'); A.enviar({ t: 'soltar', vx, vy });
      return;
    }
    // Clique: pula e fala.
    classe('feliz'); setTimeout(() => classe('feliz', false), 900);
    if (rn.gravando && $('reuniao').hidden && $('conversa').hidden) { abrirReuniao('gravando'); return; }
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
    else if (m === 'reuniao') abrirReuniao();
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
    else if (a === 'nota' && rnUltima) pedirReuniao('abrir', { caminho: rnUltima.nota });
    else if (a === 'rn-gravar') { pedirReuniao('comecar', { titulo: '' }); falar(tr('Gravando. Avise as pessoas da reunião que ela está sendo gravada.'), 4000); }
    else if (a === 'rn-terminar') { pedirReuniao('terminar'); }
    else if (a === 'rn-painel') abrirReuniao('gravando');
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
    if (it.tipo === 'pergunta' && it.perguntas.some((x) => x && x.isSecret)) {
      // Resposta secreta nunca é digitada aqui (o app já não manda; isto é a
      // segunda trava): só o aviso e o botão para abrir o app.
      $('pg-passo').textContent = '';
      // O #pg-corpo é área de conteúdo (o tradutor não mexe): o aviso, que é
      // texto do app, já vai traduzido.
      const aviso = 'Pergunta com resposta secreta: responda no app.';
      $('pg-corpo').innerHTML = `<p class="pergunta">${esc(window.orqI18n ? window.orqI18n.t(aviso) : aviso)}</p>`;
      $('pg-acoes').innerHTML = '<button type="button" class="botao primario" data-pg="app">Abrir no app</button>';
    } else if (it.tipo === 'pergunta') {
      const q = it.perguntas[pg.i];
      // Pergunta já respondida (a pessoa voltou com "‹ Voltar", ou avançou de novo depois de
      // mudar uma de antes): a resposta dela aparece marcada, ou no campo, se foi escrita.
      const rotulos = (q.options || []).map((o) => o.label);
      const anterior = pg.respostas[chaveDa(q)];
      let escolhida = null, escrita = '';
      if (typeof anterior === 'string' && !pg.marcadas.size) {
        if (q.multiSelect) {
          const partes = anterior.split(', ');
          if (partes.every((x) => rotulos.includes(x))) pg.marcadas = new Set(partes); else escrita = anterior;
        } else if (rotulos.includes(anterior)) escolhida = anterior; else escrita = anterior;
      }
      $('pg-passo').textContent = [it.perguntas.length > 1 ? `pergunta ${pg.i + 1} de ${it.perguntas.length}` : '', q.multiSelect ? 'pode marcar mais de uma' : ''].filter(Boolean).join(' · ');
      $('pg-corpo').innerHTML = `${q.header ? `<p class="aj-cabeca">${esc(q.header)}</p>` : ''}<p class="pergunta">${esc(q.question)}</p>
        <div class="aj-opcoes">${(q.options || []).map((o) => { const m = pg.marcadas.has(o.label) || escolhida === o.label; return `<button type="button" class="aj-opcao${m ? ' marcada' : ''}" data-op="${esc(o.label)}"${q.multiSelect ? '' : ` aria-pressed="${m}"`}><strong>${esc(o.label)}</strong>${o.description ? `<small>${esc(o.description)}</small>` : ''}</button>`; }).join('')}</div>
        <textarea id="pg-outra" rows="2" placeholder="Outra resposta… (Enter envia)">${esc(escrita)}</textarea>${erro ? `<p class="aj-erro">${esc(erro)}</p>` : ''}`;
      // "‹ Voltar" a partir da 2ª pergunta: nada é enviado antes da última.
      $('pg-acoes').innerHTML = `${pg.i > 0 ? '<button type="button" class="botao-texto aj-voltar" data-pg="voltar">‹ Voltar</button>' : ''}<button type="button" class="botao-texto" data-pg="app">Abrir no app</button>${q.multiSelect ? '<button type="button" class="botao primario" data-pg="confirmar">Confirmar</button>' : ''}`;
    } else if (it.tipo === 'aprovacao') {
      // Algo que só sai (ou só roda) com o seu sim: decide aqui mesmo.
      $('pg-passo').textContent = 'espera você aprovar';
      const anexos = blocoAnexos(it);
      $('pg-corpo').innerHTML = `<p class="pergunta">${it.canal ? `Recado para ${esc(it.quem)}` : `Pedido ao ${esc(it.quem)}`}</p>${it.titulo ? `<p><strong>${esc(it.titulo)}</strong></p>` : ''}<pre class="aj-comando aj-recado">${esc(it.texto)}</pre>${it.motivo ? `<p class="aj-motivo">${esc(it.motivo)}</p>` : ''}${anexos.html}
        <textarea id="pg-nota" rows="2" placeholder="Orientação ou motivo (opcional)"></textarea>${erro ? `<p class="aj-erro">${esc(erro)}</p>` : ''}`;
      $('pg-acoes').innerHTML = '<button type="button" class="botao-texto" data-pg="app">Abrir no app</button><button type="button" class="botao-texto" data-pg="negar">Negar</button>' + (anexos.semMiniatura ? '' : '<button type="button" class="botao primario" data-pg="permitir">Aprovar</button>');
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
  // A chave da resposta: pelo id quando há (duas perguntas iguais não colidem).
  const chaveDa = (q) => (q.id != null ? q.id : q.question);
  // Uma resposta por pergunta; na última, manda tudo.
  function proxima(resposta) {
    const q = pg.item.perguntas[pg.i];
    pg.respostas[chaveDa(q)] = resposta;
    pg.marcadas = new Set();
    if (pg.i + 1 < pg.item.perguntas.length) { pg.i++; desenharPergunta(); return; }
    enviarResposta({ respostas: pg.respostas });
  }
  function enviarResposta(r) {
    $('pg-acoes').innerHTML = '<span class="nota pensando-pontos">Enviando</span>';
    pg.enviando = true;
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
    const ampliar = ev.target.closest('[data-ampliar]');
    if (ampliar) { ampliar.closest('.aj-rc-anexo').classList.toggle('grande'); return; }
    const cp = ev.target.closest('[data-copiar]');
    if (cp) { A.enviar({ t: 'copiar', texto: pg.item.comandos[Number(cp.dataset.copiar)] }); cp.textContent = 'Copiado'; setTimeout(() => { cp.textContent = 'Copiar'; }, 1500); return; }
    const a = ev.target.closest('[data-pg]')?.dataset.pg;
    if (a === 'feito') { enviarResposta({ feito: true }); return; }
    // Volta uma pergunta: as respostas já dadas ficam guardadas e aparecem marcadas.
    if (a === 'voltar') { if (pg.i > 0 && !pg.enviando) { pg.i--; pg.marcadas = new Set(); desenharPergunta(); } return; }
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

  // --- modo reunião --------------------------------------------------------------
  // O app grava (reuniao.js); aqui só se pede e se mostra. Enquanto grava, o bichinho fica com o
  // sinal vermelho e o tempo; o painel tem Print, Marcar momento e Terminar (com confirmação).
  let rn = { gravando: false }; // último estado vindo do app
  let rnTela = 'inicio'; // inicio | gravando | terminar | montando | pronta
  let rnUltima = null; // { nota, pasta, assunto } da última nota pronta
  let rnPedido = 0;
  let rnMini = null; // miniatura da tela ou janela que os prints mostram
  let visualAtual = null;
  // Gravando, ele segura a câmera (no lugar do que estiver na mão), com a luz vermelha piscando.
  function desenharVisual() {
    if (!visualAtual) return;
    const v = rn.gravando ? { ...visualAtual, itens: { ...(visualAtual.itens || {}), mao: 'camera' } } : visualAtual;
    vira.innerHTML = window.petVisual.svg(v);
  }
  let tRec = null;
  const relogio = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0'); const ss = String(s % 60).padStart(2, '0'); return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`; };
  function pintarRec() {
    $('rec').hidden = !rn.gravando;
    if (pet.classList.contains('gravando') !== !!rn.gravando) { classe('gravando', !!rn.gravando); desenharVisual(); }
    // Balão de pensamento com a câmera: um clique tira o print na hora (com os prints ligados).
    $('pensa-print').hidden = !(rn.gravando && rn.printsLigados !== false);
    $('pensa-n').hidden = !rn.prints;
    $('pensa-n').textContent = rn.prints ? String(rn.prints) : '';
    $('menu-reuniao').textContent = rn.gravando ? tr('🎙 Reunião (gravando)') : tr('🎙 Gravar reunião');
    clearInterval(tRec);
    if (rn.gravando) {
      const tique = () => { $('rec-tempo').textContent = relogio(Date.now() - rn.inicio); if (rnTela === 'gravando' && !$('reuniao').hidden) $('rn-passo').textContent = `${tr('gravando')} · ${relogio(Date.now() - rn.inicio)}`; };
      tique();
      tRec = setInterval(tique, 1000);
    }
  }
  function abrirReuniao(tela) {
    calar(); $('menu').hidden = true; $('conversa').hidden = true;
    if (tela) rnTela = tela; else if (rn.gravando) rnTela = 'gravando'; else if (rn.processando && rn.processando.length) rnTela = 'montando'; else if (rnTela !== 'pronta') rnTela = 'inicio';
    $('reuniao').hidden = false;
    A.enviar({ t: 'abrirConversa' });
    desenharReuniao();
  }
  function fecharReuniao() { $('reuniao').hidden = true; A.enviar({ t: 'fecharConversa' }); }
  function pedirReuniao(acao, dados = {}) { A.enviar({ t: 'reuniao', acao, id: ++rnPedido, ...dados }); }
  function desenharReuniao(erro) {
    const corpo = $('rn-corpo');
    const acoes = $('rn-acoes');
    const msgErro = erro ? `<p class="aj-erro">${esc(erro)}</p>` : '';
    if (rnTela === 'inicio') {
      $('rn-titulo').textContent = tr('Gravar reunião');
      $('rn-passo').textContent = '';
      corpo.innerHTML = `<label class="rn-campo"><span>${esc(tr('Título (opcional)'))}</span><input id="rn-nome" type="text" maxlength="120" placeholder="${esc(tr('Ex.: Alinhamento com o financeiro'))}"></label>
        <p class="aj-motivo rn-aviso">${esc(tr('Avise as pessoas da reunião que ela está sendo gravada.'))}</p>
        <p class="nota">${esc(tr('Para os prints, o sistema vai perguntar o que mostrar: escolha a janela da reunião (Meet, Zoom, Teams…) ou a tela onde ela está.'))}</p>
        <p class="nota">${esc(tr('Grava você (microfone) e os outros (som do computador) em separado. O áudio fica no computador; no fim, a nota sai com a transcrição, os prints e o resumo.'))}</p>${msgErro}`;
      acoes.innerHTML = `<button type="button" class="botao-texto" data-rn="fechar">${esc(tr('Cancelar'))}</button><button type="button" class="botao primario" data-rn="comecar">${esc(tr('Começar a gravar'))}</button>`;
      setTimeout(() => { const c = $('rn-nome'); if (c) c.focus(); }, 50);
    } else if (rnTela === 'gravando' || rnTela === 'terminar') {
      $('rn-titulo').textContent = rn.titulo || tr('Reunião');
      $('rn-passo').textContent = rn.gravando ? `${tr('gravando')} · ${relogio(Date.now() - rn.inicio)}` : '';
      const d = rn.dispositivos || {};
      const aparelhos = [d.voce ? `${tr('Microfone')}: ${d.voce}` : '', d.outros ? `${tr('Som do computador')}: ${d.outros}` : ''].filter(Boolean);
      corpo.innerHTML = `${aparelhos.length ? `<p class="nota rn-aparelhos">${aparelhos.map(esc).join('<br>')}</p>` : ''}
        <p class="rn-contas"><span>📷 ${rn.prints || 0}</span> <span>★ ${rn.marcas || 0}</span></p>
        ${rnMini && rn.printsLigados !== false ? `<figure class="rn-tela"><img src="${esc(rnMini)}" alt=""><figcaption><span>${esc(tr('Os prints mostram isto.'))}</span> <button type="button" class="botao-texto" data-rn="trocar-tela">${esc(tr('Trocar'))}</button></figcaption></figure>` : ''}
        ${rn.printsLigados === false ? `<p class="aj-motivo">${esc(tr('Prints desligados nesta reunião.'))}</p>` : ''}
        ${rnTela === 'terminar' ? `<p class="pergunta">${esc(tr('Terminar a reunião? A gravação para e a nota começa a ser montada.'))}</p>` : ''}${msgErro}`;
      acoes.innerHTML = rnTela === 'terminar'
        ? `<button type="button" class="botao-texto" data-rn="continuar">${esc(tr('Continuar gravando'))}</button><button type="button" class="botao primario" data-rn="terminar-sim">${esc(tr('Terminar'))}</button>`
        : `<button type="button" class="botao-texto" data-rn="print"${rn.printsLigados === false ? ' disabled' : ''}>📷 ${esc(tr('Print'))}</button><button type="button" class="botao-texto" data-rn="marcar">★ ${esc(tr('Marcar momento'))}</button><button type="button" class="botao secundario" data-rn="terminar">⏹ ${esc(tr('Terminar'))}</button>`;
    } else if (rnTela === 'montando') {
      const p = (rn.processando || [])[0];
      $('rn-titulo').textContent = tr('Montando a nota');
      $('rn-passo').textContent = '';
      corpo.innerHTML = p ? `<p>${esc(p.fase === 'resumindo' ? tr('Escrevendo o resumo…') : tr('Transcrevendo…'))}</p><div class="rn-barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.pct || 0}"><i style="width:${p.pct || 0}%"></i></div><p class="nota">${p.pct || 0}%</p>${msgErro}`
        : `<p>${esc(tr('Nada sendo montado agora.'))}</p>${msgErro}`;
      acoes.innerHTML = `<button type="button" class="botao-texto" data-rn="fechar">${esc(tr('Fechar'))}</button>`;
    } else if (rnTela === 'pronta') {
      $('rn-titulo').textContent = tr('Nota da reunião pronta');
      $('rn-passo').textContent = '';
      corpo.innerHTML = `<p class="pergunta">${esc((rnUltima && rnUltima.assunto) || tr('Reunião'))}</p>${msgErro}`;
      acoes.innerHTML = `<button type="button" class="botao-texto" data-rn="pasta">${esc(tr('Abrir a pasta'))}</button><button type="button" class="botao primario" data-rn="nota">${esc(tr('Abrir a nota'))}</button>`;
    }
  }
  $('rn-fechar').addEventListener('click', fecharReuniao);
  // Balão de pensamento: o clique pede o print na hora (o brilho aparece antes da resposta). Os
  // eventos param aqui: clicar nele não arrasta o bichinho nem abre o painel.
  for (const tipo of ['pointerdown', 'pointerup', 'dblclick']) $('pensa-print').addEventListener(tipo, (ev) => ev.stopPropagation());
  $('pensa-print').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const b = $('pensa-print');
    b.classList.remove('flash', 'ok'); void b.offsetWidth; b.classList.add('flash');
    pedirReuniao('print');
  });
  $('reuniao').addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-rn]')?.dataset.rn;
    if (!a) return;
    if (a === 'fechar') fecharReuniao();
    else if (a === 'comecar') { const b = ev.target.closest('button'); b.disabled = true; b.textContent = tr('Começando…'); pedirReuniao('comecar', { titulo: ($('rn-nome') || {}).value || '' }); }
    else if (a === 'print') { pedirReuniao('print'); }
    else if (a === 'marcar') { pedirReuniao('marcar'); }
    else if (a === 'terminar') { rnTela = 'terminar'; desenharReuniao(); }
    else if (a === 'continuar') { rnTela = 'gravando'; desenharReuniao(); }
    else if (a === 'terminar-sim') { rnTela = 'montando'; desenharReuniao(); pedirReuniao('terminar'); }
    else if (a === 'nota' && rnUltima) pedirReuniao('abrir', { caminho: rnUltima.nota });
    else if (a === 'pasta' && rnUltima) pedirReuniao('abrir', { caminho: rnUltima.pasta });
    else if (a === 'trocar-tela') { const b = ev.target.closest('button'); b.disabled = true; pedirReuniao('trocarTela'); }
  });
  $('reuniao').addEventListener('keydown', (ev) => {
    if (ev.target.id === 'rn-nome' && ev.key === 'Enter') { ev.preventDefault(); $('reuniao').querySelector('[data-rn=comecar]').click(); }
  });
  function aoReuniao(e) {
    if (!e) return;
    const antes = rn;
    rn = e;
    pintarRec();
    if (e.evento === 'tela') { rnMini = e.tela ? e.tela.miniatura : null; }
    else if (e.evento === 'detectada' && !e.gravando) {
      classe('chamando'); setTimeout(() => classe('chamando', false), 1500);
      if ($('reuniao').hidden) falar(`${tr('Começou uma reunião')} n${e.nome || tr('o computador')}? ${tr('Quer gravar?')}`, 0, [['rn-gravar', tr('Sim, gravar')], ['depois', tr('Agora não')]]);
      return;
    } else if (e.evento === 'comecou-sozinha') {
      classe('chamando'); setTimeout(() => classe('chamando', false), 1500);
      if ($('reuniao').hidden) falar(`${tr('Comecei a gravar a reunião')} n${e.nome || tr('o computador')}. ${tr('Avise as pessoas que ela está sendo gravada.')}`, 0, [['depois', 'OK'], ['rn-painel', tr('Abrir o painel')]]);
    } else if (e.evento === 'acabou' && e.gravando) {
      classe('chamando'); setTimeout(() => classe('chamando', false), 1500);
      calar();
      falar(`${tr('A ligação')} n${e.nome || tr('o computador')} ${tr('acabou? Terminar a gravação?')}`, 0, [['rn-terminar', tr('Terminar')], ['depois', tr('Continuar gravando')]]);
      return;
    }
    if (!e.gravando) rnMini = null; // parou de gravar: a tela compartilhada foi solta
    if (e.evento === 'comecou') { classe('feliz'); setTimeout(() => classe('feliz', false), 900); if (!$('reuniao').hidden) { rnTela = 'gravando'; } }
    else if (e.evento === 'print') {
      classe('feliz'); setTimeout(() => classe('feliz', false), 600);
      const b = $('pensa-print');
      if (!b.hidden) { b.classList.remove('ok'); void b.offsetWidth; b.classList.add('ok'); } else if ($('reuniao').hidden) falar(tr('Print guardado 📷'), 1200);
    }
    else if (e.evento === 'marca') { if ($('reuniao').hidden) falar(tr('Momento marcado ★'), 1200); }
    else if (e.evento === 'parou') { rnTela = 'montando'; }
    else if (e.evento === 'pronta') {
      rnUltima = { nota: e.nota, pasta: e.pasta, assunto: e.assunto };
      rnTela = 'pronta';
      if ($('reuniao').hidden) { classe('chamando'); setTimeout(() => classe('chamando', false), 1500); falar(`${tr('Nota da reunião pronta')}: ${e.assunto || tr('Reunião')}`, 0, [['depois', 'OK'], ['nota', tr('Abrir a nota')]]); }
    } else if (e.evento === 'falhou') { if ($('reuniao').hidden) falar(`${tr('A nota da reunião não saiu')}: ${e.erro || ''}`, 4000); else desenharReuniao(e.erro); return; }
    else if (e.evento === 'prints-off' && antes.printsLigados !== false && !$('reuniao').hidden) { desenharReuniao(); return; }
    if (!$('reuniao').hidden) desenharReuniao();
  }
  function aoReuniaoResposta(m) {
    if (m.erro) {
      if (m.acao === 'comecar') { rnTela = 'inicio'; abrirReuniao('inicio'); desenharReuniao(m.erro); }
      else if ($('reuniao').hidden) falar(m.erro, 3000); else desenharReuniao(m.erro);
      return;
    }
    if (m.acao === 'comecar') { rnTela = 'gravando'; desenharReuniao(); }
  }

  // --- mensagens do processo -----------------------------------------------
  A.aoMsg((m) => {
    if (m.t === 'visual') {
      if (m.idioma && window.orqI18n && window.orqI18n.idioma() !== m.idioma) window.orqI18n.definir(m.idioma, '../renderer/i18n/');
      visualAtual = m.visual;
      desenharVisual();
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
      if (!m.ok) { pg.enviando = false; desenharPergunta(m.erro); return; }
      fecharPergunta();
      classe('feliz'); falar('Respondido! 👍', 1400);
      setTimeout(() => { A.enviar({ t: 'avisoFechado' }); A.enviar({ t: 'irEmbora' }); }, 1500);
    } else if (m.t === 'pendencia') {
      alvoPendencia = m.conversa;
      classe('chamando');
      // Só avisar: OK dispensa; abrir o app é opcional.
      falar(m.texto, 0, [['depois', 'OK'], ['ver', 'Abrir no app']]);
    } else if (m.t === 'noApp') {
      // O usuário foi direto ao app em vez de responder aqui: o aviso sai de
      // cena. Fica se ele está conversando com o bichinho ou se já começou a
      // responder (uma pergunta respondida, opção marcada, texto escrito).
      if (!$('conversa').hidden) return;
      if (pg) {
        const escreveu = [...$('pergunta').querySelectorAll('textarea')].some((e) => e.value.trim());
        if (pg.enviando || pg.i > 0 || pg.marcadas.size || escreveu) return;
        fecharPergunta();
      } else if (!fixo || $('bolha').hidden) return; // nenhum aviso na tela (ainda chegando, ou já dispensado)
      calar(); classe('chamando', false);
      A.enviar({ t: 'avisoFechado' }); A.enviar({ t: 'irEmbora' });
    } else if (m.t === 'falar') falar(m.texto, 1800);
    else if (m.t === 'reuniao') aoReuniao(m.estado);
    else if (m.t === 'reuniaoResposta') aoReuniaoResposta(m);
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
