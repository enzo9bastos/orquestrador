// Página do Google Meet: quem participa e quem está falando, para a nota da reunião gravada pelo
// App de Orquestração levar o nome de cada um. Só trabalha enquanto o app grava (pergunta ao fundo
// da extensão a cada 3 s). Não grava áudio, não guarda o texto da legenda: manda só nomes.
//
// De onde vem cada coisa (a página do Meet muda; o que está aqui foi conferido em código de
// extensões abertas que fazem o mesmo, atualizadas em nov/2026):
//   participantes  os quadros de vídeo têm [data-participant-id]; o nome está num
//                  span.notranslate dentro do quadro; o da própria pessoa, em [data-self-name].
//   quem fala      a legenda do Meet (div[role=region][tabindex="0"]) põe o nome de quem fala
//                  antes do texto. Quando a legenda muda, quem fala é o nome logo antes do texto
//                  que mudou (como lê a TranscripTonic); vale primeiro o que bate com um quadro.
//   legenda        se estiver desligada, liga com a tecla "c" (o atalho do Meet) e esconde da tela
//                  (fica transparente: os outros não veem nada, e o texto continua chegando).
//                  Quando a gravação acaba, desliga de novo se foi a extensão que ligou.
(() => {
  const T = globalThis.__orqMeetTeste || {};
  const POR_ESTADO_MS = T.estadoMs || 3000;
  const POR_QUADROS_MS = T.quadrosMs || 1000;
  const REPETIR_FALANDO_MS = T.falandoMs || 700;
  const mandar = (m) => { try { chrome.runtime.sendMessage(m); } catch { /* extensão recarregada */ } };
  const perguntar = () => new Promise((ok) => {
    try { chrome.runtime.sendMessage({ t: 'estado' }, (r) => { void chrome.runtime.lastError; ok(r || {}); }); } catch { ok({}); }
  });

  let gravando = false;
  let ligamosLegenda = false;
  let tentativasLegenda = 0;
  let regiao = null;
  let observador = null;
  let ultimoNomes = '';
  let ultimoParticipantesEm = 0;
  const ultimoFalando = new Map();
  const ESTILO_ID = 'orq-meet-esconde-legenda';

  // --- participantes -------------------------------------------------------------------------
  const lixo = (n) => n.length < 2 || n.length > 80 || /^Google Participant \(|spaces\/|devices\//.test(n) || /let participants|send messages|turn on captions/i.test(n);
  function eu() {
    const e = document.querySelector('[data-self-name]');
    const n = e && (e.getAttribute('data-self-name') || '').trim();
    return n || null;
  }
  function participantes() {
    const nomes = new Set();
    for (const q of document.querySelectorAll('[data-participant-id]')) {
      const s = q.querySelector('span.notranslate');
      let n = s ? s.textContent.trim() : '';
      if (!n) { const a = q.querySelector('[data-self-name]'); n = a ? (a.getAttribute('data-self-name') || '').trim() : ''; }
      if (n && !lixo(n)) nomes.add(n);
    }
    const proprio = eu();
    if (proprio) nomes.add(proprio);
    return { nomes: [...nomes].sort(), eu: proprio };
  }
  function mandarParticipantes(forcar = false) {
    const p = participantes();
    if (!p.nomes.length) return;
    const chave = JSON.stringify(p);
    if (!forcar && chave === ultimoNomes && Date.now() - ultimoParticipantesEm < 30000) return;
    ultimoNomes = chave;
    ultimoParticipantesEm = Date.now();
    mandar({ t: 'participantes', nomes: p.nomes, eu: p.eu });
  }

  // --- legenda: ligar, esconder, desligar ----------------------------------------------------
  function botaoLegenda() {
    for (const i of document.querySelectorAll('.google-symbols, i, span')) {
      const t = (i.textContent || '').trim();
      if (t !== 'closed_caption_off' && t !== 'closed_caption' && t !== 'translate_cc') continue;
      const b = i.closest('button');
      if (b) return b;
    }
    return null;
  }
  const legendaLigada = () => { const b = botaoLegenda(); return b ? b.getAttribute('aria-pressed') === 'true' : null; };
  function apertarC() {
    const alvo = document.body;
    for (const tipo of ['keydown', 'keyup']) alvo.dispatchEvent(new KeyboardEvent(tipo, { key: 'c', code: 'KeyC', keyCode: 67, which: 67, bubbles: true, cancelable: true }));
  }
  function garantirLegenda() {
    const l = legendaLigada();
    if (l === null || l === true) { tentativasLegenda = 0; return; }
    // Desligada: aperta "c" e confere de novo na próxima volta (às vezes o Meet ignora a tecla).
    if (tentativasLegenda >= 10) return;
    tentativasLegenda++;
    ligamosLegenda = true;
    apertarC();
  }
  function esconder(sim) {
    const atual = document.getElementById(ESTILO_ID);
    if (!sim) { if (atual) atual.remove(); return; }
    if (atual) return;
    const s = document.createElement('style');
    s.id = ESTILO_ID;
    // Só a legenda (a região que de fato mostrou nomes falando): transparente e sem receber clique.
    s.textContent = '[data-orq-legenda="1"] { opacity: 0 !important; pointer-events: none !important; }';
    (document.head || document.documentElement).appendChild(s);
  }
  function desligarSeLigamos() {
    if (ligamosLegenda && legendaLigada() === true) apertarC();
    ligamosLegenda = false;
    tentativasLegenda = 0;
  }

  // --- quem fala ------------------------------------------------------------------------------
  const ALIAS_EU = new Set(['Você', 'You', 'Vous', 'Tú', 'Du']);
  // Parece um nome: curto, sem pontuação de fim de frase.
  const pareceNome = (t) => !!t && t.length <= 60 && !/[.!?,;:]$/.test(t);
  // Os candidatos a nome que cada mudança da legenda aponta: o elemento logo antes do texto que
  // mudou (é como a legenda do Meet põe o nome antes do texto; a TranscripTonic lê assim) e, num
  // bloco novo, o primeiro texto dele.
  function candidatos(mutacoes) {
    const c = [];
    const antesDe = (no) => { const p = no && (no.nodeType === 3 ? no.parentElement : no); const a = p && p.previousElementSibling; return a ? (a.textContent || '').trim() : ''; };
    for (const m of mutacoes) {
      if (m.type === 'characterData') { c.push(antesDe(m.target)); continue; }
      for (const n of m.addedNodes || []) {
        if (n.nodeType === 3) { c.push(antesDe(n)); continue; }
        if (n.nodeType !== 1) continue;
        // Bloco inteiro novo (nome + texto): o nome é o primeiro texto dentro dele. Só o texto
        // novo dentro de um bloco que já existia: o nome é o elemento logo antes dele.
        if (n.children.length) {
          const folha = [...n.querySelectorAll('*')].find((e) => !e.children.length && (e.textContent || '').trim());
          if (folha) c.push((folha.textContent || '').trim());
        } else c.push(antesDe(n));
      }
    }
    return c.filter(pareceNome);
  }
  function nomeNaLegenda(mutacoes) {
    const conhecidos = new Set(participantes().nomes);
    const proprio = eu();
    const canon = (t) => (ALIAS_EU.has(t) && proprio ? proprio : t);
    const c = candidatos(mutacoes);
    // 1) O candidato mais recente que é o nome de um participante (ou "Você").
    for (let i = c.length - 1; i >= 0; i--) if (conhecidos.has(c[i]) || ALIAS_EU.has(c[i])) return canon(c[i]);
    // 2) O candidato mais recente, mesmo sem bater com um quadro (o Meet pode encurtar o nome).
    if (c.length) return canon(c[c.length - 1]);
    // 3) O último nome de participante que aparece na legenda.
    let achado = null;
    for (const el of regiao.querySelectorAll('*')) {
      if (el.children.length) continue;
      const t = (el.textContent || '').trim();
      if (t && (conhecidos.has(t) || ALIAS_EU.has(t))) achado = canon(t);
    }
    return achado;
  }
  function aoMudarLegenda(mutacoes) {
    if (!gravando || !regiao) return;
    const quem = nomeNaLegenda(mutacoes);
    if (!quem) return;
    regiao.setAttribute('data-orq-legenda', '1');
    const agora = Date.now();
    if (agora - (ultimoFalando.get(quem) || 0) < REPETIR_FALANDO_MS) return;
    ultimoFalando.set(quem, agora);
    mandar({ t: 'falando', quem });
  }
  function vigiarLegenda() {
    const r = document.querySelector('div[role="region"][tabindex="0"]');
    if (r === regiao) return;
    if (observador) observador.disconnect();
    regiao = r;
    observador = null;
    if (!r) return;
    observador = new MutationObserver(aoMudarLegenda);
    observador.observe(r, { childList: true, subtree: true, characterData: true });
  }

  // --- laço -----------------------------------------------------------------------------------
  const naLigacao = () => !!document.querySelector('[data-participant-id]');
  async function verEstado() {
    const r = await perguntar();
    const antes = gravando;
    gravando = !!r.gravando && naLigacao();
    if (gravando) { garantirLegenda(); esconder(true); vigiarLegenda(); mandarParticipantes(!antes); }
    else if (antes) { esconder(false); desligarSeLigamos(); if (regiao) regiao.removeAttribute('data-orq-legenda'); }
  }
  setInterval(verEstado, POR_ESTADO_MS);
  setInterval(() => { if (gravando) { mandarParticipantes(); vigiarLegenda(); } }, POR_QUADROS_MS);
  verEstado();
  if (T.expor) T.expor({ participantes, eu, legendaLigada, estado: () => ({ gravando, ligamosLegenda, tentativasLegenda, regiao: !!regiao }) });
})();
