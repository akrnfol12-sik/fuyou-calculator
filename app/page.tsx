"use client";

import { useEffect, useMemo, useState } from "react";

type EmployerId = "bic" | "intern";

type Shift = {
  id: string;
  sourceTitle: string;
  employer: EmployerId;
  start: string;
  end: string;
  breakMinutes: number;
  transport: number;
};

type EmployerRule = {
  id: EmployerId;
  label: string;
  shortLabel: string;
  hourly: number;
  aliases: string[];
};

type ImportStatus = "idle" | "loading" | "ready" | "error";

declare global {
  interface Window {
    gapi?: {
      load: (moduleName: string, callback: () => void) => void;
      client: {
        init: (config: { apiKey: string; discoveryDocs: string[] }) => Promise<void>;
        calendar: {
          events: {
            list: (params: Record<string, string | number | boolean>) => Promise<{
              result: {
                items?: Array<{
                  id?: string;
                  summary?: string;
                  start?: { dateTime?: string; date?: string };
                  end?: { dateTime?: string; date?: string };
                }>;
              };
            }>;
          };
        };
      };
    };
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
          }) => { requestAccessToken: (options?: { prompt?: string }) => void };
        };
      };
    };
  }
}

const DISCOVERY_DOC =
  "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

const initialEmployers: EmployerRule[] = [
  {
    id: "bic",
    label: "ビックカメラ",
    shortLabel: "ビック",
    hourly: 1150,
    aliases: ["バイト｜ビックカメラ", "びっくかめら", "ビック", "bic"],
  },
  {
    id: "intern",
    label: "エンダストリアル",
    shortLabel: "インターン",
    hourly: 1230,
    aliases: ["インターン｜エンダストリアル", "インターン", "エンダ", "endustrial"],
  },
];

const holidays2026 = new Set([
  "2026-01-01",
  "2026-01-12",
  "2026-02-11",
  "2026-02-23",
  "2026-03-20",
  "2026-04-29",
  "2026-05-03",
  "2026-05-04",
  "2026-05-05",
  "2026-05-06",
  "2026-07-20",
  "2026-08-11",
  "2026-09-21",
  "2026-09-22",
  "2026-09-23",
  "2026-10-12",
  "2026-11-03",
  "2026-11-23",
]);

const sampleShifts: Shift[] = [
  {
    id: "sample-20260813",
    sourceTitle: "バイト｜ビックカメラ",
    employer: "bic",
    start: "2026-08-13T10:00",
    end: "2026-08-13T14:00",
    breakMinutes: 0,
    transport: 0,
  },
  ...generateWeekly("sample-tu", "バイト｜ビックカメラ", "bic", "2026-08-18", "2026-12-29", 16, 21),
  ...generateWeekly("sample-we", "バイト｜ビックカメラ", "bic", "2026-08-19", "2026-12-30", 16, 21),
  ...generateWeekly("sample-sa", "バイト｜ビックカメラ", "bic", "2026-08-15", "2026-12-26", 14, 21),
  {
    id: "sample-intern",
    sourceTitle: "インターン｜エンダストリアル",
    employer: "intern",
    start: "2026-09-04T10:00",
    end: "2026-09-04T16:00",
    breakMinutes: 0,
    transport: 0,
  },
];

function generateWeekly(
  prefix: string,
  sourceTitle: string,
  employer: EmployerId,
  startDate: string,
  endDate: string,
  startHour: number,
  endHour: number,
) {
  const shifts: Shift[] = [];
  const current = new Date(`${startDate}T00:00:00+09:00`);
  const last = new Date(`${endDate}T00:00:00+09:00`);
  while (current <= last) {
    const date = toDateKey(current);
    shifts.push({
      id: `${prefix}-${date}`,
      sourceTitle,
      employer,
      start: `${date}T${String(startHour).padStart(2, "0")}:00`,
      end: `${date}T${String(endHour).padStart(2, "0")}:00`,
      breakMinutes: automaticBreakMinutes((endHour - startHour) * 60),
      transport: 0,
    });
    current.setDate(current.getDate() + 7);
  }
  return shifts;
}

