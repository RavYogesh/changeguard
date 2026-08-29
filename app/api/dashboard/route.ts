import { getDashboardSnapshot } from '@/db/store';

export async function GET() {
  return Response.json(await getDashboardSnapshot(), {
    headers: { 'cache-control': 'no-store' },
  });
}
