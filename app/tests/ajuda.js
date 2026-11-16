// Utilidades dos testes: uma "casa" temporária para cada teste, para nunca
// tocar nos arquivos reais (config, notas, settings do Claude).
const fs = require('fs');
const path = require('path');
const { pastaTemporaria } = require('./temporarias');

function casaTemporaria(config = {}) {
  const casa = pastaTemporaria('orq-teste-'); // apagada quando o teste passa
  fs.mkdirSync(path.join(casa, '.config', 'orq-app'), { recursive: true });
  fs.writeFileSync(path.join(casa, '.config', 'orq-app', 'config.json'), JSON.stringify(config));
  process.env.HOME = casa;
  return casa;
}

function escrever(casa, rel, texto) {
  const abs = path.join(casa, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, texto);
  return abs;
}

module.exports = { casaTemporaria, escrever, pastaTemporaria };
