// Os comandos do "/" que o app faz por conta própria (comandos.js diz o jeito
// de cada um). Regra: tudo o que funciona no Claude Code ou no Codex funciona
// aqui. O que roda no modo -p vai como texto (conversa-tela.js); o resto o app
// faz: popup ou cartão com um pedido de controle ao motor, arquivo (CLAUDE.md,
// hooks, subagentes), estado da sessão, ou — o que só existe na tela do
// terminal — a linha do motor com a conversa colada no terminal do app.
(() => {
  const $ = (id) => document.getElementById(id);
  const K = window.orq.comandos;
  const V = () => window.orqConversa;
  const { esc } = window.orqUtil;
  const md = (t) => DOMPurify.sanitize(marked.parse(t || '', { gfm: true, breaks: true }));
  const FEITO = { feito: true };
  const erroDe = (r) => (r && r.erro ? r.erro : null);
  const quando = (ms) => (ms ? new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

  // Popup dos comandos: o mesmo do /config e do /permissions. cmd vira
  // data-cmd (testes e prints acham por ele).
  function popup(cmd, titulo, html) {
    V().abrirPopup(titulo, `<div class="cmd-popup" data-cmd="${esc(cmd)}">${html}</div>`);
    return document.querySelector('#popup-corpo .cmd-popup');
  }
  const carregando = (cmd, titulo) => popup(cmd, titulo, '<p class="popup-nota">Carregando…</p>');
  function falhou(cmd, titulo, e) {
    popup(cmd, titulo, `<p class="cmd-erro"><span>Não deu:</span> <span data-sem-traducao>${esc(e)}</span></p>`);
  }
  // O valor só se traduz quando é uma frase do app ("12% usados"); caminho,
  // id e nome não casam com o dicionário e ficam como vieram.
  const tabela = (linhas) => `<table class="cmd-tabela">${linhas.map(([a, b]) => `<tr><th>${esc(a)}</th><td>${esc(b)}</td></tr>`).join('')}</table>`;
  const pre = (t) => `<pre class="cmd-pre" data-sem-traducao>${esc(t)}</pre>`;

  // Confirmação dentro do popup: o custo em texto e os dois botões.
  function confirmar(cmd, titulo, custoHtml, rotuloSim, aoSim) {
    const el = popup(cmd, titulo, `${custoHtml}<div class="cmd-acoes"><button type="button" class="botao" data-nao>Cancelar</button><button type="button" class="botao perigo" data-sim>${esc(rotuloSim)}</button></div>`);
    el.querySelector('[data-nao]').addEventListener('click', V().fecharPopup);
    el.querySelector('[data-sim]').addEventListener('click', async (ev) => { ev.currentTarget.disabled = true; await aoSim(); });
    el.querySelector('[data-nao]').focus();
  }

  // --- terminal: o que só existe na tela do terminal ----------------------------
  async function noTerminal(item, texto) {
    const r = await K.linhaTerminal(V().ativa(), texto);
    if (erroDe(r)) { V().aviso(`Não consegui montar o comando: ${r.erro}`, 'erro'); return FEITO; }
    const ok = window.orqTerminal ? await window.orqTerminal.colar(r.linha) : false;
    const motor = item.motor === 'codex' ? 'Codex' : 'Claude';
    if (!ok) { V().aviso(`O /${item.nome} é uma tela do terminal do ${motor}. Abra a aba Terminal e rode: ${r.linha}`); return FEITO; }
    V().aviso(r.digitar
      ? `O /${item.nome} é uma tela do terminal do Codex: colei no terminal do app o Codex com uma cópia desta conversa. Aperte Enter e digite ${r.digitar} lá.`
      : `O /${item.nome} é uma tela do terminal do Claude: colei no terminal do app o Claude com uma cópia desta conversa e o comando. Confira e aperte Enter.`);
    return FEITO;
  }

  // --- leitura e edição de arquivo (memory, agents, keybindings) -----------------
  async function editarArquivo(cmd, titulo, caminho, { voltar } = {}) {
    const r = await K.lerArquivo(caminho);
    if (erroDe(r)) return falhou(cmd, titulo, r.erro);
    const el = popup(cmd, titulo, `<p class="popup-nota"><code>${esc(r.caminho)}</code>${r.existe ? '' : ' <span>(ainda não existe: gravar cria)</span>'}</p>
      <textarea class="cmd-editor" spellcheck="false" data-sem-traducao>${esc(r.conteudo)}</textarea>
      <p class="popup-nota">Cada gravação guarda a versão anterior.</p>
      <div class="cmd-acoes">${voltar ? '<button type="button" class="botao" data-voltar>Voltar</button>' : ''}<button type="button" class="botao primario" data-gravar>Gravar</button></div>`);
    if (voltar) el.querySelector('[data-voltar]').addEventListener('click', voltar);
    el.querySelector('[data-gravar]').addEventListener('click', async () => {
      const g = await K.gravarArquivo(r.caminho, el.querySelector('textarea').value, r.mtime);
      if (erroDe(g)) { el.querySelector('.cmd-acoes').insertAdjacentHTML('beforebegin', `<p class="cmd-erro"><span>Não gravei:</span> <span data-sem-traducao>${esc(g.erro)}</span></p>`); return; }
      V().fecharPopup();
      V().aviso(`Gravado: ${g.caminho}. O Claude lê de novo na próxima conversa ou depois de /restart.`);
    });
  }

  // --- os comandos ------------------------------------------------------------------
  const H = {};

  H.restart = async () => {
    await window.orq.conversa.reiniciar(V().ativa());
    V().aviso(V().motor() === 'codex' ? 'Codex reiniciado; a conversa continua do mesmo ponto.' : 'Claude reiniciado; a conversa continua do mesmo ponto.');
    return FEITO;
  };
  // No Claude, "/model x" vai como texto (funciona no -p); no Codex o modelo vem
  // da configuração dele e o menu mostra o esforço.
  H.model = async (item, args) => { if (!args || item.motor === 'codex') { V().abrirMenuModelo(); return FEITO; } return { feito: false }; };
  H.effort = async (item, args) => {
    if (!args) { V().abrirMenuModelo(); return FEITO; }
    const nivel = args.toLowerCase();
    if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(nivel)) { V().avisoComando(`/effort ${args}`, 'nível desconhecido', 'use low, medium, high, xhigh ou max'); return FEITO; }
    await window.orq.conversa.configurar(V().ativa(), { esforco: nivel });
    return FEITO;
  };
  H.config = async (item, args) => { if (args) return { feito: false }; V().abrirPopupConfig(); return FEITO; };
  H.permissions = async () => { V().abrirPopupPermissoes(); return FEITO; };

  // /exit: fecha só esta conversa (D16.3). O processo dela sai, a sessão fica
  // guardada (dá para voltar), a tela limpa e a próxima mensagem começa uma
  // sessão nova. O app continua aberto; quem fecha o app é o ✕ da janela.
  H.exit = async () => {
    const r = await K.encerrar(V().ativa());
    if (erroDe(r)) V().aviso(`Não consegui encerrar a conversa: ${r.erro}`, 'erro');
    return FEITO;
  };

  // /heapdump vai como texto, mas o arquivo pode ter o histórico e credenciais.
  H['confirmar-heapdump'] = async (item, args, texto) => {
    confirmar('heapdump', '/heapdump', '<p>O Claude grava a memória dele (heap) num arquivo na Área de Trabalho, ou na pasta pessoal se ela não existir. O arquivo pode ter o histórico da conversa e credenciais: apague-o depois de usar e não o mande a ninguém.</p>',
      'Gravar o heap', async () => { V().fecharPopup(); await V().mandar(texto); });
    return FEITO;
  };

  // /status: as seções da tela de status do terminal (get_status).
  H.status = async () => {
    const titulo = 'Status';
    carregando('status', titulo);
    const id = V().ativa();
    const e = await K.estado(id);
    if (V().motor() === 'codex') {
      const r = await K.codex(id, 'account/rateLimits/read', {});
      const lim = erroDe(r) ? [] : [r.rateLimits && r.rateLimits.primary, r.rateLimits && r.rateLimits.secondary].filter(Boolean)
        .map((w) => [`Janela de ${Math.round((w.windowDurationMins || 0) / 60)} h`, `${Math.round(w.usedPercent || 0)}% usados`]);
      const i = e.info || {};
      popup('status', titulo, tabela([['Motor', 'Codex'], ['Modelo', i.modelo || '—'], ['Esforço', i.esforco || '—'], ['Pasta', i.pasta || '—'], ['Conversa', e.sessao || '—'],
        ['Contexto', i.contexto != null && i.janela ? `${Math.round((i.contexto / i.janela) * 100)}%` : '—'], ...lim]));
      return FEITO;
    }
    const r = await K.controle(id, 'get_status', {});
    if (!erroDe(r) && Array.isArray(r.sections)) {
      popup('status', titulo, r.sections.map((s) => `<h4 data-sem-traducao>${esc(s.title || '')}</h4>${tabela((s.rows || []).map((x) => [x.label || '', x.value || '']))}`).join(''));
      return FEITO;
    }
    // Sem get_status (Claude antigo): o que o init contou.
    const i = e.init || {};
    popup('status', titulo, `<p class="popup-nota"><span>O Claude não respondeu ao pedido de status; isto é o que ele contou ao abrir.</span> <code>${esc(erroDe(r) || '')}</code></p>` +
      tabela([['Versão', i.versao || '—'], ['Modelo', i.modelo || '—'], ['Pasta', i.pasta || '—'], ['Modo de permissão', i.modo || '—'], ['Sessão', i.sessao || e.sessao || '—'],
        ['Ferramentas', i.ferramentas != null ? String(i.ferramentas) : '—'], ['MCP', (i.mcp || []).map((m) => `${m.name} (${m.status})`).join(', ') || '—']]));
    return FEITO;
  };

  // /memory: os CLAUDE.md (usuário, projeto, local e os outros carregados).
  H.memory = async () => {
    const titulo = 'Memória (CLAUDE.md)';
    carregando('memory', titulo);
    const r = await K.memoria(V().ativa());
    if (erroDe(r)) return falhou('memory', titulo, r.erro), FEITO;
    const lista = () => {
      const el = popup('memory', titulo, `<p class="popup-nota">Os arquivos de instrução que o Claude lê. Clique para abrir e editar.</p>
        <ul class="cmd-lista">${r.arquivos.map((a, i) => `<li><button type="button" class="cmd-item" data-i="${i}"><strong>${esc(a.label)}</strong><span>${esc(a.description || '')}</span><code>${esc(a.path)}</code>${a.exists ? '' : '<em>ainda não existe</em>'}</button></li>`).join('')}</ul>
        ${r.automemoria ? `<p class="popup-nota"><span>Memória automática:</span> <span data-sem-traducao>${esc(r.automemoria.status || (r.automemoria.enabled ? 'on' : 'off'))}</span></p>` : ''}`);
      el.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => editarArquivo('memory', titulo, r.arquivos[Number(b.dataset.i)].path, { voltar: lista })));
    };
    lista();
    return FEITO;
  };

  // /keybindings: o arquivo de atalhos do Claude.
  H.keybindings = async () => {
    const r = await K.keybindings();
    if (erroDe(r)) { falhou('keybindings', 'Atalhos do Claude', r.erro); return FEITO; }
    await editarArquivo('keybindings', 'Atalhos do Claude', r.caminho);
    return FEITO;
  };

  // /hooks: o bloco "hooks" de cada settings, por evento; edita como JSON.
  H.hooks = async (item) => {
    const titulo = 'Hooks';
    const id = V().ativa();
    if (item.motor === 'codex') return listaJson('hooks', titulo, await K.codex(id, 'hooks/list', {}));
    carregando('hooks', titulo);
    const r = await K.hooks(id);
    if (erroDe(r)) return falhou('hooks', titulo, r.erro), FEITO;
    const deFora = r.listagem && Array.isArray(r.listagem.hooks) ? r.listagem.hooks.filter((h) => !/Settings$/.test(h.source || '')) : [];
    const lista = () => {
      const el = popup('hooks', titulo, r.arquivos.map((a, i) => `<section class="cmd-secao"><h4><span>${esc(a.rotulo)}</span> <code>${esc(a.caminho)}</code> <span class="cmd-contagem">${a.contagem}</span></h4>
          ${a.erro ? `<p class="cmd-erro" data-sem-traducao>${esc(a.erro)}</p>` : Object.keys(a.hooks).length
            ? `<ul class="cmd-lista">${Object.entries(a.hooks).map(([ev, grupos]) => `<li><strong data-sem-traducao>${esc(ev)}</strong> ${(grupos || []).map((g) => `<code>${esc(g.matcher || '*')}</code> → <span data-sem-traducao>${esc((g.hooks || []).map((h) => h.command || h.prompt || h.type).join(' · '))}</span>`).join('; ')}</li>`).join('')}</ul>`
            : '<p class="popup-nota">Nenhum hook.</p>'}
          ${a.erro ? '' : `<button type="button" class="botao-texto" data-editar="${i}">Editar</button>`}</section>`).join('') +
        (deFora.length ? `<section class="cmd-secao"><h4>De plugins e da sessão (só leitura)</h4><ul class="cmd-lista">${deFora.map((h) => `<li><strong data-sem-traducao>${esc(h.event)}</strong> <code>${esc(h.matcher || '*')}</code> <span data-sem-traducao>${esc(h.displayText || '')} · ${esc(h.sourceLabel || h.source || '')}</span></li>`).join('')}</ul></section>` : ''));
      el.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => editar(r.arquivos[Number(b.dataset.editar)])));
    };
    const editar = (a, texto = JSON.stringify(a.hooks, null, 2)) => {
      const el = popup('hooks', titulo, `<p class="popup-nota"><span>O bloco hooks deste arquivo; o resto dele fica como está e a versão anterior é guardada:</span> <code>${esc(a.caminho)}</code></p>
        <textarea class="cmd-editor" spellcheck="false" data-sem-traducao>${esc(texto)}</textarea>
        <div class="cmd-acoes"><button type="button" class="botao" data-voltar>Voltar</button><button type="button" class="botao primario" data-gravar>Gravar</button></div>`);
      el.querySelector('[data-voltar]').addEventListener('click', lista);
      el.querySelector('[data-gravar]').addEventListener('click', async () => {
        const novo = el.querySelector('textarea').value;
        const g = await K.gravarHooks(id, a.caminho, novo, false);
        if (erroDe(g)) { el.querySelector('.cmd-acoes').insertAdjacentHTML('beforebegin', `<p class="cmd-erro"><span>Não gravei:</span> <span data-sem-traducao>${esc(g.erro)}</span></p>`); return; }
        if (g.precisaConfirmar) {
          // Tirar hook é apagar: o custo antes, e só com o sim.
          confirmar('hooks', titulo, `<p><span>${g.somem} hook(s) somem (de ${g.antes} para ${g.depois}) em:</span> <code>${esc(g.caminho)}</code></p>
            <p><span>A automação destes eventos para de rodar nas conversas novas:</span> <code>${esc(g.eventos.join(', ') || '—')}</code></p>
            <p class="popup-nota">A versão de agora é guardada antes (pasta de versões do app), então dá para voltar.</p>`,
          'Tirar e gravar', async () => {
            const g2 = await K.gravarHooks(id, a.caminho, novo, true);
            if (erroDe(g2)) { falhou('hooks', titulo, g2.erro); return; }
            V().fecharPopup();
            V().aviso(`Hooks gravados em ${g2.caminho} (${g2.depois}). Valem nas conversas novas ou depois de /restart.`);
          });
          return;
        }
        V().fecharPopup();
        V().aviso(`Hooks gravados em ${g.caminho} (${g.depois}). Valem nas conversas novas ou depois de /restart.`);
      });
    };
    lista();
    return FEITO;
  };

  // /agents: lista, cria, edita e apaga subagentes.
  H.agents = async () => {
    const titulo = 'Subagentes';
    const id = V().ativa();
    const lista = async () => {
      const r = await K.agentes(id);
      if (erroDe(r)) return falhou('agents', titulo, r.erro);
      const el = popup('agents', titulo, `<p class="popup-nota"><span>Pastas:</span> ${r.pastas.map((p) => `<code>${esc(p)}</code>`).join(' ')}</p>
        ${r.agentes.length ? `<ul class="cmd-lista">${r.agentes.map((a, i) => `<li class="cmd-agente"><button type="button" class="cmd-item" data-editar="${i}"><strong data-sem-traducao>${esc(a.nome)}</strong><span data-sem-traducao>${esc(a.descricao)}</span><code>${esc(a.caminho)}</code></button>
          <button type="button" class="botao-icone" data-apagar="${i}" title="Apagar este subagente" aria-label="Apagar">🗑</button></li>`).join('')}</ul>` : '<p class="popup-nota">Nenhum subagente ainda.</p>'}
        <div class="cmd-acoes"><button type="button" class="botao primario" data-novo>Novo subagente</button></div>`);
      el.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => editarArquivo('agents', titulo, r.agentes[Number(b.dataset.editar)].caminho, { voltar: lista })));
      el.querySelectorAll('[data-apagar]').forEach((b) => b.addEventListener('click', () => apagar(r.agentes[Number(b.dataset.apagar)])));
      el.querySelector('[data-novo]').addEventListener('click', novo);
    };
    const apagar = async (a) => {
      const c = await K.custoApagarAgente(a.caminho);
      if (erroDe(c)) return falhou('agents', titulo, c.erro);
      confirmar('agents', 'Apagar subagente?', `<p><span>1 arquivo some (${c.linhas} linhas):</span> <code>${esc(c.caminho)}</code></p>
        <p>${c.citacoes.length ? `<span>Ficam citando um subagente que não existe mais (o nome dele aparece nestes arquivos):</span> ${c.citacoes.map((x) => `<code>${esc(x.arquivo)} (${x.vezes}×)</code>`).join(' ')}` : '<span>Nenhum outro subagente, skill ou CLAUDE.md cita esse nome.</span>'}</p>
        <p class="popup-nota"><span>Antes de apagar, uma cópia vai para a pasta abaixo: dá para trazer de volta. Alternativa sem apagar: edite e deixe a descrição dizendo para não usar.</span> <code>${esc(c.copiaEm)}</code></p>`,
      'Apagar', async () => {
        const r = await K.apagarAgente(a.caminho, true);
        if (erroDe(r)) return falhou('agents', titulo, r.erro);
        V().aviso(`Subagente apagado. Cópia em ${r.copia}.`);
        await lista();
      });
    };
    const novo = () => {
      const el = popup('agents', 'Novo subagente', `<label class="popup-linha"><span><strong>Nome</strong></span><input data-campo="nome" placeholder="ex.: revisor-de-codigo"></label>
        <label class="popup-linha"><span><strong>Descrição</strong></span><input data-campo="descricao" placeholder="Quando o Claude deve usar este subagente"></label>
        <label class="popup-linha"><span><strong>Ferramentas</strong></span><input data-campo="ferramentas" placeholder="ex.: Read, Grep, Glob (vazio = todas)"></label>
        <label class="popup-linha"><span><strong>Modelo</strong></span><select data-campo="modelo"><option value="">(o da conversa)</option><option>sonnet</option><option>opus</option><option>haiku</option><option>inherit</option></select></label>
        <label class="popup-linha"><span><strong>Onde</strong></span><select data-campo="onde"><option value="usuario">Do usuário (~/.claude/agents)</option><option value="projeto">Do projeto (.claude/agents)</option></select></label>
        <textarea class="cmd-editor" data-campo="prompt" placeholder="Instruções do subagente"></textarea>
        <div class="cmd-acoes"><button type="button" class="botao" data-voltar>Voltar</button><button type="button" class="botao primario" data-criar>Criar</button></div>`);
      el.querySelector('[data-voltar]').addEventListener('click', lista);
      el.querySelector('[data-criar]').addEventListener('click', async () => {
        const d = {};
        el.querySelectorAll('[data-campo]').forEach((c) => { d[c.dataset.campo] = c.value.trim(); });
        const r = await K.criarAgente(id, d);
        if (erroDe(r)) { el.querySelector('.cmd-acoes').insertAdjacentHTML('beforebegin', `<p class="cmd-erro"><span>Não criei:</span> <span data-sem-traducao>${esc(r.erro)}</span></p>`); return; }
        V().aviso(`Subagente criado: ${r.caminho}.`);
        await lista();
      });
    };
    carregando('agents', titulo);
    await lista();
    return FEITO;
  };

  // /todos: a última lista do TodoWrite desta conversa.
  H.todos = async () => {
    const titulo = 'Tarefas (TodoWrite)';
    const r = await K.todos(V().ativa());
    if (erroDe(r)) return falhou('todos', titulo, r.erro), FEITO;
    const marca = { completed: '☑', in_progress: '◐', pending: '☐' };
    popup('todos', titulo, r.achou
      ? `<p class="popup-nota"><span>A última lista que o Claude escreveu nesta conversa.</span>${r.quando ? ` <span data-sem-traducao>(${esc(quando(Date.parse(r.quando)))})</span>` : ''}</p>
        <ul class="cmd-todos">${r.itens.map((t) => `<li class="todo-${esc(t.status)}"><span class="marca">${marca[t.status] || '☐'}</span><span data-sem-traducao>${esc(t.texto)}</span></li>`).join('')}</ul>`
      : '<p class="popup-nota">Nenhuma lista de tarefas nesta conversa ainda.</p>');
    return FEITO;
  };

  // /release-notes: o changelog que o próprio Claude guarda.
  H['release-notes'] = async () => {
    const titulo = 'Notas da versão';
    const r = await K.notasVersao(V().ativa());
    if (erroDe(r)) return falhou('release-notes', titulo, r.erro), FEITO;
    if (!r.achou) { popup('release-notes', titulo, '<p class="popup-nota">O Claude ainda não baixou as notas (~/.claude/cache/changelog.md). Elas chegam quando ele se atualiza.</p>'); return FEITO; }
    popup('release-notes', titulo, r.secoes.map((s, i) => `<details${i ? '' : ' open'}><summary><span data-sem-traducao>${esc(s.versao)}</span>${i || !r.versao ? '' : ' <span>(instalada)</span>'}</summary><div class="md" data-sem-traducao>${md(s.texto)}</div></details>`).join(''));
    return FEITO;
  };

  // /help: todos os comandos desta conversa e o jeito de cada um aqui.
  H.help = async () => {
    const jeito = { texto: 'vai ao motor', app: 'o app faz', terminal: 'abre no terminal' };
    const l = V().comandos();
    popup('help', 'Comandos', `<p class="popup-nota"><span>Digite / na caixa para ver e completar.</span> <span>${l.length} comandos nesta conversa.</span></p>
      <table class="cmd-tabela cmd-ajuda">${l.map((c) => `<tr><th><code>/${esc(c.nome)}</code>${c.aliases ? ` <small data-sem-traducao>${esc(c.aliases.map((a) => '/' + a).join(' '))}</small>` : ''}</th><td>${esc(c.descricao)}</td><td class="cmd-jeito">${esc(jeito[c.como] || '')}</td></tr>`).join('')}</table>`);
    return FEITO;
  };

  // /skills e /skill-doctor (ordenado pelo custo em tokens).
  H.skills = async (item) => {
    const titulo = item.nome === 'skill-doctor' ? 'Skills que custam contexto' : 'Skills';
    const id = V().ativa();
    if (item.motor === 'codex') return listaJson('skills', titulo, await K.codex(id, 'skills/list', {}));
    carregando('skills', titulo);
    const r = await K.controle(id, 'get_skills_dialog', {});
    if (erroDe(r)) return falhou('skills', titulo, r.erro), FEITO;
    let l = Array.isArray(r.skills) ? r.skills : Array.isArray(r.rows) ? r.rows : [];
    if (item.nome === 'skill-doctor') l = [...l].sort((a, b) => (b.tokens || 0) - (a.tokens || 0));
    popup('skills', titulo, `<table class="cmd-tabela"><tr><th>Skill</th><th>Origem</th><th>Tokens</th><th>Estado</th></tr>${l.map((s) => `<tr><td data-sem-traducao><code>/${esc(s.display_name || s.name)}</code> ${esc(s.description || '')}</td><td data-sem-traducao>${esc(s.source || '')}</td><td data-sem-traducao>${esc(s.tokens != null ? s.tokens : '')}</td><td data-sem-traducao>${esc(s.state || '')}${s.locked_by ? ` (${esc(s.locked_by)})` : ''}</td></tr>`).join('')}</table>`);
    return FEITO;
  };

  // Resposta do Codex mostrada como lista (mcp, hooks, skills, ps, config).
  function listaJson(cmd, titulo, r) {
    if (erroDe(r)) { falhou(cmd, titulo, r.erro); return FEITO; }
    const arr = Array.isArray(r) ? r : Array.isArray(r && r.data) ? r.data : null;
    if (arr && !arr.length) { popup(cmd, titulo, '<p class="popup-nota">Nada por aqui.</p>'); return FEITO; }
    popup(cmd, titulo, arr
      ? `<ul class="cmd-lista">${arr.map((x) => `<li data-sem-traducao><strong>${esc(x.name || x.id || x.command || '')}</strong> ${esc(x.status || x.description || x.cwd || '')}</li>`).join('')}</ul>${pre(JSON.stringify(r, null, 2))}`
      : pre(JSON.stringify(r, null, 2)));
    return FEITO;
  }

  // /export: o texto da conversa, com Copiar e Salvar (nunca grava por cima).
  function popupExport(texto, nome) {
    const el = popup('export', 'Exportar a conversa', `${pre(texto)}<div class="cmd-acoes"><button type="button" class="botao" data-copiar>Copiar</button><button type="button" class="botao primario" data-salvar>Salvar…</button></div>`);
    el.querySelector('[data-copiar]').addEventListener('click', async (ev) => { try { await navigator.clipboard.writeText(texto); ev.currentTarget.textContent = 'Copiado'; } catch { /* sem área de transferência */ } });
    el.querySelector('[data-salvar]').addEventListener('click', async () => {
      const r = await K.salvarTexto(nome, texto);
      if (r && r.cancelado) return;
      if (erroDe(r)) { el.querySelector('.cmd-acoes').insertAdjacentHTML('beforebegin', `<p class="cmd-erro"><span>Não salvei:</span> <span data-sem-traducao>${esc(r.erro)}</span></p>`); return; }
      V().fecharPopup(); V().aviso(`Conversa salva em ${r.caminho}.`);
    });
  }
  H.export = async (item, args) => {
    const id = V().ativa();
    if (item.motor === 'codex') {
      // Do que está na tela, em Markdown.
      const partes = [...document.querySelectorAll('#mensagens .msg-voce .balao, #mensagens .msg-claude .texto-claude:not(.rascunho)')]
        .map((e) => (e.closest('.msg-voce') ? `## Você\n\n${e.innerText.trim()}` : `## Codex\n\n${e.innerText.trim()}`));
      popupExport(partes.join('\n\n'), args || 'conversa-codex.md');
      return FEITO;
    }
    carregando('export', 'Exportar a conversa');
    const r = await K.controle(id, 'export_conversation', {});
    if (erroDe(r)) return falhou('export', 'Exportar a conversa', r.erro), FEITO;
    popupExport(r.text || '', args || r.default_filename || 'conversa.txt');
    return FEITO;
  };

  // /plan: liga o modo plano; "/plan open" mostra o plano; com texto, liga e manda.
  H.plan = async (item, args, texto) => {
    const id = V().ativa();
    if (args === 'open') {
      const r = await K.controle(id, 'get_plan', {});
      if (erroDe(r)) return falhou('plan', 'Plano', r.erro), FEITO;
      popup('plan', 'Plano', r.exists ? `<p class="popup-nota"><code>${esc(r.path || '')}</code></p><div class="md" data-sem-traducao>${md(r.content || '')}</div>` : '<p class="popup-nota">Esta conversa ainda não tem plano.</p>');
      return FEITO;
    }
    const r = await K.controle(id, 'set_permission_mode', { mode: 'plan' });
    if (erroDe(r)) { V().aviso(`O Claude não entrou no modo plano: ${r.erro}`, 'erro'); return FEITO; }
    V().aviso('Modo plano ligado: o Claude planeja e pergunta antes de mexer em qualquer coisa. Para ver o plano: /plan open.');
    if (args) await V().mandar(args);
    return FEITO;
  };

  // /diff: mudanças não commitadas.
  H.diff = async (item) => {
    const titulo = 'Mudanças não commitadas';
    const id = V().ativa();
    carregando('diff', titulo);
    if (item.motor === 'codex') {
      const r = await K.diffGit(id);
      if (erroDe(r)) return falhou('diff', titulo, r.erro), FEITO;
      popup('diff', titulo, !r.git ? '<p class="popup-nota">A pasta desta conversa não é um repositório git.</p>'
        : `${r.novos.length ? `<p class="popup-nota"><span>Não rastreados:</span> ${r.novos.map((n) => `<code>${esc(n)}</code>`).join(' ')}</p>` : ''}${pre(r.diff || '(sem mudanças)')}`);
      return FEITO;
    }
    const r = await K.controle(id, 'get_workspace_diff', {});
    if (erroDe(r)) return falhou('diff', titulo, r.erro), FEITO;
    const d = r.diff || {};
    const st = d.stats || {};
    const arqs = Array.isArray(d.perFileStats) ? d.perFileStats : [];
    const trechos = Array.isArray(d.hunks) ? d.hunks : Array.isArray(d.files) ? d.files : [];
    popup('diff', titulo, arqs.length || st.filesCount
      ? `<p class="popup-nota" data-sem-traducao>${esc(`${st.filesCount || arqs.length} arquivo(s) · +${st.linesAdded || 0} −${st.linesRemoved || 0}`)}</p>
        <ul class="cmd-lista">${arqs.map((f) => `<li data-sem-traducao><code>${esc(f.path)}</code> <span class="mais">+${f.added}</span> <span class="menos">−${f.removed}</span>${f.isUntracked ? ' (novo)' : ''}</li>`).join('')}</ul>
        ${trechos.length ? pre(trechos.map((h) => h.patch || h.diff || h.content || '').join('\n')) : ''}`
      : `<p class="popup-nota">${esc(r.reason || r.message || 'Sem mudanças (ou a pasta não é um repositório git).')}</p>`);
    return FEITO;
  };

  // /btw: pergunta de lado, sem entrar na conversa.
  H.btw = async (item, args) => {
    if (!args) { V().avisoComando('/btw', 'escreva a pergunta depois do comando', 'ex.: /btw qual o nome daquele arquivo?'); return { feito: true, manterTexto: true }; }
    const c = V().cartao(`<div class="cartao-titulo">De lado</div><div class="cartao-pergunta" data-sem-traducao>${esc(args)}</div><div class="cartao-resposta"><span class="nota">Pensando…</span></div>`, 'cartao-btw');
    const r = await K.controle(V().ativa(), 'side_question', { question: args, history: [] });
    const resp = c.querySelector('.cartao-resposta');
    if (erroDe(r)) { resp.innerHTML = `<span class="cmd-erro" data-sem-traducao>${esc(r.erro)}</span>`; return FEITO; }
    const texto = typeof r.response === 'string' ? r.response : r.response && r.response.response ? r.response.response : r.text || r.answer || JSON.stringify(r);
    resp.innerHTML = `<div class="md" data-sem-traducao>${md(texto)}</div>`;
    return FEITO;
  };

  // /tasks: tarefas em segundo plano vistas nesta conversa.
  H.tasks = async () => {
    const titulo = 'Tarefas em segundo plano';
    const id = V().ativa();
    const e = await K.estado(id);
    if (erroDe(e)) return falhou('tasks', titulo, e.erro), FEITO;
    const t = e.tarefas || [];
    const el = popup('tasks', titulo, t.length
      ? `<ul class="cmd-lista">${t.map((x) => `<li class="cmd-tarefa"><strong data-sem-traducao>${esc(x.descricao || x.id)}</strong> <span class="estado-${esc(x.status)}">${esc({ running: 'rodando', completed: 'terminou', failed: 'falhou', stopped: 'parada' }[x.status] || x.status)}</span>
          <button type="button" class="botao-texto" data-saida="${esc(x.id)}">Ver saída</button>${x.status === 'running' ? `<button type="button" class="botao-texto" data-parar="${esc(x.id)}">Parar</button>` : ''}<div class="cmd-saida" hidden></div></li>`).join('')}</ul>`
      : '<p class="popup-nota">Nenhuma tarefa em segundo plano nesta conversa.</p>');
    el.querySelectorAll('[data-saida]').forEach((b) => b.addEventListener('click', async () => {
      const r = await K.controle(id, 'get_task_output', { task_id: b.dataset.saida });
      const box = b.parentElement.querySelector('.cmd-saida');
      box.hidden = false;
      box.innerHTML = erroDe(r) ? `<span class="cmd-erro" data-sem-traducao>${esc(r.erro)}</span>` : pre(r.output || r.text || r.content || '(vazia)');
    }));
    el.querySelectorAll('[data-parar]').forEach((b) => b.addEventListener('click', async () => {
      const r = await K.controle(id, 'stop_task', { task_id: b.dataset.parar });
      b.replaceWith(Object.assign(document.createElement('span'), { className: 'nota', textContent: erroDe(r) ? r.erro : 'parando…' }));
    }));
    return FEITO;
  };

  // /background: o que roda em primeiro plano vai para o fundo (Ctrl+B).
  H.background = async (item, args) => {
    const r = await K.controle(V().ativa(), 'background_tasks', {});
    V().aviso(erroDe(r) ? `O Claude não mandou para o fundo: ${r.erro}` : 'O que estava rodando em primeiro plano foi para o segundo plano; veja em /tasks.');
    if (args) await V().mandar(args);
    return FEITO;
  };

  // /branch e /fork: conversa nova com a conversa copiada.
  H.branch = async (item, args) => {
    const r = await K.ramificar(V().ativa(), item.nome === 'fork' ? args : '');
    if (erroDe(r)) { V().aviso(`Não deu para copiar a conversa: ${r.erro}`, 'erro'); return FEITO; }
    await V().trocar(r.id);
    V().aviso('Conversa copiada: esta é a cópia. A original continua na lista, como estava.');
    return FEITO;
  };
  H.fork = H.branch;

  // /resume: uma conversa anterior numa conversa nova do app.
  H.resume = async (item, args) => {
    const titulo = 'Retomar conversa';
    const id = V().ativa();
    carregando('resume', titulo);
    let l;
    if (item.motor === 'codex') {
      const r = await K.codex(id, 'thread/list', { limit: 40 });
      if (erroDe(r)) return falhou('resume', titulo, r.erro), FEITO;
      l = (r.data || r.threads || []).map((t) => ({ sessao: t.id, titulo: t.name || t.preview || t.id, quando: (t.updatedAt || t.createdAt || 0) * (String(t.updatedAt || t.createdAt || 0).length <= 10 ? 1000 : 1) }));
    } else {
      l = await K.sessoes(id);
      if (erroDe(l)) return falhou('resume', titulo, l.erro), FEITO;
    }
    const b = (args || '').toLowerCase();
    if (b) l = l.filter((s) => `${s.titulo} ${s.sessao}`.toLowerCase().includes(b));
    const el = popup('resume', titulo, l.length
      ? `<ul class="cmd-lista">${l.map((s, i) => `<li><button type="button" class="cmd-item" data-i="${i}"><strong data-sem-traducao>${esc(s.titulo)}</strong><span data-sem-traducao>${esc(quando(s.quando))}${s.mensagens ? ` · ${s.mensagens} msg` : ''}${s.aberta ? ' · aberta no app' : ''}</span></button></li>`).join('')}</ul>`
      : '<p class="popup-nota">Nenhuma conversa anterior.</p>');
    el.querySelectorAll('[data-i]').forEach((x) => x.addEventListener('click', async () => {
      const s = l[Number(x.dataset.i)];
      const r = await K.retomar(s.sessao, item.motor, s.titulo);
      if (erroDe(r)) return falhou('resume', titulo, r.erro);
      V().fecharPopup();
      await V().trocar(r.id);
    }));
    return FEITO;
  };

  // /rewind: volta a conversa para antes de uma mensagem (o ✎ dos balões).
  H.rewind = async () => {
    const msgs = V().mensagens();
    const el = popup('rewind', 'Voltar a conversa', msgs.length
      ? `<p class="popup-nota">Escolha a mensagem: ela e tudo depois dela saem da conversa do Claude (a conversa antiga fica guardada no histórico dele) e o texto volta para a caixa. Os arquivos que o Claude mexeu não voltam.</p>
        <ul class="cmd-lista">${msgs.map((m, i) => `<li><button type="button" class="cmd-item" data-i="${i}"><span data-sem-traducao>${esc(m.length > 160 ? m.slice(0, 159) + '…' : m)}</span></button></li>`).reverse().join('')}</ul>`
      : '<p class="popup-nota">Nenhuma mensagem sua nesta conversa ainda.</p>');
    el.querySelectorAll('[data-i]').forEach((x) => x.addEventListener('click', async () => { V().fecharPopup(); await V().voltarPara(Number(x.dataset.i)); }));
    return FEITO;
  };

  // /copy [N]: a última resposta (ou a N-ésima de trás para frente).
  H.copy = async (item, args) => {
    const t = V().resposta(Number(args) || 1);
    if (!t) { V().aviso('Nenhuma resposta para copiar ainda.'); return FEITO; }
    try { await navigator.clipboard.writeText(t); V().aviso(`Resposta copiada (${t.length} caracteres).`); } catch (e) { V().aviso(`Não consegui copiar: ${e.message}`, 'erro'); }
    return FEITO;
  };

  // /add-dir <pasta>.
  H['add-dir'] = async (item, args) => {
    if (!args) { V().avisoComando('/add-dir', 'diga a pasta', 'ex.: /add-dir ~/projetos/site'); return { feito: true, manterTexto: true }; }
    const r = await K.pastaExtra(V().ativa(), args);
    if (erroDe(r)) V().aviso(`Não adicionei a pasta: ${r.erro}`, 'erro');
    return FEITO;
  };

  // /fast [on|off]: sem argumento, alterna.
  H.fast = async (item, args) => {
    const id = V().ativa();
    let ligar;
    if (/^(on|ligar|sim)$/i.test(args)) ligar = true;
    else if (/^(off|desligar|não|nao)$/i.test(args)) ligar = false;
    else { const e = await K.estado(id); ligar = !(e && e.rapido); }
    const r = await K.rapido(id, ligar);
    if (erroDe(r)) V().aviso(`Não troquei o modo rápido: ${r.erro}`, 'erro');
    return FEITO;
  };

  // /feedback e /bug: o relato vai à Anthropic pelo próprio Claude (submit_feedback).
  H.feedback = async (item, args) => {
    const el = popup('feedback', 'Feedback para a Anthropic', `<p class="popup-nota">Vai só o texto abaixo, pelo próprio Claude. A conversa não vai junto.</p>
      <textarea class="cmd-editor" data-sem-traducao>${esc(args || '')}</textarea>
      <div class="cmd-acoes"><button type="button" class="botao primario" data-enviar>Enviar</button></div>`);
    el.querySelector('[data-enviar]').addEventListener('click', async (ev) => {
      const texto = el.querySelector('textarea').value.trim();
      if (!texto) return;
      ev.currentTarget.disabled = true;
      const r = await K.controle(V().ativa(), 'submit_feedback', { description: texto, surface: 'sdk' });
      if (erroDe(r)) { falhou('feedback', 'Feedback para a Anthropic', r.erro); return; }
      V().fecharPopup(); V().aviso(`Feedback enviado${r.feedback_id || r.id ? ` (${r.feedback_id || r.id})` : ''}.`);
    });
    return FEITO;
  };

  // /stop: pausa a conversa (o processo sai; a próxima mensagem retoma).
  H.stop = async (item) => {
    if (item.motor === 'codex') {
      confirmar('stop', 'Parar os terminais em segundo plano?', '<p>Todos os terminais que o Codex deixou rodando em segundo plano nesta conversa param. O que eles estavam fazendo não termina.</p>', 'Parar todos', async () => {
        const r = await K.codex(V().ativa(), 'thread/backgroundTerminals/clean', {});
        V().fecharPopup(); V().aviso(erroDe(r) ? `O Codex não parou os terminais: ${r.erro}` : 'Terminais em segundo plano parados.');
      });
      return FEITO;
    }
    await K.pausar(V().ativa());
    return FEITO;
  };

  // /subtask <tarefa>: pedido para um subagente, com o contexto da conversa.
  H.subtask = async (item, args, texto) => {
    if (!args) { V().avisoComando('/subtask', 'diga a tarefa', 'ex.: /subtask procure onde o login é validado'); return { feito: true, manterTexto: true }; }
    await window.orq.conversa.mandar(V().ativa(), `Use um subagente (ferramenta Agent) para esta tarefa, passando a ele o contexto desta conversa, e me traga o resultado: ${args}`, [], texto);
    return FEITO;
  };

  H['terminal-setup'] = async () => {
    V().aviso('Nada a instalar: na caixa do app o Enter envia e o Shift+Enter quebra a linha. O /terminal-setup do terminal só configura isso no emulador de terminal.');
    return FEITO;
  };
  H.vim = async () => {
    V().aviso(V().motor() === 'codex'
      ? 'A caixa do app não tem modo vim; o /vim do Codex vale só na tela do terminal dele.'
      : 'A caixa do app não tem modo vim. No Claude Code o modo vim é a opção editor do /config (vale no terminal): /config editor=vim.');
    return FEITO;
  };
  H.raw = async () => { V().aviso('O texto da conversa no app já se seleciona e copia direto; o /raw é para o terminal.'); return FEITO; };
  H.theme = async () => {
    const atual = document.documentElement.dataset.theme || 'dark';
    const el = popup('theme', 'Tema', `<p class="popup-nota">O tema do app. O do terminal do Claude fica no /config (theme).</p>
      <div class="cmd-acoes"><button type="button" class="botao" data-tema="dark" aria-pressed="${atual === 'dark'}">Escuro</button><button type="button" class="botao" data-tema="light" aria-pressed="${atual === 'light'}">Claro</button></div>`);
    el.querySelectorAll('[data-tema]').forEach((b) => b.addEventListener('click', () => {
      document.querySelector(`#config-tema [data-tema="${b.dataset.tema}"]`)?.click();
      V().fecharPopup();
    }));
    return FEITO;
  };
  H.mobile = async () => {
    const el = popup('mobile', 'App do Claude no celular', '<p>Baixe o app do Claude para iPhone ou Android pelo endereço abaixo (ele leva à loja certa).</p><div class="cmd-acoes"><button type="button" class="botao primario" data-abrir>Abrir claude.ai/mobile</button></div>');
    el.querySelector('[data-abrir]').addEventListener('click', () => window.orq.abrirLink('https://claude.ai/mobile?entrypoint=claude_code_cli'));
    return FEITO;
  };

  // --- só do Codex ---------------------------------------------------------------
  H.new = async () => { await K.threadNova(V().ativa()); V().aviso('Conversa nova do Codex; a anterior continua no histórico dele.'); return FEITO; };
  H.archive = async () => {
    confirmar('archive', 'Arquivar esta conversa?', '<p>A conversa do Codex vai para os arquivados (dá para desarquivar com codex unarchive) e uma conversa nova começa aqui.</p>', 'Arquivar', async () => {
      const id = V().ativa();
      const r = await K.codex(id, 'thread/archive', {});
      V().fecharPopup();
      if (erroDe(r)) { V().aviso(`O Codex não arquivou: ${r.erro}`, 'erro'); return; }
      await K.threadNova(id);
      V().aviso('Conversa arquivada; esta é uma conversa nova.');
    });
    return FEITO;
  };
  H.delete = async (item) => {
    const e = await K.estado(V().ativa());
    if (!e.sessao) { V().aviso('Esta conversa ainda não começou no Codex: não há o que apagar.'); return FEITO; }
    confirmar('delete', 'Apagar esta conversa do Codex?', `<p><span>Esta conversa some do histórico do Codex, sem volta, com os subagentes dela. Não há cópia.</span> <code>${esc(e.sessao)}</code></p>
      <p>Alternativa sem apagar: /archive (arquiva e dá para desarquivar).</p>
      <p class="popup-nota">Confirmando, o app cola o comando no terminal dele sem executar: você confere e aperta Enter.</p>`,
    'Colar no terminal', async () => { V().fecharPopup(); await noTerminalLinha(`codex delete ${e.sessao}`); });
    return FEITO;
  };
  H.logout = async () => {
    confirmar('logout', 'Sair da conta do Codex?', '<p>As credenciais do Codex neste computador são apagadas; todas as conversas Codex param até você entrar de novo (codex login).</p><p class="popup-nota">O app cola o comando no terminal dele sem executar: você confere e aperta Enter.</p>',
      'Colar no terminal', async () => { V().fecharPopup(); await noTerminalLinha('codex logout'); });
    return FEITO;
  };
  async function noTerminalLinha(linha) {
    const ok = window.orqTerminal ? await window.orqTerminal.colar(linha) : false;
    V().aviso(ok ? `Colei no terminal do app: ${linha}. Confira e aperte Enter.` : `Abra a aba Terminal e rode: ${linha}`);
  }
  H.compact = async () => {
    const r = await K.codex(V().ativa(), 'thread/compact/start', {});
    V().aviso(erroDe(r) ? `O Codex não compactou: ${r.erro}` : 'O Codex está compactando a conversa.');
    return FEITO;
  };
  H.review = async () => {
    const r = await K.codex(V().ativa(), 'review/start', { target: { type: 'uncommittedChanges' } });
    V().aviso(erroDe(r) ? `O Codex não começou a revisão: ${r.erro}` : 'O Codex está revisando as mudanças não commitadas; a revisão aparece aqui.');
    return FEITO;
  };
  H.rename = async (item, args) => {
    if (!args) { V().avisoComando('/rename', 'diga o nome', 'ex.: /rename revisão do site'); return { feito: true, manterTexto: true }; }
    const r = await K.codex(V().ativa(), 'thread/name/set', { name: args });
    V().aviso(erroDe(r) ? `O Codex não renomeou: ${r.erro}` : `Conversa renomeada no Codex: ${args}.`);
    return FEITO;
  };
  H.usage = async () => {
    const r = await K.codex(V().ativa(), 'account/rateLimits/read', {});
    if (erroDe(r)) return falhou('usage', 'Uso da conta', r.erro), FEITO;
    const l = [r.rateLimits && r.rateLimits.primary, r.rateLimits && r.rateLimits.secondary].filter(Boolean);
    popup('usage', 'Uso da conta', l.length ? tabela(l.map((w) => [`Janela de ${Math.round((w.windowDurationMins || 0) / 60)} h`, `${Math.round(w.usedPercent || 0)}% usados${w.resetsAt ? ` · renova ${quando(w.resetsAt * 1000)}` : ''}`])) : pre(JSON.stringify(r, null, 2)));
    return FEITO;
  };
  H['debug-config'] = async () => listaJson('debug-config', 'Configuração do Codex', await K.codex(V().ativa(), 'config/read', {}));
  H.mcp = async () => listaJson('mcp', 'Servidores MCP', await K.codex(V().ativa(), 'mcpServerStatus/list', {}));
  H.ps = async () => listaJson('ps', 'Terminais em segundo plano', await K.codex(V().ativa(), 'thread/backgroundTerminals/list', {}));
  H.pwd = async () => { V().aviso(`Pasta de trabalho: ${(V().info() || {}).pasta || '~'}`); return FEITO; };
  H.mention = async () => { V().anexarArquivo(); return FEITO; };

  // Entrada: conversa-tela.js chama com o item da lista (comandos.js).
  // Devolve { feito } (o app fez; nada vai ao motor) ou { feito: false } (vai
  // como texto).
  async function executar(item, args, texto) {
    try {
      if (item.como === 'terminal') return await noTerminal(item, texto);
      const h = item.acao && H[item.acao];
      if (!h) return { feito: false };
      return (await h(item, args, texto)) || FEITO;
    } catch (e) {
      V().aviso(`O /${item.nome} falhou: ${e.message || e}`, 'erro');
      return FEITO;
    }
  }
  window.orqComandos = { executar, _H: H };
})();
