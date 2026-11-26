// Análise de foto de comida com a IA do Google (Gemini), pelo plano gratuito.
// A pessoa cria uma chave grátis em aistudio.google.com e cola em Ajustes.
// Como a lista de modelos gratuitos muda com frequência, o app pergunta à API
// quais modelos a chave pode usar e escolhe o melhor "flash"; se a cota diária
// de um acabar, tenta o próximo.
// (A versão com o Claude pago está em ai-anthropic.js.)

export class ScanError extends Error {}

export const needsKey = true;
export const useServiceWorker = true;
export const cloud = null; // sem cópia na nuvem: tudo fica no aparelho
export const keyInfo = {
  provider: "Google, grátis",
  prefix: "AIza",
  valid: (k) => typeof k === "string" && /^AIza[\w-]{20,}$/.test(k.trim()),
  help: `O reconhecimento de comida usa a IA do Google (Gemini), que tem uso <b>gratuito</b> todo dia.
    Entre em <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>
    com sua conta Google, toque em <b>Create API key</b> (Criar chave), copie e cole aqui.
    Não precisa de cartão. A chave fica salva só neste aparelho.`,
};

const BASE = "https://generativelanguage.googleapis.com/v1beta";

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

class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `HTTP ${status}`);
    this.status = status;
    this.apiStatus = body?.error?.status || "";
  }
}

async function api(path, apiKey, body) {
  let r;
  try {
    r = await fetch(`${BASE}/${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey)}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (_) {
    throw new ScanError("Sem conexão com a internet. Tente novamente. (código: rede)");
  }
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, json);
  return json;
}

// Pontua os modelos: flash > flash-lite > pro; versão mais nova primeiro.
function rank(id) {
  if (!/^gemini-/.test(id)) return -1;
  if (/(image|live|tts|audio|embed|native|robotics|computer|thinking-exp|learnlm)/.test(id)) return -1;
  const v = parseFloat((id.match(/^gemini-(\d+(?:\.\d+)?)/) || [])[1] || "0");
  const family = /flash-lite/.test(id) ? 1 : /flash/.test(id) ? 3 : /pro/.test(id) ? 0.5 : -1;
  if (family < 0) return -1;
  return family * 100 + v - (/(preview|exp)/.test(id) ? 0.01 : 0) - (/-\d{3}$|-\d{2}-\d{4}$/.test(id) ? 0.005 : 0);
}

let modelsCache = { key: "", list: [] };
async function candidateModels(apiKey) {
  if (modelsCache.key === apiKey && modelsCache.list.length) return modelsCache.list;
  let data;
  try { data = await api("models?pageSize=200", apiKey); }
  catch (e) { throw new ScanError(friendly(e)); }
  const list = (data?.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => String(m.name || "").replace(/^models\//, ""))
    .filter((id) => rank(id) >= 0)
    .sort((a, b) => rank(b) - rank(a));
  if (!list.length) throw new ScanError("Sua chave não tem acesso a nenhum modelo de IA com imagens. (código: sem_modelos)");
  modelsCache = { key: apiKey, list };
  return list;
}

export async function analyzeFoodPhoto({ apiKey, dataUrl, profile }) {
  const key = String(apiKey || "").trim();
  const [, mimeType, data] = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.*)$/) || [];
  if (!data) throw new ScanError("Formato de imagem não suportado.");
  const goal = { perder: "perder peso", manter: "manter o peso", ganhar: "ganhar peso" }[profile?.goal];
  const body = {
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType, data } },
        { text: PROMPT + (goal ? `\n\n(A pessoa quer ${goal}.)` : "") },
      ],
    }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
  };

  const models = await candidateModels(key);
  let lastErr;
  // tenta até 4 modelos: se a cota grátis de um acabar, passa para o próximo
  for (const model of models.slice(0, 4)) {
    let res;
    try {
      res = await api(`models/${encodeURIComponent(model)}:generateContent`, key, body);
    } catch (e) {
      lastErr = e;
      if (e instanceof ApiError && (e.status === 429 || e.status === 404 || e.status === 503 || e.status === 500)) continue;
      throw new ScanError(friendly(e));
    }
    if (res?.promptFeedback?.blockReason) throw new ScanError("A IA não conseguiu analisar esta imagem. Tente outra foto do prato. (código: bloqueado)");
    const cand = res?.candidates?.[0];
    const text = (cand?.content?.parts || []).map((p) => p.text || "").join("");
    if (!text) {
      if (cand?.finishReason === "SAFETY") throw new ScanError("A IA não conseguiu analisar esta imagem. Tente outra foto do prato. (código: seguranca)");
      lastErr = new ScanError("A IA não respondeu. Tente novamente. (código: vazio)");
      continue;
    }
    return normalize(parseJson(text));
  }
  throw lastErr instanceof ScanError ? lastErr : new ScanError(friendly(lastErr));
}

function parseJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(t); } catch (_) { /* tenta recortar */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch (_) { /* cai no erro */ }
  }
  throw new ScanError("Resposta inesperada da IA. Tente novamente. (código: json)");
}

function normalize(parsed) {
  if (!parsed || typeof parsed !== "object") throw new ScanError("Resposta inesperada da IA. Tente novamente. (código: json)");
  return {
    e_comida: parsed.e_comida !== false,
    prato: String(parsed.prato || ""),
    observacao: String(parsed.observacao || ""),
    itens: (Array.isArray(parsed.itens) ? parsed.itens : []).map((it) => ({
      nome: String(it?.nome || "Alimento"),
      porcao_estimada: String(it?.porcao_estimada || ""),
      unidade: it?.unidade === "ml" ? "ml" : "g",
      gramas: Math.max(0, +it?.gramas || 0),
      calorias: Math.max(0, +it?.calorias || 0),
      proteina_g: Math.max(0, +it?.proteina_g || 0),
      carboidratos_g: Math.max(0, +it?.carboidratos_g || 0),
      gorduras_g: Math.max(0, +it?.gorduras_g || 0),
    })),
  };
}

function friendly(e) {
  if (e instanceof ScanError) return e.message;
  const msg = String(e?.message || "");
  const code = e?.apiStatus || e?.status || "desconhecido";
  if (/api key not valid|API_KEY_INVALID/i.test(msg) || e?.status === 400 && /key/i.test(msg))
    return `Chave inválida. Confira a chave em Ajustes. (código: ${code})`;
  if (e?.status === 429) return `A cota gratuita de hoje acabou. Ela volta amanhã. (código: ${code})`;
  if (e?.status === 403) return `Sua chave não tem permissão para usar a IA. Crie uma chave nova no AI Studio. (código: ${code})`;
  if (/location is not supported|FAILED_PRECONDITION/i.test(msg + code)) return `A IA gratuita do Google não está disponível para esta conta ou região. (código: ${code})`;
  if (e?.status >= 500) return `O serviço de IA está instável agora. Tente de novo em instantes. (código: ${code})`;
  return `Erro ao analisar a foto: ${msg.slice(0, 120)} (código: ${code})`;
}
