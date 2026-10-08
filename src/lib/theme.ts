/** The cookie holding the chosen theme. The root layout reads it so the page arrives in the right colours. */
export const THEME_COOKIE = 'theme';

export type Theme = 'light' | 'dark';

export const parseTheme = (value: string | undefined): Theme | undefined =>
  value === 'light' || value === 'dark' ? value : undefined;
