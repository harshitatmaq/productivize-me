"use client";

import { FileDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import type { ResumeData } from "@/lib/jobs/types";
import { api } from "@/lib/utils";

type ReactPdf = typeof import("@react-pdf/renderer");

function buildDoc(R: ReactPdf, d: ResumeData) {
  const s = R.StyleSheet.create({
    page: { paddingVertical: 34, paddingHorizontal: 40, fontFamily: "Helvetica", fontSize: 9.6, color: "#1a1a1a", lineHeight: 1.35 },
    name: { fontSize: 20, fontFamily: "Helvetica-Bold", color: "#111" },
    headline: { fontSize: 10.5, color: "#444", marginTop: 2 },
    contact: { fontSize: 8.8, color: "#555", marginTop: 5 },
    section: { marginTop: 11 },
    h: { fontSize: 9, fontFamily: "Helvetica-Bold", letterSpacing: 1.2, color: "#4a55c0", textTransform: "uppercase", borderBottomWidth: 0.6, borderBottomColor: "#d6d8e6", paddingBottom: 2, marginBottom: 5 },
    row: { flexDirection: "row", justifyContent: "space-between" },
    role: { fontFamily: "Helvetica-Bold", fontSize: 10 },
    muted: { color: "#666" },
    bullet: { flexDirection: "row", marginTop: 1.5, paddingRight: 6 },
    dot: { width: 9 },
    item: { marginBottom: 6 },
  });
  const B = ({ children }: { children: string }) => (
    <R.View style={s.bullet}>
      <R.Text style={s.dot}>•</R.Text>
      <R.Text style={{ flex: 1 }}>{children}</R.Text>
    </R.View>
  );
  const contact = [d.contact.email, d.contact.phone, d.contact.location, ...d.contact.links].filter(Boolean).join("  ·  ");
  return (
    <R.Document title={`${d.name} — Resume`} author={d.name} subject={d.tailoredFor ? `Resume for ${d.tailoredFor.title}` : "Resume"}>
      <R.Page size="A4" style={s.page}>
        <R.Text style={s.name}>{d.name}</R.Text>
        {d.headline ? <R.Text style={s.headline}>{d.headline}</R.Text> : null}
        {contact ? <R.Text style={s.contact}>{contact}</R.Text> : null}

        {d.summary ? (
          <R.View style={s.section}>
            <R.Text style={s.h}>Summary</R.Text>
            <R.Text>{d.summary}</R.Text>
          </R.View>
        ) : null}

        {d.skills.length ? (
          <R.View style={s.section}>
            <R.Text style={s.h}>Skills</R.Text>
            {d.skills.map((g, i) => (
              <R.Text key={i} style={{ marginBottom: 1.5 }}>
                <R.Text style={{ fontFamily: "Helvetica-Bold" }}>{g.group ? `${g.group}: ` : ""}</R.Text>
                {g.items.join(", ")}
              </R.Text>
            ))}
          </R.View>
        ) : null}

        {d.experience.length ? (
          <R.View style={s.section}>
            <R.Text style={s.h}>Experience</R.Text>
            {d.experience.map((e, i) => (
              <R.View key={i} style={s.item} wrap={false}>
                <R.View style={s.row}>
                  <R.Text style={s.role}>
                    {e.role}
                    <R.Text style={{ fontFamily: "Helvetica" }}>{e.company ? ` — ${e.company}` : ""}</R.Text>
                  </R.Text>
                  <R.Text style={s.muted}>{[e.start, e.end].filter(Boolean).join(" – ")}</R.Text>
                </R.View>
                {e.location ? <R.Text style={s.muted}>{e.location}</R.Text> : null}
                {e.bullets.filter(Boolean).map((b, j) => (
                  <B key={j}>{b}</B>
                ))}
              </R.View>
            ))}
          </R.View>
        ) : null}

        {d.projects.length ? (
          <R.View style={s.section}>
            <R.Text style={s.h}>Projects</R.Text>
            {d.projects.map((p, i) => (
              <R.View key={i} style={s.item} wrap={false}>
                <R.Text style={s.role}>
                  {p.name}
                  <R.Text style={[s.muted, { fontFamily: "Helvetica" }]}>{p.tech.length ? `  ·  ${p.tech.join(", ")}` : ""}</R.Text>
                </R.Text>
                <R.Text>{p.description}</R.Text>
                {p.link ? <R.Text style={s.muted}>{p.link}</R.Text> : null}
              </R.View>
            ))}
          </R.View>
        ) : null}

        {d.education.length || d.certifications.length ? (
          <R.View style={s.section}>
            <R.Text style={s.h}>Education</R.Text>
            {d.education.map((e, i) => (
              <R.View key={i} style={s.row}>
                <R.Text>
                  <R.Text style={{ fontFamily: "Helvetica-Bold" }}>{e.degree}</R.Text>
                  {e.school ? ` — ${e.school}` : ""}
                </R.Text>
                <R.Text style={s.muted}>{e.year ?? ""}</R.Text>
              </R.View>
            ))}
            {d.certifications.length ? <R.Text style={{ marginTop: 3 }}>Certifications: {d.certifications.join(", ")}</R.Text> : null}
          </R.View>
        ) : null}
      </R.Page>
    </R.Document>
  );
}

const PHONE_KEY = "pm-resume-phone";

/** Builds a clean, ATS-friendly PDF in the browser (open-source @react-pdf/renderer). */
export function ResumeButton({ jobId, label = "Resume PDF", ...props }: { jobId?: string; label?: string } & ButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState(() => {
    try {
      return localStorage.getItem(PHONE_KEY) ?? "";
    } catch {
      return "";
    }
  });

  const make = async () => {
    setBusy(true);
    try {
      try {
        localStorage.setItem(PHONE_KEY, phone);
      } catch {
        // ignore
      }
      const r = await api<{ resume: ResumeData; tailored: boolean }>("/api/jobs/resume", { json: jobId ? { jobId } : {} });
      const resume: ResumeData = { ...r.resume, contact: { ...r.resume.contact, phone: phone || undefined } };
      const R = await import("@react-pdf/renderer");
      const blob = await R.pdf(buildDoc(R, resume)).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const who = (resume.name || "resume").replace(/[^a-z0-9]+/gi, "-");
      const target = resume.tailoredFor ? `-${`${resume.tailoredFor.company ?? ""}-${resume.tailoredFor.title}`.replace(/[^a-z0-9]+/gi, "-")}` : "";
      a.href = url;
      a.download = `${who}${target}.pdf`.replace(/-+/g, "-");
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(jobId ? (r.tailored ? "Tailored resume downloaded" : "Resume downloaded (AI unavailable — used your analysis bullets)") : "Resume downloaded");
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button {...props} onClick={() => setOpen(true)}>
        <FileDown className="h-3.5 w-3.5" /> {label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={jobId ? "Tailored resume" : "Resume PDF"}
        description={
          jobId
            ? "Built from your Portfolio + profile, rewritten for this job (truthfully — no invented experience)."
            : "Built from your Portfolio. Keep the Portfolio up to date and this stays current."
        }
        size="sm"
        footer={
          <Button variant="primary" onClick={make} loading={busy}>
            <FileDown className="h-3.5 w-3.5" /> Download PDF
          </Button>
        }
      >
        <Field label="Phone (optional — stays on this device, never published)">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98xxxxxx" inputMode="tel" />
        </Field>
      </Dialog>
    </>
  );
}
