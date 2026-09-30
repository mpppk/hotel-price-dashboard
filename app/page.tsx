"use client";

import { useEffect, useMemo, useState } from "react";

const HOTEL = "ritz-carlton-nikko";
const PROFILE = "standard-2a-1r-1n";
const SOURCE = "https://www.ikyu.com/00002777/";
const YEN = new Intl.NumberFormat("ja-JP", {
  style: "currency", currency: "JPY", maximumFractionDigits: 0,
});
const money = (n: number | null | undefined) => n == null ? "—" : YEN.format(n);
const compact = (n: number) => n >= 100_000 ? (n / 10_000).toFixed(1) + "万" : Math.round(n / 1000) + "k";
const parseDay = (date: string) => new Date(date + "T00:00:00+09:00");
const labelDay = (date: string) => parseDay(date).toLocaleDateString("ja-JP", {
  year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Tokyo",
});
const labelTime = (date: string) => new Date(date).toLocaleString("ja-JP", {
  timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
});
function jstToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const o = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return [o.year, o.month, o.day].join("-");
}
function plusMonths(iso: string, count: number) {
  const [y,m,d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + count + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y,m-1+count,Math.min(d,last))).toISOString().slice(0,10);
}
type Day = {
  stayDate: string; available: boolean; price: number | null; observedAt: string;
  roomName?: string | null; planName?: string | null; previousPrice?: number | null;
  historicalMinimum?: number | null; historicalMaximum?: number | null;
};
type Summary = {
  currentMinimum: number | null; currentMinimumStayDate: string | null;
  availableDays: number; coveredDays: number; lastObservedAt: string | null;
};
type Observation = {
  observedAt: string; price: number | null; available: boolean;
  roomName?: string | null; planName?: string | null;
};
type History = { stayDate: string; observations: Observation[] };

