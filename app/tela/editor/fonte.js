// Editor de notas no estilo Notion: blocos já formatados, "/" para inserir,
// e o arquivo continua sendo Markdown. Empacotado pelo esbuild em
// tela/editor.bundle.js (npm run editor), que expõe window.EditorNotas.
import { Editor, Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import Image from '@tiptap/extension-image';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';

const lowlight = createLowlight(common);

// Imagem da nota: no arquivo fica o caminho relativo (anexos/x.png); na tela,
// o app troca por orqnota://p<pasta>/<pasta-da-nota>/anexos/x.png.
let contexto = { pasta: 0, dir: '' };
const resolverSrc = (src) => {
  if (!src || /^(https?:|data:|orqnota:)/i.test(src)) return src;
  const rel = [contexto.dir, src].filter(Boolean).join('/').replace(/\/\.\//g, '/');
  return `orqnota://p${contexto.pasta}/${rel.split('/').map(encodeURIComponent).join('/')}`;
};
const ImagemNota = Image.extend({
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { src: resolverSrc(HTMLAttributes.src) })];
  },
}).configure({ inline: false, allowBase64: false });

// --- blocos e marcas no estilo Notion, gravados em Markdown que o Obsidian lê ---

// Cores do Notion (texto). Gravadas como <span style="color:#...">.
export const CORES = [
  ['Padrão', null], ['Cinza', '#9b9a97'], ['Marrom', '#a27763'], ['Laranja', '#d9730d'], ['Amarelo', '#cb912f'],
  ['Verde', '#448361'], ['Azul', '#337ea9'], ['Roxo', '#9065b0'], ['Rosa', '#c14c8a'], ['Vermelho', '#d44c47'],
];
const Cor = Mark.create({
  name: 'cor',
  addAttributes() { return { cor: { default: null, parseHTML: (el) => el.style.color || null } }; },
  parseHTML() { return [{ tag: 'span[style*="color"]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', { style: `color:${HTMLAttributes.cor}` }, 0]; },
  renderMarkdown: (node, h) => `<span style="color:${node.attrs?.cor}">${h.renderChildren(node)}</span>`,
  parseMarkdown: (token, h) => h.applyMark('cor', h.parseInline(token.tokens || []), { cor: token.cor }),
  markdownTokenizer: {
    name: 'cor',
    level: 'inline',
    start: (src) => src.indexOf('<span style="color'),
    tokenize(src, _t, lexer) {
      const m = /^<span style="color:\s*([#\w(),. ]+?);?">([\s\S]*?)<\/span>/.exec(src);
      if (m) return { type: 'cor', raw: m[0], cor: m[1], tokens: lexer.inlineTokens(m[2]) };
    },
  },
});

// Callout no formato do Obsidian: "> [!tipo] título" e as linhas seguintes com "> ".
const TIPOS_CALLOUT = { info: '💡', nota: '📝', aviso: '⚠️', perigo: '⛔', ok: '✅' };
const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() { return { tipo: { default: 'info', parseHTML: (el) => el.getAttribute('data-tipo') || 'info' } }; },
  parseHTML() { return [{ tag: 'div[data-callout]' }]; },
  renderHTML({ HTMLAttributes }) {
    const tipo = HTMLAttributes.tipo || 'info';
    return ['div', { 'data-callout': '', 'data-tipo': tipo, class: `callout callout-${tipo}` },
      ['span', { class: 'callout-icone', contenteditable: 'false' }, TIPOS_CALLOUT[tipo] || '💡'], ['div', { class: 'callout-corpo' }, 0]];
  },
  renderMarkdown: (node, h) => {
    const corpo = h.renderChildren(node.content || [], '\n\n');
    return `> [!${node.attrs?.tipo || 'info'}]\n` + corpo.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
  },
  parseMarkdown: (token, h) => ({ type: 'callout', attrs: { tipo: token.tipo }, content: h.parseChildren(token.tokens || []) }),
  markdownTokenizer: {
    name: 'callout',
    level: 'block',
    start: (src) => src.indexOf('> [!'),
    tokenize(src, _t, lexer) {
      const m = /^> \[!(\w+)\][^\n]*\n?((?:>[^\n]*(?:\n|$))*)/.exec(src);
      if (!m) return;
      const dentro = m[2].split('\n').map((l) => l.replace(/^> ?/, '')).join('\n').trim();
      return { type: 'callout', raw: m[0], tipo: m[1].toLowerCase(), tokens: lexer.blockTokens(dentro || ' ') };
    },
  },
  addCommands() {
    return { setCallout: (tipo = 'info') => ({ commands }) => commands.wrapIn(this.name, { tipo }) };
  },
});

