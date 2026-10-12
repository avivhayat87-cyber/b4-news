'use client';
// The writing canvas: TipTap limited to exactly what the site renders
// (paragraphs, sub-headings, quotes, lists, bold, italic, links).
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef, type ReactNode } from 'react';
import { cx } from '../ui';

type Props = {
  doc: unknown;
  /** Changes when the server sends a new version (e.g. after an AI edit): the canvas reloads. */
  contentKey: string | number;
  editable: boolean;
  onChange(doc: unknown): void;
  onSelection?(text: string): void;
};

function ToolButton({ active, label, onClick, children, disabled }: { active?: boolean; label: string; onClick(): void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx('flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-bold transition-colors disabled:opacity-40', active ? 'bg-ink text-white' : 'text-ink-2 hover:bg-stone')}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      quote: e.isActive('blockquote'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      link: e.isActive('link'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const run = (fn: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => fn(editor.chain().focus()).run();

  function link() {
    if (state.link) return run((c) => c.unsetLink());
    const href = window.prompt('כתובת הקישור (https://… או /article/…)');
    if (!href) return;
    const ok = /^https?:\/\//i.test(href) || (href.startsWith('/') && !href.startsWith('//'));
    if (!ok) return window.alert('אפשר לקשר רק לכתובות http/https או לעמודים באתר.');
    run((c) => c.extendMarkRange('link').setLink({ href }));
  }

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-line-soft bg-white/95 px-3 py-1.5 backdrop-blur" role="toolbar" aria-label="עיצוב טקסט">
      <ToolButton label="מודגש" active={state.bold} disabled={disabled} onClick={() => run((c) => c.toggleBold())}>
        B
      </ToolButton>
      <ToolButton label="נטוי" active={state.italic} disabled={disabled} onClick={() => run((c) => c.toggleItalic())}>
        <i>I</i>
      </ToolButton>
      <span className="mx-1 h-5 w-px bg-line" />
      <ToolButton label="כותרת ביניים" active={state.h2} disabled={disabled} onClick={() => run((c) => c.toggleHeading({ level: 2 }))}>
        H2
      </ToolButton>
      <ToolButton label="כותרת משנה" active={state.h3} disabled={disabled} onClick={() => run((c) => c.toggleHeading({ level: 3 }))}>
        H3
      </ToolButton>
      <ToolButton label="ציטוט" active={state.quote} disabled={disabled} onClick={() => run((c) => c.toggleBlockquote())}>
        ”
      </ToolButton>
      <ToolButton label="רשימה" active={state.bullet} disabled={disabled} onClick={() => run((c) => c.toggleBulletList())}>
        •
      </ToolButton>
      <ToolButton label="רשימה ממוספרת" active={state.ordered} disabled={disabled} onClick={() => run((c) => c.toggleOrderedList())}>
        1.
      </ToolButton>
      <ToolButton label={state.link ? 'הסרת קישור' : 'קישור'} active={state.link} disabled={disabled} onClick={link}>
        🔗
      </ToolButton>
      <span className="mx-1 h-5 w-px bg-line" />
      <ToolButton label="ביטול" disabled={disabled || !state.canUndo} onClick={() => run((c) => c.undo())}>
        ↶
      </ToolButton>
      <ToolButton label="חזרה" disabled={disabled || !state.canRedo} onClick={() => run((c) => c.redo())}>
        ↷
      </ToolButton>
    </div>
  );
}

export function Canvas({ doc, contentKey, editable, onChange, onSelection }: Props) {
  const onChangeRef = useRef(onChange);
  const onSelectionRef = useRef(onSelection);
  onChangeRef.current = onChange;
  onSelectionRef.current = onSelection;

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        link: { openOnClick: false, autolink: true, protocols: ['http', 'https'], HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } },
      }),
      Placeholder.configure({ placeholder: 'כאן נכתבת הכתבה…' }),
    ],
    content: doc as object,
    editorProps: { attributes: { class: 'tiptap reading px-6 py-5', dir: 'rtl', 'aria-label': 'גוף הכתבה', role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: ({ editor: e }) => onChangeRef.current(e.getJSON()),
    onSelectionUpdate: ({ editor: e }) => {
      const { from, to } = e.state.selection;
      onSelectionRef.current?.(from === to ? '' : e.state.doc.textBetween(from, to, ' ').trim());
    },
  });

  // A new server version (AI rewrite/refine, restore) replaces the content.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.commands.setContent(doc as object, { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the version changes
  }, [editor, contentKey]);

  useEffect(() => {
    // false: toggling editability must not look like an edit (no autosave).
    editor?.setEditable(editable, false);
  }, [editor, editable]);

  if (!editor) return <div className="min-h-96" />;
  return (
    <div className={cx('relative', !editable && 'bg-canvas')}>
      <Toolbar editor={editor} disabled={!editable} />
      <EditorContent editor={editor} />
    </div>
  );
}
