#!/usr/bin/env node
// No lugar do pw-dump nos testes (ORQ_PW_DUMP): imprime o que está no arquivo PW_FALSO_ARQ
// (uma lista de { app, binario, pid } de quem usa o microfone), no formato do pw-dump.
const fs = require('fs');
let l = [];
try { l = JSON.parse(fs.readFileSync(process.env.PW_FALSO_ARQ, 'utf8')); } catch { /* ninguém */ }
const nos = l.map((c, i) => ({ id: 100 + i, type: 'PipeWire:Interface:Node', info: { props: { 'media.class': 'Stream/Input/Audio', 'application.name': c.app, 'application.process.binary': c.binario, 'application.process.id': c.pid, ...(c.monitor ? { 'stream.capture.sink': true } : {}) } } }));
process.stdout.write(JSON.stringify([{ id: 0, type: 'PipeWire:Interface:Core', info: { props: {} } }, ...nos]));