async function load<T>(path: string, signal: AbortSignal): Promise<T> {
  const r = await fetch(path, { signal, cache: "no-store" });
  if (!r.ok) {
    const body = await r.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body?.error?.message || "APIエラー " + r.status);
  }
  return r.json() as Promise<T>;
}
function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const x = (sorted.length - 1) * p;
  const floor = Math.floor(x);
  return sorted[floor] + (sorted[Math.ceil(x)] - sorted[floor]) * (x - floor);
}
function priceBackground(price: number, min: number, max: number) {
  const ratio = Math.min(1, Math.max(0, (price - min) / Math.max(1,max-min)));
  return {
    background: "hsla(" + Math.round(151 - 145 * ratio) + ",58%,65%,.23)",
    borderColor: "hsla(" + Math.round(151 - 145 * ratio) + ",43%,54%,.46)",
  };
}
function Stat({ title, value, hint, emphasis = false }: {
  title: string; value: string; hint?: string; emphasis?: boolean;
}) {
  return <div className={"stat" + (emphasis ? " emphasis" : "")}>
    <span className="stat-title">{title}</span><strong>{value}</strong>
    <span className="stat-hint">{hint || "\u00a0"}</span>
  </div>;
}
function Month({
  year, month, dates, selected, select, low, high,
}: {
  year: number; month: number; dates: Map<string,Day>; selected: string | null;
  select: (date: string) => void; low: number; high: number;
}) {
  const offset = new Date(Date.UTC(year,month-1,1)).getUTCDay();
  const length = new Date(Date.UTC(year,month,0)).getUTCDate();
  const squares = Array.from({length:offset+length}, (_,i) => {
    const day = i - offset + 1;
    if (day <= 0) return <div key={"blank"+i} className="blank" />;
    const key = [year,String(month).padStart(2,"0"),String(day).padStart(2,"0")].join("-");
    const item = dates.get(key);
    const hasPrice = item?.available && item.price != null;
    const change = hasPrice && item.previousPrice != null ? item.price! - item.previousPrice : null;
    return <button key={key} type="button" disabled={!item}
      aria-pressed={selected === key}
      aria-label={key + (hasPrice ? " " + money(item.price) : item ? " 販売なし" : " データなし")}
      className={"day" + (selected === key ? " selected" : "") + (!item ? " no-data" : "") + (item && !hasPrice ? " unavailable" : "")}
      style={hasPrice ? priceBackground(item.price!, low, high) : undefined}
      onClick={() => select(key)}>
      <span className="day-date">{day}</span>
      <span className="day-price">{hasPrice ? compact(item.price!) : item ? "満室" : "·"}</span>
      <span className={"day-change" + (change != null && change < 0 ? " down" : "")}>
        {change == null || change === 0 ? "\u00a0" : (change < 0 ? "▼" : "▲") + compact(Math.abs(change))}
      </span>
    </button>;
  });
  return <article className="month"><header><span>{year}年</span><h3>{month}月</h3></header>
    <div className="weekday">{["日","月","火","水","木","金","土"].map(w => <span key={w}>{w}</span>)}</div>
    <div className="days">{squares}</div>
  </article>;
}
function HistoryChart({history}: {history:History|null}) {
  if (!history) return <div className="placeholder">カレンダーから宿泊日を選択すると、価格の観測履歴を表示します。</div>;
  const points = history.observations.filter(o => o.available && o.price != null);
  if (!points.length) return <div className="placeholder">この宿泊日の販売価格履歴はまだありません。</div>;
  const w = 950, h = 270, left = 77, right = 24, top = 28, bottom = 40;
  const min = Math.min(...points.map(o => o.price!));
  const max = Math.max(...points.map(o => o.price!));
  const padding = Math.max(2500,(max-min) * 0.17);
  const yMin = Math.max(0,min-padding), yMax = max+padding;
  const time = history.observations.map(o => new Date(o.observedAt).getTime());
  const tMin = Math.min(...time), tMax = Math.max(...time);
  const x = (t:number) => left + (tMax === tMin ? (w-left-right)/2 : (t-tMin)/(tMax-tMin)*(w-left-right));
  const y = (n:number) => top + (yMax-n)/(yMax-yMin)*(h-top-bottom);
  const segments: string[][] = [];
  let active: string[] = [];
  history.observations.forEach(o => {
    if (o.available && o.price != null) {
      active.push(x(new Date(o.observedAt).getTime())+","+y(o.price));
    } else if (active.length) { segments.push(active); active=[]; }
  });
  if (active.length) segments.push(active);
  const last = points.at(-1)!;
  return <div className="chart"><div className="chart-subhead">
    <span>現在 <b>{money(last.price)}</b></span>
    <span>過去最安 <b>{money(min)}</b></span>
    <span>過去最高 <b>{money(max)}</b></span>
    <span>{history.observations.length}回観測</span>
  </div><svg className="chart-svg" viewBox={"0 0 "+w+" "+h} role="img" aria-label="宿泊日の観測価格推移">
    {Array.from({length:5},(_,i) => {
      const price = yMin+(yMax-yMin)*i/4;
      return <g key={i}><line className="gridline" x1={left} x2={w-right} y1={y(price)} y2={y(price)}/>
        <text className="chart-text" x={left-11} y={y(price)+4} textAnchor="end">{Math.round(price/1000)}k</text>
      </g>;
    })}
    {segments.map((s,i) => s.length > 1 ?
      <polyline key={i} className="trend" points={s.join(" ")} /> : null)}
    {points.map((o,i) => <circle key={i} className="trend-dot"
      cx={x(new Date(o.observedAt).getTime())} cy={y(o.price!)} r={4}>
      <title>{labelTime(o.observedAt)}　{money(o.price)}</title>
    </circle>)}
    <text className="chart-text" x={left} y={h-6}>{labelTime(history.observations[0].observedAt)}</text>
    <text className="chart-text" x={w-right} y={h-6} textAnchor="end">{labelTime(history.observations.at(-1)!.observedAt)}</text>
  </svg><p className="chart-caption">点を重ねると観測日時と価格を確認できます。販売なしの観測は線をつなぎません。</p></div>;
}

