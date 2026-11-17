// Lista única dos comandos (/…) do autocompletar e da paleta (Ctrl+K). A tela
// só desenha o que sai daqui; nada de lista própria lá.
//
// Regra (pedido do usuário, 16/11/2026): todo comando que funciona no Claude
// Code ou no Codex — no terminal ou no app de mesa — aparece e FUNCIONA na
// conversa do app. Nada cinza, nada some. Cada um tem um jeito ("como"):
//   texto     vai ao motor como mensagem (no -p do Claude ele roda e a saída
//             volta como <local-command-stdout>);
//   app       o app faz a versão dele (popup, cartão, pedido de controle,
//             arquivo); "acao" diz qual (renderer/comandos-tela.js);
//   terminal  o comando é de tela do terminal e não tem como ser feito por
//             trás: o app cola no terminal dele o motor com a conversa
//             (Claude: --resume <sessão> --fork-session "/x"; Codex: fork) e
//             a pessoa aperta Enter.
// Fora da lista ficam só os que nem o terminal tem: isEnabled sempre falso
// (loops, version, wellbeing, pause-memory) e os internos (__…). Os comandos de
// um motor não aparecem nas conversas do outro.
//
// Conferido no binário do Claude Code 2.1.325 e do Codex CLI 0.167.1 (16/11/2026);
// o inventário com a evidência de cada um está na pasta de entrega da frente.
const fs = require('fs');
const os = require('os');
const path = require('path');

const VERSAO_CONFERIDA = '2.1.325';
const VERSAO_CODEX = '0.167.1';

