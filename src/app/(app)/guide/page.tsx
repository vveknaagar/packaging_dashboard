import type { Metadata } from 'next';
import Link from 'next/link';
import { StartTourButton } from '@/components/Tour';
import { PageHead } from '@/components/ui';
import { guideFor } from '@/lib/guide';
import { ROLE_LABELS } from '@/lib/permissions';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'User guide' };

/** Step-by-step help for everything this user's role can do. */
export default async function GuidePage() {
  const user = await requireUser();
  const sections = guideFor(user.role);

  return (
    <>
      <PageHead
        title="User guide"
        sub={<>How to use Mayave Item Transfer as a {ROLE_LABELS[user.role]}{user.location_name ? ` at ${user.location_name}` : ''}.</>}
      >
        <StartTourButton />
      </PageHead>

      <nav className="card" aria-label="Contents">
        <ul className="guide-toc">
          {sections.map((s) => <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>)}
        </ul>
      </nav>

      {sections.map((s) => (
        <section key={s.id} id={s.id} className="card guide-section">
          <h2>{s.title}</h2>
          <p className="summary">{s.summary}</p>
          <ol>
            {s.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          {s.tips?.map((tip) => <p key={tip} className="guide-tip"><strong>Tip:</strong> {tip}</p>)}
          {s.href && s.href !== '/guide' && (
            <p className="hint"><Link href={s.href}>Open {s.title.replace(/ \(.*\)$/, '')} →</Link></p>
          )}
        </section>
      ))}

      <p className="hint">Need something else? Ask your Super Admin.</p>
    </>
  );
}