export default function Page() {
  const [summary,setSummary] = useState<Summary|null>(null);
  const [dates,setDates] = useState<Day[]>([]);
  const [selected,setSelected] = useState<string|null>(null);
  const [history,setHistory] = useState<History|null>(null);
  const [loading,setLoading] = useState(true);
  const [loadingHistory,setLoadingHistory] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const [historyError,setHistoryError] = useState<string|null>(null);
  const [bounds,setBounds] = useState({from:"",to:""});
  useEffect(() => {
    const controller = new AbortController();
    const from = jstToday(), to = plusMonths(from,12);
    setBounds({from,to});
    const base = "/api/v1/hotels/"+HOTEL;
    Promise.all([
      load<Summary>(base+"/summary?pricingProfileId="+PROFILE,controller.signal),
      load<{days:Day[]}>(base+"/calendar?from="+from+"&to="+to+"&pricingProfileId="+PROFILE,controller.signal),
    ]).then(([s,c]) => {
      setSummary(s); setDates(c.days);
      setSelected(s.currentMinimumStayDate || c.days.find(d => d.available)?.stayDate || c.days[0]?.stayDate || null);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!selected) { setHistory(null); return; }
    const controller = new AbortController();
    setLoadingHistory(true); setHistoryError(null);
    load<History>("/api/v1/hotels/"+HOTEL+"/history?stayDate="+selected+"&pricingProfileId="+PROFILE,controller.signal)
      .then(setHistory)
      .catch(e => { if (!controller.signal.aborted) setHistoryError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoadingHistory(false); });
    return () => controller.abort();
  }, [selected]);
  const byDate = useMemo(() => new Map(dates.map(d => [d.stayDate,d])),[dates]);
  const selectedDay = selected ? byDate.get(selected) : undefined;
  const values = useMemo(() => dates.filter(d => d.available && d.price != null).map(d => d.price!).sort((a,b)=>a-b),[dates]);
  const low = percentile(values,.05), high = percentile(values,.95);
  const months = useMemo(() => {
    if (!bounds.from) return [] as {year:number,month:number}[];
    const [fy,fm] = bounds.from.split("-").map(Number), [ty,tm] = bounds.to.split("-").map(Number);
    const result=[];
    for (let y=fy,m=fm; y < ty || y===ty && m<=tm; m++) {
      if (m>12) {y++;m=1;}
      if (y > ty || y===ty && m>tm) break;
      result.push({year:y,month:m});
    }
    return result;
  },[bounds]);
  const monthLows = useMemo(() => {
    const map = new Map<string,Day>();
    dates.forEach(d => {
      if (!d.available || d.price == null) return;
      const key=d.stayDate.slice(0,7), old=map.get(key);
      if (!old || d.price<old.price!) map.set(key,d);
    });
    return Array.from(map.entries()).sort(([a],[b])=>a.localeCompare(b));
  },[dates]);
  const stale = summary?.lastObservedAt ?
    (Date.now()-new Date(summary.lastObservedAt).getTime()) > 36*3600*1000 : false;
  const delta = selectedDay?.price != null && selectedDay.previousPrice != null ?
    selectedDay.price-selectedDay.previousPrice : null;
  return <main className="shell">
    <header className="masthead">
      <div><div className="brand"><span className="brand-mark">◈</span> IKYU <span>PRICE OBSERVATORY</span></div>
        <p className="eyebrow">HOTEL PRICE INTELLIGENCE / NIKKO</p>
        <h1>ホテル料金を、<br/><em>観測する。</em></h1>
        <p className="lead">ザ・リッツ・カールトン日光の宿泊料金を、<br/>宿泊日と観測日の2軸で追跡します。</p>
      </div><div className="masthead-side">
        <div className="hotel-tag"><div className="tag-dot" /> THE RITZ-CARLTON, NIKKO</div>
        <a className="external-link" href={SOURCE} target="_blank" rel="noopener noreferrer">一休で最新価格を確認 <span>↗</span></a>
      </div>
    </header>

    <div className="profile-strip">
      <span>取得条件</span><b>大人2名</b><i/><b>1室・1泊</b><i/><b>食事指定なし</b><i/><b>税込・ポイント即時利用前</b>
      <span className="strip-right">{summary?.lastObservedAt ? "最終観測 "+labelTime(summary.lastObservedAt)+" JST" : "価格データ待機中"}</span>
    </div>
    {error && <div role="alert" className="alert error">APIからデータを取得できませんでした：{error}</div>}
    {stale && <div role="status" className="alert warning">最後の観測から36時間以上経過しています。現在価格は一休で再確認してください。</div>}

    <section className="stats" aria-label="価格サマリー">
      <Stat title="今後12か月の最安値" value={loading?"読み込み中":money(summary?.currentMinimum)}
        hint={summary?.currentMinimumStayDate?labelDay(summary.currentMinimumStayDate)+" 泊":"観測データなし"} emphasis/>
      <Stat title="予約可能日数" value={loading?"—":summary?summary.availableDays+"日":"—"}
        hint={summary ? "観測済み "+summary.coveredDays+"日" : "—"}/>
      <Stat title="観測状況" value={loading?"—":!summary?.lastObservedAt?"未取得":stale?"要確認":"最新"}
        hint={summary?.lastObservedAt?labelTime(summary.lastObservedAt)+" JST":"クローラからの初回送信待ち"}/>
    </section>

    <section className="section calendar-section" aria-labelledby="calendar-title">
      <div className="section-heading"><div><p className="eyebrow">01 / CURRENT RATES</p>
        <h2 id="calendar-title">宿泊日別の現在価格</h2>
        <p>セルを選択すると、その宿泊日の価格履歴を表示します。</p></div>
        <div className="legend"><span><i className="legend-swatch cheap"/>安い</span>
          <span><i className="legend-swatch moderate"/>中間</span><span><i className="legend-swatch expensive"/>高い</span>
          <span><i className="legend-swatch unknown"/>未観測/販売なし</span></div>
      </div>
      {loading ? <div className="placeholder">現在価格を読み込んでいます…</div> :
        !dates.length ? <div className="placeholder">価格データはまだありません。クローラからスナップショットを送信すると表示されます。</div> :
        <div className="month-grid">{months.map(({year,month})=>
          <Month key={year+"-"+month} year={year} month={month} dates={byDate}
            selected={selected} select={setSelected} low={low} high={high}/>)}</div>}
    </section>

    <section className="section" aria-labelledby="history-title">
      <div className="section-heading history-header"><div>
        <p className="eyebrow">02 / OBSERVATION HISTORY</p>
        <h2 id="history-title">{selected ? labelDay(selected)+" 泊" : "宿泊日を選択"}</h2>
        <p>同じ宿泊日の料金が、観測を重ねるとどう動いたか。</p></div>
        <div className="detail-price"><span>現在の販売価格</span>
          <strong>{money(selectedDay?.available ? selectedDay.price : null)}</strong>
          {delta != null && <small className={delta < 0 ? "positive" : delta > 0 ? "negative" : ""}>
            {delta < 0 ? "▼" : delta > 0 ? "▲" : "—"} 前回比 {money(Math.abs(delta))}
          </small>}</div>
      </div>
      {historyError ? <div className="alert error">{historyError}</div> :
        loadingHistory ? <div className="placeholder">履歴を読み込んでいます…</div> :
        <HistoryChart history={history}/>}
      {selectedDay && <div className="detail-row">
        <span>過去最安 <b>{money(selectedDay.historicalMinimum)}</b></span>
        <span>過去最高 <b>{money(selectedDay.historicalMaximum)}</b></span>
        <span>客室 <b>{selectedDay.roomName || "記録なし"}</b></span>
        <span>プラン <b>{selectedDay.planName || "記録なし"}</b></span>
      </div>}
    </section>

    <section className="section" aria-labelledby="month-lows">
      <div className="section-heading"><div>
        <p className="eyebrow">03 / MONTHLY LOWS</p><h2 id="month-lows">月別の最安宿泊日</h2>
        <p>現在取得できている各月の最安価格。</p></div></div>
      {!monthLows.length ? <div className="placeholder">データ待機中</div> :
        <div className="monthly-grid">{monthLows.map(([month,d])=><button type="button" className="monthly-card"
          key={month} onClick={() => { setSelected(d.stayDate); document.getElementById("history-title")?.scrollIntoView({behavior:"smooth",block:"center"}); }}>
          <span>{month.replace("-","年")}月</span><strong>{money(d.price)}</strong>
          <small>{labelDay(d.stayDate)} 泊　↗</small>
        </button>)}</div>}
    </section>
    <footer><span>IKYU PRICE OBSERVATORY</span><p>収集時点の参考価格です。予約時の価格・販売状況は必ず一休公式ページで確認してください。<br/>
      非公式の個人用ダッシュボードであり、一休またはホテルによる提供ではありません。</p></footer>
  </main>;
}