// [nome, como, descrição, dica, extra]. extra: { aliases, acao }.
// acao: o que a tela faz quando como = 'app' (ou um passo antes do envio,
// quando como = 'texto', como a confirmação do /heapdump).
const T = 'texto', A = 'app', X = 'terminal';
const CLAUDE = [
  ['add-dir', A, 'Adiciona uma pasta de trabalho (a conversa reinicia com ela)', '<pasta>'],
  ['advisor', X, 'Deixa o Claude consultar um modelo mais forte em momentos-chave', '[modelo|off]'],
  ['agents', A, 'Subagentes: lista, cria, edita e apaga', ''],
  ['artifacts', X, 'Navega pelos artifacts publicados e compartilhados', ''],
  ['autocompact', T, 'Quanto o contexto enche antes de resumir sozinho', '[auto|<tokens>]'],
  ['autofix-pr', X, 'Acompanha e corrige o PR atual', ''],
  ['auto-mode-setup', T, 'Ensina o modo auto sobre o seu ambiente', ''],
  ['background', A, 'Manda para o fundo o que está rodando em primeiro plano', '[mensagem]', { aliases: ['bg'] }],
  ['branch', A, 'Cria um ramo desta conversa, numa conversa nova', '[nome]'],
  ['brief', X, 'Liga ou desliga o modo só-resumo', ''],
  ['btw', A, 'Pergunta de lado, sem interromper a conversa', '<pergunta>'],
  ['bug', A, 'Relata um problema à Anthropic', '[relato]', { aliases: ['share'], acao: 'feedback' }],
  ['cd', X, 'Move a sessão para outra pasta de trabalho', '<pasta>'],
  ['chrome', X, 'Configurações do Claude no Chrome', ''],
  ['clear', T, 'Limpa o histórico da conversa', '[nome]', { aliases: ['reset', 'new'] }],
  ['cloud-plugins', X, 'Plugins nas sessões na nuvem', ''],
  ['color', T, 'Cor da barra do prompt desta sessão', '[cor|default]'],
  ['compact', T, 'Resume a conversa para liberar contexto', '[instruções]'],
  ['config', A, 'Configurações do Claude', '[chave=valor]', { aliases: ['settings'] }],
  ['context', T, 'Quanto do contexto está em uso', '[all]'],
  ['copy', A, 'Copia a última resposta do Claude (ou a N-ésima)', '[N]'],
  ['daemon', X, 'Serviços de fundo e rotinas', ''],
  ['design-consent', T, 'Dá ao Claude acesso aos projetos do Design', ''],
  ['design-login', X, 'Autoriza o acesso ao design-system com a conta claude.ai', ''],
  ['design-revoke', T, 'Tira o acesso do Claude aos projetos do Design', ''],
  ['desktop', X, 'Continua esta sessão no Claude Desktop', '', { aliases: ['app'] }],
  ['diff', A, 'Mudanças não commitadas', ''],
  ['effort', A, 'Troca o esforço', '[low|medium|high|xhigh|max]'],
  ['exit', A, 'Encerra só esta conversa (o app continua aberto); a próxima mensagem começa uma sessão nova', '', { aliases: ['quit'] }],
  ['export', A, 'Exporta a conversa como texto (copiar ou salvar)', '[arquivo]'],
  ['extra-usage', X, 'Agora é /usage-credits', ''],
  ['fast', A, 'Liga ou desliga o modo rápido', '[on|off]'],
  ['feedback', A, 'Manda um feedback à Anthropic', '[relato]'],
  ['focus', T, 'Visão foco: só o seu pedido, o resumo e a resposta', '[on|off]'],
  ['fork', A, 'Copia esta conversa para uma conversa nova e segue aqui', '[mensagem]'],
  ['goal', T, 'Meta que o Claude confere antes de parar', '[condição|clear]'],
  ['heapdump', T, 'Grava a memória do Claude (heap) num arquivo, para diagnóstico', '', { acao: 'confirmar-heapdump' }],
  ['help', A, 'Todos os comandos, com o que cada um faz aqui', ''],
  ['hooks', A, 'Hooks dos settings: ver e editar', ''],
  ['ide', X, 'Integrações com IDE', '[open]'],
  ['import', X, 'Importa a configuração de outro agente de código', '[codex|gemini|cursor]'],
  ['init', T, 'Cria um CLAUDE.md para o projeto', ''],
  ['insights', T, 'Relatório das suas sessões do Claude Code', ''],
  ['install', X, 'Instala o build nativo do Claude Code', '[opções]'],
  ['install-github-app', X, 'GitHub Actions do Claude num repositório', ''],
  ['install-slack-app', X, 'Instala o app do Claude no Slack', ''],
  ['keybindings', A, 'Abre o arquivo de atalhos do Claude', ''],
  ['list-agents', T, 'Subagentes, colegas e outras sessões', '', { aliases: ['peers'] }],
  ['login', X, 'Entra ou troca de conta da Anthropic', ''],
  ['logout', X, 'Sai da conta da Anthropic', ''],
  ['mcp', T, 'Servidores MCP', '[reconnect|enable|disable [servidor|all]]'],
  ['memory', A, 'Arquivos CLAUDE.md: ver e editar', ''],
  ['mobile', A, 'Links do app do Claude para celular', '', { aliases: ['ios', 'android'] }],
  ['model', A, 'Mostra ou troca o modelo', '[modelo]'],
  ['output-style', T, 'Lista os estilos de saída ou troca', '[estilo]'],
  ['passes', X, 'Compartilha uma semana grátis do Claude Code', ''],
  ['permissions', A, 'Regras de permissão', '', { aliases: ['allowed-tools'] }],
  ['plan', A, 'Liga o modo plano ou mostra o plano', '[open|descrição]'],
  ['plugin', X, 'Plugins do Claude Code', '', { aliases: ['plugins', 'marketplace'] }],
  ['powerup', X, 'Lições rápidas dos recursos do Claude Code', ''],
  ['privacy-settings', X, 'Configurações de privacidade', ''],
  ['project', X, 'Projeto do claude.ai para os relatórios de uso', '[projeto]'],
  ['pro-trial-expired', X, 'Opções do fim do teste do plano Pro', ''],
  ['radio', X, 'Rádio lo-fi do Claude', ''],
  ['rate-limit-options', X, 'Limites de uso e opções de upgrade', ''],
  ['recap', T, 'Resumo de uma linha da sessão', ''],
  ['release-notes', A, 'Notas da versão instalada', ''],
  ['reload-plugins', T, 'Ativa as mudanças de plugin pendentes (aceita a opção de forçar)', ''],
  ['reload-skills', T, 'Relê as skills mudadas no disco', ''],
  ['remote-control', X, 'Controla esta sessão pelo celular ou claude.ai', '[nome]', { aliases: ['rc'] }],
  ['remote-env', X, 'Ambiente padrão dos agentes na nuvem', ''],
  ['rename', T, 'Renomeia a conversa', '[nome]', { aliases: ['name'] }],
  ['restart', A, 'Reinicia o Claude desta conversa e continua do mesmo ponto', '', { aliases: ['update'] }],
  ['resume', A, 'Retoma uma conversa anterior, numa conversa nova do app', '[busca]', { aliases: ['continue'] }],
  ['rewind', A, 'Volta a conversa para antes de uma mensagem sua', '', { aliases: ['checkpoint', 'undo'] }],
  ['sandbox', X, 'Sandbox dos comandos do Bash', ''],
  ['scroll-speed', X, 'Velocidade da rolagem do terminal', ''],
  ['security-review', T, 'Revisão de segurança das mudanças', ''],
  ['session', X, 'Endereço e QR da sessão na nuvem', '', { aliases: ['remote'] }],
  ['setup-bedrock', X, 'Reconfigura o Amazon Bedrock', ''],
  ['setup-vertex', X, 'Reconfigura o Google Vertex AI', ''],
  ['skill-doctor', A, 'Skills que custam contexto e não são usadas', '', { acao: 'skills' }],
  ['skills', A, 'Skills disponíveis', ''],
  ['status', A, 'Versão, modelo, conta, conexões e ferramentas', ''],
  ['statusline', X, 'Monta a linha de status do terminal', ''],
  ['stickers', X, 'Adesivos do Claude Code', ''],
  ['stop', A, 'Pausa esta conversa (a próxima mensagem retoma)', ''],
  ['subtask', A, 'Manda um subagente fazer uma tarefa com o contexto todo', '<tarefa>'],
  ['tasks', A, 'Tarefas em segundo plano: ver a saída e parar', '', { aliases: ['bashes'] }],
  ['team-onboarding', T, 'Guia para o time começar no Claude Code', ''],
  ['teleport', X, 'Manda esta sessão para a nuvem, ou retoma uma de lá', '', { aliases: ['tp'] }],
  ['terminal-setup', A, 'Atalho Shift+Enter para quebrar linha', ''],
  ['theme', A, 'Tema do app (claro ou escuro)', ''],
  ['todos', A, 'Lista de tarefas (TodoWrite) desta conversa', ''],
  ['tui', X, 'Renderizador da tela do terminal', '[default|fullscreen]'],
  ['ultraplan', X, 'Plano editável numa sessão na nuvem', '<pedido>'],
  ['ultrareview', X, 'Revisão do branch numa sessão na nuvem', ''],
  ['upgrade', X, 'Troca de plano para limites maiores', ''],
  ['usage', T, 'Custo, uso do plano e atividade da sessão', '', { aliases: ['cost', 'stats'] }],
  ['usage-credits', X, 'Créditos de uso', ''],
  ['use-case', X, 'Caso de uso (Life Sciences)', '[caso]'],
  ['vim', A, 'Modo vim da caixa de texto', ''],
  ['voice', X, 'Modo de voz', '[hold|tap|off]'],
  ['web-setup', X, 'Sessões na nuvem com a sua conta do GitHub', ''],
  ['workflow-launch-exec', T, 'Executa um workflow lançado pelo servidor (só em sessões lançadas assim)', ''],
  ['workflows', X, 'Workflows do Claude Code (rodando e concluídos)', ''],
];

