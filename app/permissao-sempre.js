// "Permitir sempre" no cartão de permissão.
//
// Junto com o pedido de permissão (can_use_tool), o Claude manda a regra que ele
// mesmo gravaria (permission_suggestions; forma do 2.1.326):
//   { type: 'addRules', rules: [{ toolName, ruleContent? }], behavior: 'allow', destination }
// O app não inventa regra: só oferece "sempre" quando o Claude sugeriu uma regra de
// permitir, mostra a regra como ela é e devolve a mesma sugestão, trocando só o alcance
// (destination) pelo que a pessoa escolheu.
//
// Lista de recusa: comando que nunca ganha "sempre", nem que o Claude sugira. São os que
// rodam outro programa qualquer, mexem em docker/tmux/ssh, falam com a rede, apagam, dão
// git push, ou regras abertas demais (coringa). Para esses, cada vez passa pela pessoa.
const DESTINOS = ['session', 'localSettings', 'userSettings'];

const RODA_OUTROS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'python', 'python2', 'python3', 'node', 'deno', 'bun', 'ruby', 'perl', 'php', 'lua',
  'env', 'xargs', 'eval', 'exec', 'sudo', 'su', 'doas', 'nohup', 'time', 'timeout', 'watch', 'nice', 'find', 'awk']);
const DOCKER_E_AFINS = new Set(['docker', 'docker-compose', 'podman', 'tmux', 'screen', 'ssh', 'scp', 'sftp', 'rsync']);
const REDE = new Set(['curl', 'wget', 'nc', 'ncat', 'netcat', 'telnet', 'ftp']);
const APAGA = new Set(['rm', 'rmdir', 'shred', 'dd', 'truncate', 'mkfs', 'unlink']);
// Ferramenta inteira (sem conteúdo na regra) que escreve ou busca qualquer coisa.
const INTEIRA_NAO = new Set(['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'WebFetch']);

// Motivo da recusa de uma regra, ou null se ela pode ganhar "sempre".
function recusaDaRegra(r) {
  const conteudo = typeof r.ruleContent === 'string' ? r.ruleContent.trim() : '';
  const aberto = !conteudo || /^:?\*+$/.test(conteudo) || /^\*\*?$/.test(conteudo);
  if (aberto) return r.toolName.startsWith('mcp__') || !INTEIRA_NAO.has(r.toolName) ? (conteudo ? 'coringa' : null) : 'coringa';
  if (r.toolName !== 'Bash') return null;
  // "npm test:*" (prefixo) ou o comando exato.
  const comando = conteudo.replace(/:\*$/, '').trim();
  if (!comando) return 'coringa';
  if (/[;&|`\n]|\$\(/.test(comando)) return 'mais de um comando';
  const palavras = comando.split(/\s+/);
  const primeira = palavras[0].replace(/^.*\//, '');
  if (RODA_OUTROS.has(primeira)) return 'roda outros programas';
  if (DOCKER_E_AFINS.has(primeira)) return 'docker, tmux ou ssh';
  if (REDE.has(primeira)) return 'rede';
  if (APAGA.has(primeira) || /^mkfs\./.test(primeira)) return 'apaga arquivos';
  if (primeira === 'git' && palavras.some((p, i) => i > 0 && p === 'push')) return 'git push';
  return null;
}

// A primeira sugestão de regra de permitir, bem formada; senão null.
function sugestaoSempre(sugestoes) {
  if (!Array.isArray(sugestoes)) return null;
  for (const s of sugestoes) {
    if (!s || s.type !== 'addRules' || s.behavior !== 'allow' || !Array.isArray(s.rules) || !s.rules.length) continue;
    if (!s.rules.every((r) => r && typeof r.toolName === 'string' && r.toolName && (r.ruleContent === undefined || typeof r.ruleContent === 'string'))) continue;
    return s;
  }
  return null;
}

// O que o cartão mostra: null (sem "sempre"), { ok: true, textos } ou { ok: false, motivo, textos }.
function resumo(sugestoes) {
  const s = sugestaoSempre(sugestoes);
  if (!s) return null;
  const textos = s.rules.map((r) => `${r.toolName}${typeof r.ruleContent === 'string' && r.ruleContent ? `(${r.ruleContent})` : ''}`);
  const motivo = s.rules.map(recusaDaRegra).find(Boolean) || null;
  return motivo ? { ok: false, motivo, textos } : { ok: true, textos };
}

// O que volta ao Claude em updatedPermissions: a sugestão dele com o alcance escolhido.
// null se não há sugestão, se ela é da lista de recusa ou se o alcance não é dos oferecidos.
function atualizacao(sugestoes, destino) {
  if (!DESTINOS.includes(destino)) return null;
  const r = resumo(sugestoes);
  if (!r || !r.ok) return null;
  return [{ ...sugestaoSempre(sugestoes), destination: destino }];
}

module.exports = { DESTINOS, resumo, atualizacao, recusaDaRegra };
