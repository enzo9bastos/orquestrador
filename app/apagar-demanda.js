// Apagar uma demanda do painel, em dois tempos e com o custo em números. É a
// primeira ligação do apagar.js (regra 3 do plano) a uma tela do app.
//
//   preparar(id)                → mede o que some e devolve um comprovante
//   executar(id, comprovante)   → só com ele: a nota vai para a lixeira do
//                                 sistema e a demanda sai do índice
//
// Só a tela chega aqui (pelo processo principal). O orq-topico, que é o comando
// que o orquestrador roda no terminal, não apaga: ele só deixa o pedido na
// demanda (topicos.pedirApagar), e quem decide é o usuário, vendo o custo.
//
// O comprovante vale para aquela demanda, uma vez só e por pouco tempo. Quando
// a demanda tem nota, ele carrega o comprovante do apagar.js, que recusa se a
// nota mudou desde a medição.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VALIDADE_MS = 2 * 60 * 1000; // igual à do apagar.js
const MAX_ABERTOS = 50;

function criar({ apagar, topicos, agora = Date.now }) {
  const abertos = new Map(); // comprovante → { id, alvo, deArquivo, expira }
  const limparVencidos = () => { const t = agora(); for (const [k, c] of abertos) if (c.expira <= t) abertos.delete(k); };
  const chaveDe = (id) => String(id ?? '').replace(/^#/, '');
  const achar = (id) => topicos.ler().find((x) => x.id === chaveDe(id));

  // Onde está a nota da demanda, se ela tem uma e o arquivo existe.
  function notaDe(t) {
    const o = t && t.arquivo ? topicos.ondeNota(t.id) : null;
    return o && fs.existsSync(o.abs) ? o : null;
  }

  async function preparar(id) {
    limparVencidos();
    const t = achar(id);
    if (!t) return { erro: `não existe a demanda ${chaveDe(id) || '(sem id)'}` };
    if (abertos.size >= MAX_ABERTOS) return { erro: 'há confirmações demais em aberto; espere um pouco e tente de novo' };
    const o = notaDe(t);
    let nota = null, deArquivo = null, expira = agora() + VALIDADE_MS;
    if (o) {
      const r = await apagar.prepararApagar({
        tipo: 'demanda', alvos: [o.abs], raizes: [o.pasta], destino: 'lixeira',
        alternativa: 'concluir a demanda: ela sai da lista das abertas e a nota fica',
      });
      if (!r.ok) return { erro: r.motivo, codigo: r.codigo };
      deArquivo = r.comprovante;
      expira = Math.min(expira, r.validoAte);
      // Só números e o nome do arquivo: a tela monta a frase (e traduz).
      nota = { nome: path.basename(o.abs), arquivos: r.custo.arquivos, bytes: r.custo.bytes, destino: r.custo.destino };
    }
    const comprovante = crypto.randomBytes(24).toString('hex');
    abertos.set(comprovante, { id: t.id, alvo: o ? o.abs : null, deArquivo, expira });
    return { comprovante, validoAte: expira, custo: { id: t.id, nota, pedidoDoOrquestrador: !!t.pedidoApagar } };
  }

  // Desistir na tela: o comprovante deixa de valer na hora.
  function cancelar(comprovante) {
    const c = typeof comprovante === 'string' ? abertos.get(comprovante) : null;
    if (!c) return false;
    abertos.delete(comprovante);
    if (c.deArquivo) apagar.cancelar(c.deArquivo);
    return true;
  }

  async function executar(id, comprovante) {
    const c = typeof comprovante === 'string' ? abertos.get(comprovante) : null;
    if (c) abertos.delete(comprovante); // uso único, mesmo se falhar adiante
    const recusar = (erro) => { if (c && c.deArquivo) apagar.cancelar(c.deArquivo); return { erro }; };
    if (!c) return recusar('não há confirmação válida para apagar esta demanda (já usada ou inexistente); nada foi apagado');
    if (c.id !== chaveDe(id)) return recusar('esta confirmação é de outra demanda; nada foi apagado');
    if (c.expira <= agora()) return recusar('a confirmação venceu; clique em apagar de novo para ver o custo atualizado. Nada foi apagado');
    const t = achar(id);
    if (!t) return recusar(`não existe mais a demanda ${c.id}; nada foi apagado`);
    const o = notaDe(t);
    // A demanda ganhou, perdeu ou trocou de nota desde a medição: o custo mostrado não vale mais.
    if ((o ? o.abs : null) !== c.alvo) return recusar('a nota desta demanda mudou de lugar desde a confirmação; clique em apagar de novo. Nada foi apagado');
    if (c.alvo) {
      const r = await apagar.executarApagar({ comprovante: c.deArquivo, alvos: [c.alvo] });
      if (!r.ok) return { erro: r.motivo, codigo: r.codigo };
    }
    // A nota já saiu da pasta: a lixeira antiga (síncrona) não pode ser chamada aqui.
    const tirada = topicos.apagar(c.id, { lixeira: () => { throw new Error('a nota desta demanda voltou para a pasta; nada mais foi apagado'); } });
    return { ok: true, demanda: tirada, notaNaLixeira: !!c.alvo };
  }

  return { preparar, executar, cancelar, _emAberto: () => abertos.size };
}

module.exports = { criar, VALIDADE_MS };