// Codex CLI 0.167.1 (slash_command.rs). O app-server não entende "/x" como
// texto: quase tudo é feito pelo app com um método dele, ou vai ao terminal.
const CODEX = [
  ['agents', X, 'Central de agentes', ''],
  ['approve', X, 'Aprova uma nova tentativa de algo negado pelo revisor', ''],
  ['apps', X, 'Apps do Codex', ''],
  ['archive', A, 'Arquiva esta conversa e começa outra (pede confirmação)', ''],
  ['cd', X, 'Troca a pasta de trabalho', '<pasta>'],
  ['clear', A, 'Começa uma conversa nova', '', { acao: 'new' }],
  ['compact', A, 'Resume a conversa para liberar contexto', ''],
  ['config', X, 'Preferências do Codex', ''],
  ['copy', A, 'Copia a última resposta do Codex', ''],
  ['daemon', X, 'Servidor local em segundo plano', ''],
  ['daybreak', X, 'Liga ou desliga o Daybreak', ''],
  ['debug-config', A, 'Camadas da configuração e de onde vem cada valor', ''],
  ['delete', A, 'Apaga esta conversa do Codex de vez (pede confirmação)', ''],
  ['diff', A, 'git diff, com os arquivos não rastreados', ''],
  ['effort', A, 'Troca o esforço', '[low|medium|high|xhigh]'],
  ['exit', A, 'Encerra só esta conversa (o app continua aberto); a próxima mensagem começa uma sessão nova', '', { aliases: ['quit'] }],
  ['experimental', X, 'Recursos experimentais', ''],
  ['export', A, 'Exporta a conversa em Markdown (copiar ou salvar)', ''],
  ['feedback', X, 'Manda os registros aos mantenedores', ''],
  ['fork', A, 'Bifurca esta conversa numa conversa nova', ''],
  ['goal', X, 'Meta de uma tarefa longa', '[objetivo|clear]'],
  ['hooks', A, 'Hooks do Codex', ''],
  ['ide', X, 'Contexto da IDE', ''],
  ['import', X, 'Importa a configuração e os chats do Claude Code', ''],
  ['init', T, 'Cria um AGENTS.md para o projeto', ''],
  ['keymap', X, 'Atalhos da tela do Codex', ''],
  ['logout', A, 'Sai da conta do Codex (pede confirmação)', ''],
  ['mcp', A, 'Servidores MCP', ''],
  ['memories', X, 'Uso e geração de memória', ''],
  ['mention', A, 'Menciona um arquivo', ''],
  ['model', A, 'Mostra ou troca o esforço (o modelo vem da configuração do Codex)', ''],
  ['new', A, 'Começa uma conversa nova', ''],
  ['permissions', X, 'O que o Codex pode fazer (sandbox e aprovação)', ''],
  ['pets', X, 'Mascote do terminal', '', { aliases: ['pet'] }],
  ['plan', X, 'Modo plano', ''],
  ['plugins', X, 'Plugins do Codex', ''],
  ['presets', X, 'Prompts e comandos guardados', ''],
  ['ps', A, 'Terminais em segundo plano', ''],
  ['pwd', A, 'Mostra a pasta de trabalho', '', { aliases: ['cwd'] }],
  ['raw', A, 'Texto cru para selecionar e copiar', ''],
  ['recap', X, 'Resume a conversa agora', ''],
  ['rename', A, 'Renomeia a conversa', '<nome>'],
  ['restart', A, 'Reinicia o Codex desta conversa e continua do mesmo ponto', ''],
  ['resume', A, 'Retoma uma conversa anterior do Codex', ''],
  ['review', A, 'Revisa as mudanças atuais e aponta problemas', ''],
  ['setup-default-sandbox', X, 'Configura o sandbox elevado', ''],
  ['side', X, 'Conversa de lado num fork passageiro', '', { aliases: ['btw'] }],
  ['skills', A, 'Skills do Codex', ''],
  ['status', A, 'Configuração da sessão e uso de tokens', ''],
  ['statusline', X, 'Itens da linha de status', ''],
  ['stop', A, 'Para todos os terminais em segundo plano', '', { aliases: ['clean'] }],
  ['subagents', X, 'Alterna entre os subagentes da sessão', ''],
  ['theme', A, 'Tema do app (claro ou escuro)', ''],
  ['title', X, 'Itens do título do terminal', ''],
  ['tui', X, 'Modo da tela do Codex', ''],
  ['usage', A, 'Uso da conta', ''],
  ['vim', A, 'Modo vim da caixa de texto', ''],
  ['voice', X, 'Voz', ''],
  ['warnings', X, 'Avisos e diagnósticos guardados', ''],
  ['worktree', X, 'Conversa num worktree novo', ''],
];

