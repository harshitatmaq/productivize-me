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
    grant usage on schema auth to authenticated, service_role;
    grant usage on schema public to authenticated, service_role;
  `);
  try {
    await db.exec("create publication supabase_realtime");
  } catch {
    // publications unsupported here — the migration skips that block
  }
  for (const f of ["0001_init.sql", "0002_more_features.sql", "0003_scout_worker.sql", "0004_sharing_interests.sql", "0005_planning_health_chat_memory.sql"]) {
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
    // Opting in isn't enough any more: you only see people you share a dashboard with.
    expect((await db.query(`select * from public.buddy_stats('${week}')`)).rows).toHaveLength(1);
    const sp = await one<{ id: string }>(`insert into public.spaces (name, owner_id) values ('Us', '${u1}') returning id`);
    await db.exec(`insert into public.space_members (space_id, user_id) values ('${sp.id}', '${u2}')`);
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

describe("scout worker plumbing", () => {
  it("claims a periodic source only once per interval", async () => {
    const claim = async (key: string, min: number) =>
      (await one<{ ok: boolean }>(`select public.claim_source('${key}', ${min}) as ok`)).ok;
    expect(await claim("u:jobspy_linkedin", 60)).toBe(true);
    expect(await claim("u:jobspy_linkedin", 60)).toBe(false);
    await db.exec(`update public.source_state set last_run_at = now() - interval '61 minutes' where key = 'u:jobspy_linkedin'`);
    expect(await claim("u:jobspy_linkedin", 60)).toBe(true);
  });

  it("hands each queued job to exactly one worker", async () => {
    await db.exec(`insert into public.agent_jobs (user_id, type, priority) values ('${u1}', 'live_search', 1), ('${u1}', 'job_search', 5)`);
    const a = await db.query<{ type: string; status: string; attempts: number }>(`select type, status, attempts from public.claim_agent_job('vm', array['live_search','job_search'])`);
    const b = await db.query<{ type: string }>(`select type from public.claim_agent_job('pc', array['live_search','job_search'])`);
    const c = await db.query(`select * from public.claim_agent_job('pc', array['live_search','job_search'])`);
    expect(a.rows[0]).toMatchObject({ type: "live_search", status: "running", attempts: 1 });
    expect(b.rows[0].type).toBe("job_search");
    expect(c.rows).toHaveLength(0);
    // a crashed worker's job becomes claimable again after 20 minutes
    await db.exec(`update public.agent_jobs set locked_at = now() - interval '25 minutes' where type = 'live_search'`);
    const d = await db.query<{ type: string; locked_by: string }>(`select type, locked_by from public.claim_agent_job('pc', array['live_search'])`);
    expect(d.rows[0]).toMatchObject({ type: "live_search", locked_by: "pc" });
  });

  it("ranks stored jobs by meaning for the signed-in user only", async () => {
    await asUser(u1);
    const vec = (hot: number) => `[${Array.from({ length: 384 }, (_, i) => (i === hot ? 1 : 0)).join(",")}]`;
    await db.exec(`insert into public.jobs (title, url, url_hash, dedupe_key, embedding, embedding_model) values
      ('Data Engineer', 'a', 'ha', 'da', '${vec(0)}', 'm'),
      ('Chef', 'b', 'hb', 'db', '${vec(5)}', 'm'),
      ('Other model', 'c', 'hc', 'dc', '${vec(0)}', 'other')`);
    const r = await db.query<{ title: string; similarity: number }>(
      `select j.title, m.similarity from public.match_jobs('${vec(0)}', 'm', 10) m join public.jobs j on j.id = m.id`,
    );
    expect(r.rows.map((x) => x.title)).toEqual(["Data Engineer", "Chef"]);
    expect(r.rows[0].similarity).toBeCloseTo(1);
    await asUser(u2);
    expect((await db.query(`select * from public.match_jobs('${vec(0)}', 'm', 10)`)).rows).toHaveLength(0);
  });
});

describe("shared dashboards", () => {
  // Runs queries the way the app does: as the "authenticated" role, with RLS on.
  const asApp = async (id: string) => {
    await db.exec(`reset role`);
    await asUser(id);
    await db.exec(`set role authenticated`);
  };
  const rows = async (sql: string) => (await db.query(sql)).rows;

  it("invites by email, accepts, shares copies and keeps strangers out", async () => {
    await db.exec(`reset role`);
    const u3 = (await one<{ id: string }>(`insert into auth.users (email) values ('c@x.com') returning id`)).id;
    const u4 = (await one<{ id: string }>(`insert into auth.users (email) values ('d@x.com') returning id`)).id;

    await asApp(u3);
    const sp = await one<{ id: string }>(`insert into public.spaces (name) values ('Job hunt') returning id`);
    expect(await rows(`select role from public.space_members where space_id = '${sp.id}'`)).toEqual([{ role: "owner" }]);

    // Not invited yet → invisible.
    await asApp(u4);
    expect(await rows(`select id from public.spaces where id = '${sp.id}'`)).toHaveLength(0);

    await asApp(u3);
    const inv = await one<{ id: string }>(`insert into public.space_invites (space_id, email) values ('${sp.id}', 'd@x.com') returning id`);

    // The invitee sees the space name and the invite, but nothing inside yet.
    await asApp(u4);
    expect(await rows(`select name from public.spaces where id = '${sp.id}'`)).toEqual([{ name: "Job hunt" }]);
    expect(await rows(`select id from public.space_items where space_id = '${sp.id}'`)).toHaveLength(0);
    await db.exec(`select public.accept_space_invite('${inv.id}')`);
    expect((await rows(`select * from public.space_people('${sp.id}')`)).length).toBe(2);

    // Someone else can't accept an invite that isn't theirs.
    await asApp(u2);
    await expect(db.exec(`select public.accept_space_invite('${inv.id}')`)).rejects.toThrow();

    await asApp(u3);
    const item = await one<{ id: string }>(
      `insert into public.space_items (space_id, kind, title, payload) values ('${sp.id}', 'task', 'Mock interview', '{"due_date":"2030-01-01"}') returning id`,
    );
    await asApp(u4);
    await db.exec(`update public.space_items set done = true where id = '${item.id}'`);
    expect(await one<{ done_by: string }>(`select done_by from public.space_items where id = '${item.id}'`)).toEqual({ done_by: u4 });
    await db.exec(`insert into public.space_comments (item_id, body) values ('${item.id}', 'Nice')`);
    // Members can't delete what others shared (only the author or the owner).
    await db.exec(`delete from public.space_items where id = '${item.id}'`);
    expect(await rows(`select id from public.space_items where id = '${item.id}'`)).toHaveLength(1);

    // A stranger can't read it, or attach comments to it via their own space.
    await asApp(u2);
    expect(await rows(`select id from public.space_items where id = '${item.id}'`)).toHaveLength(0);
    const own = await one<{ id: string }>(`insert into public.spaces (name) values ('Mine') returning id`);
    await expect(
      db.exec(`insert into public.space_comments (item_id, space_id, body) values ('${item.id}', '${own.id}', 'sneaky')`),
    ).rejects.toThrow();

    // Members can leave; the owner can't leave their own dashboard (they delete it instead).
    await asApp(u4);
    await db.exec(`delete from public.space_members where space_id = '${sp.id}' and user_id = '${u4}'`);
    expect(await rows(`select id from public.space_items where space_id = '${sp.id}'`)).toHaveLength(0);
    await asApp(u3);
    await db.exec(`delete from public.space_members where space_id = '${sp.id}' and user_id = '${u3}'`);
    expect(await rows(`select user_id from public.space_members where space_id = '${sp.id}'`)).toHaveLength(1);
    await db.exec(`reset role`);
  });

  it("keeps interests unique per person", async () => {
    await asUser(u1);
    await db.exec(`insert into public.interests (name, kind) values ('Power BI', 'career')`);
    await expect(db.exec(`insert into public.interests (name, kind) values ('power bi', 'learning')`)).rejects.toThrow();
    await asUser(u2);
    await db.exec(`insert into public.interests (name, kind) values ('Power BI', 'hobby')`);
  });
});

describe("health", () => {
  it("keeps workouts per day, sets with their owner, and data private", async () => {
    await asUser(u1);
    const ex = await one<{ id: string }>(`insert into public.exercises (name, day_type, reps_min, reps_max) values ('Bench press', 'push', 6, 8) returning id`);
    const w = await one<{ id: string }>(`insert into public.workouts (date, day_type) values ('2026-11-09', 'push') returning id`);
    await db.exec(`insert into public.workout_sets (workout_id, exercise_id, exercise_name, set_no, reps, weight) values ('${w.id}', '${ex.id}', 'Bench press', 1, 8, 60)`);
    // One entry per day.
    await expect(db.exec(`insert into public.workouts (date, day_type) values ('2026-11-09', 'pull')`)).rejects.toThrow();
    await expect(db.exec(`insert into public.exercises (name, day_type, reps_min, reps_max) values ('Bad', 'push', 10, 5)`)).rejects.toThrow();
    // Someone else can't hang sets on your workout.
    await asUser(u2);
    await expect(
      db.exec(`insert into public.workout_sets (workout_id, exercise_name, reps, weight) values ('${w.id}', 'Sneaky', 1, 1)`),
    ).rejects.toThrow();
    await db.exec(`insert into public.body_metrics (date, weight) values ('2026-11-09', 72.4)`);
    await asUser(u1);
    // Deleting the workout removes its sets.
    await db.exec(`delete from public.workouts where id = '${w.id}'`);
    expect((await one<{ n: number }>(`select count(*)::int as n from public.workout_sets where workout_id = '${w.id}'`)).n).toBe(0);
  });
});

describe("chat", () => {
  const asApp = async (id: string) => {
    await db.exec(`reset role`);
    await asUser(id);
    await db.exec(`set role authenticated`);
  };

  it("gives members distinct colours, keeps messages inside the dashboard and credits senders", async () => {
    await db.exec(`reset role`);
    const p = (await one<{ id: string }>(`insert into auth.users (email) values ('p@x.com') returning id`)).id;
    const q = (await one<{ id: string }>(`insert into auth.users (email) values ('q@x.com') returning id`)).id;
    const r = (await one<{ id: string }>(`insert into auth.users (email) values ('r@x.com') returning id`)).id;
    await asApp(p);
    const sp = await one<{ id: string }>(`insert into public.spaces (name) values ('Us two') returning id`);
    await db.exec(`reset role`);
    await db.exec(`insert into public.space_members (space_id, user_id) values ('${sp.id}', '${q}')`);
    const colours = (await db.query<{ color: string }>(`select color from public.space_members where space_id = '${sp.id}' order by joined_at`)).rows.map((x) => x.color);
    expect(colours).toEqual(["green", "purple"]);

    // Can't take someone else's colour; can pick a free one.
    await asApp(q);
    await expect(db.exec(`update public.space_members set color = 'green' where space_id = '${sp.id}' and user_id = '${q}'`)).rejects.toThrow();
    await db.exec(`update public.space_members set color = 'teal' where space_id = '${sp.id}' and user_id = '${q}'`);
    expect((await db.query(`select color from public.space_people('${sp.id}') where user_id = '${q}'`)).rows).toEqual([{ color: "teal" }]);

    // Messages: members only, and only as yourself.
    await asApp(p);
    const m = await one<{ id: string }>(`insert into public.chat_messages (space_id, client_id, body) values ('${sp.id}', 'c1', 'dinner at 8?') returning id`);
    await expect(db.exec(`insert into public.chat_messages (space_id, client_id, body, sender) values ('${sp.id}', 'c2', 'fake', '${q}')`)).rejects.toThrow();
    await asApp(q);
    await db.exec(`insert into public.chat_reactions (message_id, emoji) values ('${m.id}', '👍')`);
    await db.exec(`insert into public.chat_promises (message_id, message_client_id, body, promiser) values ('${m.id}', 'c1', 'dinner at 8?', '${p}')`);
    expect((await db.query(`select id from public.chat_search('${sp.id}', 'dinner')`)).rows).toHaveLength(1);
    // Someone else can't edit your message.
    await db.exec(`update public.chat_messages set body = 'hacked' where id = '${m.id}'`);
    expect((await one<{ body: string }>(`select body from public.chat_messages where id = '${m.id}'`)).body).toBe("dinner at 8?");

    // Board: anyone edits, edit is credited to the editor.
    const b = await one<{ id: string }>(`insert into public.board_items (space_id, client_id, kind, title) values ('${sp.id}', 'b1', 'note', 'Buy flowers') returning id`);
    await asApp(p);
    await db.exec(`update public.board_items set title = 'Buy tulips', updated_by = '${p}' where id = '${b.id}'`);
    await expect(db.exec(`update public.board_items set updated_by = '${q}' where id = '${b.id}'`)).rejects.toThrow();

    // A stranger sees nothing and can't post.
    await asApp(r);
    expect((await db.query(`select id from public.chat_messages where space_id = '${sp.id}'`)).rows).toHaveLength(0);
    expect((await db.query(`select id from public.board_items where space_id = '${sp.id}'`)).rows).toHaveLength(0);
    await expect(db.exec(`insert into public.chat_messages (space_id, client_id, body) values ('${sp.id}', 'c3', 'hi')`)).rejects.toThrow();
    await db.exec(`reset role`);
  });
});
