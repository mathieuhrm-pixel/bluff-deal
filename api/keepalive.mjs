// Appelé chaque jour par un cron Vercel : une petite requête en base empêche
// le projet Supabase gratuit (relais du mode en ligne) de se mettre en pause.
const URL = "https://vjtkkgtpgnhxtvwslttr.supabase.co/rest/v1/heartbeat?select=id";
const KEY = "sb_publishable_ZtsRxryVJBZKc5qS_ir8oQ_xEffDNw4";

export default async function handler(req, res) {
  try {
    const r = await fetch(URL, { headers: { apikey: KEY } });
    res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e) });
  }
}
