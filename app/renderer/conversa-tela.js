// Conversa com o orquestrador: balões, Markdown, ferramentas recolhidas e
// perguntas/permissões com botão. O Claude roda por trás (conversa.js).
(() => {
  const $ = (id) => document.getElementById(id);
  const caixa = $('mensagens');
  const C = window.orq.conversa;
  let ativa = 'orquestrador'; // conversa na tela
  // Partes da configuração que a tela usa (config.js, lidas pela ponte).
  let cfg = { comandoInicial: null, comandoDesligar: null, comandoOrdem: null };
  let listaConversas = [];

  const { esc } = window.orqUtil;
  const md = (t) => DOMPurify.sanitize(marked.parse(t || '', { gfm: true, breaks: true }));

  let grupo = null;          // bloco "Claude" em que as próximas respostas entram
  let rascunho = null;       // texto chegando aos pedaços
  let rascunhoTexto = '';
  const ferramentas = new Map(); // tool_use_id → <details>
  let colado = true;         // a rolagem acompanha o fim enquanto ninguém subir

  caixa.addEventListener('scroll', () => {
    colado = caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < 80;
  });
  function rolar() { if (colado) caixa.scrollTop = caixa.scrollHeight; }

  // --- pedaços da conversa ------------------------------------------------
  // Horário do evento sendo desenhado: undefined fora de um evento (texto
  // chegando ao vivo: agora); null em evento sem horário conhecido (não mostra).
  let horaEvento;
  function horario(ms) {
    const d = new Date(ms), h = new Date();
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === h.toDateString() ? hora : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`;
  }
  function novoGrupo() {
    grupo = document.createElement('div');
    grupo.className = 'msg-claude';
    const ms = horaEvento === undefined ? Date.now() : horaEvento;
    // Quem responde: o Claude ou o Codex (motor da conversa aberta).
    const autor = infoAtual.motor === 'codex' ? '<span class="marca-claude marca-codex">◎</span>Codex' : '<span class="marca-claude">✳</span>Claude';
    grupo.innerHTML = `<div class="autor">${autor}${ms ? `<time class="hora-msg" data-sem-traducao title="${esc(new Date(ms).toLocaleString('pt-BR'))}">${esc(horario(ms))}</time>` : ''}
      <button type="button" class="copiar-resposta" title="Copiar esta resposta" aria-label="Copiar esta resposta"><svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.500 3v5A1.500 1.500 0 0 0 4 9.500h.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg><span class="feito" aria-hidden="true">✓</span></button></div>`;
    caixa.append(grupo);
    return grupo;
  }
  function noGrupo(el) { (grupo || novoGrupo()).append(el); }

  // Mensagens do Claude Code que não são texto do usuário (comando, saída de comando).
  function textoDoUsuario(t) {
    const cmd = t.match(/<command-name>([^<]*)<\/command-name>/);
    if (cmd) {
      const args = (t.match(/<command-args>([^<]*)<\/command-args>/) || [])[1] || '';
      return { comando: `${cmd[1]} ${args}`.trim() };
    }
    if (/^<(local-command-|system-reminder|task-notification)/.test(t.trim())) return null;
    return { texto: t };
  }

  function balaoImagens(blocos) {
    grupo = null;
    const el = document.createElement('div');
    el.className = 'msg-voce';
    el.innerHTML = `<div class="balao balao-imagens">${blocos.map((b) => (b.source && b.source.data
      ? `<img src="data:${esc(b.source.media_type)};base64,${b.source.data}" alt="imagem enviada">` : '<span class="nota">[imagem]</span>')).join('')}</div>`;
    caixa.append(el);
  }

  function balaoUsuario(texto) {
    // Mensagem que um workflow mandou por trás: não é do usuário, vira só uma
    // linha discreta (abre para ver o texto).
    const wf = /^<orq-workflow nome="([^"]*)">\n?([\s\S]*?)\n?<\/orq-workflow>\s*$/.exec(String(texto).trim());
    if (wf) {
      grupo = null;
      const el = document.createElement('details');
      el.className = 'msg-bastidor';
      el.innerHTML = `<summary>⏱ Por trás · workflow «${esc(wf[1])}»</summary><div class="msg-bastidor-texto">${esc(wf[2])}</div>`;
      caixa.append(el);
      return;
    }
    // Aviso de tópico aprovado/recusado no painel: também é por trás.
    const tp = /^<orq-topico id="([^"]*)" acao="([^"]*)" titulo="([^"]*)">\n?([\s\S]*?)\n?<\/orq-topico>\s*$/.exec(String(texto).trim());
    if (tp) {
      grupo = null;
      const el = document.createElement('details');
      el.className = 'msg-bastidor msg-bastidor-topico';
      const rotulo = { recusado: 'Demanda recusada', apagado: 'Demanda apagada', mantido: 'Demanda mantida' }[tp[2]] || 'Demanda aprovada';
      el.innerHTML = `<summary>📌 ${rotulo}: <span data-sem-traducao>${esc(tp[3])}</span></summary><div class="msg-bastidor-texto">${esc(tp[4])}</div>`;
      caixa.append(el);
      return;
    }
    // Recado de um agente que o app entregou ao orquestrador: por trás também.
    const rc = /^<orq-recado id="[^"]*" de="([^"]*)" projeto="([^"]*)" tipo="([^"]*)">\n?([\s\S]*?)\n?<\/orq-recado>\s*$/.exec(String(texto).trim());
    if (rc) {
      grupo = null;
      const el = document.createElement('details');
      el.className = `msg-bastidor msg-bastidor-recado recado-${rc[3]}`;
      const icone = { pergunta: '❓', travado: '⛔', pronto: '✅', vez: '🔁', resposta: '🧩', falhou: '⚠', negado: '🚫' }[rc[3]] || '✉';
      el.innerHTML = `<summary>${icone} Recado de <span data-sem-traducao>${esc(rc[1])} · ${esc(rc[2])}</span></summary><div class="msg-bastidor-texto">${esc(rc[4])}</div>`;
      caixa.append(el);
      return;
    }
    // Recado do canal entre orquestradores (de outro computador, ou o retorno
    // de um envio para fora): por trás, com a origem à vista.
    const ce = /^<orq-recado id="[^"]*" de="([^"]*)" tipo="([^"]*)" canal="externo">\n?([\s\S]*?)\n?<\/orq-recado>\s*$/.exec(String(texto).trim());
    if (ce) {
      grupo = null;
      const el = document.createElement('details');
      el.className = `msg-bastidor msg-bastidor-recado msg-bastidor-externo recado-${ce[2]}`;
      const resumo = ce[2] === 'externo' ? `🌐 Recado de fora: <span data-sem-traducao>${esc(ce[1])}</span>`
        : ce[2] === 'negado' ? '🚫 Recado para fora que você não deixou sair' : '⚠ Recado para fora que não saiu';
      el.innerHTML = `<summary>${resumo}</summary><div class="msg-bastidor-texto">${esc(ce[3])}</div>`;
      caixa.append(el);
      return;
    }
    const u = textoDoUsuario(texto);
    if (!u) return;
    // O comando que abre a rodada não aparece: é bastidor, não conversa.
    const primeiro = (u.comando || u.texto || '').trim().split(/\s/)[0];
    if (cfg.comandoInicial && primeiro === cfg.comandoInicial) return;
    grupo = null;
    const el = document.createElement('div');
    el.className = 'msg-voce';
    el.innerHTML = u.comando
      ? `<div class="balao comando"><svg class="ico"><use href="#i-terminal"/></svg>${esc(u.comando)}</div>`
      : `<button class="editar-msg" type="button" aria-label="Editar" title="Voltar a conversa para antes desta mensagem e corrigir"></button><div class="balao">${esc(u.texto)}</div>`;
    if (!u.comando) el.dataset.texto = u.texto;
    caixa.append(el);
  }

  const curto = (s, n = 90) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const base = (p) => String(p || '').split('/').pop();
  function resumoFerramenta(nome, e = {}) {
    if (nome.startsWith('mcp__')) nome = nome.split('__').slice(2).join(' ');
    switch (nome) {
      case 'Bash': return ['Rodou', e.description || curto(e.command)];
      case 'Read': return ['Leu', base(e.file_path)];
      case 'Edit': case 'MultiEdit': return ['Editou', base(e.file_path)];
      case 'Write': return ['Escreveu', base(e.file_path)];
      case 'Grep': return ['Buscou', curto(e.pattern, 60)];
      case 'Glob': return ['Procurou arquivos', curto(e.pattern, 60)];
      case 'Skill': return ['Usou a skill', e.skill];
      case 'Agent': case 'Task': return ['Chamou um agente', e.description];
      case 'WebFetch': return ['Abriu', curto(e.url, 70)];
      case 'WebSearch': return ['Pesquisou', curto(e.query, 70)];
      case 'TodoWrite': return ['Atualizou a lista de tarefas', ''];
      case 'AskUserQuestion': return ['Perguntou', curto((e.questions || [])[0]?.question)];
      case 'ToolSearch': return ['Carregou ferramentas', ''];
      default: return [nome, curto(Object.values(e).find((v) => typeof v === 'string') || '', 70)];
    }
  }

  // O mesmo resumo, no tempo do pedido (ainda não aconteceu).
  function pedidoFerramenta(nome, e = {}) {
    const curtoNome = nome.startsWith('mcp__') ? nome.split('__').slice(2).join(' ') : nome;
    // Bash: o comando em si, não a descrição que o próprio modelo escreveu.
    const alvo = nome === 'Bash' ? curto(e.command) : resumoFerramenta(nome, e)[1];
    const verbo = {
      Bash: 'quer rodar', Read: 'quer ler', Edit: 'quer editar', MultiEdit: 'quer editar', Write: 'quer escrever',
      Grep: 'quer buscar', Glob: 'quer procurar arquivos', Skill: 'quer usar a skill', Agent: 'quer chamar um agente',
      Task: 'quer chamar um agente', WebFetch: 'quer abrir', WebSearch: 'quer pesquisar',
    }[curtoNome];
    return verbo ? [verbo, alvo] : ['quer usar', `${curtoNome}${alvo ? ` ${alvo}` : ''}`];
  }

  function linhaFerramenta(bloco) {
    const [verbo, alvo] = resumoFerramenta(bloco.name, bloco.input);
    const el = document.createElement('details');
    el.className = 'ferramenta';
    const corpo = bloco.name === 'Bash' ? bloco.input.command : JSON.stringify(bloco.input, null, 2);
    el.innerHTML = `<summary><span class="estado-ferramenta"></span><svg class="ico"><use href="#i-ferramenta"/></svg>
        <span class="verbo">${esc(verbo)}</span><span class="alvo">${esc(alvo)}</span></summary>
      <pre class="entrada-ferramenta">${esc(curto(corpo, 6000))}</pre>`;
    ferramentas.set(bloco.id, el);
    noGrupo(el);
  }

  function resultadoFerramenta(r) {
    const el = ferramentas.get(r.tool_use_id);
    if (!el) return;
    let texto = typeof r.content === 'string' ? r.content
      : (r.content || []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
    if (texto.length > 6000) texto = texto.slice(0, 6000) + '\n…';
    el.classList.add(r.is_error ? 'falhou' : 'feito');
    const pre = document.createElement('pre');
    pre.className = 'saida-ferramenta';
    pre.textContent = texto || '(sem saída)';
    el.append(pre);
  }

  // O Markdown de cada bloco de texto, como o motor escreveu: é o que o botão de
  // copiar e o /copy levam (não o texto já desenhado).
  const fonteMd = new WeakMap();
  const markdownDoGrupo = (g) => [...g.querySelectorAll('.texto-claude:not(.rascunho)')]
    .map((x) => String(fonteMd.has(x) ? fonteMd.get(x) : x.innerText).trim()).filter(Boolean).join('\n\n');
  async function copiarResposta(botao) {
    const texto = markdownDoGrupo(botao.closest('.msg-claude'));
    if (!texto) return;
    try { await navigator.clipboard.writeText(texto); } catch (e) { aviso(`Não consegui copiar: ${e.message}`, 'erro'); return; }
    botao.classList.add('copiado');
    botao.title = 'Copiado';
    setTimeout(() => { botao.classList.remove('copiado'); botao.title = 'Copiar esta resposta'; }, 1500);
  }
  function textoClaude(t) {
    if (!t.trim()) return;
    const el = document.createElement('div');
    el.className = 'md texto-claude';
    fonteMd.set(el, t);
    el.innerHTML = md(t);
    marcarCaminhos(el);
    linkificarDominios(el);
    botoesDeCodigo(el);
    noGrupo(el);
  }

  // Bloco de código na conversa: Copiar e "▶ Terminal" (escreve no terminal
  // do app sem executar; a pessoa confere e aperta Enter).
  function botoesDeCodigo(raiz) {
    for (const pre of raiz.querySelectorAll('pre')) {
      if (pre.parentElement.classList.contains('caixa-codigo')) continue;
      // Os botões ficam numa caixa em volta do bloco (que não rola): dentro
      // do bloco, rolar para o lado arrastava os botões para cima do texto.
      const embrulho = document.createElement('div');
      embrulho.className = 'caixa-codigo';
      pre.before(embrulho);
      embrulho.append(pre);
      const barra = document.createElement('div');
      barra.className = 'acoes-codigo';
      barra.innerHTML = '<button type="button" data-codigo="copiar" title="Copiar">Copiar</button><button type="button" data-codigo="terminal" title="Escrever no terminal do app (sem executar)">▶ Terminal</button>';
      embrulho.append(barra);
    }
  }

  // Caminhos absolutos ou com ~ escritos como código viram clicáveis: abrem
  // no explorador de arquivos (pasta abre; arquivo aparece selecionado).
  const PARECE_CAMINHO = /^(~|\/)[^\s`'"<>|]*[^\s`'"<>|.,:;)]$/;
  // Nome de arquivo sem caminho completo ("video.mp4", "app/main.js"): também
  // vira clicável; o app procura na pasta da conversa, nas pastas dos caminhos
  // citados na mesma mensagem, em Downloads, na Área de Trabalho e na pasta pessoal.
  const PARECE_ARQUIVO = /^(?!-)(?!.*\.\.)[\w@+-][\w@+.\/-]*\.[A-Za-z][A-Za-z0-9]{0,5}$/;
  // Endereço escrito sem "http://" ("sistema.exemplo.com.br", "painel.exemplo.com/login")
  // também é link: abre como http://, com as mesmas regras (Ctrl+clique, dica do
  // host, confirmação). Só conta como domínio o que termina num sufixo de site
  // conhecido; nome de arquivo ("app.js", "README.md", "config.validar") não.
  const SUFIXO_SITE = /\.(com|net|org|br|io|dev|app|gov|edu|info|biz|me|co|ai|us|uk|pt|es|de|fr|it|ar|cl|mx|uy|eu|cloud|online|site|tech|xyz|local|lan|internal|home|intra|corp)$/i;
  const DOMINIO = /^((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})(?::\d{1,5})?(?:[/?#][^\s<>"'`]*)?$/i;
  function pareceDominio(t) {
    const m = String(t || '').trim().match(DOMINIO);
    if (!m) return false;
    const host = m[1];
    if (/\.(md|js|ts|mjs|cjs|json|txt|sh|html?|css|png|jpe?g|gif|svg|pdf|ya?ml|toml|lock|log|csv|xml|zip)$/i.test(host)) return false;
    return SUFIXO_SITE.test(host);
  }
  // Texto corrido: o Markdown só faz link de "www." e "http(s)://"; aqui o
  // domínio sem esquema também vira link (fora de código, de link e de bloco).
  function linkificarDominios(raiz) {
    const andar = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && n.parentElement.closest('a, code, pre, .cartao-pedido') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nos = [];
    while (andar.nextNode()) nos.push(andar.currentNode);
    const PALAVRA = /(^|[\s(\["'«])([a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?::\d{1,5})?(?:[/?#][^\s<>"'`)\]»]*)?)/gi;
    for (const no of nos) {
      const texto = no.nodeValue;
      if (!texto || texto.indexOf('.') < 0) continue;
      const pedacos = [];
      let ultimo = 0;
      let m;
      PALAVRA.lastIndex = 0;
      while ((m = PALAVRA.exec(texto))) {
        let alvo = m[2].replace(/[.,;:!?]+$/, ''); // pontuação do fim da frase não é do endereço
        if (!pareceDominio(alvo)) continue;
        const ini = m.index + m[1].length;
        pedacos.push(document.createTextNode(texto.slice(ultimo, ini)));
        const a = document.createElement('a');
        a.href = `http://${alvo}`;
        a.textContent = alvo;
        pedacos.push(a);
        ultimo = ini + alvo.length;
      }
      if (!pedacos.length) continue;
      pedacos.push(document.createTextNode(texto.slice(ultimo)));
      no.replaceWith(...pedacos);
    }
  }
  function marcarCaminhos(raiz) {
    const codigos = [...raiz.querySelectorAll('code')].filter((c) => !c.closest('pre'));
    const dicas = codigos.map((c) => c.textContent.trim()).filter((t) => PARECE_CAMINHO.test(t) && t.length > 2);
    for (const c of codigos) {
      const t = c.textContent.trim();
      if (pareceDominio(t)) { // "sistema.exemplo.com.br" em código é endereço, não arquivo
        const a = document.createElement('a');
        a.href = `http://${t}`;
        a.textContent = t;
        c.replaceChildren(a);
        continue;
      }
      if (PARECE_CAMINHO.test(t) && t.length > 2) { c.classList.add('caminho-clicavel'); c.title = 'Abrir no explorador de arquivos'; }
      else if (PARECE_ARQUIVO.test(t)) {
        c.classList.add('caminho-clicavel');
        c.title = 'Procurar e abrir no explorador de arquivos';
        if (dicas.length) c.dataset.dicas = JSON.stringify(dicas);
      }
    }
  }

  function saidaDeComando(t) {
    const m = String(t).match(/<local-command-(stdout|stderr)>([\s\S]*?)<\/local-command-\1>/);
    if (!m || !m[2].trim()) return;
    grupo = null;
    const el = document.createElement('div');
    el.className = `saida-comando${m[1] === 'stderr' ? ' erro' : ''}`;
    el.textContent = m[2].replace(/\x1b\[[0-9;]*m/g, '').trim();
    caixa.append(el);
  }

  function aviso(texto, tipo = '') {
    grupo = null;
    const el = document.createElement('div');
    el.className = `aviso-conversa ${tipo}`;
    el.textContent = texto;
    caixa.append(el);
  }

  // Aviso sobre um comando que não foi enviado: o comando fica como código
  // (não se traduz) e cada frase é um pedaço próprio (traduzível).
  function avisoComando(cmd, frase, depois = '') {
    grupo = null;
    const el = document.createElement('div');
    el.className = 'aviso-conversa aviso-comando';
    el.innerHTML = `<code>${esc(cmd)}</code> <span>${esc(frase)}</span>${depois ? ` — <span>${esc(depois)}</span>` : ''}`;
    caixa.append(el);
    colado = true; rolar();
  }
  // O Claude respondeu "/x isn't available in this environment.": o texto dele fica
  // e o app diz, em português, o que isso quer dizer e como rodar o comando.
  function avisoIndisponivel(ev) {
    grupo = null;
    const el = document.createElement('div');
    el.className = 'aviso-conversa aviso-comando aviso-indisponivel';
    el.innerHTML = `<code>/${esc(ev.naoDisponivel)}</code> <span>só existe na tela do terminal do Claude; nesta conversa ele não roda.</span> <button type="button" class="botao-texto" data-abrir-terminal title="Cola no terminal do app o Claude com uma cópia desta conversa e o comando; nada roda sem você apertar Enter lá">Abrir no terminal</button>`;
    el.querySelector('[data-abrir-terminal]').addEventListener('click', () => {
      if (window.orqComandos) window.orqComandos.abrirNoTerminal(ev.naoDisponivel, ev.comando);
    });
    caixa.append(el);
  }
  const conversaCodex = () => ((listaConversas.find((c) => c.id === ativa) || {}).motor || infoAtual.motor) === 'codex';

  function limparRascunho() {
    if (rascunho) rascunho.remove();
    rascunho = null; rascunhoTexto = '';
  }

  function desenharEvento(ev) {
    horaEvento = ev.ts || null;
    try { desenharEventoAgora(ev); } finally { horaEvento = undefined; }
  }
  function desenharEventoAgora(ev) {
    if (ev.sub) return; // por dentro de um subagente: só o resumo dele aparece
    if (ev.tipo === 'shell') return blocoShell(ev);
    if (ev.tipo === 'shell-fim') return atualizarShell(ev);
    // O "Usage: /config" que o Claude mostra vira a lista do popup de configurações.
    if (ev.tipo === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
      for (const b of ev.message.content) if (b.type === 'text' && /^\s*Usage: \/config\b/.test(b.text || '')) aprenderUsoConfig(b.text);
    }
    if (ev.tipo === 'user') {
      const c = ev.message.content;
      // Texto do usuário ao vivo já virou balão na hora de mandar (ev.local); o
      // que o Claude devolve depois é eco (ex.: o comando inicial) e não se
      // repete. Do histórico (ev.antigo) vem tudo. A saída de um comando
      // (/model, /usage…) aparece sempre.
      const eco = !ev.local && !ev.antigo;
      // Imagens mandadas pelo usuário viram miniaturas no balão.
      if (!eco && Array.isArray(c) && c.some((b) => b.type === 'image')) balaoImagens(c.filter((b) => b.type === 'image'));
      const textos = typeof c === 'string' ? [c] : c.filter((b) => b.type === 'text').map((b) => b.text);
      for (const t of textos) saidaDeComando(t);
      if (typeof c === 'string') return eco ? undefined : balaoUsuario(c);
      for (const b of c) {
        if (eco && b.type !== 'tool_result') continue;
        if (b.type === 'tool_result') resultadoFerramenta(b);
        else if (b.type === 'text' && !ev.antigo) balaoUsuario(b.text);
        else if (b.type === 'text' && ev.antigo) balaoUsuario(b.text);
      }
    } else if (ev.tipo === 'assistant') {
      for (const b of ev.message.content || []) {
        if (b.type === 'text') { limparRascunho(); textoClaude(b.text); }
        else if (b.type === 'tool_use') linhaFerramenta(b);
      }
      if (ev.naoDisponivel) avisoIndisponivel(ev);
    } else if (ev.tipo === 'resultado') {
      limparRascunho();
      if (ev.erro) aviso(ev.texto || 'O turno terminou com erro.', 'erro');
      grupo = null;
    } else if (ev.tipo === 'encerrada' && ev.conversa) {
      // /exit: só esta conversa foi encerrada; a tela fica limpa, com o caminho de volta.
      limparRascunho(); grupo = null;
      const el = document.createElement('div');
      el.className = 'rodada-encerrada conversa-encerrada';
      el.innerHTML = `<strong>Conversa encerrada</strong><span>A sessão desta conversa foi fechada e está guardada. O app continua aberto, e a próxima mensagem começa uma sessão nova.</span>
        ${ev.podeVoltar ? '<button type="button" class="botao secundario" data-voltar-sessao>Voltar à sessão anterior</button>' : ''}`;
      caixa.append(el);
    } else if (ev.tipo === 'encerrada') {
      limparRascunho(); grupo = null;
      const el = document.createElement('div');
      el.className = 'rodada-encerrada';
      el.innerHTML = `<strong>Rodada encerrada</strong><span>O orquestrador saiu. Na próxima vez que abrir o app, começa uma rodada nova.</span>
        <button type="button" class="botao primario" data-nova-rodada>Começar nova rodada agora</button>`;
      caixa.append(el);
    } else if (ev.tipo === 'fim' || ev.tipo === 'erro' || ev.tipo === 'aviso') {
      limparRascunho();
      aviso(ev.texto, ev.tipo === 'erro' ? 'erro' : '');
    } else if (ev.tipo === 'limpa') {
      // /clear: o que veio antes saiu da tela; fica a divisória.
      limparRascunho(); grupo = null;
      const el = document.createElement('div');
      el.className = 'conversa-limpa';
      el.setAttribute('role', 'separator');
      el.innerHTML = '<span>Conversa limpa</span>';
      caixa.append(el);
    }
  }

  // --- links na conversa -------------------------------------------------------
  // Ctrl+clique abre no navegador do sistema (pelo processo principal, que só
  // aceita http/https). Ao passar o mouse, a dica mostra o endereço de verdade
  // (em punycode: "раураl.com" aparece como xn--…). Link com usuário e senha
  // embutidos nunca abre; texto que parece outro endereço pede confirmação.
  const linksAbertos = []; // para os testes de tela
  function analisarLink(a) {
    let u;
    const bruto = String(a.getAttribute('href') || '').trim();
    if (pareceDominio(bruto)) { try { u = new URL(`http://${bruto}`); } catch { /* cai abaixo */ } }
    if (!u) try { u = new URL(bruto, location.href); } catch { return { erro: 'Endereço inválido: o app não abre' }; }
    if (!['http:', 'https:'].includes(u.protocol)) return { erro: 'Só links http e https abrem' };
    if (u.username || u.password) return { erro: 'Link com usuário e senha embutidos: o app não abre' };
    return { url: u.href, host: u.host, hostTexto: hostDoTexto(a.textContent) };
  }
  // O texto do link parece um endereço? Devolve o host dele (em punycode).
  function hostDoTexto(t) {
    const m = String(t || '').trim().match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^\s/@]+@)?([^\s/:?#@]+\.[^\s/:?#@]*[^\s/:?#@.\d][^\s/:?#@.]*)(?::\d+)?(?:[/?#]\S*)?$/i);
    // Nome de arquivo ("README.md", "app.js") não é endereço.
    if (!m || (!/:\/\/|^www\./i.test(t.trim()) && ARQUIVO_NAO_HOST.test(m[1]))) return null;
    try { return new URL(`http://${m[1]}`).hostname; } catch { return null; }
  }
  const ARQUIVO_NAO_HOST = /\.(md|js|ts|mjs|cjs|json|txt|py|sh|html?|css|png|jpe?g|gif|svg|pdf|ya?ml|toml|lock|log|csv|xml|zip)$/i;
  const semWww = (h) => String(h || '').toLowerCase().replace(/^www\./, '');
  function mesmoLugar(hostTexto, host) {
    const a = semWww(hostTexto), b = semWww(String(host).replace(/:\d+$/, ''));
    return a === b || b.endsWith(`.${a}`) || a.endsWith(`.${b}`);
  }
  // Link que aponta para um arquivo ou pasta local ("[relatorio.md](/home/ana/relatorio.md)",
  // "app/main.js:12") não é endereço web: abre no explorador de arquivos como o
  // caminho em `código` (pasta abre; arquivo aparece selecionado). "file://" o
  // DOMPurify já tira do Markdown.
  const caminhosAbertos = []; // para os testes de tela
  function caminhoDoLink(a) {
    const bruto = String(a.getAttribute('href') || '').trim();
    if (!bruto || bruto.startsWith('#') || bruto.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(bruto)) return null;
    if (pareceDominio(bruto)) return null; // "sistema.exemplo.com.br" é site, não arquivo
    let p = bruto.replace(/#.*$/, '');
    try { p = decodeURI(p); } catch { /* fica como veio */ }
    p = p.replace(/:\d+(?::\d+)?$/, ''); // "arquivo.js:12" → linha não faz parte do caminho
    return PARECE_CAMINHO.test(p) || PARECE_ARQUIVO.test(p) ? p : null;
  }
  async function abrirCaminhoDoLink(a, p) {
    const ok = window.orq.abrirCaminho ? await window.orq.abrirCaminho(p, { pasta: infoAtual.pasta || '', dicas: [] }) : false;
    if (ok) { caminhosAbertos.push(ok); a.classList.remove('caminho-sumiu'); return; }
    a.classList.add('caminho-sumiu');
    a.title = 'Este caminho não existe (ou não está acessível daqui)';
  }
  async function abrirLink(url) {
    const r = window.orq.abrirLink ? await window.orq.abrirLink(url) : false;
    if (r) linksAbertos.push(url); else aviso('O app não abriu este link.', 'erro');
  }
  function ctrlCliqueLink(a) {
    const l = analisarLink(a);
    if (l.erro) { aviso(`${l.erro}.`, 'erro'); return; }
    if (l.hostTexto && !mesmoLugar(l.hostTexto, l.host)) { confirmarLink(l); return; }
    abrirLink(l.url);
  }
  // Confirmação dentro do app (nada de confirm() do navegador).
  function confirmarLink(l) {
    abrirPopup('Link para outro endereço', `<div class="confirmar-link">
      <p><span>O texto do link mostra</span> <code>${esc(l.hostTexto)}</code><span>, mas ele leva a</span> <code>${esc(l.host)}</code>.</p>
      <p class="popup-nota"><span>Endereço completo:</span> <code>${esc(l.url)}</code></p>
      <div class="perm-acoes"><button type="button" class="botao secundario" data-link-cancelar>Cancelar</button>
        <button type="button" class="botao primario" data-link-abrir>Abrir mesmo assim</button></div></div>`);
    const corpo = $('popup-corpo');
    corpo.querySelector('[data-link-cancelar]').addEventListener('click', fecharPopup);
    corpo.querySelector('[data-link-abrir]').addEventListener('click', () => { fecharPopup(); abrirLink(l.url); });
    corpo.querySelector('[data-link-cancelar]').focus();
  }
  // Dica ao passar o mouse: "Ctrl+clique para abrir · host".
  const dicaLink = document.createElement('div');
  dicaLink.className = 'dica-link';
  dicaLink.hidden = true;
  dicaLink.setAttribute('role', 'tooltip');
  document.body.append(dicaLink);
  caixa.addEventListener('mouseover', (ev) => {
    const a = ev.target.closest('a[href]');
    if (!a) return;
    if (caminhoDoLink(a)) { dicaLink.hidden = true; if (!a.title) a.title = 'Abrir no explorador de arquivos'; return; }
    const l = analisarLink(a);
    dicaLink.classList.toggle('recusado', !!l.erro);
    dicaLink.innerHTML = l.erro ? `<span>${esc(l.erro)}</span>`
      : `<span>Ctrl+clique para abrir</span> <code class="host-link">${esc(l.host)}</code>`;
    dicaLink.hidden = false;
    const r = a.getBoundingClientRect();
    const larg = dicaLink.offsetWidth;
    dicaLink.style.left = `${Math.max(8, Math.min(r.left, innerWidth - larg - 8))}px`;
    dicaLink.style.top = `${r.top - dicaLink.offsetHeight - 6 < 8 ? r.bottom + 6 : r.top - dicaLink.offsetHeight - 6}px`;
  });
  caixa.addEventListener('mouseout', (ev) => { if (ev.target.closest('a[href]')) dicaLink.hidden = true; });
  caixa.addEventListener('scroll', () => { dicaLink.hidden = true; });

  // --- perguntas e permissões --------------------------------------------
  function cartaoPedido(p) {
    if (document.querySelector(`[data-pedido="${CSS.escape(p.id)}"]`)) return;
    const el = document.createElement('div');
    el.className = 'cartao-pedido';
    el.dataset.pedido = p.id;
    if (p.ferramenta === 'AskUserQuestion') {
      // Resposta secreta (isSecret, do Codex): campo de senha, sem print, e a
      // resposta nunca volta à tela. Texto livre: sempre, a não ser que o
      // Codex diga que a pergunta só aceita as opções (isOther false).
      const campoLivre = (q) => (q.isSecret
        ? '<input type="password" class="outra secreta" autocomplete="off" spellcheck="false" placeholder="Resposta secreta…  (Enter responde)">'
          + '<p class="nota aviso-secreta">Resposta secreta: não aparece na tela nem no histórico do app. O Codex guarda o que você digitar no histórico dele (~/.codex/sessions/).</p>'
        : q.isOther === false && (q.options || []).length ? ''
          : '<textarea class="outra" rows="1" placeholder="Outra resposta…  (Enter responde · Shift+Enter quebra linha · Ctrl+V cola print)"></textarea>');
      el.innerHTML = (p.entrada.questions || []).map((q, i) => `
        <fieldset class="pergunta" data-i="${i}" data-multi="${q.multiSelect ? 1 : 0}">
          <legend><span class="etiqueta">${esc(q.header || 'Pergunta')}</span>${esc(q.question)}${q.multiSelect ? '<span class="dica-multi">Pode marcar mais de uma</span>' : ''}</legend>
          <div class="opcoes">${(q.options || []).map((o) => `
            <button type="button" class="opcao ${q.multiSelect ? 'multi' : 'unica'}" data-rotulo="${esc(o.label)}" role="${q.multiSelect ? 'checkbox' : 'radio'}" aria-checked="false">
              <strong>${esc(o.label)}</strong>${o.description ? `<span>${esc(o.description)}</span>` : ''}${o.preview ? `<pre class="previa">${esc(o.preview)}</pre>` : ''}</button>`).join('')}
          </div>
          ${campoLivre(q)}
          <div class="anexos anexos-pergunta" hidden></div>
        </fieldset>`).join('') +
        '<div class="acoes"><button type="button" class="botao primario" data-enviar-resposta>Responder</button></div>';
    } else if (p.tipo === 'elicitacao') {
      cartaoMcp(el, p);
    } else if (p.ferramenta === 'ExitPlanMode' && !conversaCodex() && p.entrada && typeof p.entrada.plan === 'string') {
      cartaoPlano(el, p);
    } else {
      // Quem pede é a conversa onde o pedido apareceu, no tempo certo: "Ana
      // quer rodar: git push" (e não "O orquestrador pede permissão: Rodou").
      const [verbo, alvo] = pedidoFerramenta(p.ferramenta, p.entrada);
      const corpo = p.ferramenta === 'Bash' ? p.entrada.command : JSON.stringify(p.entrada, null, 2);
      const conv = listaConversas.find((c) => c.id === ativa);
      // O nome sai igual ao da lista da lateral (lá "Conversa 2" também vira "Conversation 2" em inglês).
      const quem = `<span class="quem-pede">${!conv || conv.orquestrador ? 'O orquestrador' : esc(conv.titulo)}</span>`;
      const cabeca = `<div class="titulo-pedido"><span class="ponto permissao"></span>${quem} <span class="verbo-pedido">${esc(verbo)}:</span> <strong>${esc(alvo)}</strong></div>
        <pre class="entrada-ferramenta">${esc(curto(corpo, 3000))}</pre>`;
      if (conversaCodex()) {
        // Codex: as respostas dele (sessão, prefixo, cancelar) entram com o cartão próprio do P2.
        el.innerHTML = `${cabeca}<div class="acoes"><button type="button" class="botao primario" data-permitir="1">Permitir</button>
          <button type="button" class="botao secundario" data-permitir="0">Negar</button></div>`;
      } else {
        // Claude: três saídas (desta vez, sempre com o alcance, negar dizendo o que fazer) e o motivo à vista.
        el.classList.add('cartao-permissao');
        el.tabIndex = 0;
        el.dataset.alvo = alvo;
        el.dataset.corpo = curto(corpo, 300);
        el.innerHTML = `${cabeca}${p.motivo ? `<p class="motivo-pedido"><strong>Por que pergunta:</strong> <span data-sem-traducao>${esc(p.motivo)}</span></p>` : ''}<div class="area-permissao"></div>`;
        permissaoInicio(el, p);
        el.addEventListener('keydown', (ev) => {
          if (cfg.teclasNosCartoes === false || ev.ctrlKey || ev.altKey || ev.metaKey || ev.target.closest('input, textarea, select')) return;
          if (!/^[1-9]$/.test(ev.key)) return;
          const b = el.querySelectorAll('.saidas-permissao [data-perm]')[Number(ev.key) - 1];
          if (b) { ev.preventDefault(); b.click(); }
        });
      }
    }
    grupo = null;
    caixa.append(el);
    colado = true; rolar();
  }

  // --- cartão do pedido de dado de um servidor MCP --------------------------------------
  // O pedido chega do processo principal já conferido (elicitacao.js): servidor, mensagem,
  // campos (texto, número, sim/não, lista; segredo mascarado) ou, no modo página, o site.
  function cartaoMcp(el, p) {
    el.classList.add('cartao-mcp');
    el.tabIndex = 0;
    const servidor = `<strong data-sem-traducao>${esc(p.servidor)}</strong>`;
    const mensagem = p.mensagem ? `<p class="motivo-pedido"><strong>Mensagem do servidor:</strong> <span data-sem-traducao>${esc(p.mensagem)}</span></p>` : '';
    const recusarCancelar = '<button type="button" class="botao secundario" data-mcp="recusar">Recusar</button>';
    if (p.modo === 'url' && p.ok) {
      el.innerHTML = `<div class="titulo-pedido"><span class="ponto permissao"></span><span><span>O servidor</span> ${servidor} <span>(MCP) pede que você abra uma página</span></span></div>${mensagem}
        <dl class="sempre-regra"><dt>Site</dt><dd><strong class="site-mcp" data-sem-traducao>${esc(p.site)}</strong></dd><dt>Endereço</dt><dd data-sem-traducao><code>${esc(curto(p.url, 400))}</code></dd></dl>
        <p class="nota aviso-recusa"><span>Confira o site antes de abrir. A página abre no seu navegador; nada é digitado aqui no app.</span></p>
        <div class="acoes"><button type="button" class="botao primario" data-mcp="abrir">Abrir no navegador</button>${recusarCancelar}</div>`;
      return;
    }
    const campo = (c) => {
      const attrs = `data-campo="${esc(c.nome)}" data-tipo="${c.tipo}"`;
      const entrada = c.tipo === 'sim-nao' ? `<input type="checkbox" ${attrs}${c.padrao ? ' checked' : ''}>`
        : c.tipo === 'lista' ? `<select ${attrs}>${c.obrigatorio && c.padrao ? '' : '<option value=""></option>'}${c.opcoes.map((o) => `<option value="${esc(o.valor)}"${c.padrao === o.valor ? ' selected' : ''} data-sem-traducao>${esc(o.rotulo)}</option>`).join('')}</select>`
          : `<input ${attrs} type="${c.secreto ? 'password' : c.formato === 'email' ? 'email' : 'text'}"${c.tipo !== 'texto' ? ' inputmode="decimal"' : ''} autocomplete="off" spellcheck="false" value="${c.padrao !== undefined && !c.secreto ? esc(String(c.padrao)) : ''}"${c.secreto ? ' placeholder="não aparece na tela"' : ''}>`;
      return `<label class="campo-mcp${c.tipo === 'sim-nao' ? ' em-linha' : ''}"><span><span data-sem-traducao>${esc(c.rotulo)}</span>${c.obrigatorio ? ' <em title="obrigatório">*</em>' : ''}</span>${entrada}${c.descricao ? `<small data-sem-traducao>${esc(c.descricao)}</small>` : ''}</label>`;
    };
    el.innerHTML = `<div class="titulo-pedido"><span class="ponto permissao"></span><span><span>O servidor</span> ${servidor} <span>(MCP) pede um dado</span></span></div>${mensagem}
      ${p.ok ? `${(p.campos || []).map(campo).join('')}
        <p class="nota"><span>O que você preencher vai só para esse servidor. Campo de segredo não aparece na tela nem no histórico do app.</span></p>
        <p class="erro-mcp" role="alert" data-sem-traducao></p>`
    : `<p class="nota aviso-recusa"><span>Este pedido tem um formato que o app não sabe mostrar; só dá para recusar.</span> <span data-sem-traducao>(${esc(p.problema || '')})</span></p>`}
      <div class="acoes">${p.ok ? '<button type="button" class="botao primario" data-mcp="enviar">Enviar</button>' : ''}${recusarCancelar}<button type="button" class="botao secundario" data-mcp="cancelar">Cancelar o pedido</button></div>`;
  }
  async function clicouNoMcp(cartao, acao, deVerdade) {
    const p = pedidoDoCartao(cartao);
    const servidor = `<strong data-sem-traducao>${esc(p.servidor || '')}</strong>`;
    const fechar = (classe, html) => { cartao.classList.add('respondido'); cartao.removeAttribute('tabindex'); cartao.innerHTML = `<span class="marca-resposta ${classe}" aria-hidden="true">${classe === 'sim' ? '✓' : classe === 'nao' ? '✕' : '↗'}</span>${html}`; };
    if (acao === 'recusar') {
      await C.responder(ativa, cartao.dataset.pedido, { acao: 'decline' });
      return fechar('nao', `<span>Recusado</span> · <span>o servidor</span> ${servidor} <span>não recebeu nada</span>`);
    }
    if (acao === 'cancelar') {
      await C.responder(ativa, cartao.dataset.pedido, { acao: 'cancel' });
      return fechar('nao', `<span>Pedido cancelado</span> · <span>a ferramenta do servidor</span> ${servidor} <span>parou</span>`);
    }
    if (acao === 'abrir') {
      if (!deVerdade) return undefined; // abrir uma página no navegador só com o clique da pessoa
      await C.responder(ativa, cartao.dataset.pedido, { acao: 'accept' });
      return fechar('abriu', `<span>Página aberta no navegador</span> · <strong data-sem-traducao>${esc(p.site || '')}</strong>`);
    }
    if (acao !== 'enviar') return undefined;
    const conteudo = {};
    for (const c of cartao.querySelectorAll('[data-campo]')) conteudo[c.dataset.campo] = c.type === 'checkbox' ? c.checked : c.value;
    const r = await C.responder(ativa, cartao.dataset.pedido, { acao: 'accept', conteudo });
    if (r && r.erro) {
      cartao.querySelector('.erro-mcp').textContent = r.erro;
      const culpado = [...cartao.querySelectorAll('[data-campo]')].find((c) => c.dataset.campo === r.campo);
      if (culpado) culpado.focus();
      return undefined;
    }
    // O resumo não repete segredo: campo mascarado vira "•••".
    const resumo = (p.campos || []).filter((c) => conteudo[c.nome] !== '' && conteudo[c.nome] !== undefined).map((c) => {
      const v = conteudo[c.nome];
      const texto = c.secreto ? '•••' : c.tipo === 'sim-nao' ? (v ? 'sim' : 'não') : c.tipo === 'lista' ? ((c.opcoes.find((o) => o.valor === v) || {}).rotulo || v) : curto(String(v), 60);
      return `<span data-sem-traducao>${esc(c.rotulo)}: ${esc(texto)}</span>`;
    });
    return fechar('sim', `<span>Enviado ao servidor</span> ${servidor}${resumo.length ? ` · ${resumo.join(' · ')}` : ''}`);
  }

  // --- cartão do plano (plano 2.3): o Claude terminou de planejar e pede para começar ----
  // O plano vem em Markdown (entrada.plan). Três saídas; "Editar o plano" troca o texto
  // formatado por um campo com o Markdown, e aprovar manda a versão editada.
  const quemPede = () => { const conv = listaConversas.find((c) => c.id === ativa); return !conv || conv.orquestrador ? 'O orquestrador' : esc(conv.titulo); };
  function cartaoPlano(el, p) {
    el.classList.add('cartao-plano');
    el.tabIndex = 0;
    el.innerHTML = `<div class="titulo-pedido titulo-plano"><span class="ponto permissao"></span><span><span class="quem-pede">${quemPede()}</span> <span>terminou o plano e pede para começar</span></span>
        <button type="button" class="botao-texto" data-plano="editar">Editar o plano</button></div>
      <div class="plano-area"></div><div class="area-permissao"></div>`;
    planoTexto(el, p.entrada.plan);
    planoInicio(el);
    el.addEventListener('keydown', (ev) => {
      if (cfg.teclasNosCartoes === false || ev.ctrlKey || ev.altKey || ev.metaKey || ev.target.closest('input, textarea, select')) return;
      if (!/^[1-9]$/.test(ev.key)) return;
      const b = el.querySelectorAll('.saidas-plano [data-plano]')[Number(ev.key) - 1];
      if (b) { ev.preventDefault(); b.click(); }
    });
  }
  function planoTexto(el, markdown, { escondido = false } = {}) {
    const area = el.querySelector('.plano-area');
    area.innerHTML = '<div class="md plano-texto" data-sem-traducao></div>';
    const t = area.firstElementChild;
    t.innerHTML = md(markdown);
    t.hidden = escondido;
    marcarCaminhos(t);
  }
  function planoInicio(el) {
    const comTeclas = cfg.teclasNosCartoes !== false;
    let n = 0;
    const k = () => (comTeclas ? `<kbd data-sem-traducao>${++n}</kbd> ` : '');
    el.querySelector('.area-permissao').innerHTML = `<div class="acoes saidas-permissao saidas-plano">
        <button type="button" class="botao primario" data-plano="auto">${k()}<span>Aprovar e seguir em Auto</span></button>
        <button type="button" class="botao secundario" data-plano="perguntar">${k()}<span>Aprovar e perguntar a cada mudança</span></button>
        <button type="button" class="botao secundario" data-plano="continuar">${k()}<span>Continuar planejando…</span></button></div>
      <p class="nota"><span>"Seguir em Auto" troca o modo desta conversa para Auto. Nada começa antes de você escolher.</span></p>
      ${comTeclas ? '<p class="nota dica-teclas"><span>Com o cartão em foco, as teclas de número escolhem a saída.</span></p>' : ''}`;
  }
  function fecharPlano(cartao, html, markdown) {
    cartao.classList.add('respondido', 'plano-respondido');
    cartao.removeAttribute('tabindex');
    cartao.innerHTML = `<div class="linha-plano">${html}${markdown ? '<button type="button" class="botao-texto" data-ver-plano>Ver o plano</button>' : ''}</div><div class="plano-area"></div>`;
    if (markdown) planoTexto(cartao, markdown, { escondido: true });
  }
  async function clicouNoPlano(cartao, acao) {
    const p = pedidoDoCartao(cartao);
    const original = (p.entrada && p.entrada.plan) || '';
    const editor = cartao.querySelector('.plano-editor');
    if (acao === 'editar') {
      const botao = cartao.querySelector('[data-plano="editar"]');
      if (editor) { planoTexto(cartao, original); botao.textContent = 'Editar o plano'; return undefined; }
      cartao.querySelector('.plano-area').innerHTML = '<textarea class="plano-editor" spellcheck="false" data-sem-traducao></textarea><p class="nota"><span>Você edita o texto do plano (Markdown). O Claude segue a versão que você aprovar.</span></p>';
      cartao.querySelector('.plano-editor').value = original;
      botao.textContent = 'Descartar a edição';
      return undefined;
    }
    if (acao === 'continuar') {
      cartao.querySelector('.area-permissao').innerHTML = `<div class="painel-permissao">
          <label class="rotulo-negar"><span>O que ajustar no plano</span><textarea class="campo-negar" rows="2" placeholder="ex.: sem botão novo; ponha a exportação no menu"></textarea></label>
          <div class="acoes"><button type="button" class="botao primario" data-plano="mandar-ajuste">Enviar e continuar planejando</button><button type="button" class="botao secundario" data-plano="voltar">Voltar</button></div>
        </div>`;
      cartao.querySelector('.campo-negar').focus();
      return undefined;
    }
    if (acao === 'voltar') { planoInicio(cartao); cartao.focus(); return undefined; }
    if (acao === 'mandar-ajuste') {
      const t = cartao.querySelector('.campo-negar').value.replace(/\s+/g, ' ').trim();
      await C.responder(ativa, cartao.dataset.pedido, { permitir: false, continuarPlano: true, emVezDisso: t });
      return fecharPlano(cartao, `<span class="marca-resposta" aria-hidden="true">↻</span><span>Continua planejando</span>${t ? ` · <span>você pediu:</span> <span data-sem-traducao>"${esc(curto(t, 300))}"</span>` : ''}`, null);
    }
    if (acao === 'auto' || acao === 'perguntar') {
      const editado = editor && editor.value.trim() && editor.value !== original ? editor.value : null;
      await C.responder(ativa, cartao.dataset.pedido, { permitir: true, modo: acao === 'auto' ? 'auto' : 'default', ...(editado ? { plano: editado } : {}) });
      return fecharPlano(cartao, `<span class="marca-resposta sim" aria-hidden="true">✓</span><span>${editado ? 'Plano editado por você e aprovado' : 'Plano aprovado'}</span> · <span>${acao === 'auto' ? 'seguindo em Auto (o modo desta conversa mudou)' : 'o Claude pergunta antes de cada mudança'}</span>`, editado || original);
    }
    return undefined;
  }

  // --- cartão de permissão do Claude (plano 6.4) --------------------------------
  // p.sempre vem do processo principal: null (o Claude não sugeriu regra), { ok: true, textos }
  // ou { ok: false, motivo, textos } (comando da lista que nunca ganha "sempre").
  const ALCANCES = {
    session: { rotulo: 'Só nesta conversa', nota: 'Nada é gravado em arquivo. Vale até você fechar esta conversa.', arquivo: 'nenhum (nada é gravado)', desfazer: 'fechar a conversa, ou /permissions → remover a regra', botao: 'Permitir sempre nesta conversa', fim: 'Permitido sempre nesta conversa' },
    localSettings: { rotulo: 'Neste projeto', nota: 'Vale para toda conversa aberta nesta pasta.', arquivo: '.claude/settings.local.json desta pasta (só seu, fora do git)', desfazer: '/permissions → remover a regra, ou apagar a linha do arquivo', botao: 'Permitir sempre neste projeto', fim: 'Permitido sempre neste projeto' },
    userSettings: { rotulo: 'Em todos os seus projetos', nota: 'Vale em qualquer pasta, também no Claude Code fora do app.', arquivo: '~/.claude/settings.json', desfazer: '/permissions → remover a regra, ou apagar a linha do arquivo', botao: 'Permitir sempre em todos os projetos', fim: 'Permitido sempre em todos os seus projetos' },
  };
  const pedidoDoCartao = (cartao) => pedidos.get(cartao.dataset.pedido) || {};
  function permissaoInicio(cartao, p) {
    const comTeclas = cfg.teclasNosCartoes !== false;
    const podeSempre = !!(p.sempre && p.sempre.ok);
    let n = 0;
    const k = () => (comTeclas ? `<kbd data-sem-traducao>${++n}</kbd> ` : '');
    cartao.querySelector('.area-permissao').innerHTML = `<div class="acoes saidas-permissao">
        <button type="button" class="botao primario" data-perm="vez" data-permitir="1">${k()}<span>Permitir desta vez</span></button>
        ${podeSempre ? `<button type="button" class="botao secundario" data-perm="sempre">${k()}<span>Permitir sempre…</span></button>` : ''}
        <button type="button" class="botao secundario" data-perm="negar">${k()}<span>Negar…</span></button></div>
      ${p.sempre && !p.sempre.ok ? `<p class="nota aviso-recusa"><span>Para este tipo de comando o app não oferece "Permitir sempre": cada vez passa por você.</span> <span class="motivo-recusa">(<span>${esc(p.sempre.motivo)}</span>)</span></p>` : ''}
      ${comTeclas ? `<p class="nota dica-teclas"><span>Com o cartão em foco, as teclas de número escolhem a saída.</span></p>` : ''}`;
  }
  function permissaoSempre(cartao, p) {
    const nome = `alcance-${cartao.dataset.pedido}`;
    cartao.querySelector('.area-permissao').innerHTML = `<div class="painel-permissao">
        <h4>Permitir sempre: onde vale?</h4>
        <div class="alcances">${Object.entries(ALCANCES).map(([v, a], i) => `<label class="alcance"><input type="radio" name="${esc(nome)}" value="${v}"${i === 0 ? ' checked' : ''}><strong>${a.rotulo}</strong><span>${a.nota}</span></label>`).join('')}</div>
        <dl class="sempre-regra"></dl>
        <p class="nota sempre-copia" hidden>Antes de o Claude gravar, o app guarda a versão de agora desse arquivo.</p>
        <div class="acoes"><button type="button" class="botao primario" data-perm="confirmar-sempre"></button><button type="button" class="botao secundario" data-perm="voltar">Voltar</button></div>
      </div>`;
    const pintar = () => {
      const v = cartao.querySelector(`input[name="${CSS.escape(nome)}"]:checked`).value;
      const a = ALCANCES[v];
      cartao.querySelector('.sempre-regra').innerHTML = `<dt>Regra</dt><dd data-sem-traducao>${(p.sempre.textos || []).map((x) => `<code>${esc(x)}</code>`).join(' ')}</dd>
        <dt>Arquivo</dt><dd>${esc(a.arquivo)}</dd><dt>Para desfazer</dt><dd>${esc(a.desfazer)}</dd>`;
      cartao.querySelector('[data-perm="confirmar-sempre"]').textContent = a.botao;
      cartao.querySelector('.sempre-copia').hidden = v === 'session';
    };
    cartao.querySelector('.alcances').addEventListener('change', pintar);
    pintar();
  }
  function permissaoNegar(cartao) {
    cartao.querySelector('.area-permissao').innerHTML = `<div class="painel-permissao">
        <label class="rotulo-negar"><span>O que fazer em vez disso (opcional)</span><textarea class="campo-negar" rows="2" placeholder="ex.: rode só os testes do arquivo que mudou"></textarea></label>
        <p class="nota">O Claude recebe a recusa junto com este texto e segue por outro caminho.</p>
        <div class="acoes"><button type="button" class="botao primario" data-perm="confirmar-negar">Negar</button><button type="button" class="botao secundario" data-perm="voltar">Voltar</button></div>
      </div>`;
    cartao.querySelector('.campo-negar').focus();
  }
  function fecharPermissao(cartao, classe, html) {
    cartao.classList.add('respondido');
    cartao.removeAttribute('tabindex');
    cartao.innerHTML = `<span class="marca-resposta ${classe}" aria-hidden="true">${classe === 'nao' ? '✕' : '✓'}</span>${html}`;
  }
  async function clicouNaPermissao(cartao, acao) {
    const p = pedidoDoCartao(cartao);
    const alvo = `<code data-sem-traducao>${esc(cartao.dataset.corpo || cartao.dataset.alvo || '')}</code>`;
    if (acao === 'sempre') return permissaoSempre(cartao, p);
    if (acao === 'negar') return permissaoNegar(cartao);
    if (acao === 'voltar') { permissaoInicio(cartao, p); cartao.focus(); return undefined; }
    if (acao === 'vez') {
      await C.responder(ativa, cartao.dataset.pedido, { permitir: true });
      return fecharPermissao(cartao, 'sim', `<span>Permitido desta vez</span> · ${alvo}`);
    }
    if (acao === 'confirmar-sempre') {
      const v = cartao.querySelector('.alcances input:checked').value;
      await C.responder(ativa, cartao.dataset.pedido, { permitir: true, sempre: v });
      return fecharPermissao(cartao, 'sim', `<span>${ALCANCES[v].fim}</span> · <span>regra</span> ${(p.sempre.textos || []).map((x) => `<code data-sem-traducao>${esc(x)}</code>`).join(' ')} · <span>para desfazer:</span> <code data-sem-traducao>/permissions</code>`);
    }
    if (acao === 'confirmar-negar') {
      const t = cartao.querySelector('.campo-negar').value.replace(/\s+/g, ' ').trim();
      await C.responder(ativa, cartao.dataset.pedido, t ? { permitir: false, emVezDisso: t } : { permitir: false });
      return fecharPermissao(cartao, 'nao', `<span>Negado</span> · ${alvo}${t ? ` · <span>você disse:</span> <span data-sem-traducao>"${esc(curto(t, 300))}"</span>` : ''}`);
    }
    return undefined;
  }

  caixa.addEventListener('click', async (ev) => {
    const verPlano = ev.target.closest('[data-ver-plano]');
    if (verPlano) {
      const texto = verPlano.closest('.cartao-plano').querySelector('.plano-texto');
      texto.hidden = !texto.hidden;
      verPlano.textContent = texto.hidden ? 'Ver o plano' : 'Recolher o plano';
      return;
    }
    const noMcp = ev.target.closest('.cartao-mcp:not(.respondido) [data-mcp]');
    if (noMcp) { await clicouNoMcp(noMcp.closest('.cartao-mcp'), noMcp.dataset.mcp, ev.isTrusted === true); return; }
    const noPlano = ev.target.closest('.cartao-plano:not(.respondido) [data-plano]');
    if (noPlano) { await clicouNoPlano(noPlano.closest('.cartao-plano'), noPlano.dataset.plano); return; }
    const perm = ev.target.closest('.cartao-permissao:not(.respondido) [data-perm]');
    if (perm) { await clicouNaPermissao(perm.closest('.cartao-permissao'), perm.dataset.perm); return; }
    const cr = ev.target.closest('.copiar-resposta');
    if (cr) { copiarResposta(cr); return; }
    if (ev.target.closest('[data-parar-shell]')) { C.shellParar(ativa); return; }
    const bc = ev.target.closest('[data-codigo]');
    if (bc) {
      const texto = bc.closest('.caixa-codigo').querySelector('pre code, pre')?.textContent ?? '';
      if (bc.dataset.codigo === 'copiar') {
        try { await navigator.clipboard.writeText(texto); bc.textContent = 'Copiado'; setTimeout(() => { bc.textContent = 'Copiar'; }, 1500); } catch { /* sem área de transferência */ }
      } else if (window.orqTerminal) {
        await window.orqTerminal.colar(texto);
      }
      return;
    }
    const cam = ev.target.closest('code.caminho-clicavel');
    if (cam && window.orq.abrirCaminho) {
      let dicas = [];
      try { dicas = JSON.parse(cam.dataset.dicas || '[]'); } catch { /* sem dicas */ }
      const ok = await window.orq.abrirCaminho(cam.textContent.trim(), { pasta: infoAtual.pasta || '', dicas });
      if (!ok) { cam.classList.add('caminho-sumiu'); cam.title = 'Este caminho não existe (ou não está acessível daqui)'; }
      return;
    }
    const a = ev.target.closest('a[href]');
    if (a) { // nada de navegar dentro do app
      ev.preventDefault();
      const p = caminhoDoLink(a);
      if (p) abrirCaminhoDoLink(a, p);
      else if (ev.ctrlKey || ev.metaKey) ctrlCliqueLink(a);
      return;
    }
    if (ev.target.closest('[data-nova-rodada]')) { trocar('orquestrador'); return; }
    const voltar = ev.target.closest('[data-voltar-sessao]');
    if (voltar) {
      voltar.disabled = true;
      const r = await window.orq.comandos.reabrir(ativa);
      if (!r || r.erro || !r.ok) { voltar.disabled = false; aviso(`Não consegui voltar à sessão anterior${r && r.erro ? `: ${r.erro}` : '.'}`, 'erro'); }
      return;
    }
    const ap = ev.target.closest('.cartao-aprovacao:not(.respondido)');
    if (ap) { const d = ev.target.closest('[data-decidir]'); if (d) decidirAprovacao(ap, d.dataset.decidir === '1'); return; }
    const cartao = ev.target.closest('.cartao-pedido');
    if (!cartao) return;
    const opcao = ev.target.closest('.opcao');
    if (opcao) {
      const fs = opcao.closest('.pergunta');
      if (fs.dataset.multi !== '1') fs.querySelectorAll('.opcao').forEach((o) => o.classList.remove('marcada'));
      opcao.classList.toggle('marcada');
      fs.querySelectorAll('.opcao').forEach((o) => o.setAttribute('aria-checked', o.classList.contains('marcada') ? 'true' : 'false'));
      // Escolha única: o texto de "Outra resposta" deixa de valer. Múltipla:
      // as marcas e o texto valem juntos.
      if (fs.dataset.multi !== '1' && fs.querySelector('.outra')) fs.querySelector('.outra').value = '';
      // Uma pergunta só, de escolha única: o clique já responde.
      if (fs.dataset.multi !== '1' && cartao.querySelectorAll('.pergunta').length === 1) enviarRespostas(cartao);
      return;
    }
    if (ev.target.closest('[data-enviar-resposta]')) return enviarRespostas(cartao);
    const b = ev.target.closest('[data-permitir]');
    if (b) {
      await C.responder(ativa, cartao.dataset.pedido, { permitir: b.dataset.permitir === '1' });
      fecharPedido(cartao, b.dataset.permitir === '1' ? 'Permitido' : 'Negado');
    }
  });

  // Escrevendo em "Outra resposta": as opções marcadas deixam de valer, para
  // a tela nunca mostrar duas respostas ao mesmo tempo.
  caixa.addEventListener('input', (ev) => {
    const outra = ev.target.closest('.outra');
    if (!outra) return;
    // Cresce para baixo conforme o texto, até um limite; dali em diante rola.
    if (outra.tagName === 'TEXTAREA') {
      outra.style.height = 'auto';
      outra.style.height = Math.min(outra.scrollHeight + 2, 240) + 'px';
    }
    if (!outra.value.trim()) return;
    if (outra.closest('.pergunta').dataset.multi === '1') return; // múltipla: marcas + texto valem juntos
    outra.closest('.pergunta').querySelectorAll('.opcao.marcada').forEach((o) => o.classList.remove('marcada'));
  });
  caixa.addEventListener('keydown', (ev) => {
    const outra = ev.target.closest('.outra');
    if (outra && ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && outra.value.trim()) { ev.preventDefault(); enviarRespostas(outra.closest('.cartao-pedido')); }
  });

  async function enviarRespostas(cartao) {
    const p = pedidos.get(cartao.dataset.pedido);
    const respostas = {};
    // Prints coladas na pergunta: a resposta da pergunta só leva texto, então
    // elas vão numa mensagem logo depois (o Claude recebe as duas juntas).
    const prints = cartao._prints || [];
    if (prints.length && !window.orq.permissoes) {
      aviso('Este app foi aberto antes da versão que manda imagens: feche e abra o app. Nada foi enviado.', 'erro');
      return;
    }
    // A resposta de cada pergunta vai pela chave dela: o id (Codex), ou o
    // texto da pergunta (Claude), para duas perguntas iguais não colidirem.
    const chave = (q) => (q.id != null ? q.id : q.question);
    for (const fs of cartao.querySelectorAll('.pergunta')) {
      const q = p.entrada.questions[fs.dataset.i];
      const outra = (fs.querySelector('.outra')?.value || '').trim();
      const marcadas = [...fs.querySelectorAll('.opcao.marcada')].map((o) => o.dataset.rotulo);
      // Múltipla escolha: as marcadas e o texto de "Outra resposta" vão juntos.
      let r = fs.dataset.multi === '1' && marcadas.length && outra ? `${marcadas.join(', ')}; ${outra}` : (outra || marcadas.join(', '));
      if (!r && !prints.length) { fs.classList.add('falta'); return; }
      if (prints.length && fs === cartao.querySelector('.pergunta') && !q.isSecret) r = `${r ? `${r} ` : ''}(a print segue na próxima mensagem)`;
      respostas[chave(q)] = r;
    }
    await C.responder(ativa, cartao.dataset.pedido, { permitir: true, respostas });
    if (prints.length) {
      const q0 = p.entrada.questions[0];
      await C.mandar(ativa, `Print da minha resposta à pergunta "${q0.header || q0.question}".`, prints);
    }
    // Respondido: cada pergunta com a sua resposta embaixo, uma por bloco.
    // A secreta aparece só como •••.
    cartao.classList.add('respondido', 'respondido-perguntas');
    cartao.innerHTML = `<div class="titulo-respondido"><span class="ponto trabalhando"></span>Respondido</div>` +
      p.entrada.questions.map((q) => `<div class="resposta-dada">
        <span class="etiqueta">${esc(q.header || 'Pergunta')}</span>
        <strong>${esc(q.question)}</strong>
        <p>${q.isSecret ? '•••' : esc(respostas[chave(q)] || '')}</p></div>`).join('');
  }

  function fecharPedido(cartao, texto) {
    cartao.classList.add('respondido');
    cartao.innerHTML = `<span class="ponto trabalhando"></span>${esc(texto)}`;
  }

  // --- barra de informações ----------------------------------------------
  const nomeModelo = (m) => {
    if (!m) return '—';
    if (m === 'opusplan') return 'Opus + Sonnet';
    const x = m.match(/claude-([a-z]+)-(\d+)-(\d+)/);
    return x ? `${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}.${x[3]}` : m;
  };
  // Uma linha do popover de uso (Contexto, 5 h, a janela longa).
  function medidor(el, rotulo, pct, extra = '') {
    if (pct == null) { el.hidden = true; return; }
    el.hidden = false;
    const nivel = pct >= 80 ? 'alto' : pct >= 50 ? 'medio' : 'baixo';
    el.innerHTML = `<span class="rotulo">${rotulo}</span><span class="barra-uso"><i class="${nivel}" style="width:${Math.min(pct, 100)}%"></i></span><span class="valor" data-sem-traducao>${pct}%${extra}</span>`;
  }
  // O chip de uso: um anel com o contexto. Se a janela de 5 h ou a longa passa
  // de 80%, o chip mostra qual e quanto, sem precisar abrir (95% ou mais: vermelho).
  const tr = (x) => (window.orqI18n && window.orqI18n.t ? window.orqI18n.t(x) : x);
  function desenharUso(ctx, h5, longo, rotuloLongoPt) {
    const rotuloLongo = tr(rotuloLongoPt);
    const chip = $('chip-uso');
    const tem = [ctx, h5, longo].some((v) => v != null);
    chip.hidden = !tem;
    if (!tem) { fecharMenuUso(); return; }
    const anel = $('anel-uso');
    anel.style.setProperty('--pct', String(Math.min(ctx || 0, 100)));
    anel.dataset.nivel = ctx == null ? 'vazio' : ctx >= 90 ? 'alto' : ctx >= 75 ? 'medio' : 'baixo';
    // Sem o contexto ainda (conversa nova), o número é o da janela que houver.
    chip.querySelector('.valor').textContent = ctx != null ? `${ctx}%` : h5 != null ? `5 h ${h5}%` : `${rotuloLongo} ${longo}%`;
    const pior = Math.max(h5 == null ? -1 : h5, longo == null ? -1 : longo);
    const alerta = $('alerta-uso');
    const nivel = pior >= 95 ? 'alto' : pior >= 80 ? 'medio' : '';
    alerta.hidden = !nivel || ctx == null;
    alerta.className = `alerta-uso ${nivel}`;
    alerta.textContent = nivel ? `${(h5 == null ? -1 : h5) >= (longo == null ? -1 : longo) ? '5 h' : rotuloLongo} ${pior}%` : '';
    chip.classList.toggle('em-alerta', !!nivel);
    chip.classList.toggle('alto', nivel === 'alto');
    chip.title = [ctx != null ? `${tr('Contexto')} ${ctx}%` : '', h5 != null ? `5 h ${h5}%` : '', longo != null ? `${rotuloLongo} ${longo}%` : ''].filter(Boolean).join(' · ');
  }
  // Faixa de atividade (no lugar do "Pensando… Parar"): o que o motor faz
  // agora, o que roda em segundo plano e o Parar. Parada e sem nada, some.
  let fazendoAgora = '';
  const FAZENDO = { Bash: 'Rodando', Read: 'Lendo', Edit: 'Editando', MultiEdit: 'Editando', Write: 'Escrevendo', Grep: 'Buscando', Glob: 'Procurando arquivos', Agent: 'Com um ajudante', Task: 'Com um ajudante', WebFetch: 'Lendo uma página', WebSearch: 'Buscando na web' };
  // Roda a cada ferramenta que o motor começa a usar na conversa da frente.
  function faixaFerramenta(nome, entrada) {
    if (nome === 'AskUserQuestion') return;
    const verbo = FAZENDO[nome] || 'Usando uma ferramenta';
    const detalhe = FAZENDO[nome] && !['Agent', 'Task', 'WebSearch', 'Glob'].includes(nome) ? resumoFerramenta(nome, entrada)[1] : '';
    fazendoAgora = detalhe ? `${verbo}: ${detalhe}` : `${verbo}…`;
    if (infoAtual.ocupado) $('trabalhando-texto').textContent = fazendoAgora;
  }
  // Fila da caixa: o que foi mandado com o motor trabalhando espera aqui, no fim
  // da conversa (onde vai cair), em balão tracejado com "Enviar já" e "Tirar".
  function desenharFila(i) {
    caixa.querySelectorAll('.msg-fila').forEach((x) => x.remove());
    const fila = Array.isArray(i.fila) ? i.fila : [];
    for (const m of fila) {
      const d = document.createElement('div');
      d.className = `msg-fila${m.ja ? ' ja' : ''}`;
      d.dataset.fila = m.id;
      const estado = m.ja ? 'vai assim que o motor parar' : i.filaParada ? 'na fila, parada (o motor foi interrompido)' : 'na fila';
      d.innerHTML = `<div class="balao" data-sem-traducao>${esc(m.texto)}${m.imagens ? ` <span class="fila-imagens">🖼 ${m.imagens}</span>` : ''}</div>
        <div class="fila-acoes"><span>${estado}</span>${m.ja ? '' : `<button type="button" data-fila-ja="${esc(m.id)}" title="Interrompe o que o motor faz e manda esta mensagem agora (na caixa: Ctrl+Enter)">Enviar já</button>`}<button type="button" data-fila-tirar="${esc(m.id)}" title="Tira da fila sem mandar">Tirar ✕</button></div>`;
      caixa.append(d);
    }
    const q = $('faixa-fila');
    q.hidden = !fila.length;
    q.innerHTML = `<svg class="ico" viewBox="0 0 16 16"><rect x="2" y="3.5" width="12" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="m2.5 4.5 5.5 4 5.5-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg><span data-sem-traducao>${fila.length}</span> <span>na fila</span>`;
    q.setAttribute('aria-label', `${fila.length} ${tr('na fila')}`);
    // Só acompanha o fim da conversa quando a fila cresce (quem rolou para cima não é puxado a cada atualização).
    if (fila.length > filaDesenhada) rolar();
    filaDesenhada = fila.length;
  }
  let filaDesenhada = 0;
  // Os balões da fila ficam sempre por último, depois do que o motor for escrevendo.
  const filaNoFim = () => { for (const x of caixa.querySelectorAll('.msg-fila')) caixa.append(x); };
  // Com o motor trabalhando a caixa avisa o que o Enter faz, e o botão de enviar vira "pôr na fila".
  const LUGAR_OCUPADO = 'Trabalhando: Enter põe na fila · Ctrl+Enter corrige o rumo agora';
  let lugarParado = null;
  function desenharCaixaOcupada(ocupado) {
    if (ocupado) { if (entrada.placeholder !== LUGAR_OCUPADO) lugarParado = entrada.placeholder; entrada.placeholder = LUGAR_OCUPADO; }
    else if (entrada.placeholder === LUGAR_OCUPADO && lugarParado != null) entrada.placeholder = lugarParado;
    $('compositor').classList.toggle('ocupada', !!ocupado);
    $('enviar').title = ocupado ? 'Pôr na fila (Enter) · Ctrl+Enter corrige o rumo agora' : 'Enviar (Enter)';
    // Dicas fixas sob a caixa: o que o Enter (e o Esc) fazem agora.
    const k = (t) => `<kbd data-sem-traducao>${t}</kbd>`;
    $('dica-esc').hidden = !ocupado;
    $('dica-enter').innerHTML = modoShell()
      ? `<span>${k('Enter')} <span>roda no seu computador, na pasta</span> <code data-sem-traducao>${esc(pastaCurta())}</code></span>`
      : ocupado
        ? `<span>${k('Enter')} <span>põe na fila</span></span><span>${k('Ctrl')}+${k('Enter')} <span>corrige o rumo</span></span>`
        : `<span>${k('Enter')} <span>envia</span></span><span>${k('Shift')}+${k('Enter')} <span>quebra linha</span></span>`;
  }
  // "!" no começo da caixa: o que for digitado é um comando para rodar no computador da
  // pessoa (não uma mensagem). A caixa muda de cor e a dica diz onde ele roda.
  // E só vale se foi a própria pessoa que pôs o "!" no começo, digitando ou colando: texto
  // colocado na caixa por código (atalho, repertório, sugestão do ajudante, texto devolvido
  // depois de um erro) nunca vira comando, mesmo que ela aperte Enter em seguida. A exceção
  // é um comando que ela mesma já rodou e trouxe de volta (seta para cima, cancelar).
  let exclamacaoDaPessoa = false, valorDaPessoa = '', shellRecuperado = null;
  const rodadosNoShell = new Set();
  // O recurso vem desligado (Configurações › Avançado): sem ligar, "!" é texto comum.
  const modoShell = () => cfg.comandoNaCaixa === true && /^!/.test(entrada.value) && !anexos.length && !arquivosAnexos.length
    && ((exclamacaoDaPessoa && entrada.value === valorDaPessoa) || entrada.value === shellRecuperado);
  const pastaCurta = () => String(infoAtual.pasta || '~').replace(/^\/home\/[^/]+/, '~');
  function desenharModoShell() {
    const liga = modoShell();
    const caixaEntrada = document.querySelector('.caixa-entrada');
    if (caixaEntrada.classList.contains('modo-shell') === liga) return;
    caixaEntrada.classList.toggle('modo-shell', liga);
    desenharCaixaOcupada(infoAtual.ocupado === true);
  }
  // Bloco "Você rodou": o comando, o estado e a saída. Chega como evento 'shell' (rodando ou
  // já terminado, se a conversa foi redesenhada) e é atualizado pelo 'shell-fim'.
  function estadoDoShell(ev) {
    if (ev.estado !== 'fim') return 'rodando…';
    if (ev.tempoEsgotado) return 'tempo esgotado: o comando foi encerrado';
    if (ev.parado) return 'parado';
    // Comando que terminou na hora não ganha "em 0 s".
    const tempo = typeof ev.ms === 'number' && ev.ms >= 100 ? ` em ${(ev.ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s` : '';
    return typeof ev.codigo === 'number' && ev.codigo !== 0 ? `saiu com código ${ev.codigo}${tempo}` : `terminou${tempo}`;
  }
  function preencherShell(el, ev) {
    const fim = ev.estado === 'fim';
    el.dataset.estado = fim ? 'fim' : 'rodando';
    el.classList.toggle('falhou', fim && (ev.tempoEsgotado || (typeof ev.codigo === 'number' && ev.codigo !== 0)));
    const cortado = (n) => (n ? `<p class="nota"><span>Saída cortada:</span> <span data-sem-traducao>${Number(n).toLocaleString('pt-BR')}</span> <span>caracteres a mais.</span></p>` : '');
    const c = ev.cortado || {};
    el.innerHTML = `<div class="shell-cabeca"><span class="shell-marca" aria-hidden="true">&gt;_</span><span class="shell-titulo">Você rodou</span><code data-sem-traducao>${esc(curto(ev.comando, 400))}</code>
        <span class="shell-estado">${esc(estadoDoShell(ev))}</span>${fim ? '' : '<button type="button" class="botao-texto" data-parar-shell>Parar</button>'}</div>
      ${ev.saida ? `<pre class="shell-saida" data-sem-traducao>${esc(String(ev.saida).replace(/\x1b\[[0-9;]*m/g, '').replace(/\n+$/, ''))}</pre>${cortado(c.saida)}` : ''}
      ${ev.erro ? `<pre class="shell-saida erro" data-sem-traducao>${esc(String(ev.erro).replace(/\x1b\[[0-9;]*m/g, '').replace(/\n+$/, ''))}</pre>${cortado(c.erro)}` : ''}
      ${fim && !ev.antigo && !conversaCodex() ? '<p class="nota shell-nota">A saída vai para o Claude junto com a sua próxima mensagem.</p>' : ''}`;
  }
  function blocoShell(ev) {
    grupo = null;
    const el = document.createElement('div');
    el.className = 'msg-shell';
    if (ev.id) el.dataset.shell = ev.id;
    preencherShell(el, ev);
    caixa.append(el);
    colado = true; rolar();
  }
  function atualizarShell(ev) {
    const el = ev.id ? caixa.querySelector(`.msg-shell[data-shell="${CSS.escape(ev.id)}"]`) : null;
    if (el) preencherShell(el, { ...ev, estado: 'fim' }); else blocoShell({ ...ev, estado: 'fim', tipo: 'shell' });
    rolar();
  }
  // Roda o comando da caixa. Várias linhas (em geral uma colagem): confirma antes, e só
  // o clique de verdade no "Rodar" vale.
  async function rodarShellDaCaixa(comando, textoDaCaixa) {
    // O texto volta para a caixa (erro, cancelar): continua sendo o comando que ela escreveu.
    const devolver = () => { if (entrada.value.trim()) return; shellRecuperado = textoDaCaixa; porNaCaixa(textoDaCaixa); };
    const rodar = async () => {
      const r = await C.shell(ativa, comando);
      if (r && r.erro) { aviso(`Não rodei o comando: ${r.erro}`, 'erro'); devolver(); return; }
      rodadosNoShell.add(textoDaCaixa);
      enviados.push(textoDaCaixa); if (enviados.length > 50) enviados.shift();
      posHistorico = -1;
    };
    entrada.value = ''; ajustarAltura(); fecharSugestoes(); desenharModoShell();
    const linhasDoComando = comando.split('\n').filter((l) => l.trim()).length;
    if (linhasDoComando < 2) return rodar();
    grupo = null;
    const el = document.createElement('div');
    el.className = 'cartao-pedido confirma-shell';
    el.innerHTML = `<div class="titulo-pedido"><span class="shell-marca" aria-hidden="true">&gt;_</span><span><span>Rodar estas</span> <strong data-sem-traducao>${linhasDoComando}</strong> <span>linhas no seu computador, na pasta</span> <code data-sem-traducao>${esc(pastaCurta())}</code>?</span></div>
      <pre class="entrada-ferramenta" data-sem-traducao>${esc(curto(comando, 3000))}</pre>
      <div class="acoes"><button type="button" class="botao primario" data-rodar>Rodar</button><button type="button" class="botao secundario" data-cancelar>Cancelar</button></div>`;
    el.addEventListener('click', (ev) => {
      if (!ev.isTrusted) return; // clique feito por código não roda nem cancela
      if (ev.target.closest('[data-rodar]')) { el.remove(); rodar(); }
      else if (ev.target.closest('[data-cancelar]')) { el.remove(); devolver(); }
    });
    caixa.append(el);
    colado = true; rolar();
    return undefined;
  }
  // --- painel de atalhos ("? Atalhos" e Ctrl+/) -----------------------------------
  // Só o que funciona hoje. Os atalhos que dá para trocar (colunas, Shift+Tab)
  // aparecem como estão nas Configurações.
  function abrirAtalhos() {
    const A = window.orqAtalhos;
    const colunas = { ...(A ? A.PADRAO : {}), ...(cfg.atalhosColunas || {}) };
    const combo = (c) => (c ? (A ? A.mostrar(c) : c).split('+').map((p) => `<kbd data-sem-traducao>${esc(p === 'Comma' ? ',' : p === 'Period' ? '.' : p)}</kbd>`).join('+') : '<span class="atalho-desligado">desativado</span>');
    const teclas = (t) => t.split('+').map((p) => `<kbd data-sem-traducao>${esc(p)}</kbd>`).join('+');
    const l = (rotulo, html) => `<div class="linha-atalho"><span>${rotulo}</span><span class="teclas">${html}</span></div>`;
    abrirPopup('Atalhos', `<div class="lista-atalhos">
      <h4>Na conversa</h4>
      ${l('Enviar', teclas('Enter'))}${l('Quebrar linha', teclas('Shift+Enter'))}${l('Parar o motor', teclas('Esc'))}
      ${l('Voltar a conversa (parado, com a caixa vazia)', `${teclas('Esc')} ${teclas('Esc')}`)}
      ${l('Com o motor trabalhando: pôr na fila', teclas('Enter'))}${l('Com o motor trabalhando: corrigir o rumo', teclas('Ctrl+Enter'))}
      ${l('Trocar o modo de permissão', teclas('Ctrl+Shift+M'))}${cfg.shiftTabTrocaModo === false ? '' : l('Trocar o modo, com a caixa vazia', teclas('Shift+Tab'))}
      ${l('Trazer de volta a mensagem anterior (caixa vazia)', teclas('↑'))}
      ${l('Buscar nesta conversa', teclas('Ctrl+F'))}
      <h4>Na caixa de texto</h4>
      ${l('Comandos', teclas('/'))}${l('Skill de outra ferramenta', `${teclas('/')}${teclas('/')}`)}${l('Mencionar arquivo, nota ou workflow', teclas('@'))}
      ${cfg.comandoNaCaixa === true ? l('Rodar um comando no seu computador (no começo da caixa)', teclas('!')) : ''}
      ${l('No menu de modelo: mudar o esforço', `${teclas('←')} ${teclas('→')}`)}
      <h4>No app</h4>
      ${l('Paleta de comandos', teclas('Ctrl+K'))}${l('Esta lista', teclas('Ctrl+/'))}
      ${l('Recolher ou abrir os agentes', combo(colunas.agentes))}${l('Recolher ou abrir as demandas', combo(colunas.demandas))}
      ${l('Chamar o bichinho', teclas('Ctrl+Alt+Espaço'))}${l('Atalhos do repertório', `${teclas('Ctrl+Alt+1')} … ${teclas('9')}`)}
    </div>
    <p class="popup-nota"><span>Os atalhos das colunas e o Shift+Tab mudam em</span> <button type="button" class="botao-texto link-config" data-abrir-config-atalhos>Configurações › Atalhos</button></p>`);
    $('popup-corpo').querySelector('[data-abrir-config-atalhos]').addEventListener('click', () => {
      fecharPopup();
      $('abrir-config').click();
      const aba = document.querySelector('[data-secao-config="atalhos"]');
      if (aba) aba.click();
    });
    $('fechar-popup').focus();
  }
  $('abrir-atalhos').addEventListener('click', abrirAtalhos);
  document.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey && !ev.shiftKey && !ev.altKey && (ev.code === 'Slash' || ev.key === '/')) { ev.preventDefault(); if (popup.hidden) abrirAtalhos(); }
  });
  function desenharFaixa(i) {
    const fundo = Number(i.fundo) || 0;
    const f = $('trabalhando');
    const naFila = Array.isArray(i.fila) ? i.fila.length : 0;
    desenharFila(i);
    desenharCaixaOcupada(i.ocupado);
    f.hidden = !(i.ocupado || fundo > 0 || naFila > 0);
    f.classList.toggle('parada', !i.ocupado);
    if (!i.ocupado) fazendoAgora = '';
    $('trabalhando-texto').textContent = i.ocupado ? (fazendoAgora || 'Pensando…') : i.filaParada ? 'Parado, com mensagens na fila' : 'Parado';
    $('parar').hidden = !i.ocupado;
    const g = $('faixa-fundo');
    g.hidden = !fundo;
    g.innerHTML = `<svg class="ico" viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 3v2.6h-2.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg><span data-sem-traducao>${fundo}</span> <span>em segundo plano</span>`;
    g.setAttribute('aria-label', `${fundo} ${tr('em segundo plano')}`);
  }
  function desenharInfo(i) {
    // Pasta: as duas últimas partes ("…/pai/pasta"); o caminho inteiro na dica.
    const pasta = (i.pasta || '').replace(/^\/home\/[^/]+/, '~') || '~';
    const partes = pasta.split('/').filter(Boolean);
    $('info-pasta').textContent = partes.length > 2 ? `…/${partes.slice(-2).join('/')}` : pasta;
    $('info-pasta').parentElement.title = i.pasta || '';
    $('info-modelo').textContent = nomeModelo(i.modelo);
    desenharEsforco(i.esforco);
    infoAtual = i;
    const comRapido = [...MODELOS, ...OUTROS_MODELOS].some((x) => x[4] && x[2] === i.modelo);
    $('selo-rapido').hidden = !(i.rapido === true && comRapido);
    if (!$('menu-modelo').hidden) { const foco = document.activeElement && (document.activeElement.dataset.passo || document.activeElement.dataset.chave); desenharMenu(); const el = foco && $('menu-modelo').querySelector(`[data-passo="${foco}"], [data-chave="${foco}"]`); if (el && !el.disabled) el.focus(); }
    const janela = i.janela || null;
    const ctx = i.contexto != null && janela ? Math.round((i.contexto / janela) * 100) : null;
    // A janela longa: 7 dias no Claude; no Codex, a do plano (ex.: 30 dias no free).
    const rotuloLongo = i.rotuloLongo || '7 dias';
    medidor($('info-contexto'), 'Contexto', ctx);
    medidor($('info-5h'), '5 h', i.uso5h);
    medidor($('info-7d'), rotuloLongo, i.uso7d);
    desenharUso(ctx, i.uso5h == null ? null : i.uso5h, i.uso7d == null ? null : i.uso7d, rotuloLongo);
    desenharFaixa(i);
    desenharModo(i);
    if (ehOrquestrador()) rodadaAberta = i.rodada === true;
    desenharRodada();
  }

  // --- modelo e esforço (botão da barra) ------------------------------------
  // [chave, nome, id que o Claude devolve, nome técnico (o apelido do terminal), tem modo rápido]
  // Conferido na documentação do Claude Code (model-config, fast-mode): os
  // modelos atuais já têm contexto de 1 milhão, por isso não há interruptor
  // de "[1m]"; o modo rápido só existe em Opus e Fable.
  const MODELOS = [['opus', 'Opus 5.5', 'claude-opus-5-5', 'opus', true], ['sonnet', 'Sonnet 5.5', 'claude-sonnet-5-5', 'sonnet', false],
    ['haiku', 'Haiku 5.5', 'claude-haiku-5-5', 'haiku', false], ['opusplan', 'Opus planeja, Sonnet executa', 'opusplan', 'opusplan', false]];
  const OUTROS_MODELOS = [['fable', 'Fable 5.2', 'claude-fable-5-2', 'fable', true], ['', 'Padrão da conta', null, 'default', false]];
  const ESFORCOS = [['low', 'Baixo', 1], ['medium', 'Médio', 2], ['high', 'Alto', 3], ['xhigh', 'Extra alto', 4], ['max', 'Máximo', 5]];
  let infoAtual = {};
  function desenharEsforco(e) {
    const x = ESFORCOS.find(([k]) => k === e);
    $('info-esforco').innerHTML = x
      ? `<span class="nivel">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= x[2] ? 'cheio' : ''}"></i>`).join('')}</span>${x[1]}`
      : 'padrão';
  }
  function desenharMenu() {
    const m = infoAtual.modelo || '';
    const codex = infoAtual.motor === 'codex';
    // O Codex usa o modelo da configuração dele; aqui só o esforço muda.
    const opcao = ([k, nome, id, tecnico]) => `<button type="button" role="menuitemradio" data-modelo="${k}" aria-checked="${!!id && m === id}" aria-pressed="${!!id && m === id}"><span class="marca-radio"></span><span class="opcao-texto"><span>${nome}</span></span><span class="nome-tecnico" data-sem-traducao>${tecnico}</span></button>`;
    $('opcoes-modelo').innerHTML = codex
      ? '<p class="popup-nota">O Codex usa o modelo da configuração dele (~/.codex/config.toml).</p>'
      : MODELOS.map(opcao).join('');
    // "Outros modelos" fica recolhido; abre sozinho se o modelo de agora for um de lá.
    const emOutros = OUTROS_MODELOS.some((x) => x[2] && x[2] === m);
    $('outros-modelos').innerHTML = codex ? '' : `<details class="menu-outros"${emOutros ? ' open' : ''}><summary>Outros modelos</summary><div class="menu-opcoes">${OUTROS_MODELOS.map(opcao).join('')}</div></details>`;
    // Modo rápido: só nos modelos que têm (Opus, Fable).
    const atual = [...MODELOS, ...OUTROS_MODELOS].find((x) => x[2] && x[2] === m);
    $('chaves-modelo').innerHTML = !codex && atual && atual[4]
      ? `<div class="menu-separador"></div><button type="button" class="menu-chave" role="menuitemcheckbox" data-chave="rapido" aria-checked="${infoAtual.rapido === true}"><span class="chave-menu"></span><span class="opcao-texto"><span>Modo rápido</span><small>responde mais depressa; cobrado à parte, em créditos de uso</small></span><span class="nome-tecnico" data-sem-traducao>fastMode</span></button>`
      : '';
    // Esforço numa linha: ◂ e ▸ andam um nível (as setas do teclado também); cada barrinha vai direto ao nível dela.
    const niveis = ESFORCOS.filter(([k]) => !codex || k !== 'max');
    const pos = niveis.findIndex(([k]) => k === infoAtual.esforco);
    const nomeAtual = pos >= 0 ? niveis[pos][1] : 'padrão';
    $('opcoes-esforco').innerHTML = `<button type="button" class="botao-seta" data-passo="-1" aria-label="Menos esforço"${pos === 0 ? ' disabled' : ''}>◂</button>
      <span class="niveis-esforco">${niveis.map(([k, nome], i) => `<button type="button" class="barra-nivel${pos >= 0 && i <= pos ? ' cheia' : ''}" data-esforco="${k}" aria-pressed="${infoAtual.esforco === k}" title="${nome}" aria-label="${nome}" style="--n:${i}"></button>`).join('')}</span>
      <span class="nome-esforco">${nomeAtual}</span>
      <button type="button" class="botao-seta" data-passo="1" aria-label="Mais esforço"${pos === niveis.length - 1 ? ' disabled' : ''}>▸</button>`;
  }
  // Um nível de esforço para cima ou para baixo (◂ ▸ do menu e ← → do teclado).
  async function passoEsforco(d) {
    const niveis = ESFORCOS.filter(([k]) => infoAtual.motor !== 'codex' || k !== 'max').map(([k]) => k);
    const pos = niveis.indexOf(infoAtual.esforco);
    const novo = niveis[Math.max(0, Math.min(niveis.length - 1, (pos < 0 ? (d > 0 ? -1 : niveis.length) : pos) + d))];
    if (!novo || novo === infoAtual.esforco) return;
    await C.configurar(ativa, { esforco: novo });
  }
  function fecharMenu() { $('menu-modelo').hidden = true; $('botao-modelo').setAttribute('aria-expanded', 'false'); }
  $('botao-modelo').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const abrir = $('menu-modelo').hidden;
    fecharMenuUso(); fecharMenuModo(); fecharMenuMais();
    if (abrir) {
      desenharMenu();
      // Posição fixa na janela: a barra corta o que passa dela (overflow), e o
      // menu precisa ficar por cima da conversa.
      const r = $('botao-modelo').getBoundingClientRect();
      const m = $('menu-modelo');
      m.hidden = false;
      m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8))}px`;
      m.style.top = `${r.bottom + 6}px`;
      $('botao-modelo').setAttribute('aria-expanded', 'true');
    } else fecharMenu();
  });
  $('menu-modelo').addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const b = ev.target.closest('button');
    if (!b) return;
    // O esforço e o modo rápido deixam o menu aberto (dá para ajustar de novo); escolher o modelo fecha.
    if (b.dataset.passo) { await passoEsforco(Number(b.dataset.passo)); return; }
    if (b.dataset.esforco) { await C.configurar(ativa, { esforco: b.dataset.esforco }); return; }
    if (b.dataset.chave === 'rapido') {
      const r = await window.orq.comandos.rapido(ativa, infoAtual.rapido !== true);
      if (r && r.erro) aviso(`O modo rápido não mudou: ${r.erro}`, 'erro');
      return;
    }
    if (b.dataset.modelo != null) { await C.configurar(ativa, { modelo: b.dataset.modelo || null }); fecharMenu(); }
  });
  // Com o menu aberto: ↑ ↓ andam pelas opções; ← → mudam o esforço (como no terminal).
  document.addEventListener('keydown', (ev) => {
    if ($('menu-modelo').hidden) return;
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') { ev.preventDefault(); passoEsforco(ev.key === 'ArrowRight' ? 1 : -1); return; }
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const itens = [...$('menu-modelo').querySelectorAll('#opcoes-modelo button, .menu-outros summary, .menu-outros[open] button, .menu-chave')];
    const i = itens.indexOf(document.activeElement);
    (itens[(i + (ev.key === 'ArrowDown' ? 1 : itens.length - 1) + (i < 0 && ev.key === 'ArrowUp' ? 1 : 0)) % itens.length] || itens[0]).focus();
  });
  document.addEventListener('click', fecharMenu);

  // --- Iniciar / Desligar e o menu ⋯ ---------------------------------------------
  // Só na conversa do orquestrador, um por vez na barra: Iniciar antes da
  // rodada, Desligar com ela aberta (info.rodada). Com a opção "No menu ⋯" das
  // Configurações os dois saem da barra; o ⋯ do orquestrador tem sempre os dois.
  let rodadaAberta = false;
  function desenharRodada() {
    const orq = ehOrquestrador();
    const naBarra = cfg.iniciarDesligar !== 'menu';
    $('iniciar-rodada').hidden = !(orq && cfg.comandoInicial && naBarra && !rodadaAberta);
    // Sem comando de abrir configurado não há como saber da rodada: o Desligar fica sempre.
    $('desligar').hidden = !(orq && cfg.comandoDesligar && naBarra && (rodadaAberta || !cfg.comandoInicial));
  }
  function iniciarRodada() {
    if (!cfg.comandoInicial) return;
    colado = true;
    pet.definir('pensando');
    C.mandar('orquestrador', cfg.comandoInicial);
  }
  function desligarRodada() {
    colado = true;
    if (cfg.comandoDesligar) C.mandar('orquestrador', cfg.comandoDesligar);
  }
  function fecharMenuMais() { $('menu-mais').hidden = true; $('chip-mais').setAttribute('aria-expanded', 'false'); }
  // Cada ação é um comando do "/" que já existe: só entra no menu se a lista de
  // comandos desta conversa tiver o comando (o Codex mostra os dele).
  const ACOES_MAIS = [['btw', 'Pergunta rápida…'], ['export', 'Exportar…'], ['config', 'Configurações do Claude Code'], ['permissions', 'Permissões'], ['memory', 'Memória'], ['status', 'Status'], ['exit', 'Encerrar esta conversa']];
  function desenharMenuMais() {
    const orq = ehOrquestrador();
    const item = (acao, rotulo, extra = '') => `<button type="button" class="item-menu${extra}" role="menuitem" data-acao="${acao}"><span>${rotulo}</span>${acharComando(acao) ? `<span class="atalho" data-sem-traducao>/${acao}</span>` : ''}</button>`;
    const rodada = orq ? `${cfg.comandoInicial ? item('iniciar', 'Iniciar a rodada') : ''}${cfg.comandoDesligar ? item('desligar', 'Desligar a rodada', ' perigo') : ''}` : '';
    const comandos = ACOES_MAIS.filter(([c]) => acharComando(c)).map(([c, r]) => item(c, c === 'config' && infoAtual.motor === 'codex' ? 'Preferências do Codex' : r)).join('');
    $('menu-mais').innerHTML = `${rodada}${rodada && comandos ? '<div class="menu-separador"></div>' : ''}${comandos}<div id="confirma-mais"></div>`;
  }
  $('chip-mais').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const abrir = $('menu-mais').hidden;
    fecharMenu(); fecharMenuUso(); fecharMenuModo();
    if (!abrir) { fecharMenuMais(); return; }
    desenharMenuMais();
    const r = $('chip-mais').getBoundingClientRect();
    const m = $('menu-mais');
    m.hidden = false;
    m.style.left = `${Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8))}px`;
    m.style.top = `${r.bottom + 6}px`;
    $('chip-mais').setAttribute('aria-expanded', 'true');
  });
  document.addEventListener('click', fecharMenuMais);
  $('menu-mais').addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.cancelar != null) { $('confirma-mais').innerHTML = ''; return; }
    if (b.dataset.confirmar === 'desligar') { fecharMenuMais(); desligarRodada(); return; }
    const acao = b.dataset.acao;
    if (acao === 'desligar') {
      // Como o botão da barra (que confirma no segundo clique), aqui a confirmação mora no menu.
      $('confirma-mais').innerHTML = '<div class="menu-confirma"><span><strong>Desligar a rodada?</strong> <span>O orquestrador recebe o comando de desligar e encerra a rodada com segurança.</span></span><div class="acoes"><button type="button" class="botao secundario" data-cancelar>Cancelar</button><button type="button" class="botao perigo" data-confirmar="desligar">Desligar</button></div></div>';
      $('confirma-mais').querySelector('[data-cancelar]').focus();
      return;
    }
    fecharMenuMais();
    if (acao === 'iniciar') { iniciarRodada(); return; }
    // A pergunta rápida precisa do texto: o comando fica pronto na caixa para completar.
    if (acao === 'btw') { entrada.value = '/btw '; entrada.focus(); entrada.setSelectionRange(5, 5); ajustarAltura(); return; }
    const comando = acharComando(acao);
    if (comando && window.orqComandos) await window.orqComandos.executar(comando, '', `/${acao}`);
  });

  // --- modo de permissão (chip da barra) ---------------------------------------
  // O chip mostra o modo que o Claude confirmou (info.modo, vindo do
  // system/status) e troca ao vivo. Cor E ícone por modo, nunca só cor.
  const ICO_MODO = {
    default: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 6.6a1.6 1.6 0 1 1 2.3 1.5c-.5.3-.8.6-.8 1.1M8 11.2v.1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    acceptEdits: '<svg viewBox="0 0 16 16"><path d="M3 13l.6-2.7 7.1-7.1 2.1 2.1-7.1 7.1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    auto: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor"/></svg>',
    plan: '<svg viewBox="0 0 16 16"><path d="M2.5 4.2 6 2.7l4 1.5 3.5-1.5v9.1L10 13.3l-4-1.5-3.5 1.5zM6 2.7v9.1M10 4.2v9.1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
    bypassPermissions: '<svg viewBox="0 0 16 16"><path d="M9 2 4 9h3.5L7 14l5-7H8.5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  };
  // [modo do Claude, nome no menu, explicação, nome curto no chip]
  const MODOS = [
    ['default', 'Perguntar sempre', 'pede antes de editar ou rodar', 'Perguntar'],
    ['acceptEdits', 'Aceitar edições', 'edita sozinho, pergunta antes de rodar', 'Aceitar edições'],
    ['auto', 'Auto', 'decide sozinho o que é seguro', 'Auto'],
    ['plan', 'Planejar', 'só lê e propõe um plano', 'Planejar'],
  ];
  const BYPASS = ['bypassPermissions', 'Sem perguntas (Bypass)', 'roda tudo sem pedir; desliga quando a conversa reinicia', 'Sem perguntas'];
  const modoDaTela = () => (infoAtual.modo === 'manual' ? 'default' : infoAtual.modo || 'auto');
  const conversaAtual = () => listaConversas.find((c) => c.id === ativa) || null;
  const ehOrquestrador = () => { const c = conversaAtual(); return !!(c && c.orquestrador); };
  // O Bypass só é oferecido em conversa avulsa e com a opção das Configurações ligada.
  const ofereceBypass = () => cfg.mostrarBypass === true && !ehOrquestrador();
  function desenharModo(i) {
    const chip = $('chip-modo');
    chip.hidden = i.motor === 'codex'; // no Codex o modo é o da configuração dele
    const m = i.modo === 'manual' ? 'default' : i.modo || 'auto';
    const linha = [...MODOS, BYPASS].find((x) => x[0] === m);
    chip.className = `chip botao-chip chip-modo modo-${m}`;
    $('ico-modo').innerHTML = ICO_MODO[m] || ICO_MODO.default;
    // Modo que o chip não oferece (ex.: dontAsk, posto pelo /config): aparece com o nome do Claude.
    $('rotulo-modo').textContent = linha ? linha[3] : m;
    if (!linha) $('rotulo-modo').setAttribute('data-sem-traducao', ''); else $('rotulo-modo').removeAttribute('data-sem-traducao');
    // Com a barra apertada o nome some do chip: a dica e o leitor de tela continuam dizendo o modo.
    const dica = `${tr('Modo de permissão')}: ${linha ? tr(linha[3]) : m} (${tr('Ctrl+Shift+M troca')})`;
    chip.title = dica; chip.setAttribute('aria-label', dica);
    $('faixa-bypass').hidden = m !== 'bypassPermissions' || i.motor === 'codex';
    if (chip.hidden) fecharMenuModo();
  }
  function fecharMenuModo() { $('menu-modo').hidden = true; $('chip-modo').setAttribute('aria-expanded', 'false'); }
  function desenharMenuModo() {
    const atual = modoDaTela();
    const linha = ([k, nome, desc]) => `<button type="button" role="menuitemradio" aria-checked="${atual === k}" data-modo="${k}" class="modo-${k}"><span class="ico-modo">${ICO_MODO[k]}</span><span class="opcao-texto"><span>${nome}</span><small>${desc}</small></span><span class="nome-tecnico" data-sem-traducao>${k}</span></button>`;
    $('menu-modo').innerHTML = `<div class="menu-titulo">Modo de permissão</div>
      <div class="menu-opcoes">${MODOS.map(linha).join('')}</div>
      ${ofereceBypass() ? `<div class="menu-separador"></div><div class="menu-opcoes">${linha(BYPASS)}</div>` : ''}
      <div id="confirma-modo"></div>
      <p class="menu-nota"><span>Ctrl+Shift+M troca</span>${cfg.shiftTabTrocaModo === false ? '' : '<span> · Shift+Tab com a caixa vazia</span>'}</p>`;
  }
  function abrirMenuModo() {
    fecharMenu(); fecharMenuUso(); fecharMenuMais();
    desenharMenuModo();
    const r = $('chip-modo').getBoundingClientRect();
    const m = $('menu-modo');
    m.hidden = false;
    m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8))}px`;
    m.style.top = `${r.bottom + 6}px`;
    $('chip-modo').setAttribute('aria-expanded', 'true');
  }
  $('chip-modo').addEventListener('click', (ev) => { ev.stopPropagation(); if ($('menu-modo').hidden) abrirMenuModo(); else fecharMenuModo(); });
  document.addEventListener('click', fecharMenuModo);
  async function trocarModo(k) {
    fecharMenuModo();
    const r = await C.modo(ativa, k);
    if (r && r.erro) { aviso(`O modo não trocou: ${r.erro}`, 'erro'); return; }
    // O chip muda quando o Claude confirma (info.modo); aqui só o aviso para quem usa leitor de tela.
    const linha = [...MODOS, BYPASS].find((x) => x[0] === k);
    $('anuncio-modo').textContent = `${tr('Modo')}: ${linha ? tr(linha[3]) : k}`;
    const chip = $('chip-modo');
    chip.classList.remove('piscou'); void chip.offsetWidth; chip.classList.add('piscou');
  }
  // Pedido de troca: no orquestrador, sair do Auto pede confirmação; o Bypass
  // confirma sempre. A confirmação mora dentro do menu.
  function pedirModo(k) {
    if (k === modoDaTela()) { fecharMenuModo(); return; }
    const precisa = k === 'bypassPermissions' ? 'bypass' : ehOrquestrador() && k !== 'auto' ? 'orquestrador' : '';
    if (!precisa) { trocarModo(k); return; }
    if ($('menu-modo').hidden) abrirMenuModo();
    const linha = [...MODOS, BYPASS].find((x) => x[0] === k);
    $('confirma-modo').innerHTML = precisa === 'bypass'
      ? `<div class="menu-confirma perigo"><span><strong>Ligar "Sem perguntas"?</strong> <span>O Claude vai editar arquivos e rodar comandos nesta pasta sem pedir. Vale só nesta conversa e desliga quando ela reiniciar.</span></span><div class="acoes"><button type="button" class="botao secundario" data-cancelar>Cancelar</button><button type="button" class="botao perigo" data-confirmar="${k}">Ligar nesta conversa</button></div></div>`
      : `<div class="menu-confirma"><span><strong>Tirar o orquestrador do Auto?</strong> <span>Fora do Auto, a rodada para a cada comando de tmux ou docker até você responder.</span></span><div class="acoes"><button type="button" class="botao secundario" data-cancelar>Cancelar</button><button type="button" class="botao primario" data-confirmar="${k}"><span>Trocar para</span> <span>${linha[3]}</span></button></div></div>`;
    $('confirma-modo').querySelector('[data-cancelar]').focus();
  }
  $('menu-modo').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.confirmar) trocarModo(b.dataset.confirmar);
    else if (b.dataset.cancelar != null) $('confirma-modo').innerHTML = '';
    else if (b.dataset.modo) pedirModo(b.dataset.modo);
  });
  $('sair-bypass').addEventListener('click', () => trocarModo('auto'));
  // Ctrl+Shift+M (sempre) e Shift+Tab (caixa vazia, se a opção estiver ligada)
  // andam pelos quatro modos. O Bypass nunca entra no ciclo.
  function proximoModo() {
    if ($('chip-modo').hidden) return;
    const ordem = MODOS.map((m) => m[0]);
    pedirModo(ordem[(ordem.indexOf(modoDaTela()) + 1) % ordem.length]);
  }
  document.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey && ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'm') { ev.preventDefault(); proximoModo(); }
  });

  // --- uso (chip da barra): contexto, 5 h e a janela longa num popover ---------
  function fecharMenuUso() { $('menu-uso').hidden = true; $('chip-uso').setAttribute('aria-expanded', 'false'); }
  $('chip-uso').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const abrir = $('menu-uso').hidden;
    fecharMenu(); fecharMenuModo(); fecharMenuMais();
    if (!abrir) { fecharMenuUso(); return; }
    const r = $('chip-uso').getBoundingClientRect();
    const m = $('menu-uso');
    m.hidden = false;
    m.style.left = `${Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8))}px`;
    m.style.top = `${r.bottom + 6}px`;
    $('chip-uso').setAttribute('aria-expanded', 'true');
  });
  $('menu-uso').addEventListener('click', (ev) => ev.stopPropagation());
  document.addEventListener('click', fecharMenuUso);
  // "N em segundo plano" abre a lista de tarefas, onde dá para ver a saída e parar.
  $('faixa-fundo').addEventListener('click', async () => {
    const item = acharComando('tasks');
    if (item && window.orqComandos) await window.orqComandos.executar(item, '', '/tasks');
  });

  // --- popups: /config e /permissions ---------------------------------------
  const popup = $('popup');
  function abrirPopup(titulo, html) {
    popup.classList.remove('popup-largo');
    $('popup-titulo').textContent = titulo;
    $('popup-corpo').innerHTML = html;
    popup.hidden = false;
  }
  const fecharPopup = () => { popup.hidden = true; popup.classList.remove('popup-largo'); };
  $('fechar-popup').addEventListener('click', fecharPopup);
  popup.addEventListener('mousedown', (ev) => { if (ev.target === popup) fecharPopup(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !popup.hidden) fecharPopup(); });

  // /config do Claude Code. As chaves vêm do texto "Usage: /config" do próprio
  // CLI (config-claude.js): o da versão conferida por último ou, quando o CLI em
  // uso mostra o dele na conversa, esse. O valor atual aparece onde o Claude
  // informa (get_settings e o modo vivo); onde não informa fica "—". Cada
  // mudança vira "/config chave=valor" mandado à conversa (ele confirma ali).
  const CC = window.orqConfigClaude;
  let usoConfig = CC.USO_CONFERIDO;
  // O Claude mostrou o "Usage: /config" dele (o /config sem argumento, ou com chave errada): a lista passa a ser a dele.
  function aprenderUsoConfig(texto) { if (CC.chavesDoUso(texto).length) usoConfig = texto; }
  function abrirPopupConfig() {
    const grupos = CC.agrupar(CC.chavesDoUso(usoConfig));
    const linha = (it) => `<label class="popup-linha" data-busca="${esc(`${it.rotulo} ${it.chave}`.toLowerCase())}"><span><strong${it.semRotulo ? ' data-sem-traducao' : ''}>${esc(it.rotulo)}</strong><code>${esc(it.chave)}</code>${it.soTerminal ? '<small class="so-terminal">só na tela do terminal do Claude Code; aqui a mudança é gravada, mas não se vê</small>' : ''}</span>
        ${it.opcoes ? `<select data-config="${esc(it.chave)}" data-sem-traducao><option value="">—</option>${it.opcoes.map((o) => `<option>${esc(o)}</option>`).join('')}</select>`
                    : `<input data-config="${esc(it.chave)}" type="text" placeholder="ex.: português">`}</label>`;
    abrirPopup('Configurações do Claude Code', `<input type="search" id="busca-config-claude" class="campo-config busca-popup" placeholder="Buscar configuração" aria-label="Buscar configuração" autocomplete="off">
      <p class="popup-nota">Cada mudança é mandada ao Claude desta conversa como <code>/config chave=valor</code>; ele confirma na conversa.</p>
      ${grupos.map((g) => `<h3 class="config-secao">${g.grupo}</h3>${g.itens.map(linha).join('')}`).join('')}
      <p class="popup-nota rodape-config-claude"><span>O valor aparece onde o Claude Code informa; "—" é sem informação. Estas são as configurações do Claude Code, não as do app:</span> <button type="button" class="botao-texto link-config" data-abrir-config-app>Configurações do app</button></p>`);
    $('popup').classList.add('popup-largo');
    const corpo = $('popup-corpo');
    $('busca-config-claude').addEventListener('input', (ev) => {
      const q = ev.target.value.trim().toLowerCase();
      corpo.querySelectorAll('.popup-linha').forEach((l) => { l.hidden = !!q && !l.dataset.busca.includes(q); });
      corpo.querySelectorAll('.config-secao').forEach((h) => { let n = h.nextElementSibling, tem = false; while (n && n.classList.contains('popup-linha')) { if (!n.hidden) tem = true; n = n.nextElementSibling; } h.hidden = !tem; });
    });
    corpo.querySelector('[data-abrir-config-app]').addEventListener('click', () => { fecharPopup(); $('abrir-config').click(); });
    // Os valores atuais chegam em seguida (o popup já abre com as chaves).
    const conversaDoPopup = ativa;
    const preencher = (settings) => {
      if (popup.hidden || ativa !== conversaDoPopup || !$('busca-config-claude')) return;
      for (const el of corpo.querySelectorAll('[data-config]')) {
        const v = CC.valorAtual(el.dataset.config, { settings, info: infoAtual });
        if (v === undefined || el.closest('.popup-linha').classList.contains('mudou')) continue;
        if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === v)) el.add(new Option(v, v));
        el.value = v;
      }
    };
    preencher(null);
    if (window.orq.comandos && window.orq.comandos.controle) window.orq.comandos.controle(conversaDoPopup, 'get_settings', {}).then((r) => { if (r && !r.erro) preencher(r); }).catch(() => {});
  }
  $('popup-corpo').addEventListener('change', async (ev) => {
    const el = ev.target.closest('[data-config]');
    if (!el || !el.value) return;
    el.closest('.popup-linha').classList.add('mudou');
    await C.mandar(ativa, `/config ${el.dataset.config}=${CC.valorParaComando(el.value)}`);
  });

  // /permissions: regras allow/ask/deny do ~/.claude/settings.json.
  const LISTAS = [['allow', 'Permitir sempre', 'ex.: Bash(npm test:*)'], ['ask', 'Perguntar', 'ex.: Bash(git push:*)'], ['deny', 'Negar sempre', 'ex.: Read(./.env)']];
  async function abrirPopupPermissoes() {
    if (!window.orq.permissoes) { aviso('Reabra o app para usar o /permissions.'); return; }
    const p = await window.orq.permissoes.ler();
    const lista = (k) => p[k].map((r) => `<li><code>${esc(r)}</code><button type="button" class="botao-icone" data-tirar-regra="${esc(k)}" title="Tirar esta regra">✕</button></li>`).join('');
    abrirPopup('Permissões do Claude', `<p class="popup-nota">Regras de <code>${esc(p.arquivo)}</code>. Valem para as conversas novas ou depois de <code>/restart</code>. Cada gravação guarda a versão anterior.</p>
      <label class="popup-linha"><span><strong>Modo padrão</strong><code>defaultMode</code></span>
        <select id="perm-modo"><option value="">(não definido)</option>${p.modos.map((m) => `<option${m === p.defaultMode ? ' selected' : ''}>${m}</option>`).join('')}</select></label>` +
      LISTAS.map(([k, nome, ex]) => `<section class="perm-lista" data-lista="${k}"><h4>${nome} <span>${p[k].length}</span></h4>
        <ul>${lista(k) || '<li class="vazio-regra">Nenhuma regra.</li>'}</ul>
        <div class="perm-nova"><input type="text" placeholder="${esc(ex)}"><button type="button" class="botao-texto" data-nova-regra="${k}">Adicionar</button></div></section>`).join('') +
      '<div class="perm-acoes"><button type="button" class="botao primario" id="perm-salvar">Salvar</button></div>');
  }
  $('popup-corpo').addEventListener('click', async (ev) => {
    const tirar = ev.target.closest('[data-tirar-regra]');
    if (tirar) { tirar.closest('li').remove(); return; }
    const nova = ev.target.closest('[data-nova-regra]');
    if (nova) {
      const sec = nova.closest('.perm-lista'), inp = sec.querySelector('input');
      const v = inp.value.trim();
      if (!v) return;
      sec.querySelector('.vazio-regra')?.remove();
      sec.querySelector('ul').insertAdjacentHTML('beforeend', `<li><code>${esc(v)}</code><button type="button" class="botao-icone" data-tirar-regra="${sec.dataset.lista}" title="Tirar esta regra">✕</button></li>`);
      inp.value = '';
      return;
    }
    if (ev.target.closest('#perm-salvar')) {
      const novo = { defaultMode: $('perm-modo').value || null };
      for (const [k] of LISTAS) novo[k] = [...document.querySelectorAll(`.perm-lista[data-lista="${k}"] li code`)].map((c) => c.textContent);
      try { await window.orq.permissoes.gravar(novo); } catch (e) {
        aviso(`Não salvei: ${String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, 'erro');
        return;
      }
      fecharPopup();
      aviso('Permissões salvas. Use /restart para esta conversa passar a seguir as regras novas.');
    }
  });

  // --- ligações ----------------------------------------------------------
  const pedidos = new Map();
  function redesenharTudo(r) {
    if (r.comandos && r.comandos.length) comandosPor.set(r.id || ativa, r.comandos);
    caixa.innerHTML = '';
    dicaLink.hidden = true;
    grupo = null; ferramentas.clear(); limparRascunho();
    if (!r.eventos.length) {
      const atual = listaConversas.find((c) => c.id === ativa);
      caixa.innerHTML = `<div class="boas-vindas">
        <strong>${esc(atual && !atual.orquestrador ? atual.titulo : 'Orquestrador')}</strong><span>${atual && !atual.orquestrador ? 'Escreva abaixo para conversar com o Claude.' : 'Escreva abaixo. O orquestrador está ali no cantinho.'}</span></div>`;

    }
    r.eventos.forEach(desenharEvento);
    pedidos.clear();
    (r.pendentes || []).forEach((p) => { pedidos.set(p.id, p); cartaoPedido(p); });
    try { desenharAprovacoes(); } catch { /* ainda carregando a tela */ }
    colado = true; rolar();
  }

  // --- o orquestrador em pessoa ---------------------------------------------
  const pet = window.criarPet($('palco-pet'));
  // Comando para um agente: "orq send <projeto> …" e parecidos. O nome sai da
  // lista de frentes que a tela já tem (tela.js).
  function agenteDoComando(cmd) {
    if (!cfg.comandoOrdem) return null;
    const m = String(cmd || '').match(new RegExp(cfg.comandoOrdem));
    if (!m || !m.groups || !m.groups.alvo) return null;
    const alvo = m.groups.alvo;
    const frentes = (typeof ultimo !== 'undefined' && ultimo && ultimo.frentes) || [];
    const i = frentes.findIndex((f) => alvo.includes(f.proj) || f.proj.endsWith(alvo) || f.sessaoTmux === alvo);
    return { acao: m.groups.acao || '', nome: i >= 0 ? nomeDaFrente(frentes[i], i) : alvo };
  }
  function petReage(ev) {
    if (ev.tipo === 'assistant') {
      for (const b of ev.message.content || []) {
        if (b.type !== 'tool_use') continue;
        const ag = b.name === 'Bash' ? agenteDoComando(b.input.command) : null;
        if (ag) pet.definir('mandando', ['send', 'mandar', 'enviar'].includes(ag.acao) ? `${ag.nome}, sua vez!` : `Olhando o ${ag.nome}…`);
        else if (b.name === 'Agent' || b.name === 'Task') pet.definir('mandando', 'Chamei um ajudante!');
        else if (b.name !== 'AskUserQuestion') pet.definir('trabalhando', `${resumoFerramenta(b.name, b.input)[0]}…`);
      }
    } else if (ev.tipo === 'resultado') {
      pet.definir(ev.erro ? 'erro' : 'pronto');
    } else if (ev.tipo === 'fim' || ev.tipo === 'erro') {
      pet.definir('livre');
    } else if (ev.tipo === 'encerrada' && ev.conversa) {
      pet.definir('livre');
    } else if (ev.tipo === 'encerrada') {
      pet.definir('livre');
      pet.classe('acenando'); pet.falar('Tchau! Até a próxima rodada.', 3000);
      setTimeout(() => pet.classe('acenando', false), 3000);
    }
  }

  // Eventos de conversas que não estão na tela só mexem na lista da lateral.
  C.aoTudo((id, r) => { if (id === ativa) { redesenharTudo(r); if (r.info) desenharFila(r.info); } });
  C.aoEvento((id, ev) => {
    if (id !== ativa) return;
    caixa.querySelector('.boas-vindas')?.remove();
    desenharEvento(ev); filaNoFim(); rolar();
    // Mensagem que o motor não aceitou: o texto volta para a caixa vazia.
    if (ev.devolver && !entrada.value.trim()) porNaCaixa(ev.devolver);
    if (id === 'orquestrador' && !ev.sub) petReage(ev);
    // Faixa de atividade: a ferramenta em uso; quando o resultado dela chega, volta a "Pensando…".
    if (!ev.sub && !ev.antigo && ev.message && Array.isArray(ev.message.content)) {
      if (ev.tipo === 'assistant') for (const b of ev.message.content) { if (b.type === 'tool_use') faixaFerramenta(b.name, b.input || {}); }
      else if (ev.tipo === 'user' && ev.message.content.some((b) => b.type === 'tool_result')) { fazendoAgora = ''; if (infoAtual.ocupado) $('trabalhando-texto').textContent = 'Pensando…'; }
    }
  });
  let agendado = false;
  function desenharParcial(t) {
    rascunhoTexto += t;
    if (!rascunho) { rascunho = document.createElement('div'); rascunho.className = 'md texto-claude rascunho'; noGrupo(rascunho); }
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(() => { agendado = false; if (rascunho) { rascunho.innerHTML = md(rascunhoTexto); rolar(); } });
  }
  C.aoParcial((id, t) => {
    if (id !== ativa) return;
    if (t == null) { limparRascunho(); if (id === 'orquestrador') pet.definir('pensando'); return; }
    desenharParcial(t);
  });
  C.aoPedido((id, p) => {
    if (id === 'orquestrador') pet.definir('chamando', p.ferramenta === 'AskUserQuestion' ? 'Uma pergunta pra você!' : 'Preciso da sua permissão!');
    if (id === ativa) { pedidos.set(p.id, p); cartaoPedido(p); }
  });
  // O Claude desistiu do pedido (ex.: o turno foi interrompido): o cartão diz que foi ele.
  C.aoCancelado((id, reqId) => {
    if (id !== ativa) return;
    const c = document.querySelector(`[data-pedido="${CSS.escape(reqId)}"]`);
    if (c && !c.classList.contains('respondido')) { c.removeAttribute('tabindex'); fecharPedido(c, 'Pedido cancelado pelo Claude: não precisa mais da sua resposta'); }
  });
  C.aoRespondido((id, reqId) => {
    if (id === 'orquestrador') pet.definir('pensando');
    if (id !== ativa) return;
    const c = document.querySelector(`[data-pedido="${CSS.escape(reqId)}"]`);
    if (c && !c.classList.contains('respondido')) fecharPedido(c, 'Respondido');
  });
  C.aoInfo((id, i) => {
    if (id === 'orquestrador' && !i.ocupado && ['pensando', 'trabalhando', 'mandando'].includes(pet.modo)) pet.definir('livre');
    if (id === ativa) desenharInfo(i);
  });

  // --- lista de conversas na lateral ---------------------------------------
  function desenharLista(l) {
    listaConversas = l;
    $('conversas').innerHTML = l.map((c) => {
      const estado = c.pedidos ? 'permissao' : c.ocupado ? 'trabalhando' : 'parado';
      const texto = c.pedidos ? 'pergunta' : c.ocupado ? 'trabalhando' : c.vivo ? 'pronta' : 'pausada';
      return `<div class="item-conversa${c.id === ativa ? ' ativo' : ''}">
        <button type="button" class="abrir-conversa" data-conversa="${esc(c.id)}">
          <svg class="ico"><use href="#${c.orquestrador ? 'i-estrela' : 'i-balao'}"/></svg>
          <span class="titulo-conversa">${esc(c.titulo)}</span>
          ${c.motor === 'codex' ? '<span class="selo-motor" title="Conduzida pelo Codex">Codex</span>' : ''}
          <span class="ponto ${estado}" title="${texto}"></span>
        </button>
        ${c.orquestrador ? '' : `<button type="button" class="fechar-conversa" data-fechar-conversa="${esc(c.id)}" title="Tirar da lista (a conversa continua no histórico do Claude)" aria-label="Fechar conversa">✕</button>`}
      </div>`;
    }).join('');
    const atual = l.find((c) => c.id === ativa);
    const aba = document.querySelector('[data-aba="aba-orquestrador"]');
    aba.lastChild.textContent = atual && !atual.orquestrador ? curto(atual.titulo, 24) : 'Orquestrador';
    desenharRodada();
    $('palco-pet').hidden = !!(atual && !atual.orquestrador);
    try { desenharAprovacoes(); } catch { /* ainda carregando a tela */ }
    $('entrada').placeholder = atual && !atual.orquestrador
      ? (atual.motor === 'codex' ? 'Escreva para o Codex…' : 'Escreva para o Claude…')
      : 'Escreva para o orquestrador…';
    desenharCaixaOcupada(infoAtual.ocupado === true);
  }
  C.aoLista(desenharLista);
  // Paleta Ctrl+K: conversas (com pergunta pendente = esperando você) e comandos.
  window.orqPaleta?.registrar(() => [
    ...listaConversas.map((c) => ({ grupo: 'Conversas', titulo: c.titulo, sub: c.pedidos ? 'pergunta esperando você' : c.ocupado ? 'trabalhando' : '', atencao: c.pedidos > 0, faz: () => trocar(c.id) })),
    ...(comandosPor.get(ativa) || [])
      .map((c) => ({ grupo: 'Comandos', titulo: `/${c.nome}`, sub: c.descricao, faz: () => { trocar(ativa); entrada.value = `/${c.nome} `; entrada.focus(); } })),
  ]);
  // Clique numa notificação do sistema: abre a conversa que precisa de você.
  if (C.aoFocar) C.aoFocar((id) => trocar(id));

  async function trocar(id) {
    ativa = id;
    desenharLista(listaConversas);
    const aba = document.querySelector('[data-aba="aba-orquestrador"]');
    if (!aba.classList.contains('ativa')) aba.click();
    const r = await C.abrir(id);
    redesenharTudo(r); desenharInfo(r.info);
    desenharLista(await C.lista());
    $('entrada').focus();
  }

  // Botão que confirma no segundo clique (nada de janela de confirmação).
  function confirmar(botao, texto, acao) {
    if (botao.dataset.confirmando) {
      delete botao.dataset.confirmando;
      clearTimeout(botao._t);
      botao.textContent = botao.dataset.original;
      return acao();
    }
    botao.dataset.confirmando = '1';
    botao.dataset.original = botao.textContent;
    botao.textContent = texto;
    botao._t = setTimeout(() => { delete botao.dataset.confirmando; botao.textContent = botao.dataset.original; }, 4000);
  }

  $('conversas').addEventListener('click', async (ev) => {
    const abrir = ev.target.closest('[data-conversa]');
    if (abrir) return trocar(abrir.dataset.conversa);
    const fechar = ev.target.closest('[data-fechar-conversa]');
    if (fechar) {
      confirmar(fechar, 'Fechar?', async () => {
        const id = fechar.dataset.fecharConversa;
        await C.fechar(id);
        if (id === ativa) trocar('orquestrador');
      });
    }
  });

  const entrada = $('entrada');

  // --- imagens: colar (Ctrl+V) ou arrastar para a caixa -----------------------
  const anexos = []; // { tipo, dados (base64) }
  const MAX_IMAGEM = 5 * 1024 * 1024;
  // Arquivos que não são imagem: vão pelo caminho (o Claude lê do disco).
  const arquivosAnexos = []; // { nome, caminho }
  function desenharAnexos() {
    $('anexos').hidden = !anexos.length && !arquivosAnexos.length;
    $('anexos').innerHTML = anexos.map((a, i) => `<div class="anexo"><img src="data:${a.tipo};base64,${a.dados}" alt="imagem anexada">
      <button type="button" data-tirar-anexo="${i}" aria-label="Tirar imagem" title="Tirar">✕</button></div>`).join('')
      + arquivosAnexos.map((a, i) => `<div class="anexo anexo-arquivo" title="${esc(a.caminho)}"><span class="anexo-icone">📄</span><span class="anexo-nome">${esc(a.nome)}</span>
      <button type="button" data-tirar-arquivo="${i}" aria-label="Tirar arquivo" title="Tirar">✕</button></div>`).join('');
  }
  function anexarCaminho(nome, caminho) {
    if (!caminho || arquivosAnexos.some((a) => a.caminho === caminho)) return;
    arquivosAnexos.push({ nome, caminho });
    desenharAnexos();
  }
  // destino: a lista de anexos (caixa de texto ou cartão de pergunta) e quem redesenha.
  function anexar(arquivo, destino = anexos, redesenhar = desenharAnexos) {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(arquivo.type)) return;
    if (arquivo.size > MAX_IMAGEM) { aviso('Imagem acima de 5 MB não vai: diminua antes.', 'erro'); return; }
    const r = new FileReader();
    r.onload = () => { destino.push({ tipo: arquivo.type, dados: String(r.result).split(',')[1] }); redesenhar(); };
    r.readAsDataURL(arquivo);
  }
  // Prints no campo "Outra resposta" de uma pergunta.
  function desenharPrints(cartao) {
    const caixaP = cartao.querySelector('.anexos-pergunta');
    const l = cartao._prints || [];
    caixaP.hidden = !l.length;
    caixaP.innerHTML = l.map((a, i) => `<div class="anexo"><img src="data:${a.tipo};base64,${a.dados}" alt="print anexada">
      <button type="button" data-tirar-print="${i}" aria-label="Tirar print" title="Tirar">✕</button></div>`).join('');
  }
  caixa.addEventListener('paste', (ev) => {
    const outra = ev.target.closest('.outra');
    if (!outra || outra.classList.contains('secreta')) return; // resposta secreta não leva print
    const imgs = [...(ev.clipboardData?.items || [])].filter((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (!imgs.length) return;
    ev.preventDefault();
    const cartao = outra.closest('.cartao-pedido');
    cartao._prints = cartao._prints || [];
    imgs.forEach((i) => anexar(i.getAsFile(), cartao._prints, () => desenharPrints(cartao)));
  });
  caixa.addEventListener('drop', (ev) => {
    const cartao = ev.target.closest('.cartao-pedido');
    const arqs = [...(ev.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!cartao || !arqs.length) return;
    ev.preventDefault();
    cartao._prints = cartao._prints || [];
    arqs.forEach((f) => anexar(f, cartao._prints, () => desenharPrints(cartao)));
  });
  caixa.addEventListener('dragover', (ev) => { if (ev.target.closest('.cartao-pedido')) ev.preventDefault(); });
  caixa.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tirar-print]');
    if (!b) return;
    const cartao = b.closest('.cartao-pedido');
    cartao._prints.splice(Number(b.dataset.tirarPrint), 1);
    desenharPrints(cartao);
  });
  entrada.addEventListener('paste', (ev) => {
    const imgs = [...(ev.clipboardData?.items || [])].filter((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (!imgs.length) return;
    ev.preventDefault();
    imgs.forEach((i) => anexar(i.getAsFile()));
  });
  const compositor = $('compositor');
  compositor.addEventListener('dragover', (ev) => { if ([...ev.dataTransfer.items].some((i) => i.kind === 'file')) { ev.preventDefault(); compositor.classList.add('soltando'); } });
  compositor.addEventListener('dragleave', () => compositor.classList.remove('soltando'));
  compositor.addEventListener('drop', (ev) => {
    compositor.classList.remove('soltando');
    const todos = [...ev.dataTransfer.files];
    if (!todos.length) return;
    ev.preventDefault();
    // Imagem pequena vai como imagem; o resto (e imagem grande) vai pelo caminho.
    for (const f of todos) {
      if (/^image\/(png|jpeg|gif|webp)$/.test(f.type) && f.size <= MAX_IMAGEM) anexar(f);
      else anexarCaminho(f.name, window.orq.arquivos && window.orq.arquivos.caminho(f));
    }
  });
  // Botão 📎: escolher arquivos ou imagens no computador.
  $('anexar').addEventListener('click', async () => {
    if (!window.orq.arquivos) { aviso('Este app foi aberto antes da versão com anexos: reinicie o app.', 'erro'); return; }
    for (const a of await window.orq.arquivos.escolher()) {
      if (a.dados) { anexos.push({ tipo: a.tipo, dados: a.dados }); desenharAnexos(); } else anexarCaminho(a.nome, a.caminho);
    }
    entrada.focus();
  });
  $('anexos').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tirar-anexo]');
    if (b) { anexos.splice(Number(b.dataset.tirarAnexo), 1); desenharAnexos(); entrada.focus(); }
    const f = ev.target.closest('[data-tirar-arquivo]');
    if (f) { arquivosAnexos.splice(Number(f.dataset.tirarArquivo), 1); desenharAnexos(); entrada.focus(); }
  });

  // --- autocompletar de comandos (/…) ---------------------------------------
  // Como no terminal: digitou "/" no começo, aparece a lista filtrada; setas
  // navegam, Tab ou Enter completam, Esc fecha.
  // A lista de cada conversa vem pronta do processo principal (comandos.js,
  // a fonte única): todos os comandos do motor da conversa, cada um com o
  // jeito de funcionar aqui (texto, app ou terminal; comandos-tela.js faz os
  // do app). Nada cinza, nada some. /exit pede confirmação: fica sempre por
  // último e nunca é completado pelo Enter.
  const comandosPor = new Map(); // conversa → [{nome, descricao, dica, como, acao?, aliases?}]
  const ehExit = (x) => x && (x.inserir === '/exit' || x.titulo === '/exit');
  // O comando digitado, pelo nome ou por um alias ("/cost" é o /usage).
  function acharComando(nome) {
    const l = comandosPor.get(ativa) || [];
    return l.find((c) => c.nome === nome) || l.find((c) => (c.aliases || []).includes(nome)) || null;
  }
  // (sem o app reaberto, a ponte antiga ainda não tem aoComandos)
  if (C.aoComandos) C.aoComandos((id, l) => comandosPor.set(id, l));
  let sugestoes = [];
  let escolhida = 0;
  let navegou = false; // o usuário escolheu com as setas (aí a seleção é dele)
  function fecharSugestoes() { $('sugestoes').hidden = true; sugestoes = []; }
  // Repertório (skills de todas as ferramentas + atalhos), carregado ao abrir
  // a lista "//" e recarregado a cada 30 s.
  let repertorio = { skills: [], atalhos: [] }, repertorioEm = 0;
  async function carregarRepertorio(forcar = false) {
    if (!window.orq.repertorio || (!forcar && Date.now() - repertorioEm < 30000)) return repertorio;
    repertorio = await window.orq.repertorio.lista();
    repertorioEm = Date.now();
    return repertorio;
  }
  carregarRepertorio().catch(() => {});
  const aspas = (s) => (/\s/.test(s) ? `"${s}"` : s);

  // Lista de sugestões, conforme o que está antes do cursor:
  //   "/x" no começo   → comandos e skills do Claude desta conversa
  //   "//x"            → repertório inteiro (skills de todas as ferramentas + atalhos)
  //   "@" / "@nota:x" / "@workflow:x" → menções
  function comandosDaConversa() {
    return (comandosPor.get(ativa) || []).map((c) => ({ rotulo: `/${c.nome}`, dica: [c.aliases && c.aliases.length ? `(${c.aliases.join(', ')})` : '', c.dica].filter(Boolean).join(' '),
      desc: c.descricao, inserir: `/${c.nome}`, chave: c.nome, aliases: c.aliases || [], origem: c.como === 'terminal' ? 'abre no terminal' : '' }));
  }
  function itensRepertorio() {
    return [
      ...repertorio.atalhos.map((a) => ({ rotulo: `//${a.nome}`, desc: a.descricao || curto(a.texto, 90), origem: 'atalho', inserir: `//${a.nome}`, chave: a.nome })),
      ...repertorio.skills.map((sk) => ({ rotulo: `//${sk.nome}`, desc: sk.descricao, origem: `${sk.fonte} · ${sk.tipo}`, inserir: `//${sk.nome}`, chave: sk.nome })),
    ];
  }
  function itensMencao(tipo) {
    if (tipo === 'nota') return (window.orqNotas ? window.orqNotas.listar() : []).map((n) => ({ rotulo: `@nota:${n.caminho}`, desc: n.pasta, origem: 'nota', inserir: `@nota:${aspas(n.caminho)}`, chave: n.caminho }));
    if (tipo === 'workflow') return (window.orqWorkflows ? window.orqWorkflows.listar() : []).map((w) => ({ rotulo: `@workflow:${w.nome}`, desc: w.descricao || '', origem: 'workflow', inserir: `@workflow:${aspas(w.nome)}`, chave: w.nome }));
    return [
      { rotulo: '@nota:', desc: 'Mencionar uma nota (vai com o conteúdo)', origem: 'menção', inserir: '@nota:', chave: 'nota', continuar: true },
      { rotulo: '@workflow:', desc: 'Mencionar um workflow', origem: 'menção', inserir: '@workflow:', chave: 'workflow', continuar: true },
    ];
  }
  // "@" solto: os arquivos da pasta da conversa (pedidos ao Claude: os mesmos que o
  // terminal mostra), as notas e os workflows, em grupos de até 6.
  const POR_GRUPO = 6;
  const arquivosPor = new Map(); // busca → caminhos, só da conversa que está na tela
  let arquivosDe = null, seqArquivos = 0, tArquivos = null, pedindoArquivos = null, dispensada = null;
  function pedirArquivos(b) {
    if (!window.orq.conversa.arquivos || conversaCodex() || infoAtual.ocupado) return;
    if (arquivosDe !== ativa) { arquivosDe = ativa; arquivosPor.clear(); }
    if (arquivosPor.has(b) || pedindoArquivos === b) return;
    clearTimeout(tArquivos);
    // 150 ms depois da última tecla; cada pedido leva um número, e resposta de
    // pedido antigo não redesenha a lista (só fica guardada para a busca dela).
    tArquivos = setTimeout(async () => {
      const seq = ++seqArquivos;
      const conv = ativa;
      pedindoArquivos = b;
      let r = null;
      try { r = await window.orq.conversa.arquivos(conv, b); } catch { /* sem arquivos desta vez */ }
      if (pedindoArquivos === b) pedindoArquivos = null;
      const lista = r && Array.isArray(r.arquivos) ? r.arquivos.map((a) => a.caminho) : [];
      // Vazio não fica guardado: o Claude leva alguns segundos para indexar a pasta.
      if (!lista.length || conv !== ativa) return;
      arquivosPor.set(b, lista);
      if (arquivosPor.size > 200) arquivosPor.delete(arquivosPor.keys().next().value);
      if (seq !== seqArquivos || dispensada === entrada.value) return;
      atualizarSugestoes();
    }, 150);
  }
  function itensDoArroba(b) {
    const arquivos = infoAtual.ocupado || arquivosDe !== ativa ? [] : (arquivosPor.get(b) || []);
    const com = (grupo) => (x) => ({ ...x, grupo });
    return [
      // O Claude já escolheu o que casa (busca aproximada): estes não passam pelo filtro da lista.
      ...arquivos.map((p) => ({ rotulo: `@${p}`, desc: p.endsWith('/') ? 'pasta' : '', origem: '', inserir: `@${aspas(p)}`, chave: p, grupo: 'Arquivos', semFiltro: true, continuar: p.endsWith('/') })),
      ...(b ? itensMencao('nota') : []).map(com('Notas')),
      com('Notas')(itensMencao('')[0]),
      ...(b ? itensMencao('workflow') : []).map(com('Workflows')),
      com('Workflows')(itensMencao('')[1]),
    ];
  }
  let faixaToken = null; // [início, fim] do que a sugestão vai substituir
  function atualizarSugestoes() {
    const ate = entrada.value.slice(0, entrada.selectionStart ?? entrada.value.length);
    let itens = null, busca = '';
    const m = ate.match(/(^|\s)(\/\/\S*|@nota:\S*|@workflow:\S*|@\S*)$/);
    if (m) {
      const tok = m[2];
      faixaToken = [ate.length - tok.length, ate.length];
      if (tok.startsWith('//')) { busca = tok.slice(2); itens = itensRepertorio(); if (!repertorioEm) carregarRepertorio().then(atualizarSugestoes); }
      else if (tok.startsWith('@nota:')) { busca = tok.slice(6).replace(/^"/, ''); itens = itensMencao('nota'); }
      else if (tok.startsWith('@workflow:')) { busca = tok.slice(10).replace(/^"/, ''); itens = itensMencao('workflow'); if (!itens.length) itens = [{ rotulo: 'Nenhum workflow ainda', desc: 'Crie um na aba Workflows', origem: '', inserir: tok, chave: '' }]; }
      else { busca = tok.slice(1); itens = itensDoArroba(busca); pedirArquivos(busca); }
    } else {
      const c = entrada.value.match(/^\/(\S*)$/);
      if (!c) return fecharSugestoes();
      faixaToken = [0, entrada.value.length];
      busca = c[1]; itens = comandosDaConversa();
    }
    const b = busca.toLowerCase();
    const comecaCom = (x) => x.semFiltro || x.chave.toLowerCase().startsWith(b) || (x.aliases || []).some((a) => a.toLowerCase().startsWith(b));
    const comeca = itens.filter(comecaCom);
    const contem = itens.filter((x) => !comecaCom(x) && (x.chave + ' ' + (x.desc || '')).toLowerCase().includes(b));
    // /exit sempre por último (e nunca cortado da lista).
    let achados = [...comeca, ...contem];
    // Lista em grupos (o "@"): cada grupo junto, na ordem em que aparece, com até 6 itens.
    if (achados.some((x) => x.grupo)) {
      const nomes = [...new Set(itens.map((x) => x.grupo))];
      achados = nomes.flatMap((g) => achados.filter((x) => x.grupo === g).slice(0, POR_GRUPO));
    }
    const sair = achados.filter(ehExit);
    const bons = achados.filter((x) => !ehExit(x));
    sugestoes = [...bons.slice(0, 400 - sair.length), ...sair];
    if (!sugestoes.length) return fecharSugestoes();
    // Sem o usuário ter andado com as setas, a seleção é a primeira que não
    // é o /exit (só o /exit na lista: nada selecionado).
    escolhida = navegou ? Math.min(escolhida, sugestoes.length - 1) : sugestoes.findIndex((x) => !ehExit(x));
    $('sugestoes').innerHTML = sugestoes.map((c, i) => `${c.grupo && (i === 0 || sugestoes[i - 1].grupo !== c.grupo) ? `<li class="grupo-sugestao" role="presentation">${esc(c.grupo)}</li>` : ''}<li role="option" data-i="${i}" aria-selected="${i === escolhida}">
      <span class="nome-comando">${esc(c.rotulo)}${c.dica ? ` <i>${esc(c.dica)}</i>` : ''}</span>
      <span class="desc-comando">${c.origem ? `<span class="origem-sugestao">${esc(c.origem)}</span>` : ''}${esc(curto(c.desc || '', 110))}</span></li>`).join('');
    $('sugestoes').hidden = false;
    $('sugestoes').querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  function completar(i) {
    const c = sugestoes[i];
    if (!c || !faixaToken) return;
    const [ini, fim] = faixaToken;
    const novo = c.inserir + (c.continuar ? '' : ' ');
    entrada.value = entrada.value.slice(0, ini) + novo + entrada.value.slice(fim);
    const pos = ini + novo.length;
    entrada.setSelectionRange(pos, pos);
    fecharSugestoes();
    entrada.focus();
    if (c.continuar) { escolhida = 0; navegou = false; atualizarSugestoes(); }
  }

  // Na hora de enviar: //atalho vira o texto dele; //skill do Claude vira
  // /skill; //skill de outra ferramenta vai com o conteúdo; @nota:x vai com o
  // caminho e o conteúdo da nota. O balão mostra o texto como foi escrito.
  async function expandir(t) {
    if (!/\/\/\S|@nota:|@workflow:/.test(t)) return { enviar: t, exibir: null };
    await carregarRepertorio(true);
    const anexosTexto = [];
    let enviar = t.replace(/(^|\s)\/\/([^\s]+)/g, (tudo, ini, nome) => {
      const a = repertorio.atalhos.find((x) => x.nome === nome);
      if (a) return ini + a.texto;
      const sk = repertorio.skills.find((x) => x.nome === nome && x.ferramenta === 'claude') || repertorio.skills.find((x) => x.nome === nome);
      if (!sk) return tudo;
      // O Claude entende direto as próprias skills e comandos (/nome) e os
      // subagentes (pelo nome); o resto vai com as instruções junto.
      if (sk.ferramenta === 'claude') return sk.tipo === 'subagente' ? `${ini}(use o subagente «${sk.nome}»)` : `${ini}/${sk.nome}`;
      anexosTexto.push({ tipo: 'skill', sk });
      return `${ini}(skill «${sk.nome}», instruções abaixo)`;
    });
    const notas = [...t.matchAll(/@nota:(?:"([^"]+)"|(\S+))/g)].map((m) => m[1] || m[2]);
    for (const a of anexosTexto) {
      const conteudoSkill = await window.orq.repertorio.conteudo(a.sk.id);
      enviar += `\n\n---\nSkill «${a.sk.nome}» (de ${a.sk.fonte}): siga estas instruções.\n\n${conteudoSkill || '(não consegui ler a skill)'}`;
    }
    for (const c of notas) {
      const n = window.orqNotas && window.orqNotas.listar().find((x) => x.caminho === c);
      if (!n) continue;
      try {
        const r = await window.orq.notas.ler(n.i, n.rel);
        const abs = await window.orq.notas.caminho(n.i, n.rel);
        const texto = r.conteudo.length > 30000 ? `${r.conteudo.slice(0, 30000)}\n…(cortado: a nota inteira está no arquivo)` : r.conteudo;
        enviar += `\n\n---\nNota mencionada «${c}» (arquivo ${abs}):\n\n${texto}`;
      } catch { /* nota sumiu */ }
    }
    for (const m of t.matchAll(/@workflow:(?:"([^"]+)"|(\S+))/g)) {
      const d = window.orqWorkflows && window.orqWorkflows.descrever(m[1] || m[2]);
      if (d) enviar += `\n\n---\n${d}`;
    }
    return { enviar, exibir: enviar === t ? null : t };
  }
  window.orqConversa = {
    inserir: (texto) => { entrada.value = entrada.value ? `${entrada.value} ${texto}` : texto; entrada.focus(); ajustarAltura(); },
    mandar: async (texto) => { const e = await expandir(texto); return C.mandar(ativa, e.enviar, [], e.exibir); },
    // Para os comandos do "/" (comandos-tela.js).
    ativa: () => ativa,
    motor: () => (conversaCodex() ? 'codex' : 'claude'),
    info: () => infoAtual,
    comandos: () => comandosPor.get(ativa) || [],
    aviso: (texto, tipo) => { aviso(texto, tipo); colado = true; rolar(); },
    avisoComando,
    abrirPopup, fecharPopup,
    abrirPopupConfig: () => abrirPopupConfig(),
    abrirPopupPermissoes: () => abrirPopupPermissoes(),
    abrirMenuModelo: () => $('botao-modelo').click(),
    anexarArquivo: () => $('anexar').click(),
    trocar: (id) => trocar(id),
    // Um cartão na conversa (resposta de /btw, por exemplo): fica na tela, não no histórico.
    cartao: (html, classe = '') => {
      grupo = null;
      const el = document.createElement('div');
      el.className = `cartao-comando ${classe}`.trim();
      el.innerHTML = html;
      caixa.append(el);
      colado = true; rolar();
      return el;
    },
    // As suas mensagens (balões), da mais antiga para a mais nova (o /rewind).
    mensagens: () => [...caixa.querySelectorAll('.msg-voce[data-texto]')].map((m) => m.dataset.texto),
    voltarPara: (i) => { const b = [...caixa.querySelectorAll('.msg-voce[data-texto]')][i]; return b ? voltarPara(b) : null; },
    // Texto da última resposta (n = 1) ou da n-ésima de trás para frente (o /copy).
    resposta: (n = 1) => {
      const grupos = [...caixa.querySelectorAll('.msg-claude')].filter((g) => g.querySelector('.texto-claude:not(.rascunho)'));
      const g = grupos[grupos.length - Math.max(1, Number(n) || 1)];
      return g ? markdownDoGrupo(g) : null;
    },
  };
  // Atalhos com tecla (Ctrl+Alt+1..9): enviam direto ou só escrevem na caixa.
  document.addEventListener('keydown', async (ev) => {
    if (!ev.ctrlKey || !ev.altKey || !/^[1-9]$/.test(ev.key)) return;
    await carregarRepertorio();
    const a = repertorio.atalhos.find((x) => x.tecla === ev.key);
    if (!a) return;
    ev.preventDefault();
    document.querySelector('[data-aba="aba-orquestrador"]')?.click();
    if (a.enviar) { colado = true; window.orqConversa.mandar(a.texto); } else window.orqConversa.inserir(a.texto);
  });
  entrada.addEventListener('input', () => { escolhida = 0; navegou = false; atualizarSugestoes(); });
  entrada.addEventListener('keydown', (ev) => {
    if ($('sugestoes').hidden) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      navegou = true;
      escolhida = escolhida < 0 ? (ev.key === 'ArrowDown' ? 0 : sugestoes.length - 1)
        : (escolhida + (ev.key === 'ArrowDown' ? 1 : -1) + sugestoes.length) % sugestoes.length;
      atualizarSugestoes();
    } else if (ev.key === 'Tab' || (ev.key === 'Enter' && !ev.shiftKey)) {
      const c = sugestoes[escolhida];
      // Enter com o comando já digitado inteiro manda direto (o /exit
      // digitado inteiro também: aí é escolha clara).
      // Um alias digitado inteiro ("/cost") também manda direto.
      const digitado = entrada.value.trim();
      const inteiro = (x) => x && (digitado === x.inserir || (x.aliases || []).some((a) => digitado === `/${a}`));
      if (ev.key === 'Enter' && c && inteiro(c)) { fecharSugestoes(); return; }
      if (ev.key === 'Enter' && !c && sugestoes.some(inteiro)) { fecharSugestoes(); return; }
      ev.preventDefault(); ev.stopImmediatePropagation();
      // Nada selecionado ou o /exit selecionado (Enter): não completa.
      if (!c || (ev.key === 'Enter' && ehExit(c))) return;
      completar(escolhida);
    } else if (ev.key === 'Escape') {
      dispensada = entrada.value; // a lista fechada à mão não reabre quando os arquivos chegam
      fecharSugestoes();
    }
  });
  $('sugestoes').addEventListener('mousedown', (ev) => {
    const li = ev.target.closest('li');
    if (li) { ev.preventDefault(); completar(Number(li.dataset.i)); }
  });
  entrada.addEventListener('blur', () => setTimeout(fecharSugestoes, 100));
  function ajustarAltura() { entrada.style.height = 'auto'; entrada.style.height = Math.min(entrada.scrollHeight, 220) + 'px'; }
  entrada.addEventListener('input', ajustarAltura);
  entrada.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); enviarAgora = ev.ctrlKey || ev.metaKey; envioDeVerdade = ev.isTrusted === true; $('compositor').requestSubmit(); }
    // Shift+Tab só troca o modo com a caixa vazia (com texto, ele navega como sempre) e se a opção estiver ligada.
    if (ev.key === 'Tab' && ev.shiftKey && !ev.ctrlKey && !ev.altKey && !entrada.value && cfg.shiftTabTrocaModo !== false && !$('chip-modo').hidden) { ev.preventDefault(); proximoModo(); }
  });
  // Ctrl+Enter com o motor trabalhando: "enviar já" (parado, é um envio comum).
  let enviarAgora = false;
  // O envio veio de uma tecla ou de um clique de verdade da pessoa (e não de código do app,
  // de um atalho que envia sozinho ou de um teste)? Só assim o "!" roda um comando.
  let envioDeVerdade = false;
  $('enviar').addEventListener('click', (ev) => { envioDeVerdade = ev.isTrusted === true; }, true);
  entrada.addEventListener('beforeinput', (ev) => {
    if (!ev.isTrusted) return;
    if (entrada.value !== valorDaPessoa) exclamacaoDaPessoa = false; // o texto mudou por código desde a última tecla dela
    shellRecuperado = null;
    const dado = ev.data != null ? ev.data : ev.dataTransfer ? ev.dataTransfer.getData('text/plain') : '';
    if (entrada.selectionStart === 0 && /^!/.test(dado || '')) exclamacaoDaPessoa = true;
  });
  entrada.addEventListener('input', (ev) => {
    if (ev.isTrusted) { valorDaPessoa = entrada.value; if (!/^!/.test(entrada.value)) exclamacaoDaPessoa = false; }
    desenharModoShell();
  });
  $('compositor').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const agora = enviarAgora;
    const deVerdade = envioDeVerdade;
    enviarAgora = false; envioDeVerdade = false;
    const t = entrada.value.trim();
    if (!t && !anexos.length && !arquivosAnexos.length) return;
    // "!comando": roda no computador da pessoa, só quando ELA enviou. Por qualquer outro
    // caminho o texto segue abaixo como mensagem comum.
    const comandoShell = deVerdade && modoShell() ? t.slice(1).trim() : '';
    if (comandoShell) { await rodarShellDaCaixa(comandoShell, t); return; }
    // Ponte antiga (app aberto antes da versão com imagens): ela só leva o
    // texto. Nunca perder imagem em silêncio: avisa e deixa os anexos na caixa.
    if (anexos.length && !window.orq.permissoes) {
      aviso('Este app foi aberto antes da versão que manda imagens: feche e abra o app. Nada foi enviado; as imagens continuam na caixa.', 'erro');
      return;
    }
    // Comando do "/": o jeito de cada um vem da lista (comandos.js). Os que o
    // app faz (popup, pedido de controle, arquivo, terminal) não vão ao motor
    // como texto; comandos-tela.js faz cada um. Os outros seguem abaixo.
    const cmd = t.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
    const item = cmd && !anexos.length && !arquivosAnexos.length ? acharComando(cmd[1]) : null;
    if (item && window.orqComandos) {
      const r = await window.orqComandos.executar(item, (cmd[2] || '').trim(), t);
      if (r && r.feito) {
        if (!r.manterTexto) { entrada.value = ''; ajustarAltura(); fecharSugestoes(); }
        enviados.push(t); if (enviados.length > 50) enviados.shift();
        posHistorico = -1;
        return;
      }
      if (r && r.cancelado) return;
    }
    entrada.value = ''; ajustarAltura();
    if (t) { enviados.push(t); if (enviados.length > 50) enviados.shift(); }
    posHistorico = -1;
    fecharVolta();
    colado = true;
    if (ativa === 'orquestrador') pet.definir('pensando');
    const imagens = anexos.splice(0);
    const arquivos = arquivosAnexos.splice(0);
    desenharAnexos();
    const e = await expandir(t);
    // Arquivos anexados vão pelo caminho; o balão mostra só os nomes.
    if (arquivos.length) {
      e.enviar = `${e.enviar}${e.enviar ? '\n\n' : ''}Arquivos anexados (leia do disco):\n${arquivos.map((a) => `- ${a.caminho}`).join('\n')}`;
      e.exibir = `${e.exibir || t}${t ? '\n' : ''}📎 ${arquivos.map((a) => a.nome).join(', ')}`;
    }
    await C.daCaixa(ativa, e.enviar, imagens, e.exibir, { agora });
  });
  caixa.addEventListener('click', async (ev) => {
    const ja = ev.target.closest('[data-fila-ja]'), tirar = ev.target.closest('[data-fila-tirar]');
    if (ja) { ja.disabled = true; await C.fila(ativa, 'ja', ja.dataset.filaJa); }
    else if (tirar) { tirar.disabled = true; await C.fila(ativa, 'tirar', tirar.dataset.filaTirar); }
  });
  $('faixa-fila').addEventListener('click', () => { const q = caixa.querySelector('.msg-fila'); if (q) q.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
  // Interromper (botão Parar ou Esc): a tela diz o que isso significa.
  function interromperPorMim() {
    C.interromper(ativa);
    aviso('Interrompido por você. Arquivos já alterados continuam alterados.');
  }
  $('parar').addEventListener('click', interromperPorMim);

  // --- corrigir mensagem enviada ---------------------------------------------
  // ✎ no balão: VOLTA a conversa para antes daquela mensagem — ela e tudo o
  // que veio depois saem do contexto do Claude (a conversa antiga fica
  // guardada no histórico dele) — e o texto dela volta para a caixa. Na
  // última mensagem é direto; numa mais antiga pede confirmação.
  // Seta para cima com a caixa vazia só traz de volta um texto já enviado.
  const enviados = [];
  let posHistorico = -1, voltaPedida = null;
  function porNaCaixa(texto) {
    entrada.value = texto;
    ajustarAltura();
    entrada.focus();
    entrada.setSelectionRange(texto.length, texto.length);
    desenharModoShell();
  }
  function fecharVolta() { voltaPedida = null; $('corrigindo').hidden = true; }
  async function voltarPara(msg) {
    const baloes = [...caixa.querySelectorAll('.msg-voce[data-texto]')];
    const ordemDoFim = baloes.length - 1 - baloes.indexOf(msg);
    fecharVolta();
    const r = await C.voltar(ativa, ordemDoFim, msg.dataset.texto || '');
    if (!r || !r.ok) { aviso(`Não deu para voltar: ${(r && r.erro) || 'erro desconhecido'}. A conversa continua como estava.`, 'erro'); return; }
    porNaCaixa(r.texto || msg.dataset.texto || '');
    aviso('Voltei a conversa para antes desta mensagem. Corrija e envie.');
  }
  entrada.addEventListener('keydown', (ev) => {
    if (!$('sugestoes').hidden || ev.shiftKey || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (ev.key === 'ArrowUp' && (!entrada.value || posHistorico >= 0) && enviados.length) {
      ev.preventDefault();
      posHistorico = posHistorico < 0 ? enviados.length - 1 : Math.max(0, posHistorico - 1);
      // Um "!comando" que a pessoa já rodou volta como comando; qualquer outro texto, como texto.
      shellRecuperado = rodadosNoShell.has(enviados[posHistorico]) ? enviados[posHistorico] : null;
      porNaCaixa(enviados[posHistorico]);
    } else if (ev.key === 'ArrowDown' && posHistorico >= 0) {
      ev.preventDefault();
      posHistorico++;
      if (posHistorico >= enviados.length) { posHistorico = -1; porNaCaixa(''); } else porNaCaixa(enviados[posHistorico]);
    } else if (ev.key === 'Escape' && voltaPedida) fecharVolta();
  });
  entrada.addEventListener('input', () => { if (!entrada.value) posHistorico = -1; });
  caixa.addEventListener('click', async (ev) => {
    const b = ev.target.closest('.editar-msg');
    if (!b) return;
    const msg = b.closest('.msg-voce');
    const baloes = [...caixa.querySelectorAll('.msg-voce[data-texto]')];
    const depois = baloes.length - 1 - baloes.indexOf(msg);
    if (!depois) { await voltarPara(msg); return; }
    voltaPedida = msg;
    $('corrigindo-texto').textContent = `Voltar até esta mensagem? Ela e ${depois === 1 ? 'a 1 mensagem sua depois dela saem' : `as ${depois} mensagens suas depois dela saem`} da conversa do Claude, com as respostas. A conversa antiga fica guardada.`;
    $('corrigindo').hidden = false;
  });
  $('corrigindo-voltar').addEventListener('click', () => voltaPedida && voltarPara(voltaPedida));
  $('corrigindo-cancelar').addEventListener('click', fecharVolta);
  // A rodada não começa sozinha ao abrir o app: começa aqui.
  $('iniciar-rodada').addEventListener('click', iniciarRodada);
  $('desligar').addEventListener('click', (ev) => confirmar(ev.currentTarget, 'Confirmar desligar', desligarRodada));
  $('nova-conversa').addEventListener('click', async () => trocar(await C.nova()));

  // --- pilha única do Esc -----------------------------------------------------------
  // Cada Esc faz UMA coisa, a primeira que valer, nesta ordem:
  //   1. menu da barra aberto (ou a confirmação dentro dele) → fecha só isso;
  //   2. lista de sugestões, popup, Configurações, paleta, visor → fecha quem está
  //      por cima (cada um tem o próprio ouvinte; aqui só se garante que o Esc para ali);
  //   3. "corrigindo" (voltar a conversa) → cancela;
  //   4. motor ocupado → interrompe;
  //   5. parado e com a caixa vazia, Esc Esc (em 0,6 s) → abre o voltar na última mensagem.
  // Nunca interrompe com o foco num terminal ou num campo que não é a caixa da
  // conversa, nem fora da aba da conversa: um Esc dentro do terminal pararia o
  // orquestrador no meio de um comando. O texto da caixa nunca é apagado.
  const POR_CIMA = '#popup:not([hidden]), #config:not([hidden]), .paleta-fundo:not([hidden]), #visor-imagem:not([hidden]), #guarda-roupa:not([hidden])';
  const MENUS_DA_BARRA = [['menu-modelo', fecharMenu, 'botao-modelo'], ['menu-modo', fecharMenuModo, 'chip-modo'], ['menu-uso', fecharMenuUso, 'chip-uso'], ['menu-mais', fecharMenuMais, 'chip-mais']];
  let ultimoEsc = 0;
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey) return;
    const parar = () => { ev.preventDefault(); ev.stopPropagation(); };
    for (const [id, fechar, botao] of MENUS_DA_BARRA) {
      if ($(id).hidden) continue;
      const confirmando = $(id).querySelector('.menu-confirma');
      if (confirmando) confirmando.parentElement.innerHTML = ''; else { fechar(); $(botao).focus(); }
      parar();
      return;
    }
    if (!$('sugestoes').hidden || document.querySelector(POR_CIMA)) return; // o dono fecha
    if (!$('aba-orquestrador').classList.contains('ativa')) return;
    // A barra de busca (Ctrl+F) aberta é um nível: o Esc a fecha antes de qualquer outra coisa.
    if (window.orqBusca && window.orqBusca.aberta()) { window.orqBusca.fechar(); parar(); return; }
    const foco = document.activeElement;
    // Foco fora da conversa (as colunas dos lados, a barra de cima): o Esc é de quem está lá
    // (ex.: cancelar uma confirmação no painel de demandas), nunca uma parada do motor.
    if (foco && foco !== document.body && !foco.closest('#aba-orquestrador')) return;
    if (foco && foco !== entrada && (foco.closest('.xterm, .ProseMirror, [contenteditable="true"]') || foco.matches('input, textarea, select'))) return;
    if (voltaPedida) { fecharVolta(); parar(); return; }
    if (infoAtual.ocupado) { parar(); interromperPorMim(); return; }
    if (entrada.value || infoAtual.motor === 'codex') return;
    const agora = Date.now();
    if (agora - ultimoEsc >= 600) { ultimoEsc = agora; return; }
    ultimoEsc = 0;
    // Esc Esc: pede a confirmação de voltar para antes da última mensagem (nada muda sem o "Voltar").
    const ultima = [...caixa.querySelectorAll('.msg-voce[data-texto]')].pop();
    if (!ultima) return;
    parar();
    voltaPedida = ultima;
    $('corrigindo-texto').textContent = 'Voltar para antes da sua última mensagem? Ela e a resposta saem da conversa do Claude, e o texto volta para a caixa. A conversa antiga fica guardada.';
    $('corrigindo').hidden = false;
  }, true);

  // Configuração mudada na engrenagem: vale na hora (bichinho, comandos).
  window.addEventListener('orq:config', (ev) => {
    // Junta, não troca: uma resposta parcial (ex.: só tema e cor) não pode
    // apagar o comando de desligar e esconder o botão.
    cfg = { ...cfg, ...ev.detail };
    $('palco-pet').classList.toggle('desligado', cfg.mostrarBichinho === false);
    $('dica-shell').hidden = cfg.comandoNaCaixa !== true;
    desenharModoShell();
    desenharLista(listaConversas);
  });
  Promise.all([window.orq.config.ler(), C.lista()]).then(([c, l]) => {
    cfg = c;
    // O aviso "orq:config" da leitura inicial da engrenagem pode chegar antes de
    // este script escutar: o bichinho desligado vale já na abertura.
    $('palco-pet').classList.toggle('desligado', cfg.mostrarBichinho === false);
    $('dica-shell').hidden = cfg.comandoNaCaixa !== true;
    desenharLista(l);
    trocar('orquestrador');
  });
  // Testes de tela: ganchos para injetar eventos e pedidos sem um Claude real.
  // Fica no fim do script: tudo o que ele expõe já existe aqui.
  // --- o que espera aprovação (aba Recados), também aqui na conversa ----------
  // Recado para outro computador ou pedido avulso que pede escrita: entra na
  // conversa do orquestrador como um cartão igual ao de pergunta (Aprovar /
  // Negar, com motivo opcional). Decidir aqui ou na aba Recados é a mesma coisa.
  const R = window.orq.recados;
  let aguardando = [];
  const naDoOrquestrador = () => !!(listaConversas || []).find((c) => c.id === ativa && c.orquestrador);
  function cartaoAprovacao(r) {
    if (caixa.querySelector(`[data-aprovacao="${CSS.escape(r.id)}"]`)) return;
    const el = document.createElement('div');
    el.className = 'cartao-pedido cartao-aprovacao';
    el.dataset.aprovacao = r.id;
    // "Recado para" é traduzido; o nome e o assunto ficam como estão.
    el.innerHTML = `<fieldset class="pergunta" data-multi="0">
        <legend><span class="etiqueta">Aprovar</span><span><span>${r.canal ? 'Recado para' : 'Pedido ao'}</span> <span data-sem-traducao>${esc(r.para.nome)}${r.titulo ? ` — ${esc(r.titulo)}` : ''}</span></span></legend>
        <div class="texto-aprovacao" data-sem-traducao>${esc(r.texto)}</div>
        <div class="opcoes">
          <button type="button" class="opcao unica" data-decidir="1" role="radio" aria-checked="false"><strong>Aprovar</strong><span>${esc(r.canal ? `Sai agora para ${r.para.nome}` : 'Roda com permissão de escrever')}</span></button>
          <button type="button" class="opcao unica" data-decidir="0" role="radio" aria-checked="false"><strong>Negar</strong><span>Não sai; o orquestrador recebe o seu motivo</span></button>
        </div>
        <textarea class="outra" rows="1" maxlength="2000" placeholder="Orientação ou motivo (opcional; escreva antes de escolher)"></textarea>
      </fieldset>`;
    if (r.anexos && r.anexos.length) anexosNoCartao(el, r);
    grupo = null;
    caixa.append(el);
    rolar();
  }
  // Recado com anexo: as mesmas miniaturas e o mesmo aviso do link da aba Recados. Aprovar só
  // liga quando TODAS as imagens foram montadas; se alguma não puder ser montada, o cartão manda
  // abrir a aba Recados e não aprova às cegas (Negar continua valendo).
  const tamanhoAnexo = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 102.4) / 10} KB` : `${Math.round(b / 104857.6) / 10} MB`);
  async function anexosNoCartao(el, r) {
    const imagem = (x) => x.tipo === 'png' || x.tipo === 'jpg' || x.tipo === 'webp';
    let info = { anexoDias: 7, anexoMaxMB: 5 };
    try { const c = await window.orq.canal.estado(); if (c && c.anexoDias) info = c; } catch { /* fica o padrão */ }
    const d = info.anexoDias;
    const aprovar = el.querySelector('[data-decidir="1"]');
    const temImagem = r.anexos.some(imagem);
    if (temImagem) aprovar.disabled = true;
    el.querySelector('.texto-aprovacao').insertAdjacentHTML('afterend', `<div class="recado-anexos">${r.anexos.map((x, i) => (imagem(x)
      ? `<figure class="recado-anexo"><img class="recado-miniatura" data-cv-i="${i}" alt="" hidden><figcaption><span data-sem-traducao>${esc(x.nome)} · ${esc(tamanhoAnexo(x.bytes))}</span></figcaption></figure>`
      : `<div class="recado-anexo recado-anexo-pdf"><span aria-hidden="true">📄</span> <span data-sem-traducao>${esc(x.nome)} · ${esc(tamanhoAnexo(x.bytes))}</span></div>`)).join('')}</div>
      <div class="recado-aviso-anexo" role="alert"><strong>${d === 1 ? 'Quem tiver o link abre por 1 dia: não mande print com senha, token ou dado pessoal ou de cliente; recorte a tela antes.' : `Quem tiver o link abre por ${d} dias: não mande print com senha, token ou dado pessoal ou de cliente; recorte a tela antes.`}</strong>
      <span class="nota">${`Cada arquivo pode ter até ${info.anexoMaxMB} MB. Das imagens, o app tira os metadados (EXIF, GPS, texto); o PDF vai como está.`}</span></div>`);
    if (!temImagem) return;
    let faltam = r.anexos.filter(imagem).length;
    let falhou = false;
    for (const img of el.querySelectorAll('img[data-cv-i]')) {
      R.anexo(r.id, Number(img.dataset.cvI)).then((res) => {
        if (res && res.dataUrl) { img.src = res.dataUrl; img.hidden = false; } else falhou = true;
      }).catch(() => { falhou = true; }).finally(() => {
        if (--faltam > 0) return;
        if (falhou) el.querySelector('.recado-aviso-anexo').insertAdjacentHTML('afterend', '<p class="nota recado-anexo-falha">Abra na aba Recados para ver a imagem antes de aprovar.</p>');
        else aprovar.disabled = false;
      });
    }
  }
  function desenharAprovacoes() {
    const vivos = new Set(aguardando.map((r) => r.id));
    // Decidido em outro lugar (aba Recados, bichinho): o cartão vira a linha de respondido.
    for (const c of [...caixa.querySelectorAll('[data-aprovacao]:not(.respondido)')]) {
      if (!vivos.has(c.dataset.aprovacao)) fecharPedido(c, 'Decidido na aba Recados');
    }
    if (naDoOrquestrador()) aguardando.forEach(cartaoAprovacao);
  }
  async function carregarAprovacoes(l) {
    try { aguardando = (l || await R.lista()).filter((r) => r.estado === 'aguardando'); } catch { aguardando = []; }
    desenharAprovacoes();
  }
  async function decidirAprovacao(c, aprovar) {
    c.querySelectorAll('button').forEach((x) => { x.disabled = true; });
    const r = await R.decidir(c.dataset.aprovacao, aprovar, c.querySelector('textarea').value);
    if (r && r.erro) { c.querySelectorAll('button').forEach((x) => { x.disabled = false; }); c.querySelector('fieldset').insertAdjacentHTML('beforeend', `<span class="nota">${esc(r.erro)}</span>`); return; }
    aguardando = aguardando.filter((x) => x.id !== c.dataset.aprovacao);
    fecharPedido(c, aprovar ? 'Aprovado' : 'Negado');
  }
  if (R) { R.aoMudar((l) => carregarAprovacoes(l)); carregarAprovacoes(); }

  // Barra da conversa cheia: em vez de cortar o último botão, encolhe por
  // etapas (estilo.css: .apertada, .muito-apertada). Mede de novo quando a
  // janela muda ou quando um chip aparece, some ou muda de texto.
  const barra = document.querySelector('.conversa-barra');
  let ajusteAgendado = false;
  function ajustarBarra() {
    ajusteAgendado = false;
    barra.classList.remove('apertada', 'muito-apertada');
    if (barra.scrollWidth <= barra.clientWidth + 1) return;
    barra.classList.add('apertada');
    if (barra.scrollWidth > barra.clientWidth + 1) barra.classList.add('muito-apertada');
  }
  const agendarAjuste = () => { if (!ajusteAgendado) { ajusteAgendado = true; setTimeout(ajustarBarra, 16); } };
  if (barra) {
    new ResizeObserver(agendarAjuste).observe(barra);
    new MutationObserver(agendarAjuste).observe(barra, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  }

  if (window.orq.teste) window.__orqTeste = { lembrarEnviado: (t) => enviados.push(t), anexarCaminho, desenharEvento, desenharParcial, cartaoPedido, pedidos, trocar, abrirPopupConfig, abrirPopupPermissoes, desenharInfo, pet, linksAbertos, caminhosAbertos, expandir: (t) => expandir(t) };
})();