function item([nome, como, descricao, dica, extra = {}], motor) {
  const c = { nome, descricao, dica: dica || '', como, motor };
  if (extra.aliases) c.aliases = extra.aliases;
  if (como === A) c.acao = extra.acao || nome;
  else if (extra.acao) c.acao = extra.acao;
  return c;
}
const CATALOGO = { claude: CLAUDE.map((x) => item(x, 'claude')), codex: CODEX.map((x) => item(x, 'codex')) };

function skillsLocais(pasta = path.join(os.homedir(), '.claude', 'skills')) {
  const lista = [];
  let nomes = [];
  try { nomes = fs.readdirSync(pasta); } catch { return lista; }
  for (const nome of nomes) {
    let txt = '';
    try { txt = fs.readFileSync(path.join(pasta, nome, 'SKILL.md'), 'utf8').slice(0, 3000); } catch { continue; }
    const m = txt.match(/^description:\s*(.+)$/m);
    lista.push({ nome, descricao: m ? m[1].replace(/^["']|["']$/g, '') : '', dica: '', como: T });
  }
  return lista;
}

// Lista final de uma conversa.
//   motor: 'claude' | 'codex'
//   anunciados: nomes do init (null = o init ainda não veio)
//   descricoes: Map nome → { descricao, dica } (commands_changed do Claude)
//   skills: [{ nome, descricao, dica }] (Codex: as skills dele; Claude antes do init: as locais)
// Cada item: { nome, descricao, dica, como, acao?, aliases?, motor }.
// O catálogo entra sempre; o init e o commands_changed só acrescentam (skills,
// comandos de plugin): nunca tiram.
function montar({ motor = 'claude', anunciados = null, descricoes = new Map(), skills = [] } = {}) {
  const codex = motor === 'codex';
  const lista = new Map();
  for (const c of CATALOGO[codex ? 'codex' : 'claude']) lista.set(c.nome, { ...c });
  const tomados = new Set([...lista.values()].flatMap((c) => [c.nome, ...(c.aliases || [])]));
  const por = (c) => {
    if (!c || !c.nome || c.nome.startsWith('__') || tomados.has(c.nome)) return;
    tomados.add(c.nome);
    lista.set(c.nome, { nome: c.nome, descricao: c.descricao || 'Skill ou comando', dica: c.dica || '', como: T, motor });
  };
  if (codex) skills.forEach(por);
  else {
    const doClaude = (nome) => { const d = descricoes.get(nome) || {}; return { nome, descricao: d.descricao, dica: d.dica }; };
    // Antes do init: as skills locais. Depois: o que o init e o
    // commands_changed trouxerem de novo (skills, comandos de plugin).
    if (anunciados) { anunciados.forEach((n) => por(doClaude(n))); for (const n of descricoes.keys()) por(doClaude(n)); } else skills.forEach(por);
  }
  return [...lista.values()].sort((a, b) => a.nome.localeCompare(b.nome));
}

// O comando digitado ("/cost", "/quit") pelo nome ou por um alias.
function achar(lista, nome) {
  const n = String(nome || '').replace(/^\//, '');
  return (lista || []).find((c) => c.nome === n) || (lista || []).find((c) => (c.aliases || []).includes(n)) || null;
}

module.exports = { montar, achar, skillsLocais, VERSAO_CONFERIDA, VERSAO_CODEX, CATALOGO };
