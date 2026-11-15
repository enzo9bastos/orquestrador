// Lista única dos comandos (/…) do autocompletar e da paleta (Ctrl+K). A tela
// só desenha o que sai daqui; nada de lista própria lá.
//
// De onde vem cada comando:
//   1. lista branca: o que o próprio app trata (abre menu, popup, reinicia,
//      fecha). Entra sempre, mesmo que o motor não anuncie.
//   2. o que o Claude anuncia no init (slash_commands), skills inclusive
//      (/doctor é skill: nunca esconder skills).
//   3. lista negra: anunciados pelo Claude que não servem por trás do app.
//      Aparecem cinza, com a dica do que usar no lugar, e não são enviados.
// Antes do init (o Claude só manda a lista depois da primeira mensagem), vale
// a lista branca + os comandos que a versão conferida sempre anuncia + as
// skills locais. Comando que o init não traz (status, memory, hooks, help,
// release-notes, todos, cost…) não aparece: no modo -p ele não existe.
//
// Conferido com o Claude Code 2.1.325 (init de uma casa vazia, 15/11/2026).
const fs = require('fs');
const os = require('os');
const path = require('path');

const VERSAO_CONFERIDA = '2.1.325';

// [nome, descrição, dica de argumento]. Codex: o app trata estes também lá?
const DO_APP = [
  ['restart', 'Reinicia o Claude desta conversa e continua do mesmo ponto', '', { codex: true }],
  ['model', 'Mostra ou troca o modelo', '[modelo]', { codex: true }],
  ['effort', 'Troca o esforço', '<low|medium|high|xhigh|max>', { codex: true }],
  ['config', 'Configurações do Claude', '', { codex: false }],
  ['permissions', 'Regras de permissão', '', { codex: false }],
  ['exit', 'Fecha o app e encerra as conversas', '', { codex: true }],
];
// Numa conversa Codex o /restart reinicia o Codex.
const DESCRICAO_CODEX = { restart: 'Reinicia o Codex desta conversa e continua do mesmo ponto' };

// Anunciados pelo init da versão conferida, com a descrição em português
// (o init só traz o nome; o commands_changed traz a descrição de parte deles).
const CONHECIDOS = {
  compact: ['Resume a conversa para liberar contexto', '[instruções]'],
  context: ['Quanto do contexto está em uso', ''],
  clear: ['Limpa o histórico da conversa', ''],
  usage: ['Custo, tokens e tempo desta sessão', ''],
  init: ['Cria um CLAUDE.md para o projeto', ''],
  mcp: ['Servidores MCP', ''],
  'security-review': ['Revisão de segurança das mudanças', ''],
  doctor: ['Diagnóstico da instalação', ''],
};
// Os que valem antes do init: sempre presentes na versão conferida.
const ANTES_DO_INIT = ['compact', 'context', 'clear', 'usage', 'init', 'mcp', 'security-review'];

// Lista negra: [nome, por que não serve, o que usar no lugar].
const BLOQUEADOS = {
  agents: ['O assistente de subagentes saiu do Claude Code', 'use a aba Repertório'],
  fast: ['O modo rápido não funciona por trás do app (Agent SDK)', 'use o menu de modelo e esforço'],
  heapdump: ['Diagnóstico de memória do terminal: grava o histórico e credenciais num arquivo', 'use o Claude num terminal'],
  'workflow-launch-exec': ['Comando interno do Claude Code', 'use a aba Workflows'],
};

const item = (nome, descricao = '', dica = '') => ({ nome, descricao, dica });

function skillsLocais(pasta = path.join(os.homedir(), '.claude', 'skills')) {
  const lista = [];
  let nomes = [];
  try { nomes = fs.readdirSync(pasta); } catch { return lista; }
  for (const nome of nomes) {
    let txt = '';
    try { txt = fs.readFileSync(path.join(pasta, nome, 'SKILL.md'), 'utf8').slice(0, 3000); } catch { continue; }
    const m = txt.match(/^description:\s*(.+)$/m);
    lista.push(item(nome, m ? m[1].replace(/^["']|["']$/g, '') : ''));
  }
  return lista;
}

// Lista final de uma conversa.
//   motor: 'claude' | 'codex'
//   anunciados: nomes do init (null = o init ainda não veio)
//   descricoes: Map nome → { descricao, dica } (commands_changed do Claude)
//   skills: [{ nome, descricao, dica }] (Codex: as skills dele; Claude antes do init: as locais)
// Cada item: { nome, descricao, dica, bloqueado? } — bloqueado é o "use X".
function montar({ motor = 'claude', anunciados = null, descricoes = new Map(), skills = [] } = {}) {
  const codex = motor === 'codex';
  const app = DO_APP.filter(([, , , o]) => !codex || o.codex)
    .map(([nome, d, dica]) => item(nome, (codex && DESCRICAO_CODEX[nome]) || d, dica));
  const nomesApp = new Set(app.map((c) => c.nome));
  const outros = new Map();
  const por = (c) => { if (!nomesApp.has(c.nome) && !c.nome.startsWith('__') && !outros.has(c.nome)) outros.set(c.nome, c); };
  const doClaude = (nome) => {
    const d = descricoes.get(nome) || {};
    const k = CONHECIDOS[nome] || [];
    const b = BLOQUEADOS[nome];
    const c = item(nome, (b && b[0]) || d.descricao || k[0] || '', d.dica || k[1] || '');
    if (b) c.bloqueado = b[1];
    return c;
  };
  if (codex) {
    skills.forEach(por);
  } else {
    (anunciados || ANTES_DO_INIT).forEach((nome) => por(doClaude(nome)));
    // commands_changed pode trazer nomes que o init não trouxe (skills novas).
    if (anunciados) for (const nome of descricoes.keys()) por(doClaude(nome));
    else skills.forEach(por);
  }
  const resto = [...outros.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  return [...app, ...resto.filter((c) => !c.bloqueado), ...resto.filter((c) => c.bloqueado)];
}

module.exports = { montar, skillsLocais, VERSAO_CONFERIDA, DO_APP, BLOQUEADOS, ANTES_DO_INIT };