// Toggle (e "título alternante") em HTML <details>, que o Obsidian também abre.
const Toggle = Details.extend({
  addAttributes() { return { ...this.parent?.(), titulo: { default: false, parseHTML: (el) => el.classList.contains('titulo') } }; },
  renderHTML({ HTMLAttributes }) {
    const { titulo, ...resto } = HTMLAttributes;
    return ['details', mergeAttributes(resto, titulo ? { class: 'titulo' } : {}), 0];
  },
  renderMarkdown: (node, h) => {
    const [resumo, conteudo] = node.content || [];
    const r = resumo ? h.renderChildren(resumo.content || []) : '';
    const c = conteudo ? h.renderChildren(conteudo.content || [], '\n\n') : '';
    return `<details${node.attrs?.titulo ? ' class="titulo"' : ''}>\n<summary>${r}</summary>\n\n${c}\n\n</details>`;
  },
  parseMarkdown: (token, h) => ({
    type: 'details',
    attrs: { titulo: token.titulo },
    content: [
      { type: 'detailsSummary', content: h.parseInline(token.resumo || []) },
      { type: 'detailsContent', content: (token.tokens && token.tokens.length) ? h.parseChildren(token.tokens) : [{ type: 'paragraph' }] },
    ],
  }),
  markdownTokenizer: {
    name: 'details',
    level: 'block',
    start: (src) => src.indexOf('<details'),
    tokenize(src, _t, lexer) {
      const m = /^<details( class="titulo")?>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>\s*/.exec(src);
      if (!m) return;
      return { type: 'details', raw: m[0], titulo: !!m[1], resumo: lexer.inlineTokens(m[2].trim()), tokens: lexer.blockTokens(m[3].trim()) };
    },
  },
});

