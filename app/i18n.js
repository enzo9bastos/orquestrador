// Idioma no processo principal (notificações do sistema): o mesmo dicionário
// da tela (renderer/i18n/en.json). Em português devolve o texto como está.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const ARQ = path.join(__dirname, 'renderer', 'i18n', 'en.json');
let cache = null;
function dicionario() {
  if (cache) return cache;
  try {
    const j = JSON.parse(fs.readFileSync(ARQ, 'utf8'));
    cache = { textos: j.textos || {}, padroes: (j.padroes || []).map(([s, r]) => { try { return [new RegExp(s, 'u'), r]; } catch { return null; } }).filter(Boolean) };
  } catch { cache = { textos: {}, padroes: [] }; }
  return cache;
}
function t(s) {
  if (s == null || config.ler().idioma !== 'en') return s;
  const d = dicionario();
  const k = String(s).replace(/\s+/g, ' ').trim();
  if (d.textos[k] !== undefined) return d.textos[k];
  for (const [re, rep] of d.padroes) if (re.test(k)) return k.replace(re, rep);
  return s;
}
module.exports = { t };
