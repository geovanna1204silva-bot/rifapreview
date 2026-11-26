// Versão da IA para quando o FotoCal roda dentro do claude.ai (Artifact):
// usa o Claude da conta de quem está usando, sem chave da API.
// O build-artifact.py troca o ai.js por este arquivo.

export class ScanError extends Error {}

export const needsKey = false;
export const keyInfo = { provider: "Claude", prefix: "", valid: () => true, help: "" };
export const useServiceWorker = false;

const sampleReady = (window.claude?.use ? window.claude.use("sample") : Promise.resolve(null)).catch(() => null);

const PROMPT = `Você é um nutricionista que estima calorias a partir de fotos de refeições, para um app brasileiro de contagem de calorias.
A imagem anexada é a foto de uma refeição.
Identifique cada alimento visível separadamente, estime a porção pelo tamanho do prato, talheres e outros objetos de referência, e calcule calorias e macronutrientes com base em tabelas como a TACO e a USDA.
Considere preparos típicos brasileiros (arroz branco, feijão carioca, farofa, óleo de cozimento) quando forem os mais prováveis.
Seja realista: não subestime óleo, manteiga, molhos e frituras.
"gramas" é a quantidade do item; use "unidade": "ml" para bebidas e líquidos e "g" para o resto.
Se a foto for de um rótulo ou tabela nutricional, use os valores impressos para a porção indicada nele.
Escreva tudo em português do Brasil.

Responda SOMENTE com um objeto JSON neste formato:
{"e_comida": true, "prato": "Frango com arroz e feijão", "observacao": "dica curta ou ressalva, ou vazio",
 "itens": [{"nome": "Arroz branco", "porcao_estimada": "4 colheres de sopa", "gramas": 100, "unidade": "g", "calorias": 128, "proteina_g": 2.5, "carboidratos_g": 28.1, "gorduras_g": 0.2}]}

Se a foto não mostrar comida, responda {"e_comida": false, "prato": "", "itens": [], "observacao": "<explique>"}.`;

// Converte sem fetch(): a página publicada não pode fazer requisições, nem para data: URLs.
function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(",");
  const type = (head.match(/^data:([^;]+)/) || [])[1] || "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

const noteText = (note) => note ? `\n\nA pessoa contou o que a foto não mostra (confie nisso, ela sabe o que comeu): "${String(note).slice(0, 500)}". Inclua esses itens, recalcule e não repita a dúvida na observação.` : "";
export async function analyzeFoodPhoto({ dataUrl, profile, note }) {
  const sample = await sampleReady;
  if (!sample) throw new ScanError("Abra o FotoCal pelo claude.ai (ou pelo app do Claude) para analisar fotos. (código: sem_claude)");
  const limits = await sample.limits().catch(() => null);
  if (!limits?.images) throw new ScanError("Este aparelho ou visualizador não permite enviar fotos ao Claude. (código: sem_imagens)");

  const goal = { perder: "perder peso", manter: "manter o peso", ganhar: "ganhar peso" }[profile?.goal];
  let parsed;
  try {
    parsed = await sample.json(PROMPT + (goal ? `\n\n(A pessoa quer ${goal}.)` : "") + noteText(note), {
      images: dataUrlToBlob(dataUrl),
      modelTier: "default",
    });
  } catch (e) {
    console.error("sample.json falhou", e);
    const code = e?.code || e?.name || "desconhecido";
    throw new ScanError(`${friendly(e?.code)} (código: ${code})`);
  }
  if (!parsed || typeof parsed !== "object") throw new ScanError("Resposta inesperada da IA. Tente novamente.");
  parsed.e_comida = parsed.e_comida !== false;
  parsed.prato = String(parsed.prato || "");
  parsed.observacao = String(parsed.observacao || "");
  parsed.itens = (Array.isArray(parsed.itens) ? parsed.itens : []).map((it) => ({
    nome: String(it?.nome || "Alimento"),
    porcao_estimada: String(it?.porcao_estimada || ""),
    unidade: it?.unidade === "ml" ? "ml" : "g",
    gramas: Math.max(0, +it?.gramas || 0),
    calorias: Math.max(0, +it?.calorias || 0),
    proteina_g: Math.max(0, +it?.proteina_g || 0),
    carboidratos_g: Math.max(0, +it?.carboidratos_g || 0),
    gorduras_g: Math.max(0, +it?.gorduras_g || 0),
  }));
  return parsed;
}

function friendly(code) {
  switch (code) {
    case "not_granted": return "Você não permitiu que o FotoCal use o Claude. Recarregue a página para permitir.";
    case "rate_limited": return "Muitas análises seguidas ou limite de uso atingido. Tente de novo mais tarde.";
    case "session_expired": return "Sua sessão expirou. Entre de novo no claude.ai.";
    case "image_rejected": return "Não consegui abrir essa imagem. Tente outra foto (JPG ou PNG).";
    case "images_unavailable": return "Este aparelho ou visualizador não permite enviar fotos ao Claude.";
    case "sampling_disabled": return "O Claude não está disponível para esta conta.";
    case "refused": return "A IA não conseguiu analisar esta imagem. Tente outra foto do prato.";
    case "invalid_json": case "empty_completion": return "A resposta veio incompleta. Tente novamente.";
    case "cancelled": return "Análise cancelada.";
    default: return "Falha temporária ao analisar a foto. Tente novamente.";
  }
}

