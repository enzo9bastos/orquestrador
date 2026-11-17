// Chaves do /config do Claude Code, lidas do texto que o próprio CLI devolve
// ("Usage: /config key=value …", o que o /config sem argumento responde). A
// lista muda a cada versão: por isso o app não guarda uma lista fixa, só o
// texto da versão conferida por último (USO_CONFERIDO) como ponto de partida,
// e troca pela do CLI em uso quando ela aparece na conversa.
//
// Carregado pela tela (window.orqConfigClaude) e pelos testes (require).
(function (raiz) {
  // O que o Claude Code 2.1.326 respondeu ao "/config" (conferido em 17/11/2026).
  const USO_CONFERIDO = `Usage: /config key=value [key=value ...]
  autoCompact=true|false
  autoConnectIde=true|false
  autoScroll=true|false
  checkpoints=true|false
  copyFullResponse=true|false
  copyOnSelect=true|false
  defaultToAgentsView=true|false
  editor=normal|vim
  externalEditorContext=true|false
  gitignore=true|false
  idleCompaction=true|false
  language=<value>
  leftArrowOpensAgents=true|false
  model=default|sonnet|opus|haiku|fable|best|sonnet[1m]|opus[1m]|fable[1m]|opusplan
  notifChannel=auto|iterm2|terminal_bell|iterm2_with_bell|kitty|ghostty|notifications_disabled
  outputStyle=default|Proactive|Concise|Explanatory|Learning
  permissionMode=default|plan|acceptEdits|auto|dontAsk
  prStatus=true|false
  progressBar=true|false
  recap=true|false
  reduceMotion=true|false
  switchModelsOnFlag=Switch automatically|Ask each time
  theme=auto|dark|light|light-daltonized|dark-daltonized|light-ansi|dark-ansi
  thinking=true|false
  timeFormat=auto|12-hour|24-hour|24-hour-utc
  tips=true|false
  turnDuration=true|false
  useAutoModeDuringPlan=true|false
  verbose=true|false
  workflowKeywordTriggerEnabled=true|false
  workflowSizeGuideline=unrestricted|small|medium|large
  workflows=true|false
  worktreeBaseRef=fresh|head`;

  // Nome em português de cada chave conhecida. Chave nova, que ainda não tem
  // nome aqui, aparece com o nome técnico (nunca some).
  const ROTULOS = {
    model: 'Modelo padrão', permissionMode: 'Modo de permissão ao abrir', useAutoModeDuringPlan: 'Usar o modo Auto durante o plano',
    outputStyle: 'Estilo de resposta', language: 'Idioma das respostas', thinking: 'Pensamento estendido', verbose: 'Saída detalhada',
    autoCompact: 'Compactar sozinho', idleCompaction: 'Compactar quando parado', checkpoints: 'Pontos de restauração', recap: 'Resumo ao voltar (recap)',
    gitignore: 'Respeitar .gitignore', worktreeBaseRef: 'Base de uma cópia de trabalho nova', switchModelsOnFlag: 'Trocar de modelo quando sinalizado',
    workflows: 'Workflows', workflowKeywordTriggerEnabled: 'Workflow por palavra-chave', workflowSizeGuideline: 'Tamanho sugerido dos workflows',
    theme: 'Tema do terminal', editor: 'Modo do editor', timeFormat: 'Formato de hora', notifChannel: 'Canal de notificação', turnDuration: 'Mostrar a duração do turno',
    autoConnectIde: 'Conectar à IDE sozinho', externalEditorContext: 'Contexto do editor externo', prStatus: 'Status do PR', progressBar: 'Barra de progresso',
    autoScroll: 'Rolar sozinho', copyFullResponse: 'Copiar a resposta inteira', copyOnSelect: 'Copiar ao selecionar', reduceMotion: 'Reduzir animações', tips: 'Dicas',
    defaultToAgentsView: 'Abrir na visão de agentes', leftArrowOpensAgents: 'Seta ← abre os agentes',
  };
  // Grupo de cada chave; o que não está aqui cai em "Outras".
  const GRUPOS = [
    ['Modelo e permissões', ['model', 'permissionMode', 'useAutoModeDuringPlan', 'switchModelsOnFlag']],
    ['Respostas', ['outputStyle', 'language', 'thinking', 'verbose']],
    ['Conversa e arquivos', ['autoCompact', 'idleCompaction', 'checkpoints', 'recap', 'gitignore', 'worktreeBaseRef', 'workflows', 'workflowKeywordTriggerEnabled', 'workflowSizeGuideline']],
    ['Tela do terminal', ['theme', 'editor', 'timeFormat', 'notifChannel', 'turnDuration', 'autoConnectIde', 'externalEditorContext', 'prStatus', 'progressBar', 'autoScroll', 'copyFullResponse', 'copyOnSelect', 'reduceMotion', 'tips', 'defaultToAgentsView', 'leftArrowOpensAgents']],
  ];
  // Só mudam a tela do terminal do Claude Code: no app a mudança é gravada, mas não se vê.
  const SO_TERMINAL = new Set(GRUPOS[3][1]);

  // "Usage: /config key=value …" → [{ chave, opcoes: [..] | null }] na ordem do texto.
  // opcoes null = valor livre ("<value>"). Linha que não é "chave=…" é ignorada.
  function chavesDoUso(texto) {
    const linhas = String(texto || '').split('\n');
    const ini = linhas.findIndex((l) => /^\s*Usage: \/config\b/.test(l));
    if (ini < 0) return [];
    const lista = [];
    for (const l of linhas.slice(ini + 1)) {
      const m = /^\s+([A-Za-z][\w.]*)=(.+?)\s*$/.exec(l);
      if (!m) { if (l.trim()) break; continue; }
      const livre = /^<[^>]*>$/.test(m[2]);
      if (!lista.some((x) => x.chave === m[1])) lista.push({ chave: m[1], opcoes: livre ? null : m[2].split('|').map((o) => o.trim()).filter(Boolean) });
    }
    return lista;
  }

  // As chaves em grupos, com o nome em português: [{ grupo, itens: [{ chave, rotulo, opcoes, soTerminal }] }].
  function agrupar(chaves) {
    const por = new Map(chaves.map((c) => [c.chave, c]));
    const usadas = new Set();
    const item = (c) => ({ chave: c.chave, rotulo: ROTULOS[c.chave] || c.chave, semRotulo: !ROTULOS[c.chave], opcoes: c.opcoes, soTerminal: SO_TERMINAL.has(c.chave) });
    const grupos = [];
    for (const [nome, ordem] of GRUPOS) {
      const itens = ordem.filter((k) => por.has(k)).map((k) => { usadas.add(k); return item(por.get(k)); });
      if (itens.length) grupos.push({ grupo: nome, itens });
    }
    const outras = chaves.filter((c) => !usadas.has(c.chave)).map(item);
    if (outras.length) grupos.push({ grupo: 'Outras', itens: outras });
    return grupos;
  }

  // O valor vai dentro de "/config chave=valor": com espaço ou aspas, vai entre aspas, com as de dentro escapadas.
  function valorParaComando(v) {
    const s = String(v);
    return /[\s"\\]/.test(s) ? `"${s.replace(/(["\\])/g, '\\$1')}"` : s;
  }

  // Valor atual de uma chave, do que o Claude informa (get_settings) e do estado
  // vivo da conversa. Só onde o nome bate: o resto volta undefined (a tela
  // mostra "—" em vez de adivinhar).
  function valorAtual(chave, { settings, info } = {}) {
    const efetivo = (settings && settings.effective) || {};
    const aplicado = (settings && settings.applied) || {};
    if (chave === 'permissionMode') return (info && info.modo) || (efetivo.permissions && efetivo.permissions.defaultMode) || undefined;
    if (chave === 'model') return efetivo.model !== undefined ? efetivo.model : undefined;
    const v = efetivo[chave] !== undefined ? efetivo[chave] : aplicado[chave];
    return v === undefined || v === null || typeof v === 'object' ? undefined : String(v);
  }

  const api = { USO_CONFERIDO, ROTULOS, GRUPOS, SO_TERMINAL, chavesDoUso, agrupar, valorParaComando, valorAtual };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else raiz.orqConfigClaude = api;
})(typeof window !== 'undefined' ? window : globalThis);
