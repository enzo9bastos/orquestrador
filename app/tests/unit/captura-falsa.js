// No lugar do microfone nos testes (ORQ_DITADO_CAPTURA = ["node", este arquivo]): escreve na
// saída um som de mentira (um tom), em pedaços de 0,1 s de áudio, um a cada CAPTURA_FALSA_MS
// (20 ms se não disser: mais rápido que o relógio, para o teste não esperar).
//
// CAPTURA_FALSA_ERRO: não abre (sai com a mensagem). CAPTURA_FALSA_ACABA: para depois de N
// pedaços (o microfone caiu). CAPTURA_FALSA_LOG: guarda o número do processo.
// CAPTURA_FALSA_CONTROLE: um arquivo JSON lido ao abrir, para o teste trocar o comportamento
// sem reabrir o app: { erro, acaba }.
const fs = require('fs');

let controle = {};
try { controle = JSON.parse(fs.readFileSync(process.env.CAPTURA_FALSA_CONTROLE, 'utf8')); } catch { /* sem arquivo de controle */ }
const erro = controle.erro || process.env.CAPTURA_FALSA_ERRO;
if (process.env.CAPTURA_FALSA_LOG) fs.appendFileSync(process.env.CAPTURA_FALSA_LOG, `${JSON.stringify({ pid: process.pid })}\n`);
if (erro) { process.stderr.write(`${erro}\n`); process.exit(1); }
const pedaco = Buffer.alloc(3200);
for (let i = 0; i < 1600; i++) pedaco.writeInt16LE(Math.round(8000 * Math.sin(i / 5)), i * 2);
const acaba = Number(controle.acaba || process.env.CAPTURA_FALSA_ACABA) || 0;
let n = 0;
process.stdout.on('error', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {
  process.stdout.write(pedaco);
  n += 1;
  if (acaba && n >= acaba) process.exit(0);
}, Number(process.env.CAPTURA_FALSA_MS) || 20);
