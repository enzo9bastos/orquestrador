// Atalhos de teclado: formato único, lista do que o app já usa e a conferência
// de colisão. Carregado pela tela (window.orqAtalhos) e pelo processo principal
// (require em config.js), para que quem digita na engrenagem e quem valida o
// arquivo usem a mesma lista.
//
// Uma combinação é "Ctrl+Alt+Comma": modificadores na ordem Ctrl, Alt, Shift,
// Meta e, no fim, o código da tecla (KeyboardEvent.code), que é o mesmo em
// qualquer layout de teclado.
(function (raiz) {
  const MODIFICADORES = ['Ctrl', 'Alt', 'Shift', 'Meta'];
  const TECLA = /^(Key[A-Z]|Digit\d|F([1-9]|1\d|2[0-4])|Comma|Period|Slash|Backslash|Semicolon|Quote|BracketLeft|BracketRight|Backquote|Minus|Equal|Space|Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown|Insert)$/;
  const SO_MODIFICADOR = /^(Control|Alt|Shift|Meta|AltGraph|OS)(Left|Right)?$/;

  const PADRAO = { agentes: 'Ctrl+Alt+Comma', demandas: 'Ctrl+Alt+Period' };
  // Abrir ou fechar a gaveta da pergunta rápida (/btw). Uma letra, e não ";": o código
  // da tecla ";" do teclado americano é o do "ç" no brasileiro, e a tela mostraria errado.
  const PADRAO_PERGUNTA = 'Ctrl+Alt+KeyP';
  // Abrir a busca no que a pessoa já escreveu, na caixa de mensagem (o Ctrl+R do terminal).
  // Sem um atalho do app nessa combinação, o Ctrl+R é o "recarregar a tela" de fábrica.
  const PADRAO_ESCRITOS = 'Ctrl+KeyR';
  // Guardar o que está na caixa de mensagem e trazer de volta (o Ctrl+S do terminal).
  const PADRAO_RASCUNHO = 'Ctrl+KeyS';
  // Abrir o que está na caixa de mensagem no editor de texto do sistema (o Ctrl+G do terminal).
  const PADRAO_EDITOR = 'Ctrl+KeyG';
  // Os atalhos soltos que a pessoa pode trocar ou desligar em Configurações › Atalhos, na ordem
  // da tela: nome na tela → chave na configuração e padrão. A tela (colunas-tela.js) e a
  // conferência do arquivo (config.js) leem esta mesma lista.
  const SOLTOS = {
    pergunta: { chave: 'atalhoPerguntaRapida', padrao: PADRAO_PERGUNTA },
    escritos: { chave: 'atalhoBuscaEscritos', padrao: PADRAO_ESCRITOS },
    rascunho: { chave: 'atalhoGuardarRascunho', padrao: PADRAO_RASCUNHO },
    editor: { chave: 'atalhoEditorDeTexto', padrao: PADRAO_EDITOR },
  };

  // O que já usa teclado no app (e no sistema), com o nome que a engrenagem mostra.
  const USADOS = {};
  // Escrito como se lê ("Ctrl+K"); letra e dígito viram o código da tecla.
  const codigo = (t) => (/^[A-Z]$/.test(t) ? `Key${t}` : /^\d$/.test(t) ? `Digit${t}` : t);
  const usa = (nome, ...combos) => combos.forEach((c) => { const p = c.split('+'); USADOS[[...p.slice(0, -1), codigo(p[p.length - 1])].join('+')] = nome; });
  usa('paleta de comandos', 'Ctrl+K');
  usa('chamar o bichinho', 'Ctrl+Alt+Space');
  for (let i = 1; i <= 9; i++) usa('atalho do repertório', `Ctrl+Alt+${i}`);
  usa('edição do texto', 'Ctrl+B', 'Ctrl+I', 'Ctrl+U', 'Ctrl+E', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', 'Ctrl+Shift+B', 'Ctrl+Shift+S',
    'Ctrl+Shift+H', 'Ctrl+Shift+E', 'Ctrl+Shift+7', 'Ctrl+Shift+8', 'Ctrl+Shift+9', 'Ctrl+Alt+C', 'Ctrl+Alt+0');
  usa('selecionar tudo e duplicar', 'Ctrl+A', 'Ctrl+D');
  usa('copiar e colar', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Shift+C', 'Ctrl+Shift+V');
  usa('recurso reservado do app', 'Ctrl+F', 'Ctrl+O', 'Ctrl+Shift+M', 'Ctrl+Slash', 'Ctrl+Alt+N', 'Alt+T');
  usa('o sistema', 'Ctrl+N', 'Ctrl+Q', 'Ctrl+T', 'Ctrl+W', 'Ctrl+Shift+I', 'Alt+F4', 'Ctrl+Alt+T', 'Ctrl+Alt+L', 'Ctrl+Alt+ArrowUp', 'Ctrl+Alt+ArrowDown',
    'Ctrl+Alt+ArrowLeft', 'Ctrl+Alt+ArrowRight', 'Meta+L', 'Meta+D');

  const FIXOS = { Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backquote: '`', Minus: '-', Equal: '=', Space: 'Espaço', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };

  // Combinação a partir de um keydown; null se for só um modificador.
  function deEvento(ev) {
    if (!ev || !ev.code || SO_MODIFICADOR.test(ev.code) || SO_MODIFICADOR.test(ev.key || '')) return null;
    const m = [];
    if (ev.ctrlKey) m.push('Ctrl');
    if (ev.altKey) m.push('Alt');
    if (ev.shiftKey) m.push('Shift');
    if (ev.metaKey) m.push('Meta');
    return [...m, ev.code].join('+');
  }

  const partes = (c) => (typeof c === 'string' ? c.split('+') : []);

  // Como aparece na tela: "Ctrl+Alt+,".
  function mostrar(c) {
    return partes(c).map((p, i, a) => (i < a.length - 1 ? p : FIXOS[p] || p.replace(/^Key/, '').replace(/^Digit/, ''))).join('+');
  }

  // null se serve; senão { motivo, usadoPor? }. outra = a combinação do outro atalho
  // que a pessoa pode trocar (ou a lista delas).
  function conferir(c, outra) {
    const p = partes(c);
    const tecla = p[p.length - 1];
    const mods = p.slice(0, -1);
    if (p.length === 1 && TECLA.test(tecla)) return { motivo: 'sem-modificador' };
    if (p.length < 2 || !TECLA.test(tecla) || mods.some((m) => !MODIFICADORES.includes(m)) || new Set(mods).size !== mods.length) return { motivo: 'invalida' };
    if (!mods.some((m) => m === 'Ctrl' || m === 'Alt' || m === 'Meta')) return { motivo: 'sem-modificador' };
    const canonica = [...MODIFICADORES.filter((m) => mods.includes(m)), tecla].join('+');
    if (canonica !== c) return { motivo: 'invalida' };
    if (outra && (Array.isArray(outra) ? outra.includes(c) : outra === c)) return { motivo: 'repetida' };
    if (USADOS[c]) return { motivo: 'em-uso', usadoPor: USADOS[c] };
    return null;
  }

  const api = { PADRAO, PADRAO_PERGUNTA, PADRAO_ESCRITOS, PADRAO_RASCUNHO, PADRAO_EDITOR, SOLTOS, USADOS, deEvento, mostrar, conferir };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else raiz.orqAtalhos = api;
})(typeof window !== 'undefined' ? window : globalThis);
