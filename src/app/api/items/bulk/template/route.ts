import { isSuper } from '@/lib/permissions';
import { templateCsv, templateXlsx } from '@/lib/services/bulk';
import { getUser } from '@/lib/session';

/** Download the bulk upload template as Excel (default) or CSV. */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user || !isSuper(user)) return new Response('Not allowed', { status: 403 });

  if (new URL(request.url).searchParams.get('format') === 'csv') {
    return new Response(templateCsv(), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="items-template.csv"',
      },
    });
  }
  return new Response(new Uint8Array(await templateXlsx()), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="items-template.xlsx"',
    },
  });
}
