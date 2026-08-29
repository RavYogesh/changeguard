import { AlertTriangle, CheckCircle2, Clock3, GitBranch, GitFork, LayoutDashboard, Radar, ShieldCheck, Sparkles, TestTube2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { getDashboardSnapshot } from '@/db/store';
import { RunScanButton } from './run-scan-button';

export default async function Home() {
  const { summary, repositories: repos, alerts, trend } = await getDashboardSnapshot();
  return <main className="min-h-screen bg-background text-foreground">
    <div className="mx-auto grid min-h-screen max-w-[1600px] lg:grid-cols-[228px_1fr]">
      <aside className="hidden border-r border-border/70 bg-sidebar px-4 py-5 lg:flex lg:flex-col">
        <div className="flex items-center gap-3 px-2"><span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground"><ShieldCheck className="size-5" /></span><div><div className="font-semibold">ChangeGuard</div><div className="text-[11px] text-muted-foreground">Continuous test intelligence</div></div></div>
        <nav className="mt-8 space-y-1 text-sm">
          <a className="nav-item bg-primary text-primary-foreground" href="#overview"><LayoutDashboard className="size-4" /> Overview</a>
          <a className="nav-item" href="#repositories"><GitFork className="size-4" /> Repositories <span className="ml-auto text-xs">12</span></a>
          <a className="nav-item" href="#corpus"><TestTube2 className="size-4" /> Test corpus</a>
          <a className="nav-item" href="#alerts"><AlertTriangle className="size-4" /> Alerts <span className="ml-auto size-2 rounded-full bg-amber-500" /></a>
        </nav>
        <div className="mt-auto rounded-xl border bg-background/70 p-3.5"><div className="flex items-center gap-2 text-xs font-medium"><span className="size-2.5 rounded-full bg-emerald-500" /> Daily runner online</div><p className="mt-2 text-[11px] text-muted-foreground">Next scan at 02:00 UTC</p></div>
      </aside>

      <section className="min-w-0">
        <header className="flex h-[68px] items-center justify-between border-b px-5 sm:px-8"><div className="font-semibold lg:text-xs lg:text-muted-foreground"><span className="lg:hidden">ChangeGuard</span><span className="hidden lg:inline">Acme Engineering / Production</span></div><div className="flex items-center gap-3"><span className="hidden items-center gap-2 text-xs sm:flex"><CheckCircle2 className="size-3.5 text-emerald-600" /> All systems operational</span><RunScanButton /></div></header>
        <div className="px-5 py-7 sm:px-8" id="overview">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="eyebrow">Continuous quality</p><h1 className="mt-1 text-3xl font-semibold tracking-[-0.04em]">{summary.risks ? `${summary.risks} risks need attention.` : 'Your codebase is healthy.'}</h1><p className="mt-1 text-sm text-muted-foreground">Nightly scans are growing your regression shield across frontend and backend.</p></div><div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-3.5" /> Live from D1</div></div>
          <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Metric icon={Radar} label="Protection score" value={`${summary.protectionScore} / 100`} note="Coverage, corpus and open-risk weighted" /><Metric icon={TestTube2} label="Tests in corpus" value={summary.tests.toLocaleString()} note={`${summary.acceptedLastRun} accepted last run`} /><Metric icon={GitBranch} label="Repos protected" value={String(summary.repositories)} note="Frontend and backend" /><Metric icon={AlertTriangle} label="Breaking risks" value={String(summary.risks)} note={summary.risks ? 'Review evidence below' : 'No open alerts'} warn={summary.risks > 0} /></div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <Card className="border-border/70 shadow-none"><CardHeader><CardTitle>Regression shield</CardTitle><CardDescription>Accepted tests and defects caught over 12 nightly scans.</CardDescription></CardHeader><CardContent><div className="flex h-40 items-end gap-2">{trend.map((v,i)=><div key={i} className="flex h-full flex-1 items-end"><div className="w-full rounded-t bg-primary/15" style={{height:`${v}%`}}><div className="h-1.5 rounded bg-primary" /></div></div>)}</div><div className="mt-3 flex justify-between border-t pt-3 text-[11px] text-muted-foreground"><span>Aug 18</span><span>Today · +143 tests</span></div></CardContent></Card>
            <Card className="border-0 bg-ink text-white shadow-none"><CardHeader><Sparkles className="mb-2 size-5 text-lime-300" /><CardTitle className="text-white">Last run&apos;s intelligence</CardTitle><CardDescription className="text-white/60">Candidates enter the corpus only after isolated validation.</CardDescription></CardHeader><CardContent className="space-y-3"><Intel value={String(summary.acceptedLastRun)} label="tests accepted" /><Intel value={String(summary.tests)} label="tests in cumulative corpus" /><Intel value={String(summary.repositories)} label="repositories protected" /><Intel value={String(summary.risks)} label="evidence-backed risks" /></CardContent></Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <Card id="repositories" className="border-border/70 shadow-none"><CardHeader className="border-b pb-4"><CardTitle>Repository coverage</CardTitle><CardDescription>Highest activity in the current scan window.</CardDescription></CardHeader><CardContent>{repos.map(repo=>{const healthy=repo.status==='healthy'; return <div key={repo.name} className="grid gap-3 border-b py-4 last:border-0 sm:grid-cols-[1.2fr_1fr_auto] sm:items-center"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-muted"><GitFork className="size-4" /></span><div><div className="text-sm font-medium">{repo.name}</div><div className="text-[11px] text-muted-foreground">{repo.stack}</div></div></div><div><div className="mb-1 flex justify-between text-[11px]"><span className="text-muted-foreground">{Number(repo.tests).toLocaleString()} tests · +{repo.added}</span><span>{repo.coverage}%</span></div><Progress value={repo.coverage} /></div><Badge variant={healthy?'secondary':'destructive'}>{healthy?'Healthy':'Risk'}</Badge></div>})}</CardContent></Card>
            <Card id="alerts" className="border-border/70 shadow-none"><CardHeader className="border-b pb-4"><CardTitle>Needs attention</CardTitle><CardDescription>Evidence-backed risks, not raw AI guesses.</CardDescription></CardHeader><CardContent className="space-y-3 pt-4">{alerts.length ? alerts.map(alert=><div key={alert.id} className="rounded-xl border p-3"><div className="flex items-center gap-2"><Badge variant={alert.severity==='high'?'destructive':'outline'}>{alert.severity}</Badge><span className="text-[11px] text-muted-foreground">{alert.repository}</span></div><div className="mt-2 text-sm font-medium">{alert.title}</div><p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">{alert.evidence}</p></div>) : <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">No open regression risks.</div>}</CardContent></Card>
          </div>
        </div>
      </section>
    </div>
  </main>;
}

function Metric({icon:Icon,label,value,note,warn=false}:{icon:typeof Radar;label:string;value:string;note:string;warn?:boolean}) { return <Card size="sm" className="border-border/70 shadow-none"><CardContent><div className="flex justify-between text-xs text-muted-foreground"><span>{label}</span><Icon className={`size-4 ${warn?'text-amber-600':''}`} /></div><div className="mt-4 font-mono text-2xl font-semibold">{value}</div><div className={`mt-1 text-[11px] ${warn?'text-amber-700':'text-muted-foreground'}`}>{note}</div></CardContent></Card>; }
function Intel({value,label}:{value:string;label:string}) { return <div className="flex justify-between border-b border-white/10 pb-2 text-xs text-white/65 last:border-0"><span>{label}</span><b className="font-mono text-white">{value}</b></div>; }
