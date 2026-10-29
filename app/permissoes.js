// Regras de permissão do Claude Code do usuário (~/.claude/settings.json,
// chave "permissions"). O /permissions não existe no modo stream-json, então o
// app edita o arquivo. Só a chave "permissions" muda; o resto do arquivo fica
// como está, e a versão anterior é guardada antes de cada gravação.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ARQ = path.join(os.homedir(), '.claude', 'settings.json');
const COPIAS = path.join(os.homedir(), '.local', 'share', 'orq-app', 'versoes', 'claude-settings');
const LISTAS = ['allow', 'ask', 'deny'];
const MODOS = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions'];

function lerArquivo() {
  try { return JSON.parse(fs.readFileSync(ARQ, 'utf8')); } catch { return {}; }
}

function ler() {
  const p = lerArquivo().permissions || {};
  return {
    arquivo: ARQ,
    allow: Array.isArray(p.allow) ? p.allow : [],
    ask: Array.isArray(p.ask) ? p.ask : [],
    deny: Array.isArray(p.deny) ? p.deny : [],
    defaultMode: p.defaultMode || null,
    modos: MODOS,
  };
}

function gravar(novo) {
  const atual = lerArquivo();
  const p = { ...(atual.permissions || {}) };
  for (const k of LISTAS) {
    const l = (novo[k] || []).map((r) => String(r).trim()).filter(Boolean);
    if (l.length) p[k] = [...new Set(l)]; else delete p[k];
  }
  if (novo.defaultMode && MODOS.includes(novo.defaultMode)) p.defaultMode = novo.defaultMode;
  else delete p.defaultMode;
  if (fs.existsSync(ARQ)) {
    fs.mkdirSync(COPIAS, { recursive: true });
    fs.copyFileSync(ARQ, path.join(COPIAS, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
  }
  const saida = { ...atual };
  if (Object.keys(p).length) saida.permissions = p; else delete saida.permissions;
  const tmp = `${ARQ}.orq-tmp`;
  fs.writeFileSync(tmp, JSON.stringify(saida, null, 2) + '\n');
  fs.renameSync(tmp, ARQ);
  return ler();
}

module.exports = { ler, gravar };
