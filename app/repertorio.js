// Repertório: a biblioteca de skills do app. Junta as skills de cada
// ferramenta (Claude, pasta comum dos agentes, outras no futuro) e os atalhos
// do usuário (prompts prontos com nome, opcionalmente com tecla).
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

function fontes() {
  const c = config.ler();
  return (Array.isArray(c.fontesRepertorio) ? c.fontesRepertorio : [])
    .map((f) => ({ nome: f.nome, ferramenta: f.ferramenta || 'outra', caminho: casa(f.caminho) }))
    .filter((f) => f.caminho && fs.existsSync(f.caminho));
}

// Cabeçalho YAML simples (name/description) do SKILL.md.
function cabecalho(texto) {
  const m = texto.match(/^---\n([\s\S]*?)\n---/);
  const campos = {};
  if (m) for (const l of m[1].split('\n')) { const x = l.match(/^(\w[\w-]*):\s*(.*)$/); if (x) campos[x[1]] = x[2].replace(/^["']|["']$/g, ''); }
  return campos;
}

function skills() {
  const lista = [];
  for (const f of fontes()) {
    let pastas = [];
    try { pastas = fs.readdirSync(f.caminho, { withFileTypes: true }).filter((d) => d.isDirectory() || d.isSymbolicLink()); } catch { continue; }
    for (const d of pastas) {
      const arq = path.join(f.caminho, d.name, 'SKILL.md');
      let texto;
      try { texto = fs.readFileSync(arq, 'utf8'); } catch { continue; }
      const c = cabecalho(texto);
      lista.push({ tipo: 'skill', id: `${f.ferramenta}:${d.name}`, nome: c.name || d.name, descricao: c.description || '', fonte: f.nome, ferramenta: f.ferramenta, arquivo: arq });
    }
  }
  return lista.sort((a, b) => a.nome.localeCompare(b.nome));
}

function conteudo(id) {
  const s = skills().find((x) => x.id === id);
  if (!s) return null;
  return fs.readFileSync(s.arquivo, 'utf8');
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
  return { skills: skills().map(({ arquivo, ...r }) => r), atalhos: atalhos(), fontes: fontes().map((f) => f.nome) };
}

module.exports = { lista, conteudo, atalhos, gravarAtalhos, skills };
