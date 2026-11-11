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
    grupo.innerHTML = `<div class="autor"><span class="marca-claude">✳</span>Claude${ms ? `<time class="hora-msg" data-sem-traducao title="${esc(new Date(ms).toLocaleString('pt-BR'))}">${esc(horario(ms))}</time>` : ''}</div>`;
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
      el.innerHTML = `<summary>📌 ${tp[2] === 'recusado' ? 'Demanda recusada' : 'Demanda aprovada'}: <span data-sem-traducao>${esc(tp[3])}</span></summary><div class="msg-bastidor-texto">${esc(tp[4])}</div>`;
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

  function textoClaude(t) {
    if (!t.trim()) return;
    const el = document.createElement('div');
    el.className = 'md texto-claude';
    el.innerHTML = md(t);
    marcarCaminhos(el);
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
  function marcarCaminhos(raiz) {
    const codigos = [...raiz.querySelectorAll('code')].filter((c) => !c.closest('pre'));
    const dicas = codigos.map((c) => c.textContent.trim()).filter((t) => PARECE_CAMINHO.test(t) && t.length > 2);
    for (const c of codigos) {
      const t = c.textContent.trim();
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
    } else if (ev.tipo === 'resultado') {
      limparRascunho();
      if (ev.erro) aviso(ev.texto || 'O turno terminou com erro.', 'erro');
      grupo = null;
    } else if (ev.tipo === 'encerrada') {
      limparRascunho(); grupo = null;
      const el = document.createElement('div');
      el.className = 'rodada-encerrada';
      el.innerHTML = `<strong>Rodada encerrada</strong><span>O orquestrador saiu. Na próxima vez que abrir o app, começa uma rodada nova.</span>
        <button type="button" class="botao primario" data-nova-rodada>Começar nova rodada agora</button>`;
      caixa.append(el);
    } else if (ev.tipo === 'fim' || ev.tipo === 'erro') {
      limparRascunho();
      aviso(ev.texto, ev.tipo === 'erro' ? 'erro' : '');
    }
  }

  // --- perguntas e permissões --------------------------------------------
  function cartaoPedido(p) {
    if (document.querySelector(`[data-pedido="${CSS.escape(p.id)}"]`)) return;
    const el = document.createElement('div');
    el.className = 'cartao-pedido';
    el.dataset.pedido = p.id;
    if (p.ferramenta === 'AskUserQuestion') {
      el.innerHTML = (p.entrada.questions || []).map((q, i) => `
        <fieldset class="pergunta" data-i="${i}" data-multi="${q.multiSelect ? 1 : 0}">
          <legend><span class="etiqueta">${esc(q.header || 'Pergunta')}</span>${esc(q.question)}${q.multiSelect ? '<span class="dica-multi">Pode marcar mais de uma</span>' : ''}</legend>
          <div class="opcoes">${(q.options || []).map((o) => `
            <button type="button" class="opcao ${q.multiSelect ? 'multi' : 'unica'}" data-rotulo="${esc(o.label)}" role="${q.multiSelect ? 'checkbox' : 'radio'}" aria-checked="false">
              <strong>${esc(o.label)}</strong>${o.description ? `<span>${esc(o.description)}</span>` : ''}${o.preview ? `<pre class="previa">${esc(o.preview)}</pre>` : ''}</button>`).join('')}
          </div>
          <textarea class="outra" rows="1" placeholder="Outra resposta…  (Enter responde · Shift+Enter quebra linha · Ctrl+V cola print)"></textarea>
          <div class="anexos anexos-pergunta" hidden></div>
        </fieldset>`).join('') +
        '<div class="acoes"><button type="button" class="botao primario" data-enviar-resposta>Responder</button></div>';
    } else {
      const [verbo, alvo] = resumoFerramenta(p.ferramenta, p.entrada);
      const corpo = p.ferramenta === 'Bash' ? p.entrada.command : JSON.stringify(p.entrada, null, 2);
      el.innerHTML = `<div class="titulo-pedido"><span class="ponto permissao"></span>O orquestrador pede permissão: <strong>${esc(verbo)}</strong> ${esc(alvo)}</div>
        <pre class="entrada-ferramenta">${esc(curto(corpo, 3000))}</pre>
        <div class="acoes"><button type="button" class="botao primario" data-permitir="1">Permitir</button>
          <button type="button" class="botao secundario" data-permitir="0">Negar</button></div>`;
    }
    grupo = null;
    caixa.append(el);
    colado = true; rolar();
  }

  caixa.addEventListener('click', async (ev) => {
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
    if (a) { ev.preventDefault(); return; } // nada de navegar para fora do app
    if (ev.target.closest('[data-nova-rodada]')) { trocar('orquestrador'); return; }
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
      if (fs.dataset.multi !== '1') fs.querySelector('.outra').value = '';
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
    outra.style.height = 'auto';
    outra.style.height = Math.min(outra.scrollHeight + 2, 240) + 'px';
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
    for (const fs of cartao.querySelectorAll('.pergunta')) {
      const q = p.entrada.questions[fs.dataset.i];
      const outra = fs.querySelector('.outra').value.trim();
      const marcadas = [...fs.querySelectorAll('.opcao.marcada')].map((o) => o.dataset.rotulo);
      // Múltipla escolha: as marcadas e o texto de "Outra resposta" vão juntos.
      let r = fs.dataset.multi === '1' && marcadas.length && outra ? `${marcadas.join(', ')}; ${outra}` : (outra || marcadas.join(', '));
      if (!r && !prints.length) { fs.classList.add('falta'); return; }
      if (prints.length && fs === cartao.querySelector('.pergunta')) r = `${r ? `${r} ` : ''}(a print segue na próxima mensagem)`;
      respostas[q.question] = r;
    }
    await C.responder(ativa, cartao.dataset.pedido, { permitir: true, respostas });
    if (prints.length) {
      const q0 = p.entrada.questions[0];
      await C.mandar(ativa, `Print da minha resposta à pergunta "${q0.header || q0.question}".`, prints);
    }
    // Respondido: cada pergunta com a sua resposta embaixo, uma por bloco.
    cartao.classList.add('respondido', 'respondido-perguntas');
    cartao.innerHTML = `<div class="titulo-respondido"><span class="ponto trabalhando"></span>Respondido</div>` +
      p.entrada.questions.map((q) => `<div class="resposta-dada">
        <span class="etiqueta">${esc(q.header || 'Pergunta')}</span>
        <strong>${esc(q.question)}</strong>
        <p>${esc(respostas[q.question] || '')}</p></div>`).join('');
  }

  function fecharPedido(cartao, texto) {
    cartao.classList.add('respondido');
    cartao.innerHTML = `<span class="ponto trabalhando"></span>${esc(texto)}`;
  }

  // --- barra de informações ----------------------------------------------
  const nomeModelo = (m) => {
    if (!m) return '—';
    const x = m.match(/claude-([a-z]+)-(\d+)-(\d+)/);
    return x ? `${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}.${x[3]}` : m;
  };
  function medidor(el, rotulo, pct, extra = '') {
    if (pct == null) { el.hidden = true; return; }
    el.hidden = false;
    const nivel = pct >= 80 ? 'alto' : pct >= 50 ? 'medio' : 'baixo';
    el.innerHTML = `<span class="rotulo">${rotulo}</span><span class="barra-uso"><i class="${nivel}" style="width:${Math.min(pct, 100)}%"></i></span><span class="valor">${pct}%${extra}</span>`;
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
    const janela = i.janela || null;
    medidor($('info-contexto'), 'Contexto', i.contexto != null && janela ? Math.round((i.contexto / janela) * 100) : null);
    medidor($('info-5h'), '5 h', i.uso5h);
    medidor($('info-7d'), '7 dias', i.uso7d);
    $('trabalhando').hidden = !i.ocupado;
  }

  // --- modelo e esforço (botão da barra) ------------------------------------
  const MODELOS = [['opus', 'Opus 5.5', 'claude-opus-5-5'], ['sonnet', 'Sonnet 5.5', 'claude-sonnet-5-5'],
    ['haiku', 'Haiku 5.5', 'claude-haiku-5-5'], ['fable', 'Fable 5.1', 'claude-fable-5-1']];
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
    $('opcoes-modelo').innerHTML = MODELOS.map(([k, nome, id]) =>
      `<button type="button" data-modelo="${k}" aria-pressed="${m === id}">${nome}</button>`).join('');
    $('opcoes-esforco').innerHTML = ESFORCOS.map(([k, nome, n]) =>
      `<button type="button" data-esforco="${k}" aria-pressed="${infoAtual.esforco === k}"><span class="nivel">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'cheio' : ''}"></i>`).join('')}</span>${nome}</button>`).join('');
  }
  function fecharMenu() { $('menu-modelo').hidden = true; $('botao-modelo').setAttribute('aria-expanded', 'false'); }
  $('botao-modelo').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const abrir = $('menu-modelo').hidden;
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
    const o = b.dataset.modelo ? { modelo: b.dataset.modelo } : { esforco: b.dataset.esforco };
    await C.configurar(ativa, o);
    fecharMenu();
  });
  document.addEventListener('click', fecharMenu);

  // --- popups: /config e /permissions ---------------------------------------
  const popup = $('popup');
  function abrirPopup(titulo, html) {
    $('popup-titulo').textContent = titulo;
    $('popup-corpo').innerHTML = html;
    popup.hidden = false;
  }
  const fecharPopup = () => { popup.hidden = true; };
  $('fechar-popup').addEventListener('click', fecharPopup);
  popup.addEventListener('mousedown', (ev) => { if (ev.target === popup) fecharPopup(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !popup.hidden) fecharPopup(); });

  // Opções do /config do Claude Code. Cada mudança vira "/config chave=valor"
  // mandado à conversa (o Claude responde confirmando, na própria conversa).
  const SIM_NAO = ['true', 'false'];
  const OPCOES_CONFIG = [
    ['model', 'Modelo padrão', ['default', 'sonnet', 'opus', 'haiku', 'fable', 'best', 'sonnet[1m]', 'opus[1m]', 'fable[1m]', 'opusplan']],
    ['permissionMode', 'Modo de permissão', ['default', 'plan', 'acceptEdits', 'auto', 'dontAsk']],
    ['outputStyle', 'Estilo de resposta', ['default', 'Proactive', 'Concise', 'Explanatory', 'Learning']],
    ['thinking', 'Pensamento estendido', SIM_NAO],
    ['autoCompact', 'Compactar sozinho', SIM_NAO],
    ['checkpoints', 'Pontos de restauração', SIM_NAO],
    ['recap', 'Resumo ao voltar (recap)', SIM_NAO],
    ['promptSuggestionEnabled', 'Sugestão de prompt', SIM_NAO],
    ['language', 'Idioma das respostas', null],
    ['theme', 'Tema do terminal', ['auto', 'dark', 'light', 'light-daltonized', 'dark-daltonized', 'light-ansi', 'dark-ansi']],
    ['timeFormat', 'Formato de hora', ['auto', '12-hour', '24-hour', '24-hour-utc']],
    ['notifChannel', 'Canal de notificação', ['auto', 'iterm2', 'terminal_bell', 'iterm2_with_bell', 'kitty', 'ghostty', 'notifications_disabled']],
    ['inputNeededNotifEnabled', 'Avisar quando precisar de você', SIM_NAO],
    ['agentPushNotifEnabled', 'Notificação push dos agentes', SIM_NAO],
    ['remoteControl', 'Controle remoto', ['true', 'false', 'default']],
    ['editor', 'Modo do editor', ['normal', 'vim']],
    ['gitignore', 'Respeitar .gitignore', SIM_NAO],
    ['autoConnectIde', 'Conectar à IDE sozinho', SIM_NAO],
    ['externalEditorContext', 'Contexto do editor externo', SIM_NAO],
    ['prStatus', 'Status do PR', SIM_NAO],
    ['progressBar', 'Barra de progresso', SIM_NAO],
    ['autoScroll', 'Rolar sozinho', SIM_NAO],
    ['copyFullResponse', 'Copiar resposta inteira', SIM_NAO],
    ['copyOnSelect', 'Copiar ao selecionar', SIM_NAO],
    ['reduceMotion', 'Reduzir animações', SIM_NAO],
    ['tips', 'Dicas', SIM_NAO],
    ['defaultToAgentsView', 'Abrir na visão de agentes', SIM_NAO],
    ['leftArrowOpensAgents', 'Seta ← abre agentes', SIM_NAO],
    ['switchModelsOnFlag', 'Trocar modelo ao ser sinalizado', ['Switch automatically', 'Ask each time']],
  ];
  function abrirPopupConfig() {
    abrirPopup('Configurações do Claude', `<p class="popup-nota">Cada mudança é mandada ao Claude desta conversa como <code>/config chave=valor</code>; ele confirma na conversa.</p>` +
      OPCOES_CONFIG.map(([k, nome, ops]) => `<label class="popup-linha"><span><strong>${esc(nome)}</strong><code>${esc(k)}</code></span>
        ${ops ? `<select data-config="${esc(k)}"><option value="">—</option>${ops.map((o) => `<option>${esc(o)}</option>`).join('')}</select>`
              : `<input data-config="${esc(k)}" type="text" placeholder="ex.: português">`}</label>`).join(''));
  }
  $('popup-corpo').addEventListener('change', async (ev) => {
    const el = ev.target.closest('[data-config]');
    if (!el || !el.value) return;
    const v = /\s/.test(el.value) ? `"${el.value}"` : el.value;
    await C.mandar(ativa, `/config ${el.dataset.config}=${v}`);
    el.closest('.popup-linha').classList.add('mudou');
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
    grupo = null; ferramentas.clear(); limparRascunho();
    if (!r.eventos.length) {
      const atual = listaConversas.find((c) => c.id === ativa);
      caixa.innerHTML = `<div class="boas-vindas">
        <strong>${esc(atual && !atual.orquestrador ? atual.titulo : 'Orquestrador')}</strong><span>${atual && !atual.orquestrador ? 'Escreva abaixo para conversar com o Claude.' : 'Escreva abaixo. O orquestrador está ali no cantinho.'}</span></div>`;

    }
    r.eventos.forEach(desenharEvento);
    pedidos.clear();
    (r.pendentes || []).forEach((p) => { pedidos.set(p.id, p); cartaoPedido(p); });
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
    } else if (ev.tipo === 'encerrada') {
      pet.definir('livre');
      pet.classe('acenando'); pet.falar('Tchau! Até a próxima rodada.', 3000);
      setTimeout(() => pet.classe('acenando', false), 3000);
    }
  }

  // Eventos de conversas que não estão na tela só mexem na lista da lateral.
  C.aoTudo((id, r) => { if (id === ativa) redesenharTudo(r); });
  C.aoEvento((id, ev) => {
    if (id !== ativa) return;
    caixa.querySelector('.boas-vindas')?.remove();
    desenharEvento(ev); rolar();
    if (id === 'orquestrador' && !ev.sub) petReage(ev);
  });
  let agendado = false;
  C.aoParcial((id, t) => {
    if (id !== ativa) return;
    if (t == null) { limparRascunho(); if (id === 'orquestrador') pet.definir('pensando'); return; }
    rascunhoTexto += t;
    if (!rascunho) { rascunho = document.createElement('div'); rascunho.className = 'md texto-claude rascunho'; noGrupo(rascunho); }
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(() => { agendado = false; if (rascunho) { rascunho.innerHTML = md(rascunhoTexto); rolar(); } });
  });
  C.aoPedido((id, p) => {
    if (id === 'orquestrador') pet.definir('chamando', p.ferramenta === 'AskUserQuestion' ? 'Uma pergunta pra você!' : 'Preciso da sua permissão!');
    if (id === ativa) { pedidos.set(p.id, p); cartaoPedido(p); }
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
          <span class="ponto ${estado}" title="${texto}"></span>
        </button>
        ${c.orquestrador ? '' : `<button type="button" class="fechar-conversa" data-fechar-conversa="${esc(c.id)}" title="Tirar da lista (a conversa continua no histórico do Claude)" aria-label="Fechar conversa">✕</button>`}
      </div>`;
    }).join('');
    const atual = l.find((c) => c.id === ativa);
    const aba = document.querySelector('[data-aba="aba-orquestrador"]');
    aba.lastChild.textContent = atual && !atual.orquestrador ? curto(atual.titulo, 24) : 'Orquestrador';
    $('iniciar-rodada').hidden = !(atual && atual.orquestrador && cfg.comandoInicial);
    $('desligar').hidden = !(atual && atual.orquestrador && cfg.comandoDesligar);
    $('palco-pet').hidden = !!(atual && !atual.orquestrador);
    $('entrada').placeholder = atual && !atual.orquestrador
      ? 'Escreva para o Claude…  (Enter envia · Shift+Enter quebra linha)'
      : 'Escreva para o orquestrador…  (Enter envia · Shift+Enter quebra linha)';
  }
  C.aoLista(desenharLista);
  // Paleta Ctrl+K: conversas (com pergunta pendente = esperando você) e comandos.
  window.orqPaleta?.registrar(() => [
    ...listaConversas.map((c) => ({ grupo: 'Conversas', titulo: c.titulo, sub: c.pedidos ? 'pergunta esperando você' : c.ocupado ? 'trabalhando' : '', atencao: c.pedidos > 0, faz: () => trocar(c.id) })),
    ...COMANDOS_CLAUDE.concat(comandosPor.get(ativa) || []).filter((c, i, l) => l.findIndex((x) => x.nome === c.nome) === i)
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
    if (!outra) return;
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
  const comandosPor = new Map(); // conversa → [{nome, descricao, dica}]
  // O Claude, por trás, só anuncia as skills; os comandos próprios dele vêm
  // daqui. /exit é tratado pelo app (fecha a janela).
  const COMANDOS_CLAUDE = [
    ['exit', 'Fecha o app e encerra as conversas'], ['restart', 'Reinicia o Claude desta conversa e continua do mesmo ponto'], ['model', 'Mostra ou troca o modelo', '[modelo]'],
    ['effort', 'Troca o esforço', '<low|medium|high|xhigh|max>'], ['usage', 'Uso do plano: janelas de 5 h e 7 dias'],
    ['context', 'Quanto do contexto está em uso'], ['cost', 'Custo e tokens da sessão'],
    ['compact', 'Resume a conversa para liberar contexto', '[instruções]'], ['clear', 'Limpa o histórico da conversa'],
    ['status', 'Versão, conta e configuração'], ['memory', 'Arquivos de memória (CLAUDE.md)'],
    ['init', 'Cria um CLAUDE.md para o projeto'], ['review', 'Revisa um pull request'],
    ['security-review', 'Revisão de segurança das mudanças'], ['todos', 'Lista de tarefas da sessão'],
    ['mcp', 'Servidores MCP'], ['agents', 'Subagentes configurados'], ['hooks', 'Hooks configurados'],
    ['permissions', 'Regras de permissão'], ['doctor', 'Diagnóstico da instalação'],
    ['release-notes', 'Novidades da versão'], ['help', 'Ajuda'],
  ].map(([nome, descricao, dica = '']) => ({ nome, descricao, dica }));
  // (sem o app reaberto, a ponte antiga ainda não tem aoComandos)
  if (C.aoComandos) C.aoComandos((id, l) => comandosPor.set(id, l));
  let sugestoes = [];
  let escolhida = 0;
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
  function comandosDaConversa(busca) {
    const recebidos = comandosPor.get(ativa) || [];
    // Junta a lista do Claude com a nossa: a descrição nossa preenche os que
    // vieram sem descrição; os do app (/exit, /restart) entram sempre.
    const nossos = new Map(COMANDOS_CLAUDE.map((c) => [c.nome, c]));
    const nomes = new Set(recebidos.map((c) => c.nome));
    const todos = [...COMANDOS_CLAUDE.filter((c) => !nomes.has(c.nome)),
      ...recebidos.map((c) => (c.descricao || !nossos.has(c.nome) ? c : { ...c, descricao: nossos.get(c.nome).descricao, dica: c.dica || nossos.get(c.nome).dica }))];
    return todos.map((c) => ({ rotulo: `/${c.nome}`, dica: c.dica, desc: c.descricao, inserir: `/${c.nome}`, chave: c.nome }));
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
      else { busca = tok.slice(1); itens = itensMencao(''); }
    } else {
      const c = entrada.value.match(/^\/(\S*)$/);
      if (!c) return fecharSugestoes();
      faixaToken = [0, entrada.value.length];
      busca = c[1]; itens = comandosDaConversa();
    }
    const b = busca.toLowerCase();
    const comeca = itens.filter((x) => x.chave.toLowerCase().startsWith(b));
    const contem = itens.filter((x) => !x.chave.toLowerCase().startsWith(b) && (x.chave + ' ' + (x.desc || '')).toLowerCase().includes(b));
    sugestoes = [...comeca, ...contem].slice(0, 60);
    if (!sugestoes.length) return fecharSugestoes();
    escolhida = Math.min(escolhida, sugestoes.length - 1);
    $('sugestoes').innerHTML = sugestoes.map((c, i) => `<li role="option" data-i="${i}" aria-selected="${i === escolhida}">
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
    if (c.continuar) { escolhida = 0; atualizarSugestoes(); }
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
  entrada.addEventListener('input', () => { escolhida = 0; atualizarSugestoes(); });
  entrada.addEventListener('keydown', (ev) => {
    if ($('sugestoes').hidden) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      escolhida = (escolhida + (ev.key === 'ArrowDown' ? 1 : -1) + sugestoes.length) % sugestoes.length;
      atualizarSugestoes();
    } else if (ev.key === 'Tab' || (ev.key === 'Enter' && !ev.shiftKey)) {
      // Enter com o comando já digitado inteiro manda direto.
      if (ev.key === 'Enter' && sugestoes[escolhida] && entrada.value.trim() === sugestoes[escolhida].inserir) { fecharSugestoes(); return; }
      ev.preventDefault(); ev.stopImmediatePropagation();
      completar(escolhida);
    } else if (ev.key === 'Escape') {
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
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); $('compositor').requestSubmit(); }
  });
  $('compositor').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const t = entrada.value.trim();
    if (!t && !anexos.length && !arquivosAnexos.length) return;
    // Ponte antiga (app aberto antes da versão com imagens): ela só leva o
    // texto. Nunca perder imagem em silêncio: avisa e deixa os anexos na caixa.
    if (anexos.length && !window.orq.permissoes) {
      aviso('Este app foi aberto antes da versão que manda imagens: feche e abra o app. Nada foi enviado; as imagens continuam na caixa.', 'erro');
      return;
    }
    // /exit fecha o app, como o X do topo.
    if (t === '/exit' || t === '/quit') { (window.orq.janela ? window.orq.janela.fechar() : window.close()); return; }
    // Comandos que no terminal abrem uma janelinha de escolha: aqui também.
    if (t === '/model' || t === '/effort') { $('botao-modelo').click(); return; }
    if (t === '/config') { abrirPopupConfig(); return; }
    if (t === '/permissions' || t === '/allowed-tools') { abrirPopupPermissoes(); return; }
    // /restart: o app reinicia o Claude por trás (--resume), como no terminal.
    if (t === '/restart') { if (C.reiniciar) { await C.reiniciar(ativa); aviso('Claude reiniciado; a conversa continua do mesmo ponto.'); } return; }
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
    await C.mandar(ativa, e.enviar, imagens, e.exibir);
  });
  $('parar').addEventListener('click', () => C.interromper(ativa));

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
  $('iniciar-rodada').addEventListener('click', () => {
    if (!cfg.comandoInicial) return;
    colado = true;
    pet.definir('pensando');
    C.mandar('orquestrador', cfg.comandoInicial);
  });
  $('desligar').addEventListener('click', (ev) => confirmar(ev.currentTarget, 'Confirmar desligar', () => {
    colado = true;
    if (cfg.comandoDesligar) C.mandar('orquestrador', cfg.comandoDesligar);
  }));
  $('nova-conversa').addEventListener('click', async () => trocar(await C.nova()));

  // Configuração mudada na engrenagem: vale na hora (bichinho, comandos).
  window.addEventListener('orq:config', (ev) => {
    // Junta, não troca: uma resposta parcial (ex.: só tema e cor) não pode
    // apagar o comando de desligar e esconder o botão.
    cfg = { ...cfg, ...ev.detail };
    $('palco-pet').classList.toggle('desligado', cfg.mostrarBichinho === false);
    desenharLista(listaConversas);
  });
  Promise.all([window.orq.config.ler(), C.lista()]).then(([c, l]) => {
    cfg = c;
    desenharLista(l);
    trocar('orquestrador');
  });
  // Testes de tela: ganchos para injetar eventos e pedidos sem um Claude real.
  // Fica no fim do script: tudo o que ele expõe já existe aqui.
  if (window.orq.teste) window.__orqTeste = { lembrarEnviado: (t) => enviados.push(t), anexarCaminho, desenharEvento, cartaoPedido, pedidos, trocar, abrirPopupConfig, abrirPopupPermissoes, desenharInfo, pet, expandir: (t) => expandir(t) };
})();
