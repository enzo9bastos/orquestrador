#!/usr/bin/env node
// Roda os testes do app, por área.
//   npm test                 tudo
//   npm test -- notas        só a área "notas" (unidade + tela)
//   npm test -- notas janela várias áreas
//   npm test -- --so-unidade sem abrir o app
// Cada arquivo diz a área na primeira linha ("// Área: notas"). Os testes de
// tela abrem o app de verdade numa casa temporária (HOME falso), nunca nos
// arquivos reais, e conversam com ele pelo DevTools.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const soUnidade = args.includes('--so-unidade');
const areas = args.filter((a) => !a.startsWith('--'));
const area = (arq) => (fs.readFileSync(arq, 'utf8').match(/^\/\/ Área: (\S+)/m) || [])[1] || '';
const escolhe = (arq) => !areas.length || areas.includes(area(arq));

const pasta = (p) => path.join(__dirname, p);
const unidade = fs.readdirSync(pasta('unit')).filter((f) => f.endsWith('.test.js')).map((f) => pasta(`unit/${f}`)).filter(escolhe);
const tela = fs.readdirSync(pasta('e2e')).filter((f) => f.endsWith('.e2e.js')).map((f) => pasta(`e2e/${f}`)).filter(escolhe);

let falhou = false;
if (unidade.length) {
  console.log(`\n== unidade (${unidade.length} arquivo(s)) ==`);
  const r = spawnSync(process.execPath, ['--test', ...unidade], { stdio: 'inherit' });
  if (r.status !== 0) falhou = true;
}

let electron = null;
try { electron = require(path.join(__dirname, '..', 'node_modules', 'electron')); } catch { /* sem electron instalado */ }
if (soUnidade || !tela.length) {
  // nada de tela pedido
} else if (!electron || !fs.existsSync(electron)) {
  console.log('\n== tela: PULADO (Electron não instalado aqui; rode na pasta que tem o app instalado) ==');
} else {
  console.log(`\n== tela (${tela.length} arquivo(s)) ==`);
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tela], { stdio: 'inherit', env: { ...process.env, ORQ_ELECTRON: electron } });
  if (r.status !== 0) falhou = true;
}
process.exit(falhou ? 1 : 0);
