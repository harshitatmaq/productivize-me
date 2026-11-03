import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { beforeAll, describe, expect, it } from "vitest";

// Runs the real migrations on an in-process Postgres with a stubbed Supabase `auth` schema.
let db: PGlite;
let u1: string;
let u2: string;

const asUser = (id: string) => db.exec(`select set_config('request.jwt.claim.sub', '${id}', false)`);
const one = async <T,>(sql: string) => (await db.query<T>(sql)).rows[0];

beforeAll(async () => {
  db = new PGlite({ extensions: { vector } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  for (const f of ["0001_init.sql", "0002_more_features.sql"]) {
    const sql = readFileSync(`supabase/migrations/${f}`, "utf8");
    await db.exec(sql);
    await db.exec(sql); // idempotent
  }
  u1 = (await one<{ id: string }>(`insert into auth.users (email) values ('a@x.com') returning id`)).id;
  u2 = (await one<{ id: string }>(`insert into auth.users (email) values ('b@x.com') returning id`)).id;
  await db.exec(`update public.profiles set timezone = 'Asia/Kolkata'`);
}, 60_000);

describe("recurrence", () => {
  it("handles intervals and chosen weekdays", async () => {
    const q = (from: string, rule: string, today: string, n: number, days: string) =>
      one<{ d: string }>(`select public.next_recurrence_date('${from}', '${rule}', '${today}', ${n}, '${days}'::smallint[])::text as d`).then((r) => r.d);
    // every 2 weeks on Mon (1) and Wed (3); 2026-11-02 is a Monday
    expect(await q("2026-11-02", "weekly", "2026-11-02", 2, "{1,3}")).toBe("2026-11-04");
    expect(await q("2026-11-04", "weekly", "2026-11-04", 2, "{1,3}")).toBe("2026-11-16");
    expect(await q("2026-11-02", "daily", "2026-11-02", 3, "{}")).toBe("2026-11-05");
    expect(await q("2026-11-02", "weekly", "2026-11-02", 2, "{}")).toBe("2026-11-16");
    expect(await q("2026-01-31", "monthly", "2026-01-31", 2, "{}")).toBe("2026-03-31");
    // rolls forward past today
    expect(await q("2026-10-01", "daily", "2026-11-02", 1, "{}")).toBe("2026-11-03");
  });

  it("keeps a habit series together when completing", async () => {
    await asUser(u1);
    const t = await one<{ id: string; series_id: string }>(
      `insert into public.tasks (title, due_date, recurrence, recurrence_interval) values ('Run', current_date, 'daily', 2) returning id, series_id`,
    );
    expect(t.series_id).toBe(t.id);
    await db.exec(`update public.tasks set status = 'done' where id = '${t.id}'`);
    const next = await one<{ series_id: string; recurrence_interval: number }>(
      `select series_id, recurrence_interval from public.tasks where title = 'Run' and status = 'todo'`,
    );
    expect(next.series_id).toBe(t.id);
    expect(next.recurrence_interval).toBe(2);
  });
});

describe("job follow-ups", () => {
  it("creates, updates and closes linked tasks", async () => {
    await asUser(u1);
    const job = await one<{ id: string }>(
      `insert into public.jobs (title, company, url, url_hash, dedupe_key) values ('SRE', 'Acme', 'https://x/1', 'h1', 'd1') returning id`,
    );
    await db.exec(`update public.jobs set status = 'applied' where id = '${job.id}'`);
    const fu = await one<{ title: string; days: number }>(
      `select title, due_date - (now() at time zone 'Asia/Kolkata')::date as days from public.tasks where job_id = '${job.id}'`,
    );
    expect(fu.title).toBe("Follow up: SRE @ Acme");
    expect(fu.days).toBe(7);

    await db.exec(`update public.jobs set next_step = 'Tech screen', next_step_date = '2030-01-10' where id = '${job.id}'`);
    await db.exec(`update public.jobs set next_step_date = '2030-01-12' where id = '${job.id}'`);
    const steps = await db.query<{ title: string; due_date: string }>(
      `select title, due_date::text from public.tasks where job_id = '${job.id}' and title like 'Tech screen%'`,
    );
    expect(steps.rows).toEqual([{ title: "Tech screen: SRE @ Acme", due_date: "2030-01-12" }]);

    await db.exec(`update public.jobs set status = 'interviewing' where id = '${job.id}'`);
    const closed = await one<{ status: string }>(`select status from public.tasks where title like 'Follow up: SRE%'`);
    expect(closed.status).toBe("dropped");
  });
});

describe("focus + buddy", () => {
  it("rolls focus minutes into the task", async () => {
    await asUser(u1);
    const t = await one<{ id: string }>(`insert into public.tasks (title, due_date) values ('Deep work', current_date) returning id`);
    await db.exec(`insert into public.focus_sessions (task_id, started_at, ended_at, minutes) values ('${t.id}', now() - interval '25 minutes', now(), 25)`);
    expect((await one<{ m: number }>(`select actual_minutes as m from public.tasks where id = '${t.id}'`)).m).toBe(25);
  });

  it("shares aggregates only between people who opted in", async () => {
    await asUser(u1);
    await db.exec(`insert into public.learning_entries (entry_date, title) values ((now() at time zone 'Asia/Kolkata')::date, 'x'), ((now() at time zone 'Asia/Kolkata')::date - 1, 'y')`);
    const week = "2000-01-03";
    expect((await db.query(`select * from public.buddy_stats('${week}')`)).rows).toHaveLength(0);
    await db.exec(`update public.profiles set share_progress = true where id = '${u1}'`);
    expect((await db.query(`select * from public.buddy_stats('${week}')`)).rows).toHaveLength(1);
    await db.exec(`update public.profiles set share_progress = true where id = '${u2}'`);
    const rows = (await db.query<{ is_me: boolean; learning_streak: number; name: string }>(`select * from public.buddy_stats('${week}')`)).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].is_me).toBe(true);
    expect(rows[0].learning_streak).toBe(2);
  });
});

describe("embeddings column", () => {
  it("stores 384-d vectors", async () => {
    await asUser(u2);
    const v = `[${Array.from({ length: 384 }, () => 0.01).join(",")}]`;
    await db.exec(`insert into public.jobs (title, url, url_hash, dedupe_key, embedding) values ('ML', 'u', 'h', 'd', '${v}')`);
    const r = await one<{ n: number }>(`select extensions.vector_dims(embedding) as n from public.jobs where title = 'ML'`);
    expect(r.n).toBe(384);
  });
});
