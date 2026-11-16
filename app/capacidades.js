// Registro do que o Claude instalado atende (0.D3, na versão da decisão D16.1):
// para cada versão do CLI, quais subtipos de pedido de controle (control_request)
// ele atende. O app NÃO esconde nada com isto; só registra, para que o resto do
// app possa consultar e, onde faltar, cair na versão própria dele (popup, cartão
// ou terminal).
//
// Como aprende:
//   - pelo uso: toda resposta do Claude a um pedido do app é anotada. Sucesso →
//     atende. Erro com error_code "unsupported_request" (ou, nos CLIs antigos, só
//     as palavras dele) → não atende. Outro erro (ex.: modelo recusado) não diz
//     nada sobre atender e não entra.
//   - pela sonda: depois do primeiro init de uma versão, em segundo plano, o app
//     pergunta os subtipos que SÓ LEEM (SONDAVEIS). Pedido que muda a conversa
//     (interrupt, set_model, set_permission_mode, rewind_files, apply_flag_settings,
//     stop_task, background_tasks, side_question, submit_feedback…) nunca é sondado:
//     esse só se aprende no primeiro uso de verdade.
//
// Arquivo: um JSON na pasta de cache do app, guardado sem bloquear (fs.promises,
// juntando as gravações), com as últimas MAX_VERSOES versões vistas:
//   { "versoes": { "2.1.325": { "visto": 1700000000000,
//       "subtipos": { "get_status": { "atende": true, "como": "sonda", "quando": 1700000000000 } } } } }
const fsp = require('fs').promises;
const path = require('path');

// Só leitura: perguntar não muda nada na conversa.
const SONDAVEIS = ['get_status', 'get_memory_dialog', 'get_skills_dialog', 'get_hooks_listing', 'get_plan', 'mcp_status'];
const MAX_VERSOES = 5;
// As palavras com que o CLI diz "não atendo" (o error_code só veio nos novos).
const PALAVRAS_NAO_ATENDE = /Unsupported control request subtype|does not handle control_request subtype|is not supported in this context/;

// O que uma control_response diz sobre atender o subtipo: true, false ou null (nada).
function atendeDaResposta(r) {
  if (!r || typeof r !== 'object') return null;
  if (r.subtype === 'success') return true;
  if (r.subtype !== 'error') return null;
  if (r.error_code === 'unsupported_request') return false;
  if (typeof r.error === 'string' && PALAVRAS_NAO_ATENDE.test(r.error)) return false;
  return null;
}

const versaoValida = (v) => typeof v === 'string' && /^[\w.+-]{1,40}$/.test(v);
const subtipoValido = (s) => typeof s === 'string' && /^\w{1,60}$/.test(s);

function criar({ arquivo, maxVersoes = MAX_VERSOES, esperaGravar = 150 } = {}) {
  let versoes = {}; // versão → { visto, subtipos: { subtipo → { atende, como, quando } } }
  let mexido = false;
  let timer = null;
  let gravando = Promise.resolve();

  const podar = () => {
    const lista = Object.keys(versoes).sort((a, b) => (versoes[b].visto || 0) - (versoes[a].visto || 0));
    for (const v of lista.slice(maxVersoes)) delete versoes[v];
  };
  const gravarJa = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!mexido || !arquivo) return gravando;
    mexido = false;
    const texto = JSON.stringify({ versoes }, null, 2) + '\n';
    const tmp = `${arquivo}.${process.pid}.tmp`;
    gravando = gravando.then(async () => {
      try {
        await fsp.mkdir(path.dirname(arquivo), { recursive: true });
        await fsp.writeFile(tmp, texto);
        await fsp.rename(tmp, arquivo);
      } catch { /* sem disco: o registro continua na memória */ }
    });
    return gravando;
  };
  const agendar = () => { mexido = true; if (!timer) { timer = setTimeout(gravarJa, esperaGravar); if (timer.unref) timer.unref(); } };

  // Lê o que já estava gravado, sem bloquear. O que foi aprendido antes de a
  // leitura acabar vale mais que o arquivo (é mais novo).
  const carregado = (async () => {
    if (!arquivo) return;
    let dado = null;
    try { dado = JSON.parse(await fsp.readFile(arquivo, 'utf8')); } catch { return; /* primeira vez ou arquivo ruim */ }
    const doArquivo = (dado && typeof dado.versoes === 'object' && dado.versoes) || {};
    for (const [v, reg] of Object.entries(doArquivo)) {
      if (!versaoValida(v) || !reg || typeof reg.subtipos !== 'object') continue;
      const atual = versoes[v] || (versoes[v] = { visto: reg.visto || 0, subtipos: {} });
      atual.visto = Math.max(atual.visto || 0, reg.visto || 0);
      for (const [s, x] of Object.entries(reg.subtipos)) {
        if (subtipoValido(s) && x && typeof x.atende === 'boolean' && !atual.subtipos[s]) atual.subtipos[s] = { atende: x.atende, como: x.como || 'uso', quando: x.quando || 0 };
      }
    }
    podar();
  })();

  return {
    carregado,
    gravarJa,
    // Uma versão do CLI apareceu (init): fica como a mais recente.
    viu(versao) {
      if (!versaoValida(versao)) return;
      const reg = versoes[versao] || (versoes[versao] = { visto: 0, subtipos: {} });
      reg.visto = Date.now();
      podar();
      agendar();
    },
    // Anota a resposta do Claude a um pedido do app. Devolve true/false/null.
    anotar(versao, subtipo, resposta, como = 'uso') {
      if (!versaoValida(versao) || !subtipoValido(subtipo)) return null;
      const atende = atendeDaResposta(resposta);
      if (atende === null) return null;
      const reg = versoes[versao] || (versoes[versao] = { visto: Date.now(), subtipos: {} });
      const antes = reg.subtipos[subtipo];
      if (!antes || antes.atende !== atende || antes.como !== como) {
        reg.subtipos[subtipo] = { atende, como, quando: Date.now() };
        podar();
        agendar();
      }
      return atende;
    },
    // O que se sabe de uma versão: { subtipo: { atende, como, quando } } (cópia).
    daVersao(versao) {
      const reg = versoes[versao];
      return reg ? JSON.parse(JSON.stringify(reg.subtipos)) : {};
    },
    // Dos subtipos pedidos, os que a versão ainda não tem no registro.
    faltam(versao, lista) {
      const reg = versoes[versao];
      return lista.filter((s) => !reg || !reg.subtipos[s]);
    },
    versoes: () => Object.keys(versoes),
  };
}

module.exports = { criar, atendeDaResposta, SONDAVEIS, PALAVRAS_NAO_ATENDE };
