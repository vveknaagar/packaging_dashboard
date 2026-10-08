/** Make the first letter of a name a capital: "sanny rudani" becomes "Sanny rudani". */
export function capitalizeFirst(text: string): string {
  return text.replace(/^(\s*)(\p{L})/u, (_match, space: string, letter: string) => space + letter.toLocaleUpperCase());
}
