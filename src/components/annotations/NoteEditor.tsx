import { useState } from 'react';
import styles from './NoteEditor.module.css';

interface Props {
  value: string;
  onChange: (note: string) => void;
}

export function NoteEditor({ value, onChange }: Props) {
  const [text, setText] = useState(value);

  const handleBlur = () => {
    if (text !== value) onChange(text);
  };

  return (
    <div className={styles.editor}>
      <textarea
        className={styles.textarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={handleBlur}
        placeholder="Add a note..."
      />
    </div>
  );
}
