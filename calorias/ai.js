// Análise de foto de comida com a API do Claude.
// O SDK oficial da Anthropic (@anthropic-ai/sdk 1.8.0) vai empacotado em
// vendor/ e só é carregado quando a pessoa escaneia um prato.

export class ScanError extends Error {}

export const needsKey = true;
export const useServiceWorker = true;

const MODEL = "claude-opus-5-5";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["e_comida", "prato", "itens", "observacao"],
  properties: {
    e_comida: { type: "boolean", description: "true se a foto mostra comida ou bebida" },
    prato: { type: "string", description: "Nome curto do prato/refeição em português, ex.: 'Frango com arroz e feijão'" },
    itens: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nome", "porcao_estimada", "gramas", "calorias", "proteina_g", "carboidratos_g", "gorduras_g"],
        properties: {
          nome: { type: "string" },
          porcao_estimada: { type: "string", description: "Medida caseira, ex.: '4 colheres de sopa', '1 filé médio'" },
          gramas: { type: "number" },
          calorias: { type: "number" },
          proteina_g: { type: "number" },
          carboidratos_g: { type: "number" },
          gorduras_g: { type: "number" },
        },
      },
    },
    observacao: { type: "string", description: "Uma dica curta ou ressalva (ex.: óleo escondido, molho). Vazio se nada a dizer." },
  },
};

const SYSTEM = `Você é um nutricionista que estima calorias a partir de fotos de refeições, para um app brasileiro de contagem de calorias.
Identifique cada alimento visível separadamente, estime a porção pelo tamanho do prato, talheres e outros objetos de referência, e calcule calorias e macronutrientes com base em tabelas como a TACO e a USDA.
Considere preparos típicos brasileiros (arroz branco, feijão carioca, farofa, óleo de cozimento) quando forem os mais prováveis.
Seja realista: não subestime óleo, manteiga, molhos e frituras. Arredonde calorias para inteiros e macros para uma casa decimal.
Escreva tudo em português do Brasil. Se a foto não mostrar comida, retorne e_comida=false, itens vazio e explique em observacao.`;

let sdkPromise;
const loadSdk = () => (sdkPromise ??= import("./vendor/anthropic-sdk-1.8.0.js").then((m) => m.default));

export async function analyzeFoodPhoto({ apiKey, dataUrl, profile }) {
  const Anthropic = await loadSdk();
  const [, mediaType, data] = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.*)$/) || [];
  if (!data) throw new ScanError("Formato de imagem não suportado.");

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const goal = { perder: "perder peso", manter: "manter o peso", ganhar: "ganhar peso" }[profile?.goal] || "";

  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      // se o modelo recusar a imagem, a API tenta automaticamente um modelo alternativo
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: SCHEMA },
      },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data } },
          { type: "text", text: `Analise esta refeição e estime as calorias de cada item.${goal ? ` (A pessoa quer ${goal}.)` : ""}` },
        ],
      }],
    });
  } catch (e) {
    throw new ScanError(friendlyError(e, Anthropic));
  }

  if (response.stop_reason === "refusal") {
    throw new ScanError("A IA não conseguiu analisar esta imagem. Tente outra foto do prato.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new ScanError("A resposta veio incompleta. Tente novamente.");
  }
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) {
    throw new ScanError("Resposta inesperada da IA. Tente novamente.");
  }
  parsed.itens = (parsed.itens || []).map((it) => ({
    ...it,
    gramas: Math.max(0, +it.gramas || 0),
    calorias: Math.max(0, +it.calorias || 0),
    proteina_g: Math.max(0, +it.proteina_g || 0),
    carboidratos_g: Math.max(0, +it.carboidratos_g || 0),
    gorduras_g: Math.max(0, +it.gorduras_g || 0),
  }));
  return parsed;
}

function friendlyError(e, Anthropic) {
  const msg = String(e?.message || "");
  if (e instanceof Anthropic.AuthenticationError) return "Chave da API inválida. Confira a chave em Ajustes.";
  if (e instanceof Anthropic.PermissionDeniedError) return "Sua chave não tem permissão para usar este modelo.";
  if (e instanceof Anthropic.RateLimitError) return "Muitas análises seguidas. Espere um minuto e tente de novo.";
  if (e instanceof Anthropic.APIConnectionError) return "Sem conexão com a internet (ou a conexão caiu). Tente novamente.";
  if (e instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(msg)) return "Sua conta da Anthropic está sem créditos. Adicione créditos em console.anthropic.com.";
    if (/image/i.test(msg)) return "A imagem não pôde ser processada. Tente outra foto.";
    return "Pedido recusado pela API: " + msg.slice(0, 160);
  }
  if (e instanceof Anthropic.APIError && e.status >= 500) return "O serviço de IA está instável agora. Tente de novo em instantes.";
  return "Erro ao analisar a foto: " + msg.slice(0, 160);
}
