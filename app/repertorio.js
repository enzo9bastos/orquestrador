// Repertório: a biblioteca de skills do app. Junta o que o usuário criou em
// cada ferramenta de IA (skills, comandos, subagentes, prompts, workflows) e
// os atalhos do usuário (prompts prontos com nome, opcionalmente com tecla).
//
// Na conversa: "/" mostra os comandos daquele Claude; "//" mostra o
// repertório inteiro. Uma skill que o Claude da conversa conhece vai como
// "/nome"; uma de outra ferramenta vai com o conteúdo junto, para qualquer
// modelo conseguir seguir.
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');

const ARQ_ATALHOS = path.join(os.homedir(), '.config', 'orq-app', 'repertorio.json');
const VERSOES = path.join(os.homedir(), '.local', 'share', 'orq-app', 'versoes', 'repertorio');
const casa = (p) => (typeof p === 'string' ? p.replace(/^~(?=$|\/)/, os.homedir()) : p);

// Onde cada ferramenta guarda o que o usuário criou (skills, comandos,
// subagentes, prompts, workflows: cada ferramenta tem o seu nome). Plugins
// instalados de marketplace ficam de fora: não foram criados pelo usuário.
// formato: "skill" (pasta com SKILL.md), "md" (arquivo .md, nome = arquivo),
// "toml" (comando do Gemini: description + prompt).
const FERRAMENTAS = [
  { ferramenta: 'claude', nome: 'Claude Code', locais: [
    { tipo: 'skill', caminho: '~/.claude/skills', formato: 'skill' },
    { tipo: 'comando', caminho: '~/.claude/commands', formato: 'md' },
    { tipo: 'subagente', caminho: '~/.claude/agents', formato: 'md' },
  ] },
  { ferramenta: 'agentes', nome: 'Padrão dos agentes', locais: [{ tipo: 'skill', caminho: '~/.agents/skills', formato: 'skill' }] },
  { ferramenta: 'codex', nome: 'Codex', locais: [
    { tipo: 'prompt', caminho: '~/.codex/prompts', formato: 'md' },
    { tipo: 'skill', caminho: '~/.codex/skills', formato: 'skill' },
  ] },
  { ferramenta: 'gemini', nome: 'Gemini CLI', locais: [{ tipo: 'comando', caminho: '~/.gemini/commands', formato: 'toml' }] },
  { ferramenta: 'opencode', nome: 'OpenCode', locais: [
    { tipo: 'comando', caminho: '~/.config/opencode/command', formato: 'md' },
    { tipo: 'agente', caminho: '~/.config/opencode/agent', formato: 'md' },
  ] },
  { ferramenta: 'windsurf', nome: 'Windsurf', locais: [{ tipo: 'workflow', caminho: '~/.codeium/windsurf/global_workflows', formato: 'md' }] },
  { ferramenta: 'cursor', nome: 'Cursor', locais: [{ tipo: 'comando', caminho: '~/.cursor/commands', formato: 'md' }] },
];

// Fontes: as ferramentas detectadas (config.detectarFerramentas, padrão sim)
// e as pastas extras de config.fontesRepertorio (formato skill).
function fontes() {
  const c = config.ler();
  const lista = [];
  if (c.detectarFerramentas !== false) {
    for (const f of FERRAMENTAS) for (const l of f.locais) lista.push({ nome: f.nome, ferramenta: f.ferramenta, tipo: l.tipo, formato: l.formato, caminho: casa(l.caminho) });
  }
  for (const f of Array.isArray(c.fontesRepertorio) ? c.fontesRepertorio : []) {
    lista.push({ nome: f.nome, ferramenta: f.ferramenta || 'outra', tipo: 'skill', formato: 'skill', caminho: casa(f.caminho) });
  }
  const vistos = new Set();
  return lista.filter((f) => f.caminho && fs.existsSync(f.caminho) && !vistos.has(f.caminho) && vistos.add(f.caminho));
}

