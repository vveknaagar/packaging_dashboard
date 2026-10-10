import { all, get, insert, now, run } from '../db';
import { AppError, ForbiddenError, NotFoundError } from '../errors';
import { isSuper } from '../permissions';
import type { LogisticsPartnerRow, SessionUser } from '../types';
import { clean } from '../util';
import { cleanPhone } from './users';

export interface PartnerInput {
  name: unknown;
  contact: unknown;
  phone: unknown;
}

function assertSuper(user: SessionUser) {
  if (!isSuper(user)) throw new ForbiddenError('Only the Super Admin can manage logistic partners.');
}

export const listPartners = (activeOnly = false) => all<LogisticsPartnerRow>(
  `SELECT * FROM logistics_partners ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY active DESC, name`);

export const getPartner = (id: number) => get<LogisticsPartnerRow>('SELECT * FROM logistics_partners WHERE id = ?', id);

/** Add a partner, or update one when an id is given. Names are unique, ignoring capitals. */
export async function savePartner(actor: SessionUser, id: number | null, input: PartnerInput): Promise<number> {
  assertSuper(actor);
  const name = clean(input.name, 80);
  if (!name) throw new AppError('Name is required.');
  const contact = clean(input.contact, 80);
  const phone = cleanPhone(input.phone);
  if (await get('SELECT 1 FROM logistics_partners WHERE name = ? AND id <> ?', name, id ?? 0)) {
    throw new AppError(`A logistic partner called "${name}" already exists.`);
  }
  if (id) {
    if (!await getPartner(id)) throw new NotFoundError('Logistic partner not found.');
    await run('UPDATE logistics_partners SET name = ?, contact = ?, phone = ? WHERE id = ?', name, contact, phone, id);
    return id;
  }
  return insert('INSERT INTO logistics_partners (name, contact, phone, created_at) VALUES (?, ?, ?, ?)', name, contact, phone, now());
}

/** Partners are deactivated rather than deleted, so old transfers keep showing who carried them. */
export async function setPartnerStatus(actor: SessionUser, id: number, active: boolean): Promise<void> {
  assertSuper(actor);
  const { changes } = await run('UPDATE logistics_partners SET active = ? WHERE id = ?', active ? 1 : 0, id);
  if (!changes) throw new NotFoundError('Logistic partner not found.');
}

/** The partner chosen on a transfer form: none, or an active one from the list. */
export async function partnerForTransfer(value: unknown): Promise<number | null> {
  const id = Number(value);
  if (value === undefined || value === null || value === '' || value === 0) return null;
  const partner = Number.isInteger(id) && id > 0 ? await getPartner(id) : undefined;
  if (!partner?.active) throw new AppError('Choose a logistic partner from the list.');
  return partner.id;
}