function toDateKey(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

function minutesBetween(start: string, end: string) {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
}

function automaticBreakMinutes(totalMinutes: number) {
  if (totalMinutes > 8 * 60) return 60;
  if (totalMinutes > 6 * 60) return 45;
  return 0;
}

function currency(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function hours(value: number) {
  return `${(value / 60).toFixed(2)}h`;
}

function classifyTitle(title: string, employers: EmployerRule[]): EmployerId | null {
  const normalized = title.toLowerCase();
  for (const employer of employers) {
    if (employer.aliases.some((alias) => normalized.includes(alias.toLowerCase()))) {
      return employer.id;
    }
  }
  return null;
}

function bicPremium(start: string, end: string, breakMinutes: number) {
  const totalMinutes = minutesBetween(start, end);
  if (totalMinutes === 0) return 0;
  const paidRatio = Math.max(0, totalMinutes - breakMinutes) / totalMinutes;
  const startDate = new Date(start);
  const endDate = new Date(end);
  const weekday = startDate.getDay();
  const dateKey = start.slice(0, 10);
  const holidayOrWeekend = weekday === 0 || weekday === 6 || holidays2026.has(dateKey);
  const windows = holidayOrWeekend
    ? [{ from: 10, to: 21, rate: 200 }]
    : [{ from: 17, to: 21, rate: 100 }];

  return windows.reduce((sum, window) => {
    const windowStart = new Date(startDate);
    windowStart.setHours(window.from, 0, 0, 0);
    const windowEnd = new Date(startDate);
    windowEnd.setHours(window.to, 0, 0, 0);
    const overlap = Math.max(
      0,
      Math.min(endDate.getTime(), windowEnd.getTime()) -
        Math.max(startDate.getTime(), windowStart.getTime()),
    );
    return sum + (overlap / 3600000) * paidRatio * window.rate;
  }, 0);
}

function calculateShift(shift: Shift, employers: EmployerRule[]) {
  const employer = employers.find((item) => item.id === shift.employer) ?? employers[0];
  const totalMinutes = minutesBetween(shift.start, shift.end);
  const paidMinutes = Math.max(0, totalMinutes - shift.breakMinutes);
  const basePay = (paidMinutes / 60) * employer.hourly;
  const premium = shift.employer === "bic" ? bicPremium(shift.start, shift.end, shift.breakMinutes) : 0;
  const pay = basePay + premium;
  return {
    totalMinutes,
    paidMinutes,
    basePay,
    premium,
    pay,
    healthIncome: pay + shift.transport,
  };
}

function percent(value: number, threshold: number) {
  return Math.max(0, Math.min(100, (value / threshold) * 100));
}

function monthKey(value: string) {
  return value.slice(0, 7);
}

function nextPayDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  date.setMonth(date.getMonth() + 1);
  date.setDate(10);
  return toDateKey(date);
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export default function Home() {
  const [employers, setEmployers] = useState(initialEmployers);
  const [shifts, setShifts] = useState(sampleShifts);
  const [ageBand, setAgeBand] = useState<"studentAge" | "other">("studentAge");
  const [alreadyPaid, setAlreadyPaid] = useState(0);
  const [contractForecast, setContractForecast] = useState(0);
  const [newShift, setNewShift] = useState({
    sourceTitle: "バイト｜ビックカメラ",
    employer: "bic" as EmployerId,
    start: "2026-09-01T16:00",
    end: "2026-09-01T21:00",
    transport: 0,
  });
  const [calendarConfig, setCalendarConfig] = useState({
    apiKey: "",
    clientId: "",
    calendarId: "primary",
    from: "2026-01-01",
    to: "2026-12-31",
  });
  const [importStatus, setImportStatus] = useState<ImportStatus>("idle");
  const [importMessage, setImportMessage] = useState("同期前");

  useEffect(() => {
    const saved = localStorage.getItem("fuyou-calendar-config");
    if (saved) {
      setCalendarConfig((current) => ({ ...current, ...JSON.parse(saved) }));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("fuyou-calendar-config", JSON.stringify(calendarConfig));
  }, [calendarConfig]);

  const rows = useMemo(
    () =>
      shifts
        .slice()
        .sort((a, b) => a.start.localeCompare(b.start))
        .map((shift) => ({ shift, result: calculateShift(shift, employers) })),
    [shifts, employers],
  );

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.pay += row.result.pay;
        acc.healthIncome += row.result.healthIncome;
        acc.paidMinutes += row.result.paidMinutes;
        acc.bic += row.shift.employer === "bic" ? row.result.pay : 0;
        acc.intern += row.shift.employer === "intern" ? row.result.pay : 0;
        return acc;
      },
      { pay: alreadyPaid, healthIncome: alreadyPaid, paidMinutes: 0, bic: 0, intern: 0 },
    );
  }, [rows, alreadyPaid]);

  const healthThreshold = ageBand === "studentAge" ? 1500000 : 1300000;
  const forecastForHealth = contractForecast > 0 ? contractForecast : totals.healthIncome;
  const monthly = useMemo(() => {
    const groups = new Map<string, { pay: number; hours: number; payday: string }>();
    for (const row of rows) {
      const key = monthKey(row.shift.start);
      const current = groups.get(key) ?? { pay: 0, hours: 0, payday: nextPayDate(row.shift.start) };
      current.pay += row.result.pay;
      current.hours += row.result.paidMinutes;
      groups.set(key, current);
    }
    return Array.from(groups.entries()).slice(-6);
  }, [rows]);

  function updateEmployer(id: EmployerId, patch: Partial<EmployerRule>) {
    setEmployers((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function addShift() {
    const totalMinutes = minutesBetween(newShift.start, newShift.end);
    setShifts((current) => [
      ...current,
      {
        id: `manual-${Date.now()}`,
        ...newShift,
        breakMinutes: automaticBreakMinutes(totalMinutes),
      },
    ]);
  }

  async function syncCalendar() {
    if (!calendarConfig.apiKey || !calendarConfig.clientId) {
      setImportStatus("error");
      setImportMessage("APIキーとクライアントIDを入力");
      return;
    }
    setImportStatus("loading");
    setImportMessage("接続中");
    try {
      await Promise.all([
        loadScript("https://apis.google.com/js/api.js"),
        loadScript("https://accounts.google.com/gsi/client"),
      ]);
      await new Promise<void>((resolve) => window.gapi?.load("client", resolve));
      await window.gapi?.client.init({
        apiKey: calendarConfig.apiKey,
        discoveryDocs: [DISCOVERY_DOC],
      });

      const tokenClient = window.google?.accounts.oauth2.initTokenClient({
        client_id: calendarConfig.clientId,
        scope: CALENDAR_SCOPE,
        callback: async (response) => {
          if (response.error) {
            setImportStatus("error");
            setImportMessage("Google認証で停止");
            return;
          }
          const result = await window.gapi?.client.calendar.events.list({
            calendarId: calendarConfig.calendarId || "primary",
            timeMin: `${calendarConfig.from}T00:00:00+09:00`,
            timeMax: `${calendarConfig.to}T23:59:59+09:00`,
            singleEvents: true,
            orderBy: "startTime",
            maxResults: 2500,
          });
          const imported =
            result?.result.items
              ?.map((event) => {
                const title = event.summary ?? "";
                const employer = classifyTitle(title, employers);
                const start = event.start?.dateTime?.slice(0, 16);
                const end = event.end?.dateTime?.slice(0, 16);
                if (!event.id || !employer || !start || !end) return null;
                return {
                  id: `google-${event.id}`,
                  sourceTitle: title,
                  employer,
                  start,
                  end,
                  breakMinutes: automaticBreakMinutes(minutesBetween(start, end)),
                  transport: 0,
                } satisfies Shift;
              })
              .filter((item): item is Shift => Boolean(item)) ?? [];

          setShifts((current) => {
            const manual = current.filter((shift) => !shift.id.startsWith("google-"));
            return [...manual, ...imported];
          });
          setImportStatus("ready");
          setImportMessage(`${imported.length}件を同期`);
        },
      });
      tokenClient?.requestAccessToken({ prompt: "" });
    } catch {
      setImportStatus("error");
      setImportMessage("同期できませんでした");
    }
  }

  return (
    <main className="min-h-screen bg-[#f6f7f3] text-[#18201a]">
      <section className="border-b border-[#d8ddcf] bg-[#fbfcf7]">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-8 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
          <div>
            <p className="text-sm font-semibold text-[#50624a]">扶養計算機</p>
            <h1 className="mt-2 max-w-3xl text-4xl font-semibold tracking-normal text-[#142013] sm:text-5xl">
              カレンダーの予定名から、今年のバイト代と扶養ラインを追う
            </h1>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="総支給見込" value={currency(totals.pay)} />
            <Metric label="健保判定収入" value={currency(forecastForHealth)} />
            <Metric label="勤務時間" value={hours(totals.paidMinutes)} />
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-5 py-6 lg:grid-cols-[0.95fr_1.25fr] lg:px-8">
        <div className="space-y-6">
          <Panel title="扶養ライン">
            <div className="grid gap-3">
              <Segmented
                value={ageBand}
                options={[
                  ["studentAge", "19-22歳"],
                  ["other", "通常"],
                ]}
                onChange={(value) => setAgeBand(value as "studentAge" | "other")}
              />
              <NumberField
                label="今年すでに受け取った給与"
                value={alreadyPaid}
                onChange={setAlreadyPaid}
              />
              <NumberField
                label="契約書ベースの年収見込"
                value={contractForecast}
                onChange={setContractForecast}
              />
            </div>
            <div className="mt-5 space-y-4">
              <Gauge
                label="すかいらーく健保"
                value={forecastForHealth}
                threshold={healthThreshold}
                note={ageBand === "studentAge" ? "19歳以上23歳未満は150万円未満" : "通常は130万円未満"}
              />
              <Gauge
                label="税扶養の目安"
                value={totals.pay}
                threshold={1230000}
                note="123万円以下で扶養控除ライン"
              />
              <Gauge
                label="特定親族の満額目安"
                value={totals.pay}
                threshold={1500000}
                note="19-22歳なら150万円まで満額相当"
              />
              <Gauge
                label="本人の所得税目安"
                value={totals.pay}
                threshold={1600000}
                note="給与のみなら160万円以下"
              />
            </div>
          </Panel>

          <Panel title="勤務先ルール">
            <div className="space-y-4">
              {employers.map((employer) => (
                <div key={employer.id} className="rounded-md border border-[#dce2d6] bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{employer.label}</p>
                      <p className="text-sm text-[#5f6b59]">{employer.aliases.join(" / ")}</p>
                    </div>
                    <input
                      aria-label={`${employer.label}の時給`}
                      className="w-28 rounded-md border border-[#cdd6c8] px-3 py-2 text-right font-semibold"
                      type="number"
                      value={employer.hourly}
                      onChange={(event) =>
                        updateEmployer(employer.id, { hourly: Number(event.target.value) })
                      }
                    />
                  </div>
                  <input
                    aria-label={`${employer.label}の予定名ルール`}
                    className="mt-3 w-full rounded-md border border-[#cdd6c8] px-3 py-2 text-sm"
                    value={employer.aliases.join(", ")}
                    onChange={(event) =>
                      updateEmployer(employer.id, {
                        aliases: event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="カレンダー同期">
            <div className="grid gap-3 md:grid-cols-2">
              <TextField
                label="Google APIキー"
                value={calendarConfig.apiKey}
                onChange={(value) => setCalendarConfig((current) => ({ ...current, apiKey: value }))}
              />
              <TextField
                label="OAuthクライアントID"
                value={calendarConfig.clientId}
                onChange={(value) => setCalendarConfig((current) => ({ ...current, clientId: value }))}
              />
              <TextField
                label="カレンダー"
                value={calendarConfig.calendarId}
                onChange={(value) =>
                  setCalendarConfig((current) => ({ ...current, calendarId: value }))
                }
              />
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label="開始日"
                  type="date"
                  value={calendarConfig.from}
                  onChange={(value) => setCalendarConfig((current) => ({ ...current, from: value }))}
                />
                <TextField
                  label="終了日"
                  type="date"
                  value={calendarConfig.to}
                  onChange={(value) => setCalendarConfig((current) => ({ ...current, to: value }))}
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                className="rounded-md bg-[#285c45] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1d4634]"
                onClick={syncCalendar}
              >
                Googleカレンダーを同期
              </button>
              <span className={`status status-${importStatus}`}>{importMessage}</span>
            </div>
          </Panel>

          <Panel title="予定を追加">
            <div className="grid gap-3 md:grid-cols-2">
              <TextField
                label="予定名"
                value={newShift.sourceTitle}
                onChange={(value) => {
                  const classified = classifyTitle(value, employers);
                  setNewShift((current) => ({
                    ...current,
                    sourceTitle: value,
                    employer: classified ?? current.employer,
                  }));
                }}
              />
              <label className="field">
                <span>勤務先</span>
                <select
                  value={newShift.employer}
                  onChange={(event) =>
                    setNewShift((current) => ({
                      ...current,
                      employer: event.target.value as EmployerId,
                    }))
                  }
                >
                  {employers.map((employer) => (
                    <option key={employer.id} value={employer.id}>
                      {employer.label}
                    </option>
                  ))}
                </select>
              </label>
              <TextField
                label="開始"
                type="datetime-local"
                value={newShift.start}
                onChange={(value) => setNewShift((current) => ({ ...current, start: value }))}
              />
              <TextField
                label="終了"
                type="datetime-local"
                value={newShift.end}
                onChange={(value) => setNewShift((current) => ({ ...current, end: value }))}
              />
              <NumberField
                label="交通費"
                value={newShift.transport}
                onChange={(value) => setNewShift((current) => ({ ...current, transport: value }))}
              />
              <button
                className="self-end rounded-md border border-[#285c45] px-4 py-2 text-sm font-semibold text-[#285c45] transition hover:bg-[#e8f1eb]"
                onClick={addShift}
              >
                予定を追加
              </button>
            </div>
          </Panel>

          <Panel title="月別の見通し">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {monthly.map(([key, item]) => (
                <div key={key} className="rounded-md border border-[#dce2d6] bg-white p-4">
                  <p className="text-sm font-semibold text-[#5f6b59]">{key}</p>
                  <p className="mt-1 text-2xl font-semibold">{currency(item.pay)}</p>
                  <p className="mt-1 text-sm text-[#5f6b59]">
                    {hours(item.hours)} / 支払 {item.payday}
                  </p>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-10 lg:px-8">
        <Panel title="シフト明細">
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>日付</th>
                  <th>予定名</th>
                  <th>勤務先</th>
                  <th>勤務</th>
                  <th>休憩</th>
                  <th>給与</th>
                  <th>健保収入</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ shift, result }) => {
                  const employer = employers.find((item) => item.id === shift.employer);
                  return (
                    <tr key={shift.id}>
                      <td>{shift.start.slice(0, 10)}</td>
                      <td>{shift.sourceTitle}</td>
                      <td>{employer?.shortLabel}</td>
                      <td>{hours(result.paidMinutes)}</td>
                      <td>
                        <input
                          aria-label={`${shift.sourceTitle}の休憩分`}
                          className="w-20 rounded-md border border-[#cdd6c8] px-2 py-1 text-right"
                          type="number"
                          value={shift.breakMinutes}
                          onChange={(event) =>
                            setShifts((current) =>
                              current.map((item) =>
                                item.id === shift.id
                                  ? { ...item, breakMinutes: Number(event.target.value) }
                                  : item,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <div>{currency(result.pay)}</div>
                        {result.premium > 0 && (
                          <span className="text-xs text-[#5f6b59]">
                            加算 {currency(result.premium)}
                          </span>
                        )}
                      </td>
                      <td>{currency(result.healthIncome)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[#d8ddcf] bg-[#fbfcf7] p-5 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#d8ddcf] bg-white p-4">
      <p className="text-sm font-semibold text-[#5f6b59]">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Gauge({
  label,
  value,
  threshold,
  note,
}: {
  label: string;
  value: number;
  threshold: number;
  note: string;
}) {
  const remaining = threshold - value;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <div>
          <p className="font-semibold">{label}</p>
          <p className="text-sm text-[#5f6b59]">{note}</p>
        </div>
        <p className={remaining >= 0 ? "text-sm font-semibold text-[#285c45]" : "text-sm font-semibold text-[#a33b2f]"}>
          {remaining >= 0 ? `残り ${currency(remaining)}` : `超過 ${currency(Math.abs(remaining))}`}
        </p>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-[#e1e7dc]">
        <div
          className={value <= threshold ? "h-full bg-[#2f7b58]" : "h-full bg-[#b9503e]"}
          style={{ width: `${percent(value, threshold)}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-xs text-[#5f6b59]">
        <span>{currency(value)}</span>
        <span>{currency(threshold)}</span>
      </div>
    </div>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 rounded-md border border-[#cdd6c8] bg-white p-1">
      {options.map(([optionValue, label]) => (
        <button
          key={optionValue}
          className={`rounded px-3 py-2 text-sm font-semibold ${
            value === optionValue ? "bg-[#285c45] text-white" : "text-[#50624a]"
          }`}
          onClick={() => onChange(optionValue)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
