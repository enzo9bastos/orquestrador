// Ditado: falar em vez de escrever (plano de voz, V2). O microfone da caixa de mensagem, o atalho
// (dos que a pessoa troca em Configurações › Atalhos) ou a paleta ligam; o texto aparece na caixa
// enquanto a pessoa fala, no lugar onde o cursor estava; o mesmo botão, o atalho ou o Esc param.
//
// O processo principal lê o microfone e roda o motor de voz deste computador (ditado.js): aqui
// só chega texto. Cada fala chega primeiro como prévia (pode mudar) e, na pausa, como trecho
// fechado. O texto entra na caixa como texto comum (nunca como "!comando"), e quem envia é a
// pessoa: Enter manda o que está na caixa, como sempre. O microfone só abre com uma tecla ou um
// clique dela, e enquanto ele ouve o botão fica aceso e a faixa acima da caixa diz que está ouvindo.
//
// Enviar por voz (desligado até a pessoa ligar em Configurações › Voz e reuniões): a fala que
// TERMINA com a frase combinada ("enviar mensagem") manda o que está na caixa, sem a frase. Só
// vale num trecho fechado (ela disse e fez a pausa); no meio de uma frase é texto. A mensagem vai
// como texto comum: um "!comando" enviado por voz nunca roda.
(() => {
  const D = window.orq && window.orq.ditado;
  if (!D || !window.orqConversa) return;
  const V = window.orqConversa;
  const A = window.orqAtalhos;
  const $ = (id) => document.getElementById(id);
  const entrada = $('entrada');
  const botao = $('ditar');
  const faixa = $('ditando');

  let estado = 'parado'; // parado | preparando | ouvindo | terminando
  let id = null; // o ditado de agora (texto de um ditado antigo é ignorado)
  let epoca = 0; // sobe cada vez que o trecho aberto é largado (a pessoa mexeu no texto)
  let microfone = '';
  let continua = false; // Configurações › Voz e reuniões: continuar ouvindo depois de enviar
  let frases = []; // enviar por voz: as frases que mandam a mensagem (vazio = desligado)
  let antes = '', depois = ''; // o que estava na caixa antes e depois do cursor
  let fechado = '', previa = ''; // o que foi ditado: trechos fechados e a prévia do trecho aberto
  let ultimo = null; // o que o ditado escreveu na caixa por último (para notar quando mexem nela)
  const ativo = () => estado !== 'parado';

  function pintar() {
    const ligado = ativo();
    botao.classList.toggle('ligado', ligado);
    botao.classList.toggle('preparando', estado === 'preparando' || estado === 'terminando');
    botao.setAttribute('aria-pressed', ligado ? 'true' : 'false');
    botao.title = ligado ? 'Parar de ouvir' : 'Ditar: fale e o texto aparece aqui';
    faixa.hidden = !ligado;
    $('compositor').classList.toggle('ditando-ligado', ligado);
    for (const e of ['preparando', 'ouvindo', 'terminando']) $(`ditando-${e}`).hidden = estado !== e;
    // Com o enviar por voz ligado, a faixa troca a frase de sempre pela que ensina o que dizer.
    $('ditando-ouvindo').hidden = estado !== 'ouvindo' || frases.length > 0;
    $('ditando-microfone').hidden = !microfone || estado === 'terminando';
    $('ditando-microfone-nome').textContent = microfone;
    const c = V.atalhoDaCaixa('ditado');
    $('ditando-tecla').textContent = c ? A.mostrar(c) : '';
    $('ditando-tecla').hidden = !c;
    $('ditando-parar').hidden = estado === 'terminando';
    $('ditando-por-voz').hidden = !frases.length || estado !== 'ouvindo';
    $('ditando-frase').textContent = frases.length ? `“${frases[0]}”` : '';
    if (!ligado) botao.style.removeProperty('--nivel');
  }

  // --- enviar por voz -------------------------------------------------------------------
  // As palavras de um texto, sem acento, sem maiúscula e sem pontuação, cada uma com o lugar onde
  // começa no texto: "Enviar a mensagem!" e "enviar a mensagem" são a mesma fala.
  const palavras = (t) => [...String(t || '').matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ i: m.index, p: m[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() }));
  const DE_FABRICA = { pt: ['enviar mensagem', 'enviar a mensagem'], en: ['send message', 'send the message'] };
  const frasesDe = (c) => {
    if (!c || c.ditadoEnviarPorVoz !== true) return [];
    const escolhida = String(c.ditadoFraseEnviar || '').trim();
    return escolhida ? [escolhida] : DE_FABRICA[c.idioma === 'en' ? 'en' : 'pt'];
  };
  // O texto sem a frase do fim, ou null quando a fala não termina com ela (aí não é comando).
  function tirarComando(texto, lista) {
    const t = palavras(texto);
    for (const frase of lista) {
      const f = palavras(frase).map((x) => x.p);
      if (!f.length || t.length < f.length) continue;
      const fim = t.slice(-f.length);
      if (fim.every((x, k) => x.p === f[k])) return texto.slice(0, fim[0].i).replace(/[\s,;:–—-]+$/, '');
    }
    return null;
  }
  // Manda o que está na caixa, pelo mesmo caminho do Enter. Não é um envio feito no teclado:
  // um "!comando" segue como texto comum e não roda nada.
  const enviarPorVoz = () => $('compositor').requestSubmit();

  // O texto da caixa: o que já estava antes do cursor, o que foi ditado e o que estava depois.
  function escrever() {
    const dito = [fechado, previa].filter(Boolean).join(' ');
    const a = antes && dito && !/\s$/.test(antes) ? `${antes} ` : antes;
    const d = depois && dito && !/^[\s.,;:!?)]/.test(depois) ? ` ${depois}` : depois;
    const texto = a + dito + d;
    V.porNaCaixa(texto, { foco: false });
    ultimo = texto;
    const cursor = (a + dito).length;
    if (document.activeElement === entrada) entrada.setSelectionRange(cursor, cursor);
    if (!depois) entrada.scrollTop = entrada.scrollHeight;
  }
  // A caixa mudou por fora do ditado (a pessoa digitou, colou, trouxe um rascunho): o que está
  // nela agora é o texto de partida, e a fala daqui em diante entra onde o cursor está. O trecho
  // que estava aberto é largado (o que dele já aparecia fica como a pessoa deixou).
  function ancorar() {
    const v = entrada.value;
    const pos = document.activeElement === entrada ? entrada.selectionEnd : v.length;
    antes = v.slice(0, pos);
    depois = v.slice(pos);
    fechado = ''; previa = '';
    ultimo = v;
  }
  function reancorar() {
    ancorar();
    epoca += 1;
    D.cortar(antes.slice(-600)).catch(() => {});
  }

  async function comecar() {
    if (ativo()) return;
    if (window.orqEditorDeTexto && window.orqEditorDeTexto.editando()) { V.aviso('A mensagem está aberta no editor de texto. Termine lá antes de ditar.'); return; }
    estado = 'preparando';
    id = null; epoca = 0; microfone = '';
    entrada.focus();
    ancorar();
    pintar();
    window.orq.config.ler().then((c) => { continua = !!(c && c.ditadoContinua === true); frases = frasesDe(c); pintar(); }).catch(() => {});
    const r = await D.comecar(antes.slice(-600)).catch((e) => ({ erro: String((e && e.message) || e) }));
    if (r && r.ok) {
      if (ativo() && id === null) { id = r.id; microfone = r.microfone || ''; pintar(); }
      return;
    }
    estado = 'parado';
    pintar();
    V.aviso(`Não consegui ligar o ditado: ${(r && r.erro) || 'erro desconhecido'}. O texto da caixa continua como estava.`, 'erro');
  }
  // Parar: o que estava sendo falado é fechado e entra na caixa; depois o microfone é solto.
  async function parar() {
    if (!ativo() || estado === 'terminando') return;
    estado = 'terminando';
    pintar();
    await D.parar().catch(() => null);
    if (estado === 'terminando') { estado = 'parado'; pintar(); }
  }
  const alternar = () => (ativo() ? parar() : comecar());
  // Depois de um envio que esvaziou a caixa. O que foi enviado é o que estava lá: o trecho que
  // ainda estava aberto não volta para a caixa. Com "continuar ouvindo", a fala seguinte começa
  // a mensagem seguinte; sem, o ditado termina aqui.
  function depoisDeEnviar() {
    if (!ativo()) return;
    if (continua && estado !== 'terminando') {
      // O rascunho guardado pode voltar sozinho para a caixa logo depois deste aviso: o texto de
      // partida é o que estiver lá quando tudo assentar.
      fechado = ''; previa = ''; ultimo = null;
      queueMicrotask(() => { if (ativo()) reancorar(); });
      return;
    }
    estado = 'parado';
    pintar();
    D.largar().catch(() => {});
  }

  D.aoEvento((e) => {
    if (!e) return;
    if (e.t === 'nivel') { if (estado === 'ouvindo' || estado === 'preparando') botao.style.setProperty('--nivel', String(Math.max(0, Math.min(1, Number(e.v) || 0)))); return; }
    if (e.t === 'estado') {
      if (!ativo() || e.estado === 'parado') return;
      if (id === null && typeof e.id === 'number') id = e.id;
      if (e.microfone) microfone = e.microfone;
      if (estado !== 'terminando') estado = e.estado;
      pintar();
      return;
    }
    if (e.t === 'erro') { if (ativo()) V.aviso(`O ditado parou: ${e.erro}. O que já estava na caixa continua lá.`, 'erro'); return; }
    if (e.t === 'parou') {
      if (!ativo() || (id !== null && e.id !== id)) return;
      estado = 'parado';
      pintar();
      if (e.motivo === 'silencio') V.aviso('Parei de ouvir: passou um minuto sem fala. O que você ditou continua na caixa.');
      return;
    }
    if (e.t !== 'parcial' && e.t !== 'final') return;
    if (!ativo() || (id !== null && e.id !== id) || e.epoca !== epoca || typeof e.texto !== 'string') return;
    if (window.orqEditorDeTexto && window.orqEditorDeTexto.editando()) { parar(); return; }
    if (ultimo !== null && entrada.value !== ultimo) { reancorar(); return; }
    if (e.t === 'final') {
      const semComando = frases.length ? tirarComando(e.texto, frases) : null;
      const dito = semComando === null ? e.texto : semComando;
      if (dito) fechado = fechado ? `${fechado} ${dito}` : dito;
      previa = '';
      escrever();
      if (semComando !== null) enviarPorVoz();
      return;
    }
    previa = e.texto;
    escrever();
  });
  // A pessoa mexeu no texto no meio do ditado.
  entrada.addEventListener('input', (ev) => { if (ev.isTrusted && ativo() && estado !== 'terminando') reancorar(); });

  botao.addEventListener('click', () => alternar());
  $('ditando-parar').addEventListener('click', () => parar());
  document.addEventListener('keydown', (ev) => {
    const c = V.atalhoDaCaixa('ditado');
    if (!c || A.deEvento(ev) !== c) return;
    if (!ativo() && !V.caixaAtende()) return;
    ev.preventDefault();
    if (ev.isTrusted) alternar(); // o microfone só abre com uma tecla de verdade
  });
  // Esc com o ditado ligado e o teclado na caixa: para de ouvir (o texto fica) e a tecla não chega
  // ao resto do app, que no Esc interrompe o agente. Com um menu, uma janela, a busca ou a lista de
  // sugestões aberta, o Esc é de quem abriu. Na janela, e não no documento: a pilha do Esc da
  // conversa escuta no documento e viria antes.
  const MENUS = ['menu-modelo', 'menu-modo', 'menu-uso', 'menu-mais', 'menu-nova', 'menu-pasta'];
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey || !ativo() || estado === 'terminando') return;
    if (!V.caixaAtende() || !$('sugestoes').hidden || MENUS.some((m) => $(m) && !$(m).hidden) || (window.orqBusca && window.orqBusca.aberta())) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    parar();
  }, true);
  // Saiu da aba da conversa: para de ouvir (a caixa onde o texto aparece não está mais à vista).
  new MutationObserver(() => { if (ativo() && estado !== 'terminando' && !$('aba-orquestrador').classList.contains('ativa')) parar(); })
    .observe($('aba-orquestrador'), { attributes: true, attributeFilter: ['class'] });
  if (window.orqPaleta) window.orqPaleta.registrar(() => [ativo()
    ? { grupo: 'Ações', titulo: 'Parar o ditado', faz: () => parar() }
    : { grupo: 'Ações', titulo: 'Ditar a mensagem', sub: 'fale em vez de escrever; o texto aparece na caixa e você envia', faz: () => comecar() }]);

  window.orqDitado = { estado: () => ({ estado, id, epoca, microfone }), ativo, comecar, parar, alternar, depoisDeEnviar, tirarComando };
  pintar();
  // A tela recarregou com o microfone aberto: solta (o texto de partida se perdeu com a tela).
  D.estado().then((r) => { if (r && r.estado && r.estado !== 'parado' && !ativo()) D.largar().catch(() => {}); }).catch(() => {});
})();
