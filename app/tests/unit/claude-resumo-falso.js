#!/usr/bin/env node
// No lugar do Claude no resumo da reunião (ORQ_REUNIAO_CLAUDE). Guarda os argumentos e o texto
// recebido em RESUMO_FALSO_LOG e devolve um JSON de resumo (ou falha com RESUMO_FALSO_ERRO).
const fs = require('fs');
let entrada = '';
process.stdin.on('data', (d) => { entrada += d; });
process.stdin.on('end', () => {
  if (process.env.RESUMO_FALSO_LOG) fs.appendFileSync(process.env.RESUMO_FALSO_LOG, `${JSON.stringify({ args: process.argv.slice(2), entrada })}\n`);
  if (process.env.RESUMO_FALSO_ERRO) { process.stderr.write(`${process.env.RESUMO_FALSO_ERRO}\n`); process.exit(1); }
  process.stdout.write(`Aqui está:\n${JSON.stringify({ assunto: 'NF obrigatória no cartão', resumo: 'A equipe discutiu a obrigatoriedade da nota fiscal.', decisoes: ['Manter a NF obrigatória'], pendencias: ['Levantar os casos do cartão até sexta (Outros)'] })}\n`);
});
