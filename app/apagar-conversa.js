// Apagar uma conversa guardada pelo Claude (tela "Anteriores"), em dois tempos e com o
// custo em números. Liga o apagar.js (regra 3 do plano) às conversas anteriores.
//
//   preparar(sessao)              → mede o que some e devolve um comprovante
//   executar(sessao, comprovante) → só com ele: os arquivos vão para a lixeira do sistema
//   cancelar(comprovante)         → a pessoa desistiu: o comprovante deixa de valer
//
// O que some: o arquivo <sessão>.jsonl e, se existir, a pasta <sessão>/ ao lado dele (onde
// o Claude guarda as conversas dos subagentes daquela sessão). O que o Claude guarda fora
// dali com o id da sessão (ambiente, pontos de volta dos arquivos) NÃO é apagado: aparece
// no custo como "fica órfão", para a pessoa saber.
//
// Recusa sempre: conversa aberta no app e conversa do orquestrador. As duas listas vêm de
// quem chama, a cada preparar e de novo no executar (a conversa pode ter sido aberta no
// meio).
//
// O comprovante vale para aquela conversa, uma vez só e por pouco tempo, e carrega o do
// apagar.js, que recusa se os arquivos mudaram desde a medição.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const VALIDADE_MS = 2 * 60 * 1000; // igual à do apagar.js
const MAX_ABERTOS = 50;
const SESSAO = /^[\w-]{6,80}$/;
const ehPasta = (p) => { try { return fs.lstatSync(p).isDirectory(); } catch { return false; } };
const existe = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };

// conversas: { listar() → [{ sessao, arquivo, titulo }], raiz() → a pasta dos projetos do Claude,
//   emUso() → Map(sessão → título da conversa aberta), doOrquestrador() → Set(sessão),
//   apagada(sessao) → o que fazer depois (tirar a marca de arquivada) }
function criar({ apagar, conversas, agora = Date.now, casa = () => os.homedir() }) {
  const abertos = new Map(); // comprovante → { sessao, alvos, deArquivo, expira }
  const limparVencidos = () => { const t = agora(); for (const [k, c] of abertos) if (c.expira <= t) abertos.delete(k); };

  // Por que esta conversa não pode ser apagada agora, ou null.
  function trava(sessao) {
    const aberta = conversas.emUso().get(sessao);
    if (aberta !== undefined) return { codigo: 'aberta', erro: `esta conversa está aberta no app${aberta ? ` ("${aberta}")` : ''}; arquive ou feche antes de apagar. Nada foi apagado` };
    if (conversas.doOrquestrador().has(sessao)) return { codigo: 'orquestrador', erro: 'a conversa do orquestrador não pode ser apagada por aqui. Nada foi apagado' };
    return null;
  }
  // Os arquivos de transcript que não podem sumir: os das conversas abertas e os do orquestrador.
  async function caminhosProtegidos() {
    const lista = await conversas.listar();
    const dos = (ids) => lista.filter((x) => ids.has(x.sessao)).map((x) => x.arquivo);
    return { emUso: dos(new Set(conversas.emUso().keys())), doOrquestrador: dos(conversas.doOrquestrador()) };
  }

  async function preparar(sessao) {
    limparVencidos();
    if (!SESSAO.test(String(sessao || ''))) return { erro: 'conversa inválida' };
    const item = (await conversas.listar()).find((x) => x.sessao === sessao);
    if (!item) return { erro: 'não achei esta conversa entre as guardadas pelo Claude; ela pode já ter sido apagada' };
    const t = trava(sessao);
    if (t) return t;
    if (abertos.size >= MAX_ABERTOS) return { erro: 'há confirmações demais em aberto; espere um pouco e tente de novo' };
    const aoLado = path.join(path.dirname(item.arquivo), sessao);
    const alvos = [item.arquivo, ...(ehPasta(aoLado) ? [aoLado] : [])];
    const c = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(casa(), '.claude'));
    const dependentes = [['session-env', 'o ambiente que o Claude guardou para esta conversa'], ['file-history', 'os pontos de volta dos arquivos desta conversa']]
      .filter(([d]) => existe(path.join(c, d, sessao)))
      .map(([d, porque]) => ({ quem: path.join(c, d, sessao), porque }));
    const prot = await caminhosProtegidos();
    const r = await apagar.prepararApagar({
      tipo: 'conversa', alvos, raizes: [conversas.raiz()], destino: 'lixeira', emUso: prot.emUso, doOrquestrador: prot.doOrquestrador, dependentes,
      alternativa: 'arquivar a conversa: ela sai da lista e nada é apagado',
    });
    if (!r.ok) return { erro: r.motivo, codigo: r.codigo };
    const comprovante = crypto.randomBytes(24).toString('hex');
    const expira = Math.min(agora() + VALIDADE_MS, r.validoAte);
    abertos.set(comprovante, { sessao, alvos, deArquivo: r.comprovante, expira });
    // Só números e nomes: a tela monta a frase (e traduz).
    return { comprovante, validoAte: expira, custo: { sessao, titulo: item.titulo, arquivos: r.custo.arquivos, pastas: r.custo.pastas, bytes: r.custo.bytes, destino: r.custo.destino,
      comSubagentes: alvos.length > 1, orfaos: r.custo.orfaos } };
  }

  function cancelar(comprovante) {
    const c = typeof comprovante === 'string' ? abertos.get(comprovante) : null;
    if (!c) return false;
    abertos.delete(comprovante);
    apagar.cancelar(c.deArquivo);
    return true;
  }

  async function executar(sessao, comprovante) {
    const c = typeof comprovante === 'string' ? abertos.get(comprovante) : null;
    if (c) abertos.delete(comprovante); // uso único, mesmo se falhar adiante
    const recusar = (erro, codigo) => { if (c) apagar.cancelar(c.deArquivo); return { erro, ...(codigo ? { codigo } : {}) }; };
    if (!c) return recusar('não há confirmação válida para apagar esta conversa (já usada ou inexistente); nada foi apagado');
    if (c.sessao !== sessao) return recusar('esta confirmação é de outra conversa; nada foi apagado');
    if (c.expira <= agora()) return recusar('a confirmação venceu; clique em apagar de novo para ver o custo atualizado. Nada foi apagado');
    // A conversa pode ter sido aberta entre o custo e o clique.
    const t = trava(sessao);
    if (t) return recusar(t.erro, t.codigo);
    const prot = await caminhosProtegidos();
    const r = await apagar.executarApagar({ comprovante: c.deArquivo, alvos: c.alvos, emUso: prot.emUso });
    if (!r.ok) return { erro: r.motivo, codigo: r.codigo };
    try { conversas.apagada(sessao); } catch { /* a marca de arquivada é extra; os arquivos já foram */ }
    return { ok: true, sessao };
  }

  return { preparar, executar, cancelar, _emAberto: () => abertos.size };
}

module.exports = { criar, VALIDADE_MS };
