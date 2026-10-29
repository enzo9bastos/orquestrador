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

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
  function novoGrupo() {
    grupo = document.createElement('div');
    grupo.className = 'msg-claude';
    grupo.innerHTML = '<div class="autor"><span class="marca-claude">✳</span>Claude</div>';
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

  function balaoUsuario(texto) {
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
      : `<div class="balao">${esc(u.texto)}</div>`;
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
    noGrupo(el);
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
    if (ev.sub) return; // por dentro de um subagente: só o resumo dele aparece
    if (ev.tipo === 'user') {
      const c = ev.message.content;
      // Texto do usuário ao vivo já virou balão na hora de mandar (ev.local); o
      // que o Claude devolve depois é eco (ex.: o comando inicial) e não se
      // repete. Do histórico (ev.antigo) vem tudo. A saída de um comando
      // (/model, /usage…) aparece sempre.
      const eco = !ev.local && !ev.antigo;
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
          <legend><span class="etiqueta">${esc(q.header || 'Pergunta')}</span>${esc(q.question)}</legend>
          <div class="opcoes">${(q.options || []).map((o) => `
            <button type="button" class="opcao" data-rotulo="${esc(o.label)}">
              <strong>${esc(o.label)}</strong>${o.description ? `<span>${esc(o.description)}</span>` : ''}</button>`).join('')}
          </div>
          <textarea class="outra" rows="1" placeholder="Outra resposta…  (Enter responde · Shift+Enter quebra linha)"></textarea>
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
      // Escolheu uma opção: o texto de "Outra resposta" deixa de valer.
      fs.querySelector('.outra').value = '';
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
    outra.closest('.pergunta').querySelectorAll('.opcao.marcada').forEach((o) => o.classList.remove('marcada'));
  });
  caixa.addEventListener('keydown', (ev) => {
    const outra = ev.target.closest('.outra');
    if (outra && ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && outra.value.trim()) { ev.preventDefault(); enviarRespostas(outra.closest('.cartao-pedido')); }
  });

  async function enviarRespostas(cartao) {
    const p = pedidos.get(cartao.dataset.pedido);
    const respostas = {};
    for (const fs of cartao.querySelectorAll('.pergunta')) {
      const q = p.entrada.questions[fs.dataset.i];
      const outra = fs.querySelector('.outra').value.trim();
      const marcadas = [...fs.querySelectorAll('.opcao.marcada')].map((o) => o.dataset.rotulo);
      const r = outra || marcadas.join(', ');
      if (!r) { fs.classList.add('falta'); return; }
      respostas[q.question] = r;
    }
    await C.responder(ativa, cartao.dataset.pedido, { permitir: true, respostas });
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
    $('info-pasta').textContent = (i.pasta || '').replace(/^\/home\/[^/]+/, '~') || '~';
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
    if (abrir) { desenharMenu(); $('menu-modelo').hidden = false; $('botao-modelo').setAttribute('aria-expanded', 'true'); } else fecharMenu();
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
    $('desligar').hidden = !(atual && atual.orquestrador && cfg.comandoDesligar);
    $('palco-pet').hidden = !!(atual && !atual.orquestrador);
    $('entrada').placeholder = atual && !atual.orquestrador
      ? 'Escreva para o Claude…  (Enter envia · Shift+Enter quebra linha)'
      : 'Escreva para o orquestrador…  (Enter envia · Shift+Enter quebra linha)';
  }
  C.aoLista(desenharLista);

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

  // --- autocompletar de comandos (/…) ---------------------------------------
  // Como no terminal: digitou "/" no começo, aparece a lista filtrada; setas
  // navegam, Tab ou Enter completam, Esc fecha.
  const comandosPor = new Map(); // conversa → [{nome, descricao, dica}]
  // O Claude, por trás, só anuncia as skills; os comandos próprios dele vêm
  // daqui. /exit é tratado pelo app (fecha a janela).
  const COMANDOS_CLAUDE = [
    ['exit', 'Fecha o app (as conversas ficam pausadas)'], ['model', 'Mostra ou troca o modelo', '[modelo]'],
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
  function atualizarSugestoes() {
    const m = entrada.value.match(/^\/(\S*)$/);
    if (!m) return fecharSugestoes();
    const busca = m[1].toLowerCase();
    const recebidos = comandosPor.get(ativa) || [];
    const nomes = new Set(recebidos.map((c) => c.nome));
    const todos = [...COMANDOS_CLAUDE.filter((c) => !nomes.has(c.nome)), ...recebidos];
    const comeca = todos.filter((c) => c.nome.toLowerCase().startsWith(busca));
    const contem = todos.filter((c) => !c.nome.toLowerCase().startsWith(busca) && c.nome.toLowerCase().includes(busca));
    sugestoes = [...comeca, ...contem].slice(0, 8);
    if (!sugestoes.length) return fecharSugestoes();
    escolhida = Math.min(escolhida, sugestoes.length - 1);
    $('sugestoes').innerHTML = sugestoes.map((c, i) => `<li role="option" data-i="${i}" aria-selected="${i === escolhida}">
      <span class="nome-comando">/${esc(c.nome)}${c.dica ? ` <i>${esc(c.dica)}</i>` : ''}</span>
      <span class="desc-comando">${esc(curto(c.descricao, 110))}</span></li>`).join('');
    $('sugestoes').hidden = false;
  }
  function completar(i) {
    const c = sugestoes[i];
    if (!c) return;
    entrada.value = `/${c.nome} `;
    fecharSugestoes();
    entrada.focus();
  }
  entrada.addEventListener('input', () => { escolhida = 0; atualizarSugestoes(); });
  entrada.addEventListener('keydown', (ev) => {
    if ($('sugestoes').hidden) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      escolhida = (escolhida + (ev.key === 'ArrowDown' ? 1 : -1) + sugestoes.length) % sugestoes.length;
      atualizarSugestoes();
    } else if (ev.key === 'Tab' || (ev.key === 'Enter' && !ev.shiftKey)) {
      // Enter com o comando já digitado inteiro manda direto.
      if (ev.key === 'Enter' && sugestoes[escolhida] && entrada.value.trim() === `/${sugestoes[escolhida].nome}`) { fecharSugestoes(); return; }
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
    if (!t) return;
    // /exit fecha o app, como o X do topo.
    if (t === '/exit' || t === '/quit') { (window.orq.janela ? window.orq.janela.fechar() : window.close()); return; }
    entrada.value = ''; ajustarAltura();
    colado = true;
    if (ativa === 'orquestrador') pet.definir('pensando');
    await C.mandar(ativa, t);
  });
  $('parar').addEventListener('click', () => C.interromper(ativa));
  $('desligar').addEventListener('click', (ev) => confirmar(ev.currentTarget, 'Confirmar desligar', () => {
    colado = true;
    if (cfg.comandoDesligar) C.mandar('orquestrador', cfg.comandoDesligar);
  }));
  $('nova-conversa').addEventListener('click', async () => trocar(await C.nova()));

  Promise.all([window.orq.config.ler(), C.lista()]).then(([c, l]) => {
    cfg = c;
    desenharLista(l);
    trocar('orquestrador');
  });
})();
