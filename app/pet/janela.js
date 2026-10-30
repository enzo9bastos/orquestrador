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

  const classe = (c, sim = true) => pet.classList.toggle(c, sim);
  function falar(texto, ms = 2200, acoes = []) {
    clearTimeout(tBolha);
    $('bolha-texto').textContent = texto;
    $('bolha-acoes').innerHTML = acoes.map((a, i) => `<button type="button" class="${i ? 'botao-texto' : 'botao primario'}" data-acao="${a[0]}">${esc(a[1])}</button>`).join('');
    $('bolha').hidden = false;
    if (ms) tBolha = setTimeout(() => { $('bolha').hidden = true; }, ms);
  }
  const calar = () => { clearTimeout(tBolha); $('bolha').hidden = true; };

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
    if (a === 'ver') { A.enviar({ t: 'abrirApp' }); A.enviar({ t: 'irEmbora' }); }
    else if (a === 'depois') A.enviar({ t: 'irEmbora' });
    else if (a === 'abrir') A.enviar({ t: 'abrirApp', conversa: 'ajudante' });
  });
  let tCarinho = null;
  pet.addEventListener('pointerenter', () => { tCarinho = setTimeout(() => { classe('feliz'); const c = pet.querySelector('.pet-coracao'); c.hidden = false; c.classList.remove('sobe'); void c.offsetWidth; c.classList.add('sobe'); }, 600); });
  pet.addEventListener('pointerleave', () => { clearTimeout(tCarinho); classe('feliz', false); });

  // --- mensagens do processo -----------------------------------------------
  A.aoMsg((m) => {
    if (m.t === 'visual') {
      vira.innerHTML = window.petVisual.svg(m.visual);
      document.documentElement.dataset.theme = m.tema || 'dark';
      if (m.destaque) document.documentElement.style.setProperty('--claude', m.destaque);
    } else if (m.t === 'andando') {
      classe('andando', m.ligado);
      if (m.lado) vira.classList.toggle('virado', m.lado === 'esq');
    } else if (m.t === 'conversar') {
      classe('acenando'); setTimeout(() => classe('acenando', false), 1200);
      abrirConversa();
      if (m.capturar) capturar();
    } else if (m.t === 'pendencia') {
      classe('chamando');
      falar(m.texto, 0, [['ver', 'Ver no app'], ['depois', 'Depois']]);
    } else if (m.t === 'falar') falar(m.texto, 1800);
    else if (m.t === 'tchau') { calar(); $('menu').hidden = true; $('conversa').hidden = true; classe('chamando', false); classe('acenando'); falar('Tchau!', 900); setTimeout(() => classe('acenando', false), 1400); }
    else if (m.t === 'gesto') { const g = sorteia(['dancando', 'acenando', 'sentado', 'espreguicando']); classe(g); setTimeout(() => classe(g, false), 2000); }
    else if (m.t === 'pousou') classe('voando', false);
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
