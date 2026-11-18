// Escrever a mensagem no editor de texto do computador (plano 4.4, H2: o Ctrl+G do terminal).
//
// O texto da caixa vai para um arquivo temporário do app, o editor de texto do sistema abre
// esse arquivo e, a cada vez que a pessoa salva lá, o texto novo volta para a caixa. Quando
// ela termina, o arquivo é apagado: ele é só uma cópia do que está na caixa.
//
//   comecar(texto) → cria o arquivo, começa a olhar e abre o editor
//   terminar()     → para de olhar, devolve o último texto salvo e apaga o arquivo
//   estado()       → { editando, texto } (para a tela que recarregou no meio)
//   limparSobras() → ao abrir o app: tira os arquivos velhos que uma queda deixou
//
// Cuidados:
// - a pasta é do app (modo 700) e o arquivo nasce com nome sorteado, modo 600 e "wx" (nunca
//   por cima de outro, nunca seguindo um link plantado); o caminho nunca vem da tela;
// - o que se lê de volta tem limite de tamanho e só vale se for um arquivo comum;
// - uma edição por vez (a caixa de mensagem é uma só);
// - o texto que volta entra na caixa como texto: quem decide enviar é a pessoa.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LIMITE = 1024 * 1024; // 1 MB: mais do que qualquer mensagem
const NOME = /^mensagem-[0-9a-f]{12}\.txt~?$/; // com "~": a cópia de segurança que alguns editores deixam ao lado
const VELHO_MS = 7 * 24 * 60 * 60 * 1000; // sobra de uma queda do app: fica 7 dias, para dar tempo de recuperar

// pasta: onde os arquivos ficam. abrir(caminho) → Promise com "" ou a mensagem de erro (no app,
// shell.openPath). aoMudar(texto): a pessoa salvou no editor. intervalo: de quanto em quanto olhar.
function criar({ pasta, abrir, aoMudar = () => {}, intervalo = 300, agora = Date.now }) {
  let atual = null; // { arquivo, texto, olhar }

  // O que está no arquivo agora, ou null se não dá para ler (o editor troca o arquivo ao salvar:
  // por um instante ele pode não existir).
  function ler(arquivo) {
    try {
      const st = fs.lstatSync(arquivo);
      if (!st.isFile() || st.size > LIMITE) return null;
      return fs.readFileSync(arquivo, 'utf8').replace(/\u0000/g, '').replace(/\r?\n$/, '');
    } catch { return null; }
  }
  // O bastante para saber se o arquivo mudou sem ler o conteúdo (o editor troca o arquivo ao salvar).
  const assinatura = (arquivo) => { try { const st = fs.lstatSync(arquivo); return `${st.ino}:${st.size}:${st.mtimeMs}`; } catch { return ''; } };
  const apagar = (arquivo) => {
    // Só o arquivo que este módulo criou: direto na pasta dele, com o nome dele, e comum.
    try {
      if (path.dirname(arquivo) !== pasta || !NOME.test(path.basename(arquivo))) return false;
      if (!fs.lstatSync(arquivo).isFile()) return false;
      fs.unlinkSync(arquivo);
      return true;
    } catch { return false; }
  };

  async function comecar(texto) {
    if (typeof texto !== 'string') return { erro: 'texto inválido' };
    if (Buffer.byteLength(texto, 'utf8') > LIMITE) return { erro: 'a mensagem é grande demais para abrir no editor de texto' };
    // Já editando: só abre o editor de novo no mesmo arquivo (a pessoa pode ter fechado a janela).
    if (atual) {
      const erro = await abrir(atual.arquivo).catch((e) => String((e && e.message) || e));
      return erro ? { erro } : { ok: true, jaEditando: true, texto: atual.texto };
    }
    let arquivo;
    try {
      fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
      fs.chmodSync(pasta, 0o700);
      arquivo = path.join(pasta, `mensagem-${crypto.randomBytes(6).toString('hex')}.txt`);
      fs.writeFileSync(arquivo, texto, { mode: 0o600, flag: 'wx' });
    } catch (e) { return { erro: `não consegui criar o arquivo da mensagem: ${e.message}` }; }
    const eu = { arquivo, texto, olhar: null, vista: assinatura(arquivo), relogio: null };
    eu.olhar = () => {
      if (atual !== eu) return;
      eu.vista = assinatura(arquivo);
      const novo = ler(arquivo);
      if (novo === null || novo === eu.texto) return;
      eu.texto = novo;
      try { aoMudar(novo); } catch { /* a tela pode ter fechado */ }
    };
    atual = eu;
    // Espia o arquivo de tempos em tempos. A marca de comparação é tirada aqui, na hora em que o
    // arquivo nasce: um salvar feito logo em seguida já conta (o fs.watchFile só começa a
    // comparar depois da primeira espiada dele, e perdia esse salvar).
    eu.relogio = setInterval(() => { if (assinatura(arquivo) !== eu.vista) eu.olhar(); }, intervalo);
    if (eu.relogio.unref) eu.relogio.unref();
    const erro = await Promise.resolve().then(() => abrir(arquivo)).catch((e) => String((e && e.message) || e));
    if (erro) { terminar(); return { erro }; }
    return { ok: true };
  }

  function terminar() {
    if (!atual) return { ok: false };
    const eu = atual;
    atual = null;
    clearInterval(eu.relogio);
    const ultimo = ler(eu.arquivo); // o que foi salvo e a espreita ainda não tinha visto
    apagar(eu.arquivo);
    return { ok: true, texto: ultimo === null ? eu.texto : ultimo };
  }

  // Confere o arquivo na hora (a tela pergunta quando a pessoa volta para o app).
  const estado = () => {
    if (!atual) return { editando: false };
    atual.olhar();
    return atual ? { editando: true, texto: atual.texto } : { editando: false };
  };

  // Arquivos de mensagem que uma queda do app deixou: saem depois de 7 dias. Nunca toca no que
  // está em edição agora nem no que não tem o nome deste módulo.
  function limparSobras() {
    let tirados = 0;
    let nomes = [];
    try { nomes = fs.readdirSync(pasta); } catch { return 0; }
    for (const n of nomes) {
      const arquivo = path.join(pasta, n);
      if (!NOME.test(n) || (atual && atual.arquivo === arquivo)) continue;
      try {
        const st = fs.lstatSync(arquivo);
        if (st.isFile() && agora() - st.mtimeMs > VELHO_MS && apagar(arquivo)) tirados++;
      } catch { /* sumiu no meio */ }
    }
    return tirados;
  }

  return { comecar, terminar, estado, limparSobras, _arquivo: () => (atual ? atual.arquivo : null) };
}

module.exports = { criar, LIMITE, VELHO_MS };
