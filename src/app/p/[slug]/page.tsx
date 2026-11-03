import { createClient } from "@supabase/supabase-js";
import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PortfolioView } from "@/components/portfolio/portfolio-view";
import { normalizePortfolio, type PortfolioData } from "@/lib/portfolio";

async function getPortfolio(slug: string): Promise<PortfolioData | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`portfolio:${slug}`);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data } = await sb.from("portfolios").select("data").eq("slug", slug).eq("is_public", true).maybeSingle();
  return data ? normalizePortfolio(data.data) : null;
}

export async function generateMetadata({ params }: PageProps<"/p/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPortfolio(slug);
  if (!data) return { title: "Portfolio" };
  return {
    title: { absolute: `${data.name} — ${data.headline}`.slice(0, 70) },
    description: data.about.slice(0, 160) || data.headline,
    robots: { index: true, follow: true },
    openGraph: { title: data.name, description: data.headline, type: "profile" },
  };
}

async function Portfolio({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getPortfolio(slug);
  if (!data) notFound();
  return <PortfolioView data={data} />;
}

export default function PublicPortfolioPage({ params }: PageProps<"/p/[slug]">) {
  return (
    <main className="min-h-dvh bg-bg">
      <Suspense fallback={<div className="mx-auto max-w-[760px] px-5 pt-24"><div className="skeleton mb-4 h-10 w-64" /><div className="skeleton h-5 w-96 max-w-full" /></div>}>
        <Portfolio params={params} />
      </Suspense>
    </main>
  );
}
