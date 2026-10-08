import { AppError } from './errors';

/** Trim and collapse runs of whitespace so "Box  A " and "Box A" are the same name. */
export function clean(value: unknown, maxLength = 200): string {
  if (value === undefined || value === null || typeof value === 'object') return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/** Parse a non-negative whole number typed into a form. Returns null when invalid. */
export function parseQty(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!/^\d{1,9}$/.test(text)) return null;
  return Number(text);
}

export function parseId(value: unknown): number | null {
  const n = parseQty(value);
  return n && n > 0 ? n : null;
}

export function requireId(value: unknown, what = 'record'): number {
  const id = parseId(value);
  if (!id) throw new AppError(`Invalid ${what}.`, 404);
  return id;
}

/** A text field from a submitted form (files and missing fields become ''). */
export function field(formData: FormData, name: string, maxLength = 200): string {
  const value = formData.get(name);
  return typeof value === 'string' ? clean(value, maxLength) : '';
}

/** A field that must keep its exact characters, such as a password. */
export function rawField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/** First value of a URL search parameter. */
export function param(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

const dateTimeFormat = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const dateFormat = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' });
const numberFormat = new Intl.NumberFormat('en-IN');

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dateTimeFormat.format(d);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dateFormat.format(d);
}

export const fmtNum = (n: number | null | undefined): string => numberFormat.format(Number(n) || 0);

const moneyFormat = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Paise as rupees, e.g. 125050 to "₹1,250.50". */
export const fmtMoney = (paise: number): string => `₹${moneyFormat.format(paise / 100)}`;
/** Paise as a plain number for an input box, e.g. 1250 to "12.50". Null is blank. */
export const priceInput = (paise: number | null): string => (paise === null ? '' : (paise / 100).toFixed(2));

/** Build "?a=1&b=2" from an object, skipping empty values. */
export function queryString(params: Record<string, string | number | null | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') usp.set(key, String(value));
  }
  const text = usp.toString();
  return text ? `?${text}` : '';
}

export interface Pager {
  total: number;
  pages: number;
  page: number;
  pageSize: number;
  offset: number;
}

export function paginate(total: number, page: unknown, pageSize: number): Pager {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  return { total, pages, page: current, pageSize, offset: (current - 1) * pageSize };
}

/** Escape % and _ so user text is matched literally inside a LIKE ... ESCAPE '\' pattern. */
export const likePattern = (text: string): string => `%${text.replace(/[\\%_]/g, '\\$&')}%`;