// Cabeçalho YAML simples (name/description) de um .md.
function cabecalho(texto) {
  const m = texto.match(/^---\n([\s\S]*?)\n---/);
  const campos = {};
  if (m) for (const l of m[1].split('\n')) { const x = l.match(/^(\w[\w-]*):\s*(.*)$/); if (x) campos[x[1]] = x[2].replace(/^["']|["']$/g, ''); }
  return campos;
}
// TOML do Gemini: só os campos description e prompt (texto simples ou entre
// três aspas).
const TRES = '"""';
function toml(texto) {
  const campo = (k) => {
    const ini = texto.search(new RegExp(`^${k}\\s*=\\s*`, 'm'));
    if (ini < 0) return '';
    const resto = texto.slice(ini).replace(new RegExp(`^${k}\\s*=\\s*`), '');
    if (resto.startsWith(TRES)) { const fim = resto.indexOf(TRES, 3); return resto.slice(3, fim < 0 ? undefined : fim).trim(); }
    const um = resto.match(/^"((?:[^"\\]|\\.)*)"/);
    return um ? um[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : '';
  };
  return { description: campo('description'), prompt: campo('prompt') };
}

// Arquivos de uma pasta, descendo em subpastas (comandos aninhados viram
// "pasta:nome", como o Claude e o Gemini fazem).
function arquivos(raiz, ext, prefixo = '', nivel = 0) {
  if (nivel > 4) return [];
  let itens = [];
  try { itens = fs.readdirSync(raiz, { withFileTypes: true }); } catch { return []; }
  const lista = [];
  for (const d of itens) {
    if (d.name.startsWith('.')) continue;
    const abs = path.join(raiz, d.name);
    if (d.isDirectory()) lista.push(...arquivos(abs, ext, `${prefixo}${d.name}:`, nivel + 1));
    else if (d.name.toLowerCase().endsWith(ext)) lista.push({ nome: prefixo + d.name.slice(0, -ext.length), arquivo: abs });
  }
  return lista;
}

function skills() {
  const lista = [];
  for (const f of fontes()) {
    if (f.formato === 'skill') {
      let pastas = [];
      try { pastas = fs.readdirSync(f.caminho, { withFileTypes: true }).filter((d) => d.isDirectory() || d.isSymbolicLink()); } catch { continue; }
      for (const d of pastas) {
        const arq = path.join(f.caminho, d.name, 'SKILL.md');
        let texto;
        try { texto = fs.readFileSync(arq, 'utf8'); } catch { continue; }
        const c = cabecalho(texto);
        lista.push({ tipo: f.tipo, id: `${f.ferramenta}:${f.tipo}:${d.name}`, nome: c.name || d.name, descricao: c.description || '', fonte: f.nome, ferramenta: f.ferramenta, arquivo: arq, formato: 'skill' });
      }
    } else {
      for (const a of arquivos(f.caminho, f.formato === 'toml' ? '.toml' : '.md')) {
        let texto;
        try { texto = fs.readFileSync(a.arquivo, 'utf8'); } catch { continue; }
        const desc = f.formato === 'toml' ? toml(texto).description : (cabecalho(texto).description || '');
        const nome = f.formato === 'md' && f.tipo !== 'comando' && cabecalho(texto).name ? cabecalho(texto).name : a.nome;
        lista.push({ tipo: f.tipo, id: `${f.ferramenta}:${f.tipo}:${a.nome}`, nome, descricao: desc, fonte: f.nome, ferramenta: f.ferramenta, arquivo: a.arquivo, formato: f.formato });
      }
    }
  }
  return lista.sort((a, b) => a.nome.localeCompare(b.nome));
}

// Ferramentas conectadas (achadas) e quanto de cada tipo foi achado.
function conectadas(lista = skills()) {
  const m = new Map();
  for (const s of lista) {
    if (!m.has(s.fonte)) m.set(s.fonte, { nome: s.fonte, ferramenta: s.ferramenta, tipos: {} });
    const t = m.get(s.fonte).tipos;
    t[s.tipo] = (t[s.tipo] || 0) + 1;
  }
  return [...m.values()];
}

function conteudo(id) {
  const s = skills().find((x) => x.id === id);
  if (!s) return null;
  const texto = fs.readFileSync(s.arquivo, 'utf8');
  return s.formato === 'toml' ? (toml(texto).prompt || texto) : texto;
}

// Atalhos do usuário: { id, nome, texto, descricao, tecla, enviar } (tecla:
// "1".."9" para Ctrl+Alt+número; enviar: manda direto, sem passar pela caixa).
function atalhos() {
  try { return JSON.parse(fs.readFileSync(ARQ_ATALHOS, 'utf8')).atalhos || []; } catch { return []; }
}
function gravarAtalhos(lista) {
  const limpos = (Array.isArray(lista) ? lista : []).map((a, i) => ({
    id: String(a.id || `a${Date.now().toString(36)}${i}`),
    nome: String(a.nome || '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 40),
    texto: String(a.texto || '').slice(0, 20000),
    descricao: String(a.descricao || '').slice(0, 200),
    tecla: /^[1-9]$/.test(String(a.tecla || '')) ? String(a.tecla) : '',
    enviar: a.enviar === true,
  })).filter((a) => a.nome && a.texto);
  if (fs.existsSync(ARQ_ATALHOS)) {
    fs.mkdirSync(VERSOES, { recursive: true });
    fs.copyFileSync(ARQ_ATALHOS, path.join(VERSOES, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
  }
  fs.mkdirSync(path.dirname(ARQ_ATALHOS), { recursive: true });
  const tmp = `${ARQ_ATALHOS}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ atalhos: limpos }, null, 2) + '\n');
  fs.renameSync(tmp, ARQ_ATALHOS);
  return limpos;
}

function lista() {
  const l = skills();
  return { skills: l.map(({ arquivo, ...r }) => r), atalhos: atalhos(), conectadas: conectadas(l) };
}

module.exports = { lista, conteudo, atalhos, gravarAtalhos, skills, FERRAMENTAS };