// Itens do menu "/": nome, palavras para filtrar e o que fazem.
const BLOCOS = [
  { nome: 'Texto', dica: 'Parágrafo comum', chaves: 'texto paragrafo', faz: (c) => c.setParagraph() },
  { nome: 'Título 1', dica: 'Título grande', chaves: 'titulo h1 heading', faz: (c) => c.setHeading({ level: 1 }) },
  { nome: 'Título 2 (subtítulo)', dica: 'Título médio', chaves: 'titulo subtitulo h2 heading', faz: (c) => c.setHeading({ level: 2 }) },
  { nome: 'Título 3', dica: 'Título pequeno', chaves: 'titulo h3 heading', faz: (c) => c.setHeading({ level: 3 }) },
  { nome: 'Toggle', dica: 'Lista que abre e fecha', chaves: 'toggle alternante recolher details', faz: (c) => c.setDetails() },
  { nome: 'Título alternante', dica: 'Título que abre e fecha', chaves: 'titulo alternante toggle heading', faz: (c) => c.setDetails().updateAttributes('details', { titulo: true }) },
  { nome: 'Callout', dica: 'Caixa de destaque com ícone 💡', chaves: 'callout destaque caixa aviso', faz: (c) => c.setCallout('info') },
  { nome: 'Callout de aviso', dica: 'Caixa amarela ⚠️', chaves: 'callout aviso alerta', faz: (c) => c.setCallout('aviso') },
  { nome: 'Callout de perigo', dica: 'Caixa vermelha ⛔', chaves: 'callout perigo erro', faz: (c) => c.setCallout('perigo') },
  { nome: 'Callout de ok', dica: 'Caixa verde ✅', chaves: 'callout ok sucesso feito', faz: (c) => c.setCallout('ok') },
  { nome: 'Lista', dica: 'Lista com marcadores', chaves: 'lista bullet marcadores', faz: (c) => c.toggleBulletList() },
  { nome: 'Lista numerada', dica: '1, 2, 3…', chaves: 'lista numerada ordered', faz: (c) => c.toggleOrderedList() },
  { nome: 'Tarefas', dica: 'Lista com caixinhas', chaves: 'tarefas todo checklist caixa', faz: (c) => c.toggleTaskList() },
  { nome: 'Citação', dica: 'Bloco de citação', chaves: 'citacao quote', faz: (c) => c.toggleBlockquote() },
  { nome: 'Código', dica: 'Bloco de código', chaves: 'codigo code', faz: (c) => c.toggleCodeBlock() },
  { nome: 'Tabela', dica: 'Tabela 3 × 3', chaves: 'tabela table', faz: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
  { nome: 'Divisor', dica: 'Linha horizontal', chaves: 'divisor linha hr', faz: (c) => c.setHorizontalRule() },
];

for (const [nome, cor] of CORES.slice(1)) {
  BLOCOS.push({ nome: `Cor: ${nome}`, dica: 'Pinta o texto do bloco', chaves: `cor ${nome.toLowerCase()}`, cor,
    faz: (c) => c.command(({ tr, state }) => {
      const { $from } = state.selection;
      tr.addMark($from.start(), $from.end(), state.schema.marks.cor.create({ cor }));
      return true;
    }) });
}

const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Menu "/": aparece quando o parágrafo atual começa com "/" e só tem isso.
function menuBarra(raiz) {
  const menu = document.createElement('ul');
  menu.className = 'menu-barra';
  menu.hidden = true;
  raiz.append(menu);
  let itens = [], escolhido = 0, faixa = null, editorAtual = null;

  function fechar() { menu.hidden = true; faixa = null; }
  function aplicar(i) {
    const b = itens[i];
    if (!b || !faixa) return;
    const c = editorAtual.chain().focus().deleteRange(faixa);
    b.faz(c).run();
    fechar();
  }
  function atualizar(editor) {
    editorAtual = editor;
    const { $from, empty } = editor.state.selection;
    const texto = $from.parent.textContent;
    const m = empty && $from.parent.type.name === 'paragraph' && texto.match(/^\/([\p{L}\d ]{0,20})$/u);
    if (!m || $from.parentOffset !== texto.length) return fechar();
    const busca = semAcento(m[1]);
    itens = BLOCOS.filter((b) => !busca || semAcento(b.nome).includes(busca) || b.chaves.includes(busca));
    if (!itens.length) return fechar();
    escolhido = Math.min(escolhido, itens.length - 1);
    faixa = { from: $from.start(), to: $from.pos };
    menu.innerHTML = itens.map((b, i) => `<li data-i="${i}" aria-selected="${i === escolhido}"><strong>${b.nome}</strong><span>${b.dica}</span></li>`).join('');
    const pos = editor.view.coordsAtPos($from.pos);
    const base = raiz.getBoundingClientRect();
    menu.style.left = `${pos.left - base.left}px`;
    menu.style.top = `${pos.bottom - base.top + raiz.scrollTop + 6}px`;
    menu.hidden = false;
  }
  menu.addEventListener('mousedown', (ev) => {
    const li = ev.target.closest('li');
    if (li) { ev.preventDefault(); aplicar(Number(li.dataset.i)); }
  });
  return {
    atualizar,
    fechar,
    // Teclas enquanto o menu está aberto; true = o menu tratou.
    tecla(ev) {
      if (menu.hidden) return false;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        escolhido = (escolhido + (ev.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length;
        atualizar(editorAtual);
        return true;
      }
      if (ev.key === 'Enter' || ev.key === 'Tab') { aplicar(escolhido); return true; }
      if (ev.key === 'Escape') { fechar(); return true; }
      return false;
    },
  };
}

// Barra flutuante ao selecionar texto, como no Notion: negrito, itálico,
// riscado, código, destaque e cor.
function barraSelecao(raiz) {
  const barra = document.createElement('div');
  barra.className = 'barra-selecao';
  barra.hidden = true;
  barra.innerHTML = `
    <button type="button" data-f="bold" title="Negrito (Ctrl+B)"><b>B</b></button>
    <button type="button" data-f="italic" title="Itálico (Ctrl+I)"><i>I</i></button>
    <button type="button" data-f="strike" title="Riscado"><s>S</s></button>
    <button type="button" data-f="code" title="Código"><code>&lt;/&gt;</code></button>
    <button type="button" data-f="highlight" title="Destaque"><span class="marca-destaque">A</span></button>
    <span class="sep"></span>
    ${CORES.map(([nome, cor]) => `<button type="button" class="ponto-cor" data-cor="${cor || ''}" title="${nome}" style="--c:${cor || 'var(--fg)'}">A</button>`).join('')}`;
  raiz.append(barra);
  let ed = null;
  barra.addEventListener('mousedown', (ev) => {
    const b = ev.target.closest('button');
    if (!b || !ed) return;
    ev.preventDefault();
    const c = ed.chain().focus();
    if (b.dataset.f) c.toggleMark(b.dataset.f).run();
    else if (b.dataset.cor) c.setMark('cor', { cor: b.dataset.cor }).run();
    else c.unsetMark('cor').run();
    mostrar(ed);
  });
  function mostrar(editor) {
    ed = editor;
    const { from, to, empty } = editor.state.selection;
    if (empty || !editor.isFocused || !editor.isEditable) { barra.hidden = true; return; }
    const a = editor.view.coordsAtPos(from), b = editor.view.coordsAtPos(to);
    const base = raiz.getBoundingClientRect();
    barra.hidden = false;
    for (const btn of barra.querySelectorAll('[data-f]')) btn.classList.toggle('ligado', editor.isActive(btn.dataset.f));
    const x = Math.max(8, Math.min((a.left + b.left) / 2 - base.left - barra.offsetWidth / 2, raiz.clientWidth - barra.offsetWidth - 8));
    barra.style.left = `${x}px`;
    barra.style.top = `${a.top - base.top + raiz.scrollTop - barra.offsetHeight - 8}px`;
  }
  return { mostrar, esconder: () => { barra.hidden = true; } };
}

function criar({ el, aoMudar, aoSalvarJa, aoImagem }) {
  const menu = menuBarra(el.parentElement);
  const selecao = barraSelecao(el.parentElement);
  const Atalhos = Extension.create({
    name: 'atalhosNotas',
    addKeyboardShortcuts() {
      return { 'Mod-s': () => { if (aoSalvarJa) aoSalvarJa(); return true; } };
    },
  });
  let carregando = false;
  const editor = new Editor({
    element: el,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, codeBlock: false }),
      CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
      ImagemNota,
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit,
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'heading' ? 'Título' : 'Escreva, ou digite / para inserir um bloco…') }),
      Highlight,
      Cor,
      Callout,
      Toggle,
      DetailsSummary,
      DetailsContent,
      Markdown,
      Atalhos,
    ],
    editorProps: {
      // Imagem colada ou arrastada: o app salva em anexos/ e insere o caminho.
      handlePaste: (_v, ev) => {
        const imgs = [...(ev.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
        if (!imgs.length || !aoImagem) return false;
        imgs.forEach((f) => inserirImagem(f));
        return true;
      },
      handleDrop: (_v, ev) => {
        const imgs = [...(ev.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
        if (!imgs.length || !aoImagem) return false;
        imgs.forEach((f) => inserirImagem(f));
        return true;
      },
      handleKeyDown: (_v, ev) => {
        if (menu.tecla(ev)) { ev.preventDefault(); return true; }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => { menu.atualizar(e); if (!carregando && aoMudar) aoMudar(); },
    onSelectionUpdate: ({ editor: e }) => { menu.atualizar(e); selecao.mostrar(e); },
    onBlur: () => setTimeout(() => { menu.fechar(); selecao.esconder(); }, 150),
  });
  async function inserirImagem(arquivo) {
    const src = await aoImagem(arquivo);
    if (src) editor.chain().focus().setImage({ src, alt: arquivo.name || 'imagem' }).run();
  }

  // Modo Markdown: troca a folha formatada pelo texto puro do arquivo.
  let modoMd = null;
  function alternarMarkdown() {
    if (!modoMd) {
      modoMd = document.createElement('textarea');
      modoMd.className = 'editor-md-puro';
      modoMd.spellcheck = false;
      modoMd.value = editor.getMarkdown();
      modoMd.addEventListener('input', () => { if (aoMudar) aoMudar(); });
      el.after(modoMd);
      el.hidden = true;
      modoMd.focus();
      return true;
    }
    carregando = true;
    editor.commands.setContent(modoMd.value, { contentType: 'markdown', emitUpdate: false });
    carregando = false;
    modoMd.remove(); modoMd = null;
    el.hidden = false;
    return false;
  }

  // Comandos da barra fixa (o mesmo que o Notion e o Maestri têm em cima da nota).
  const comandos = {
    negrito: () => editor.chain().focus().toggleBold().run(),
    italico: () => editor.chain().focus().toggleItalic().run(),
    riscado: () => editor.chain().focus().toggleStrike().run(),
    codigo: () => editor.chain().focus().toggleCode().run(),
    destaque: () => editor.chain().focus().toggleHighlight().run(),
    titulo: () => {
      // Texto → Título 1 → Título 2 → Título 3 → texto.
      const n = [1, 2, 3].find((l) => editor.isActive('heading', { level: l }));
      if (!n) return editor.chain().focus().setHeading({ level: 1 }).run();
      if (n === 3) return editor.chain().focus().setParagraph().run();
      return editor.chain().focus().setHeading({ level: n + 1 }).run();
    },
    tarefas: () => editor.chain().focus().toggleTaskList().run(),
    lista: () => editor.chain().focus().toggleBulletList().run(),
    numerada: () => editor.chain().focus().toggleOrderedList().run(),
    blocoCodigo: () => editor.chain().focus().toggleCodeBlock().run(),
    citacao: () => editor.chain().focus().toggleBlockquote().run(),
    callout: () => editor.chain().focus().setCallout('info').run(),
    toggle: () => editor.chain().focus().setDetails().run(),
    tabela: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    divisor: () => editor.chain().focus().setHorizontalRule().run(),
    // Link: o endereço vem do campo da própria barra (sem diálogo do navegador).
    linkAtual: () => editor.getAttributes('link').href || '',
    link: (url) => (url ? editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run() : editor.chain().focus().extendMarkRange('link').unsetLink().run()),
    desfazer: () => editor.chain().focus().undo().run(),
    refazer: () => editor.chain().focus().redo().run(),
    imagem: (arquivo) => inserirImagem(arquivo),
    markdown: alternarMarkdown,
  };
  const ativos = () => ({
    negrito: editor.isActive('bold'), italico: editor.isActive('italic'), riscado: editor.isActive('strike'),
    codigo: editor.isActive('code'), destaque: editor.isActive('highlight'), titulo: editor.isActive('heading'),
    tarefas: editor.isActive('taskList'), lista: editor.isActive('bulletList'), numerada: editor.isActive('orderedList'),
    blocoCodigo: editor.isActive('codeBlock'), citacao: editor.isActive('blockquote'), markdown: !!modoMd,
  });

  return {
    comandos,
    ativos,
    aoMudarSelecao: (fn) => editor.on('selectionUpdate', fn) && editor.on('update', fn),
    contexto: (pasta, dir) => { contexto = { pasta, dir: dir || '' }; },
    definir(md) {
      if (modoMd) { modoMd.remove(); modoMd = null; el.hidden = false; }
      carregando = true;
      editor.commands.setContent(md || '', { contentType: 'markdown', emitUpdate: false });
      carregando = false;
    },
    markdown: () => (modoMd ? modoMd.value : editor.getMarkdown()),
    focar: () => editor.commands.focus('end'),
    editavel: (sim) => editor.setEditable(sim),
    destruir: () => editor.destroy(),
  };
}

window.EditorNotas = { criar };
