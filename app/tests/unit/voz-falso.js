// No lugar do voz/transcrever.py nos testes (ORQ_VOZ_PYTHON=node, ORQ_VOZ_SCRIPT=este arquivo).
// Fala o mesmo protocolo: uma linha de JSON por evento. O que "ouve" depende do nome do arquivo:
// voce.* → falas da pessoa; outros.* → falas dos outros. VOZ_FALSO_ERRO faz falhar; VOZ_FALSO_LOG
// guarda os argumentos recebidos; VOZ_FALSO_MS atrasa cada trecho.
const fs = require('fs');
const path = require('path');
const [arquivo, ...resto] = process.argv.slice(2);
const dizer = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
if (process.env.VOZ_FALSO_LOG) fs.appendFileSync(process.env.VOZ_FALSO_LOG, `${JSON.stringify({ arquivo, args: resto })}\n`);
if (process.env.VOZ_FALSO_ERRO) { dizer({ t: 'erro', erro: process.env.VOZ_FALSO_ERRO }); process.exit(4); }
const nome = path.basename(arquivo || '');
const falas = nome.startsWith('voce') ? [[1, 4, 'Bom dia, vamos começar pela nota fiscal.'], [20, 24, 'Então fica decidido: manter a NF obrigatória.']]
  : nome.startsWith('outros') ? [[6, 10, 'Concordo, mas o cartão corporativo precisa de exceção.'], [12, 15, 'Eu fico de levantar os casos até sexta.']] : [];
const modelo = resto[resto.indexOf('--modelo') + 1];
dizer({ t: 'inicio', modelo, aparelho: 'cpu', duracao: 30 });
const ms = Number(process.env.VOZ_FALSO_MS) || 0;
(async () => {
  for (const [ini, fim, texto] of falas) {
    if (ms) await new Promise((r) => setTimeout(r, ms));
    dizer({ t: 'trecho', ini, fim, texto });
    dizer({ t: 'progresso', pct: Math.round((fim / 30) * 100) });
  }
  dizer({ t: 'progresso', pct: 100 });
  dizer({ t: 'fim', trechos: falas.length });
})();
