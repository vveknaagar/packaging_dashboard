'use client';

import { useState } from 'react';
import type { ActionResult } from '@/lib/types';
import { ActionForm, SubmitButton } from './ActionForm';
import { Modal } from './Modal';

interface Props {
  action: (formData: FormData) => Promise<ActionResult | void>;
  /** Sent to the action as the "id" field. */
  id: number;
  buttonLabel: string;
  buttonClass?: string;
  title: string;
  description: string;
  reasonRequired?: boolean;
  submitLabel: string;
}

/** A button that asks for a reason in a dialog before running an action (reject, cancel). */
export function ReasonDialogButton({
  action, id, buttonLabel, buttonClass = 'btn btn-danger', title, description, reasonRequired = true, submitLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={buttonClass} onClick={() => setOpen(true)}>{buttonLabel}</button>
      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <p className="sub">{description}</p>
        <ActionForm action={action} onSuccess={() => setOpen(false)} className="stack">
          <input type="hidden" name="id" value={id} />
          <label className="field">
            <span>{reasonRequired ? 'Reason' : 'Reason (optional)'}</span>
            <textarea name="reason" rows={3} maxLength={500} required={reasonRequired} autoFocus />
          </label>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Keep transfer</button>
            <SubmitButton className="btn btn-danger" pendingLabel="Working…">{submitLabel}</SubmitButton>
          </div>
        </ActionForm>
      </Modal>
    </>
  );
}
