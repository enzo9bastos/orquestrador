// Pasta da conversa (plano 3.1): a janela "Nova conversa" (escolher a pasta e o motor) e o
// cartão de confiança da pasta, que aparece dentro da conversa antes de o Claude subir
// numa pasta que não é a pessoal.
//
// Quem confere a pasta e decide se pergunta é o motor (conversa.js, confianca.js). A tela
// só mostra o que ele manda em estado().pasta:
//   { exibir, estado: 'nunca-vista' | 'mudou' | 'aceita', lembrar, motivos,
//     oQueRoda: { hooks, mcp, allow, outros, instrucoes: { itens, total }, extras },
//     mudancas: { itens: [{ tipo, acao, rotulo | item }], mais }, avisos, incerta }
// e devolve a resposta da pessoa: 'confiar', 'sem' (abrir sem as configurações do projeto)
// ou 'cancelar'. Confiar e abrir sem o projeto só valem com um clique de verdade.
(() => {
  const $ = (id) => document.getElementById(id);
  const C = window.orq && window.orq.conversa;
  const menu = $('menu-nova');
  const botao = $('nova-conversa');
  if (!C || !C.pastas || !menu || !botao) return;
  const { esc } = window.orqUtil;
  const V = () => window.orqConversa;
  const caixa = $('mensagens');

  // --- a janela "Nova conversa" ---------------------------------------------------------
  let pastas = [];
  let marcada = 0;
  let motor = 'claude';
  let temCodex = false;
  let abertura = 0; // cada vez que a janela abre; resposta atrasada de uma abertura antiga não entra

  // Quando a pasta foi usada pela última vez, em palavras ("usada há 2 h").
  function quando(p) {
    if (p.pessoal) return '<span>sua pasta pessoal</span>';
    if (!p.quando) return '';
    const min = Math.max(0, Math.round((Date.now() - p.quando) / 60000));
    if (min < 2) return '<span>usada agora há pouco</span>';
    if (min < 60) return `<span>usada há ${min} min</span>`;
    if (min < 60 * 24) return `<span>usada há ${Math.round(min / 60)} h</span>`;
    const dias = Math.round(min / (60 * 24));
    return dias === 1 ? '<span>usada ontem</span>' : `<span>usada há ${dias} dias</span>`;
  }
  function avisar(texto, erro = false) {
    const a = $('nova-aviso');
    a.textContent = texto || '';
    a.hidden = !texto;
    a.classList.toggle('erro', !!texto && erro);
  }
  function pintar() {
    const p = pastas[marcada];
    for (const b of menu.querySelectorAll('[data-motor]')) b.setAttribute('aria-pressed', String(b.dataset.motor === motor));
    const codex = menu.querySelector('[data-motor="codex"]');
    codex.disabled = !temCodex;
    codex.title = temCodex ? '' : 'O Codex não foi encontrado neste computador (Configurações › IAs conectadas)';
    // O cartão de confiança é do Claude: só ele lê o que a pasta configura.
    avisar(p && !p.conhecida && motor === 'claude' ? 'Primeira vez nesta pasta: antes de abrir, o app mostra o que ela configura.' : '');
  }
  function desenhar() {
    $('nova-pastas').innerHTML = pastas.map((p, i) => `<label class="nova-pasta"><input type="radio" name="nova-pasta" value="${i}"${i === marcada ? ' checked' : ''}>
      <code data-sem-traducao>${esc(p.exibir)}</code><span class="nova-quando">${quando(p)}</span></label>`).join('');
    pintar();
  }
  const aberta = () => !menu.hidden;
  // Debaixo do botão, alinhada pela direita dele e sem sair da janela (como os outros menus da barra).
  function posicionar() {
    const r = botao.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${r.bottom + 6}px`;
  }
  function fechar({ foco = true } = {}) {
    if (!aberta()) return false;
    menu.hidden = true;
    botao.setAttribute('aria-expanded', 'false');
    if (foco) botao.focus();
    return true;
  }
  async function abrir() {
    if (aberta()) { fechar(); return; }
    marcada = 0; motor = 'claude';
    pastas = [{ pasta: '~', exibir: '~', pessoal: true, conhecida: true, quando: null }];
    menu.hidden = false;
    botao.setAttribute('aria-expanded', 'true');
    desenhar();
    posicionar();
    $('nova-abrir').focus();
    // As pastas usadas por último e se o Codex está instalado chegam depois, cada um no seu
    // tempo. O que a pessoa já escolheu enquanto isso (pasta ou marcação) fica como está.
    const vez = ++abertura;
    C.pastas().then((l) => {
      if (!aberta() || vez !== abertura || !Array.isArray(l) || !l.length) return;
      const escolhida = pastas[marcada];
      const daPessoa = pastas.filter((x) => !x.pessoal && !l.some((y) => y.pasta === x.pasta));
      pastas = [...daPessoa, ...l];
      marcada = Math.max(0, pastas.findIndex((x) => (escolhida && escolhida.pessoal ? false : escolhida && x.pasta === escolhida.pasta)));
      if (escolhida && escolhida.pessoal && pastas.length > 1 && !daPessoa.length) marcada = 0;
      desenhar();
      posicionar();
    }).catch(() => {});
    if (window.orq.ias) window.orq.ias.listar().then((ias) => {
      if (!aberta() || vez !== abertura) return;
      temCodex = !!(ias && Array.isArray(ias.ias) && ias.ias.some((x) => x.id === 'codex' && x.encontrado === true));
      pintar();
    }).catch(() => {});
  }
  async function confirmar() {
    const p = pastas[marcada];
    if (!p) return;
    $('nova-abrir').disabled = true;
    try {
      const id = await C.nova({ pasta: p.pessoal ? null : p.pasta, motor });
      fechar({ foco: false });
      await V().trocar(id);
    } catch (e) {
      avisar(`Não abri a conversa: ${String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, true);
    } finally { $('nova-abrir').disabled = false; }
  }
  botao.addEventListener('click', abrir);
  menu.addEventListener('change', (ev) => {
    if (ev.target.name !== 'nova-pasta') return;
    marcada = Number(ev.target.value) || 0;
    pintar();
  });
  menu.addEventListener('click', async (ev) => {
    const m = ev.target.closest('[data-motor]');
    if (m && !m.disabled) { motor = m.dataset.motor; pintar(); return; }
    if (ev.target.closest('#nova-escolher')) {
      const r = await C.escolherPasta();
      if (!r) return; // a pessoa fechou a janela do sistema sem escolher
      if (r.erro) { avisar(`Não deu para usar esta pasta: ${r.erro}`, true); return; }
      pastas = [r, ...pastas.filter((x) => x.pasta !== r.pasta)];
      marcada = 0;
      desenhar();
      return;
    }
    if (ev.target.closest('#nova-abrir')) confirmar();
  });
  menu.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fechar(); } else if (ev.key === 'Enter' && !ev.target.closest('button')) { ev.preventDefault(); confirmar(); }
  });
  document.addEventListener('mousedown', (ev) => { if (aberta() && !ev.target.closest('#menu-nova, #nova-conversa')) fechar({ foco: false }); });

  // --- o cartão de confiança da pasta ------------------------------------------------------
  // Quando um hook roda, em palavras de quem usa (o nome do evento fica junto).
  const EVENTOS = {
    PreToolUse: 'antes de cada ferramenta do Claude', PostToolUse: 'depois de cada ferramenta do Claude', Stop: 'quando o Claude termina',
    SubagentStop: 'quando um subagente termina', SessionStart: 'quando a conversa abre', SessionEnd: 'quando a conversa fecha',
    UserPromptSubmit: 'a cada mensagem sua', Notification: 'quando o Claude avisa algo', PreCompact: 'antes de resumir a conversa',
  };
  const ACOES = { novo: 'novo', mudou: 'mudou', removido: 'saiu' };
  const PROBLEMAS = {
    'link-para-fora': 'é um atalho para fora da pasta', 'pasta-e-link': 'é um atalho para outra pasta', 'json-invalido': 'não é um JSON válido',
    'formato-inesperado': 'tem um formato que o app não reconhece', 'grande-demais': 'é grande demais para conferir', 'nao-e-arquivo-comum': 'não é um arquivo comum',
    'importacao-de-fora': 'inclui um arquivo de fora da pasta', 'importacao-em-ciclo': 'inclui a si mesmo', 'importacao-funda-demais': 'inclui arquivos em níveis demais',
    'nao-deu-para-ler': 'não deu para ler', 'limite-de-leitura': 'passou do limite de leitura', 'pasta-funda-demais': 'fica fundo demais na pasta', 'tempo-esgotado': 'demorou demais para ler',
  };
  const alvoDoHook = (h) => h.comando || h.endereco || (h.servidor || h.ferramenta ? `${h.servidor || ''}/${h.ferramenta || ''}` : h.texto || '');
  const textoDoItem = (tipo, i) => (tipo === 'hook' ? alvoDoHook(i) : tipo === 'mcp' ? `${i.nome} → ${i.comando || i.endereco || ''}` : tipo === 'allow' ? i.regra : `${i.chave}: ${i.valor}`);
  const tamanho = (b) => (b >= 1024 ? `${(b / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB` : `${b} B`);

  function bloco(titulo, selo, l, linha) {
    if (!l || !l.itens || !l.itens.length) return '';
    const mais = (l.total || l.itens.length) - l.itens.length;
    return `<div class="pasta-bloco"><h4><span>${titulo}</span> <small data-sem-traducao>${esc(selo ? `${selo} · ${l.total || l.itens.length}` : String(l.total || l.itens.length))}</small></h4>
      <ul class="pasta-lista">${l.itens.map(linha).join('')}${mais > 0 ? `<li class="pasta-mais"><span>e mais ${mais}</span></li>` : ''}</ul></div>`;
  }
  function htmlDoCartao(k) {
    const r = k.oQueRoda || {};
    const mudou = k.estado === 'mudou';
    const novos = new Set(((k.mudancas && k.mudancas.itens) || []).filter((m) => m.acao === 'novo' && m.item).map((m) => `${m.tipo}|${textoDoItem(m.tipo, m.item)}`));
    const novo = (tipo, i) => (novos.has(`${tipo}|${textoDoItem(tipo, i)}`) ? ' <span class="pasta-novo">novo desde a última vez</span>' : '');
    const blocos = [
      bloco('Comandos que rodam sozinhos', 'hooks', r.hooks, (h) => `<li><span data-sem-traducao>${esc(alvoDoHook(h))}</span> <small><span>${esc(EVENTOS[h.evento] || '')}</span>${EVENTOS[h.evento] ? '' : `<span data-sem-traducao>${esc(h.evento)}</span>`}${h.filtro ? ` <span data-sem-traducao>(${esc(h.filtro)})</span>` : ''}</small>${novo('hook', h)}</li>`),
      bloco('Servidores MCP', '', r.mcp, (m) => `<li><span data-sem-traducao>${esc(textoDoItem('mcp', m))}</span>${novo('mcp', m)}</li>`),
      bloco('Regras que já permitem sem perguntar', '', r.allow, (a) => `<li><span data-sem-traducao>${esc(a.regra)}</span>${novo('allow', a)}</li>`),
      bloco('Outras configurações da pasta', '', r.outros, (o) => `<li><span data-sem-traducao>${esc(textoDoItem('outro', o))}</span>${novo('outro', o)}</li>`),
      bloco('Instruções para o Claude', '', r.instrucoes, (a) => `<li><span data-sem-traducao>${esc(a.rotulo)}</span> <small><span data-sem-traducao>${esc(tamanho(a.bytes || 0))}</span>${a.importadoPor ? ` · <span>incluído por</span> <span data-sem-traducao>${esc(a.importadoPor)}</span>` : ''}</small></li>`),
    ].join('');
    const extras = Object.entries(r.extras || {}).filter(([, n]) => n > 0).map(([tipo, n]) => `${n} ${tipo}`).join(' · ');
    const mudancas = mudou && k.mudancas && k.mudancas.itens.length
      ? `<div class="pasta-bloco pasta-mudou"><h4><span>O que mudou desde a última vez</span></h4><ul class="pasta-lista">${k.mudancas.itens.map((m) => `<li><span data-sem-traducao>${esc(m.item ? textoDoItem(m.tipo, m.item) : m.rotulo || '')}</span> <small>${esc(ACOES[m.acao] || m.acao)}</small></li>`).join('')}${k.mudancas.mais ? `<li class="pasta-mais"><span>e mais ${k.mudancas.mais}</span></li>` : ''}</ul></div>` : '';
    const problemas = [...(k.avisos || []).map((a) => [a.rotulo, a.tipo]), ...(k.incerta || []).map((a) => [a.rotulo, a.motivo])];
    const vistos = new Set();
    const atencao = problemas.filter(([rot, tipo]) => { const c = `${rot}|${tipo}`; if (vistos.has(c)) return false; vistos.add(c); return true; }).slice(0, 12);
    return `<div class="titulo-pedido"><span class="ponto permissao"></span><span><span>${mudou ? 'Esta pasta mudou desde que você confiou nela' : 'Primeira vez nesta pasta'}</span>: <strong data-sem-traducao>${esc(k.exibir)}</strong></span></div>
      <p class="pasta-motivo">Uma conversa aberta aqui usa o que a pasta configura. Confira antes de abrir:</p>
      ${mudancas}${blocos || '<p class="pasta-vazia">Esta pasta não configura nada que rode sozinho, nem instruções para o Claude.</p>'}
      ${extras ? `<p class="pasta-extras"><span>A pasta também traz:</span> <span data-sem-traducao>${esc(extras)}</span></p>` : ''}
      ${atencao.length ? `<div class="pasta-bloco pasta-atencao"><h4><span>O app não conseguiu conferir tudo</span></h4><ul class="pasta-lista">${atencao.map(([rot, tipo]) => `<li><span data-sem-traducao>${esc(rot || '')}</span> <small>${esc(PROBLEMAS[tipo] || tipo)}</small></li>`).join('')}</ul></div>` : ''}
      <p class="pasta-nota">${k.lembrar === false ? 'Como não deu para conferir tudo, este aceite não fica guardado: o cartão volta na próxima vez que a conversa abrir.' : 'O app olha a pasta de verdade (sem atalhos) e guarda uma impressão digital destes arquivos. Se algum mudar, pergunta de novo, mostrando o que mudou.'}</p>
      <div class="acoes"><button type="button" class="botao primario" data-pasta="confiar">Confiar e abrir</button><button type="button" class="botao secundario" data-pasta="sem">Abrir sem as configurações do projeto</button><button type="button" class="botao secundario" data-pasta="cancelar">Cancelar</button></div>
      <p class="pasta-erro" role="status" hidden></p>`;
  }
  const canceladas = new Set(); // conversas em que a pessoa cancelou o cartão (até abrirem de novo)
  // Roda a cada redesenho da conversa: r é o estado inteiro (conversa.js › estado()).
  function desenharNaConversa(r) {
    const id = r.id || V().ativa();
    if (r.pasta) {
      canceladas.delete(id);
      const el = document.createElement('div');
      el.className = 'cartao-pedido cartao-pasta';
      el.dataset.conversa = id;
      el.innerHTML = htmlDoCartao(r.pasta);
      caixa.append(el);
      el.addEventListener('click', async (ev) => {
        const b = ev.target.closest('[data-pasta]');
        if (!b) return;
        const escolha = b.dataset.pasta;
        // Abrir a conversa numa pasta é decisão da pessoa: só um clique de verdade vale.
        if (escolha !== 'cancelar' && !ev.isTrusted) return;
        for (const x of el.querySelectorAll('[data-pasta]')) x.disabled = true;
        const resp = await C.responderPasta(id, escolha);
        if (!resp || resp.ok === false) {
          for (const x of el.querySelectorAll('[data-pasta]')) x.disabled = false;
          const e = el.querySelector('.pasta-erro');
          e.textContent = `Não deu: ${(resp && resp.erro) || 'sem resposta do app'}`;
          e.hidden = false;
          return;
        }
        if (escolha !== 'cancelar') return; // a conversa abre e a tela é redesenhada
        // Cancelou numa conversa que nem começou: ela sai da lista. Numa que já existia, fica parada.
        const atual = V().lista().find((c) => c.id === id);
        const naFila = id === V().ativa() ? ((V().info() || {}).fila || []).length : 1;
        if (atual && !atual.vivo && atual.semHistorico && !naFila) {
          await C.fechar(id);
          await V().trocar('orquestrador');
          V().aviso('Cancelado: nenhuma conversa foi aberta.');
        } else {
          // O redesenho que tira o cartão pode ter chegado antes desta resposta: a linha entra agora.
          canceladas.add(id);
          if (id === V().ativa()) desenharParada(id);
        }
      });
      return;
    }
    if (canceladas.has(id) && !r.vivo) desenharParada(id);
  }
  // Depois de cancelar numa conversa que já existia: ela fica parada, com o caminho de volta ao cartão.
  function desenharParada(id) {
    if (caixa.querySelector('.pasta-parada')) return;
    const el = document.createElement('div');
    el.className = 'cartao-pedido cartao-pasta pasta-parada';
    el.innerHTML = '<div class="titulo-pedido"><span class="ponto parado"></span><span>Esta conversa está parada: a pasta dela ainda não foi confirmada.</span></div><div class="acoes"><button type="button" class="botao secundario" data-pasta-conferir>Conferir a pasta</button></div>';
    caixa.append(el);
    el.scrollIntoView({ block: 'nearest' });
    el.querySelector('[data-pasta-conferir]').addEventListener('click', () => { canceladas.delete(id); C.abrir(id); });
  }

  // --- o menu do chip da pasta ------------------------------------------------------------
  // Mostra a pasta da conversa (que não muda), as pastas extras que ela pode usar (o mesmo
  // do /add-dir, com Tirar) e abre outra conversa numa pasta usada há pouco.
  const chip = $('chip-pasta');
  const menuPasta = $('menu-pasta');
  const K = window.orq.comandos;
  const daTela = () => V().lista().find((c) => c.id === V().ativa()) || {};
  function pintarChip() {
    if (!chip) return;
    const n = daTela().pastasExtras || 0;
    const e = $('info-pasta-extras');
    e.textContent = n ? `+${n}` : '';
    e.hidden = !n;
  }
  const pastaAberta = () => !!menuPasta && !menuPasta.hidden;
  function fecharMenuPasta({ foco = false } = {}) {
    if (!pastaAberta()) return false;
    menuPasta.hidden = true;
    chip.setAttribute('aria-expanded', 'false');
    if (foco) chip.focus();
    return true;
  }
  function avisarNoMenu(texto) {
    const a = $('pasta-aviso');
    if (!a) return;
    a.textContent = texto || '';
    a.hidden = !texto;
  }
  async function desenharMenuPasta() {
    const id = V().ativa();
    const atual = daTela();
    if (atual.orquestrador) {
      menuPasta.innerHTML = `<div class="menu-titulo">Pasta desta conversa</div>
        <p class="pasta-caminho"><code data-sem-traducao>~</code> <span>(sua pasta pessoal)</span></p>
        <p class="menu-nota pasta-fixa">O orquestrador roda sempre na pasta pessoal. Ele coordena; quem trabalha dentro dos projetos são os agentes e as conversas avulsas.</p>`;
      return;
    }
    const [e, recentes] = await Promise.all([K.estado(id).catch(() => null), C.pastas().catch(() => [])]);
    if (id !== V().ativa()) return;
    const extras = e && Array.isArray(e.pastasExtras) ? e.pastasExtras : [];
    const comoSeLe = e && Array.isArray(e.pastasExtrasExibir) ? e.pastasExtrasExibir : []; // com ~ no lugar da pasta pessoal (quem sabe é o motor)
    menuPasta.innerHTML = `<div class="menu-titulo">Pasta desta conversa</div>
      <p class="pasta-caminho"><code data-sem-traducao>${esc(atual.pasta || '~')}</code>${atual.semProjeto ? ' · <span>sem as configurações do projeto</span>' : ''}</p>
      <p class="menu-nota">A pasta de uma conversa não muda depois de aberta. Para trabalhar em outra, abra outra conversa.</p>
      <div class="nova-grupo"><span class="nova-rotulo">Pastas extras que esta conversa pode usar</span>
        <ul class="pasta-lista" id="pasta-extras">${extras.map((p, i) => `<li><span data-sem-traducao>${esc(comoSeLe[i] || p)}</span><button type="button" class="botao-texto" data-tirar="${esc(p)}">Tirar</button></li>`).join('') || '<li class="pasta-mais"><span>nenhuma</span></li>'}</ul>
        <div><button type="button" class="botao secundario" id="pasta-adicionar">+ Adicionar pasta…</button></div></div>
      <div class="nova-grupo"><span class="nova-rotulo">Abrir conversa nova em</span>
        <div class="pasta-recentes">${(Array.isArray(recentes) ? recentes : []).map((p) => `<button type="button" class="chip botao-chip" data-nova-em="${esc(p.pessoal ? '' : p.pasta)}"><code data-sem-traducao>${esc(p.exibir)}</code></button>`).join('')}</div></div>
      <p class="menu-nota nova-aviso erro" id="pasta-aviso" role="status" hidden></p>`;
  }
  function posicionarMenuPasta() {
    const r = chip.getBoundingClientRect();
    menuPasta.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menuPasta.offsetWidth - 8))}px`;
    menuPasta.style.top = `${r.bottom + 6}px`;
  }
  async function abrirMenuPasta() {
    if (pastaAberta()) { fecharMenuPasta(); return; }
    menuPasta.innerHTML = '<div class="menu-titulo">Pasta desta conversa</div>';
    menuPasta.hidden = false;
    chip.setAttribute('aria-expanded', 'true');
    posicionarMenuPasta();
    await desenharMenuPasta();
    posicionarMenuPasta();
  }
  if (chip && menuPasta) {
    chip.addEventListener('click', abrirMenuPasta);
    menuPasta.addEventListener('click', async (ev) => {
      const id = V().ativa();
      const tirar = ev.target.closest('[data-tirar]');
      if (tirar) {
        tirar.disabled = true;
        const r = await K.tirarPastaExtra(id, tirar.dataset.tirar);
        if (r && r.erro) { avisarNoMenu(`Não tirei a pasta: ${r.erro}`); tirar.disabled = false; return; }
        await desenharMenuPasta();
        return;
      }
      if (ev.target.closest('#pasta-adicionar')) {
        const p = await C.escolherPasta();
        if (!p) return;
        if (p.erro) { avisarNoMenu(`Não deu para usar esta pasta: ${p.erro}`); return; }
        const r = await K.pastaExtra(id, p.pasta);
        if (r && r.erro) { avisarNoMenu(`Não adicionei a pasta: ${r.erro}`); return; }
        await desenharMenuPasta();
        return;
      }
      const nova = ev.target.closest('[data-nova-em]');
      if (nova) {
        try {
          const novoId = await C.nova({ pasta: nova.dataset.novaEm || null, motor: 'claude' });
          fecharMenuPasta();
          await V().trocar(novoId);
        } catch (e) { avisarNoMenu(`Não abri a conversa: ${String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`); }
      }
    });
    document.addEventListener('mousedown', (ev) => { if (pastaAberta() && !ev.target.closest('#menu-pasta, #chip-pasta')) fecharMenuPasta(); });
  }

  window.orqPasta = { abrirNova: abrir, fecharNova: fechar, novaAberta: aberta, desenharNaConversa, pintarChip, fecharMenuPasta, menuPastaAberto: pastaAberta };
})();
