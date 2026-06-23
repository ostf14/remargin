import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import styles from './NoteEditor.module.css';

interface Props {
  value: string;
  onChange: (note: string) => void;
}

export function NoteEditor({ value, onChange }: Props) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Resize the textarea to fit its content: reset to auto so scrollHeight reflects
  // the actual rendered height, then pin to that. Runs on every text change and
  // once on mount via useLayoutEffect so the initial value sizes correctly before
  // the user sees a frame at the default 60px min-height.
  const autoSize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useLayoutEffect(autoSize, []);
  useEffect(autoSize, [text]);

  const handleBlur = () => {
    if (text !== value) onChange(text);
  };

  return (
    <div className={styles.editor}>
      <textarea
        ref={ref}
        className={styles.textarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={handleBlur}
        placeholder="Add a note..."
      />
    </div>
  );
}
