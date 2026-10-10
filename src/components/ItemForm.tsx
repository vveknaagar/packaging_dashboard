import Link from 'next/link';
import { saveItemAction } from '@/app/actions/items';
import type { ItemRow } from '@/lib/types';
import { ActionForm, SubmitButton } from './ActionForm';
import { ImageInput } from './ImageInput';

/** Add or edit one item. Image, Name and Size are required. */
export function ItemForm({ item, units }: { item?: ItemRow; units: string[] }) {
  return (
    <ActionForm action={saveItemAction} className="card stack">
      {item && <input type="hidden" name="id" value={item.id} />}
      <div className="field">
        <span>Image{item ? ' (choose a file only to replace it)' : ' (required)'}</span>
        <ImageInput name="image" required={!item} currentSrc={item?.image ? `/uploads/${item.image}` : undefined} />
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Name (required)</span>
          <input name="name" type="text" required maxLength={120} defaultValue={item?.name} placeholder="Kraft Box" />
        </label>
        <label className="field">
          <span>Size (required)</span>
          <input name="size" type="text" required maxLength={80} defaultValue={item?.size} placeholder="Small 6 x 4 x 2 in" />
        </label>
        <label className="field">
          <span>Unit</span>
          <input name="unit" type="text" maxLength={30} defaultValue={item?.unit} list="item-units" placeholder="pcs, roll, kg" />
          <datalist id="item-units">{units.map((u) => <option key={u} value={u} />)}</datalist>
        </label>
      </div>
      <p className="hint">Name and Size together must be unique.</p>
      <div className="form-actions">
        <Link href="/items" className="btn btn-ghost">Cancel</Link>
        <SubmitButton pendingLabel="Saving…">{item ? 'Save changes' : 'Add item'}</SubmitButton>
      </div>
    </ActionForm>
  );
}