/* =========================================================
   Cópia na nuvem (conta do Claude de quem usa)
   Quando o claude.ai é aberto pelo ícone da tela inicial, o iPhone pode
   apagar a memória da página ao fechar. Por isso a conta e os dados também
   ficam no banco privado do artifact, em data/users/<id>/ (só a própria
   pessoa lê e escreve ali).
   Cada documento tem no máximo 256 KiB: o estado de cada conta é dividido
   em "main" (perfil, pesos, ajustes) e um documento por mês de refeições,
   sem as miniaturas das fotos.
   ========================================================= */
const capsReady = (window.claude?.use
  ? Promise.all([window.claude.use("db"), window.claude.use("user")])
  : Promise.resolve([null, null])).catch(() => [null, null]);

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
const STATE_RE = /^fotocal:v1:(.+)$/;
const safe = (s) => String(s).replace(/[^A-Za-z0-9_\-.~:@+]/g, "_").slice(0, 150);

function partsFor(key, value) {
  const m = key.match(STATE_RE);
  if (!m) return { [`kv~${safe(key)}`]: { key, part: "whole", v: value } };
  let st;
  try { st = JSON.parse(value); } catch (_) { return { [`kv~${safe(key)}`]: { key, part: "whole", v: value } }; }
  const base = `st~${safe(m[1])}`;
  const { log = {}, ...main } = st;
  const out = { [`${base}~main`]: { key, part: "main", v: JSON.stringify(main) } };
  for (const [day, d] of Object.entries(log)) {
    const month = day.slice(0, 7);
    const id = `${base}~log~${month}`;
    out[id] ??= { key, part: "log", month, days: {} };
    out[id].days[day] = { ...d, meals: (d.meals || []).map(({ thumb, ...rest }) => rest) };
  }
  return out;
}

let col = null;
const written = new Map();   // docId -> JSON escrito por último
const docsByKey = new Map(); // key -> Set(docId)
const pending = new Map();   // key -> valor a gravar
let timer = null, chain = Promise.resolve();

function flush() {
  clearTimeout(timer); timer = null;
  if (!col) return;
  const batch = [...pending]; pending.clear();
  for (const [key, value] of batch) {
    const parts = value == null ? {} : partsFor(key, value);
    const known = docsByKey.get(key) || new Set();
    for (const id of known) {
      if (!(id in parts)) chain = chain.then(() => col.doc(id).delete()).catch(() => {});
    }
    docsByKey.set(key, new Set(Object.keys(parts)));
    for (const [id, body] of Object.entries(parts)) {
      const json = JSON.stringify(body);
      if (written.get(id) === json) continue;
      written.set(id, json);
      chain = chain.then(() => col.doc(id).set(body)).catch((e) => {
        written.delete(id);
        console.warn("FotoCal: não salvou na nuvem", id, e?.code);
      });
    }
  }
}
document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });
window.addEventListener("pagehide", flush);

export const cloud = {
  write(key, value) {
    if (!key.startsWith("fotocal:")) return;
    pending.set(key, value);
    if (col) { clearTimeout(timer); timer = setTimeout(flush, 300); }
  },
  async init(kv) {
    try {
      const [db, user] = await withTimeout(capsReady, 10000);
      const uid = db && user ? await user.id() : null;
      if (!uid) return;
      const c = db.collection(`data/users/${uid}`);
      const snap = await withTimeout(c.get(), 12000);
      // remonta os valores a partir dos documentos
      const byKey = new Map();
      for (const d of snap.docs) {
        const body = d.data();
        if (!body?.key) continue;
        written.set(d.id, JSON.stringify(body));
        if (!docsByKey.has(body.key)) docsByKey.set(body.key, new Set());
        docsByKey.get(body.key).add(d.id);
        const e = byKey.get(body.key) || { whole: null, main: null, log: {} };
        if (body.part === "whole") e.whole = body.v;
        if (body.part === "main") e.main = body.v;
        if (body.part === "log") Object.assign(e.log, body.days || {});
        byKey.set(body.key, e);
      }
      for (const [key, e] of byKey) {
        if (e.whole !== null && e.main === null) { kv.fromCloud(key, e.whole); continue; }
        if (e.main === null) continue;
        let st;
        try { st = JSON.parse(e.main); } catch (_) { continue; }
        // mantém as miniaturas que este aparelho ainda tiver
        let local = null;
        try { local = JSON.parse(kv.get(key) || "null"); } catch (_) { /* ignora */ }
        for (const [day, d] of Object.entries(e.log)) {
          const ld = local?.log?.[day];
          if (ld?.meals?.length === d.meals?.length) d.meals.forEach((m, i) => { if (ld.meals[i]?.name === m.name) m.thumb = ld.meals[i].thumb || ""; });
        }
        st.log = e.log;
        kv.fromCloud(key, JSON.stringify(st));
      }
      // o que só existe neste aparelho sobe para a nuvem
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k?.startsWith("fotocal:") && !byKey.has(k)) pending.set(k, localStorage.getItem(k));
        }
      } catch (_) { /* sem localStorage */ }
      col = c;
      flush();
    } catch (e) {
      console.warn("FotoCal: nuvem indisponível, usando só o aparelho", e?.code || e?.message);
    }
  },
};
