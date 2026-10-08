'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { capitalizeFirst } from '@/lib/text';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'defaultValue'> & {
  defaultValue?: string;
};

/** A text field for a person's name. The first letter becomes a capital as it is typed. */
export function NameInput({ defaultValue = '', ...rest }: Props) {
  const [value, setValue] = useState(() => capitalizeFirst(defaultValue));
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  // Changing the text from code moves the cursor to the end; put it back where the user was typing.
  useLayoutEffect(() => {
    if (caret.current !== null && ref.current && document.activeElement === ref.current) {
      ref.current.setSelectionRange(caret.current, caret.current);
    }
    caret.current = null;
  }, [value]);

  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      autoCapitalize="words"
      value={value}
      onChange={(event) => {
        caret.current = event.target.selectionStart;
        setValue(capitalizeFirst(event.target.value));
      }}
    />
  );
}
