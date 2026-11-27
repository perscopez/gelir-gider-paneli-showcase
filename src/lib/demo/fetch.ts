import { buildDemoDb, type DemoDb } from "./data";

// Gösterim modunda Supabase'e giden istekleri bellekteki uydurma veriye yönlendirir (PostgREST alt kümesi).
// Yalnızca okuma çalışır; yazma istekleri reddedilir, bu yüzden gerçek veri hiçbir şekilde değişmez.

type Row = Record<string, unknown>;
type Rows = Row[] & { total?: number; offset?: number };

function match(row: Row, key: string, val: string): boolean {
  const [op, ...rest] = val.split(".");
  const v = rest.join(".");
  const x = row[key] as string | number | null | undefined;
  if (op === "eq") return String(x) === v;
  if (op === "neq") return String(x) !== v;
  if (op === "is") return v === "null" ? x == null : (x as unknown) === (v === "true");
  if (op === "gte") return x != null && x >= v;
  if (op === "lte") return x != null && x <= v;
  if (op === "lt") return x != null && x < v;
  if (op === "gt") return x != null && x > v;
  if (op === "in") return v.replace(/^\(|\)$/g, "").split(",").map((q) => q.replace(/^"|"$/g, "")).includes(String(x));
  if (op === "ilike") return String(x ?? "").toLowerCase().includes(v.replace(/\\/g, "").replace(/%/g, "").toLowerCase());
  return true;
}

function balances(db: DemoDb): Row[] {
  return db.accounts.map((a) => {
    let b = Number(a.opening_balance ?? 0);
    for (const t of db.transactions) {
      if (t.account_id === a.id) b += t.kind === "income" ? Number(t.amount) : -Number(t.amount);
      if (t.kind === "transfer" && t.to_account_id === a.id) b += Number(t.to_amount);
    }
    return { account_id: a.id, balance: b };
  });
}

function embed(db: DemoDb, rows: Row[], select: string): Row[] {
  const re = /(\w+):(\w+)(?:![\w]+)?\(([^)]*)\)/g;
  const out = rows.map((r) => ({ ...r }));
  let m: RegExpExecArray | null;
  while ((m = re.exec(select))) {
    const [, alias, table] = m;
    for (const r of out) r[alias] = db[table]?.find((x) => x.id === r[`${alias}_id`]) ?? null;
  }
  return out;
}

function query(db: DemoDb, table: string, u: URL): Rows {
  let rows: Row[] = table === "account_balances" ? balances(db) : [...(db[table] ?? [])];
  for (const [k, v] of u.searchParams) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
    if (k === "or") {
      const conds = v.replace(/^\(|\)$/g, "").split(",");
      rows = rows.filter((r) => conds.some((c) => { const [col, ...rest] = c.split("."); return match(r, col, rest.join(".")); }));
      continue;
    }
    rows = rows.filter((r) => match(r, k, v));
  }
  const ord = u.searchParams.get("order");
  if (ord) {
    for (const o of ord.split(",").reverse()) {
      const [c, d] = o.split(".");
      rows.sort((a, b) => ((a[c] as string) > (b[c] as string) ? 1 : (a[c] as string) < (b[c] as string) ? -1 : 0) * (d === "desc" ? -1 : 1));
    }
  }
  const total = rows.length;
  const off = Number(u.searchParams.get("offset") ?? 0);
  const lim = u.searchParams.get("limit");
  const out: Rows = rows.slice(off, lim ? off + Number(lim) : undefined);
  out.total = total;
  out.offset = off;
  return out;
}

const json = (code: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status: code, headers: { "content-type": "application/json", ...headers } });

export function demoFetch(real: typeof fetch): typeof fetch {
  const db = buildDemoDb();
  return async (input, init) => {
    const req = new Request(input, init);
    const u = new URL(req.url);
    if (u.pathname.startsWith("/storage/v1/")) return json(200, u.pathname.includes("/sign/") ? [] : {});
    if (!u.pathname.startsWith("/rest/v1/")) return real(input, init); // oturum/doğrulama istekleri gerçek kalır

    const table = u.pathname.replace("/rest/v1/", "");
    if (req.method !== "GET" && req.method !== "HEAD") return json(403, { message: "Gösterim modunda değişiklik kaydedilmez." });
    if (!(table in db) && table !== "account_balances") return json(404, { message: `no table ${table}` });

    const rows = query(db, table, u);
    const total = rows.total ?? rows.length;
    const off = rows.offset ?? 0;
    if (req.method === "HEAD") return json(200, undefined, { "content-range": `*/${total}` });
    const out = embed(db, rows, u.searchParams.get("select") ?? "");
    const headers = { "content-range": `${off}-${Math.max(off, off + out.length - 1)}/${total}` };
    if ((req.headers.get("accept") ?? "").includes("vnd.pgrst.object")) {
      return out.length === 1 ? json(200, out[0], headers) : json(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
    }
    return json(200, out, headers);
  };
}
