import { handle, HttpError, requireUser } from "@/lib/auth";

export const maxDuration = 60;

/** Extracts text from an uploaded resume (PDF or plain text) and stores it on the job profile. */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, supabase } = await requireUser();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Attach a file named 'file'.");
    if (file.size > 8 * 1024 * 1024) throw new HttpError(413, "File is larger than 8 MB.");

    let text = "";
    const name = file.name.toLowerCase();
    if (file.type === "application/pdf" || name.endsWith(".pdf")) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
      const result = await extractText(pdf, { mergePages: true });
      text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
    } else if (/\.(txt|md|markdown|rtf)$/.test(name) || file.type.startsWith("text/")) {
      text = await file.text();
    } else {
      throw new HttpError(415, "Upload a PDF or .txt/.md file, or paste the text into the chat.");
    }
    text = text.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 30_000);
    if (text.length < 80) throw new HttpError(422, "Couldn't read much text from that file. Is it a scanned image? Paste the text instead.");

    const { error } = await supabase.from("job_profiles").upsert({ user_id: user.id, resume_text: text });
    if (error) throw new HttpError(500, error.message);
    return { ok: true, chars: text.length, preview: text.slice(0, 400) };
  });
}
