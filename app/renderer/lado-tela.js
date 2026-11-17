// Pergunta rápida (/btw): uma gaveta por cima da coluna da direita. A pessoa pergunta
// algo sobre a conversa e o Claude responde sem entrar nela e sem parar o que está
// fazendo. A conversa continua na tela.
//
// A gaveta só desenha: quem manda a pergunta, guarda as respostas (só na memória, uma
// lista por conversa) e confere o que o Claude devolve é o motor (conversa.js,
// pergunta-de-lado.js). A cada mudança o motor manda o estado inteiro (conversa:lado):
//   { motor, trocas: [{ id, pergunta, resposta?, reserva?, erro?, detalhe? }],
//     pendente: { id, pergunta, andamento } | null }
// A gaveta acompanha a conversa que está na tela: trocou de conversa, mostra as
// perguntas da outra. O Esc fecha a gaveta quando o teclado está nela; com o teclado na
// caixa da conversa, o Esc continua sendo da conversa (parar o Claude).
(() => {
  const $ = (id) => document.getElementById(id);
  const gaveta = $('gaveta-lado');
  const C = window.orq && window.orq.conversa;
  if (!gaveta || !C || !C.ladoPerguntar) return;
  const { esc } = window.orqUtil;
  const md = (t) => DOMPurify.sanitize(marked.parse(t || '', { gfm: true, breaks: true }));
  const V = () => window.orqConversa;
  const lista = $('gaveta-lado-trocas');
  const campo = $('gaveta-lado-texto');
  const botao = $('gaveta-lado-enviar');
  const aviso = $('gaveta-lado-aviso');
  const limpar = $('gaveta-lado-limpar');
  const VAZIO = { motor: 'claude', trocas: [], pendente: null };
  const estados = new Map(); // conversa → o último estado que o motor mandou
  let dona = null; // a conversa que a gaveta está mostrando
  let tLimpar = null;

  // Por que uma pergunta ficou sem resposta, em palavras de quem usa.
  const ERROS = {
    sintetica: 'O Claude não respondeu a esta pergunta.',
    vazia: 'O Claude não deu resposta. Pergunte de novo, ou pergunte na conversa.',
    parada: 'Você parou esta pergunta.',
    demorou: 'O Claude não respondeu em 2 minutos e a pergunta foi cancelada.',
    formato: 'A resposta veio num formato que o app não reconhece.',
    falhou: 'Não deu para perguntar.',
  };
  const estado = () => estados.get(dona) || VAZIO;
  const aberta = () => !gaveta.hidden;

  function dizer(texto) {
    aviso.textContent = texto || '';
    aviso.hidden = !texto;
  }
  function ajustar() {
    campo.style.height = 'auto';
    campo.style.height = `${Math.min(campo.scrollHeight, 140)}px`;
  }
  function htmlDaTroca(t) {
    const pergunta = `<div class="troca-pergunta" data-sem-traducao>${esc(t.pergunta)}</div>`;
    if (t.erro) {
      return `<article class="troca com-erro" data-id="${t.id}" data-erro="${esc(t.erro)}">${pergunta}
        <div class="troca-erro"><span>${esc(ERROS[t.erro] || ERROS.falhou)}</span><span class="troca-detalhe" data-sem-traducao>${esc(t.detalhe || '')}</span></div>
        <div class="troca-acoes"><button type="button" class="botao-texto" data-de-novo>Perguntar de novo</button></div></article>`;
    }
    return `<article class="troca" data-id="${t.id}">${pergunta}
      <div class="troca-resposta md" data-sem-traducao>${md(t.resposta)}</div>
      ${t.reserva ? `<div class="troca-reserva" data-sem-traducao>⚠ ${esc(t.reserva.texto)}</div>` : ''}
      <div class="troca-acoes"><button type="button" class="botao-texto" data-copiar>Copiar</button></div></article>`;
  }
  function htmlDoPendente(p) {
    const a = p.andamento;
    const tentando = a && a.estado === 'tentando';
    const n = tentando && a.tentativa && a.de ? ` (${a.tentativa}/${a.de})` : '';
    return `<article class="troca pendente" data-id="${p.id}"><div class="troca-pergunta" data-sem-traducao>${esc(p.pergunta)}</div>
      <div class="troca-esperando"><span class="pontinhos" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="troca-estado">${tentando ? 'A resposta falhou no caminho. O Claude está tentando de novo' : 'Pensando…'}</span><span data-sem-traducao>${esc(n)}</span>
        <button type="button" class="botao-texto" data-parar>Parar</button></div></article>`;
  }
  function desenhar() {
    if (!aberta()) return;
    const e = estado();
    const codex = e.motor === 'codex' || (V() && V().motor() === 'codex');
    const colado = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 40;
    $('gaveta-lado-conversa').textContent = V() && V().titulo ? V().titulo() : '';
    if (codex) {
      lista.innerHTML = '<p class="gaveta-vazio">Esta conversa é do Codex. A pergunta rápida daqui é do Claude; no Codex, use o /side, que abre no terminal.</p>';
    } else if (!e.trocas.length && !e.pendente) {
      lista.innerHTML = '<p class="gaveta-vazio">Nenhuma pergunta ainda. Um exemplo: “qual era o nome daquele arquivo de configuração?”</p>';
    } else {
      lista.innerHTML = e.trocas.map(htmlDaTroca).join('') + (e.pendente ? htmlDoPendente(e.pendente) : '');
    }
    campo.disabled = codex;
    botao.disabled = codex || !!e.pendente;
    botao.title = e.pendente ? 'Espere a resposta, ou pare a pergunta' : '';
    limpar.hidden = codex || !e.trocas.length;
    if (!e.trocas.length) desarmarLimpar();
    if (colado) lista.scrollTop = lista.scrollHeight;
  }
  async function buscar() {
    const id = dona;
    const e = await C.ladoEstado(id);
    if (e && Array.isArray(e.trocas)) estados.set(id, e);
    if (id === dona) { desenhar(); lista.scrollTop = lista.scrollHeight; }
  }

  async function perguntar(texto) {
    const t = String(texto || '').trim();
    if (!t || !dona) return false;
    if (estado().pendente) { dizer('Espere a resposta da pergunta anterior, ou pare ela.'); return false; }
    dizer('');
    const id = dona;
    const r = await C.ladoPerguntar(id, t);
    // A pergunta nem saiu (vazia, grande demais, conversa do Codex): o texto fica no campo.
    if (r && r.ok === false && !r.troca) { if (id === dona) dizer(r.erro || ERROS.falhou); return false; }
    return true;
  }
  // Abre a gaveta na conversa que está na tela. Com pergunta, já pergunta.
  async function abrir(pergunta) {
    dona = V() ? V().ativa() : null;
    gaveta.hidden = false;
    document.body.classList.add('com-gaveta-lado');
    dizer('');
    desenhar();
    campo.focus();
    await buscar();
    if (pergunta) await perguntar(pergunta);
  }
  function fechar({ foco = true } = {}) {
    if (!aberta()) return false;
    gaveta.hidden = true;
    document.body.classList.remove('com-gaveta-lado');
    desarmarLimpar();
    if (foco && $('entrada')) $('entrada').focus();
    return true;
  }
  // A conversa da tela mudou: a gaveta aberta passa a mostrar as perguntas dela.
  function trocou(id) {
    if (!aberta() || id === dona) return;
    dona = id;
    dizer('');
    desenhar();
    buscar();
  }

  // "Limpar" confirma no segundo clique (some com as perguntas e respostas da lista).
  function desarmarLimpar() {
    clearTimeout(tLimpar);
    delete limpar.dataset.confirmando;
    limpar.textContent = 'Limpar';
  }
  limpar.addEventListener('click', async () => {
    if (!limpar.dataset.confirmando) {
      limpar.dataset.confirmando = '1';
      limpar.textContent = 'Limpar mesmo?';
      tLimpar = setTimeout(desarmarLimpar, 4000);
      return;
    }
    desarmarLimpar();
    await C.ladoLimpar(dona);
    campo.focus();
  });

  $('gaveta-lado-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const t = campo.value;
    if (await perguntar(t)) { if (campo.value === t) campo.value = ''; ajustar(); }
    campo.focus();
  });
  campo.addEventListener('input', () => { ajustar(); if (!aviso.hidden) dizer(''); });
  campo.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); $('gaveta-lado-form').requestSubmit(); }
  });
  // Esc com o teclado na gaveta: fecha a gaveta e devolve o teclado à caixa da conversa.
  gaveta.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey) return;
    ev.preventDefault(); ev.stopPropagation();
    fechar();
  });
  $('gaveta-lado-fechar').addEventListener('click', () => fechar());
  lista.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    const artigo = b && b.closest('.troca');
    if (!artigo) return;
    const e = estado();
    if (b.hasAttribute('data-parar')) { b.disabled = true; await C.ladoParar(dona); return; }
    const t = e.trocas.find((x) => String(x.id) === artigo.dataset.id);
    if (!t) return;
    if (b.hasAttribute('data-copiar')) {
      try { await navigator.clipboard.writeText(t.resposta); b.textContent = 'Copiado'; setTimeout(() => { b.textContent = 'Copiar'; }, 1500); } catch (err) { dizer(`Não consegui copiar: ${err.message}`); }
    } else if (b.hasAttribute('data-de-novo')) {
      campo.value = t.pergunta; ajustar(); campo.focus();
    }
  });

  C.aoLado((id, e) => {
    if (!e || !Array.isArray(e.trocas)) return;
    estados.set(id, e);
    if (id === dona) desenhar();
  });

  window.orqLado = { abrir, fechar, trocou, aberta, perguntar };
})();
