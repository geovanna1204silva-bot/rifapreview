// FotoCal — contador de calorias por foto com plano personalizado.
// Tudo fica salvo no próprio aparelho (localStorage), inclusive a conta
// (e-mail + hash da senha). A análise das fotos usa a IA do Claude.

import * as AI from "./ai.js";
const needKey = () => AI.needsKey && !AI.keyInfo.valid(state.apiKey);

/* =========================================================
   Armazenamento
   ========================================================= */
// Cada conta guarda seus dados em uma chave própria: fotocal:v1:<email>
const LEGACY_KEY = "fotocal:v1";
const ACC_KEY = "fotocal:accounts"; // { users: { email: {salt, hash} }, current: email|null }
let KEY = null;
const defaults = () => ({
  profile: null,       // preenchido ao final do questionário
  apiKey: "",
  log: {},             // { "2026-11-25": { meals: [...], water: 0 } }
  weights: [],         // [{ date, kg }]
  reminders: [],
  lastReminder: "",
});
let state = defaults();
function load() {
  try {
    const raw = KEY && localStorage.getItem(KEY);
    if (raw) return { ...defaults(), ...JSON.parse(raw) };
  } catch (_) { /* sem armazenamento: segue em memória */ }
  return defaults();
}
function save() {
  if (!KEY) return;
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (_) { toast("Não foi possível salvar neste aparelho (memória cheia?)"); }
}

/* =========================================================
   Conta (e-mail e senha, guardada só neste aparelho)
   ========================================================= */
function readAccounts() {
  try { return { users: {}, current: null, ...JSON.parse(localStorage.getItem(ACC_KEY) || "{}") }; }
  catch (_) { return { users: {}, current: null }; }
}
function writeAccounts(a) {
  try { localStorage.setItem(ACC_KEY, JSON.stringify(a)); return true; }
  catch (_) { return false; }
}
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
// A senha nunca é salva: guardamos só um hash PBKDF2 com sal aleatório.
async function hashPassword(password, saltB64) {
  const salt = saltB64 ? Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" }, key, 256);
  return { salt: b64(salt), hash: b64(bits) };
}
const normEmail = (e) => String(e || "").trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
function startSession(email) {
  KEY = `${LEGACY_KEY}:${email}`;
  state = load();
  tab = "hoje";
}
function logout() {
  const a = readAccounts(); a.current = null; writeAccounts(a);
  KEY = null; state = defaults(); scan = null; authMode = "login";
  draft = { name: "", goal: "", sex: "", age: "", height: "", weight: "", target: "", activity: "", pace: 0.5, obstacles: [], reminders: [] };
  step = 0;
  render();
}

/* =========================================================
   Utilidades
   ========================================================= */
const $app = document.getElementById("app");
const fmt = (n, d = 0) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const todayKey = (d = new Date()) => {
  const z = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function day(key = todayKey()) {
  if (!state.log[key]) state.log[key] = { meals: [], water: 0 };
  return state.log[key];
}
let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

const ICON = {
  back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
  arrow: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7 12h10"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7v8a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5M4 19h16M8 15l4-4 3 3 5-6"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};

/* =========================================================
   Cálculos do plano
   ========================================================= */
const ACTIVITY = {
  sedentario: { f: 1.2, t: "Sedentário", s: "Pouco ou nenhum exercício", e: "🛋️" },
  leve: { f: 1.375, t: "Levemente ativo", s: "Exercício 1–3 dias/semana", e: "🚶" },
  moderado: { f: 1.55, t: "Moderadamente ativo", s: "Exercício 3–5 dias/semana", e: "🏃" },
  intenso: { f: 1.725, t: "Muito ativo", s: "Exercício 6–7 dias/semana", e: "🏋️" },
};
const PACE = [
  [0.25, { t: "Lento", e: "🐢" }],
  [0.5, { t: "Recomendado", e: "🐇" }],
  [1, { t: "Rápido", e: "🐆" }],
];

function computePlan(p) {
  // Taxa metabólica basal — Mifflin-St Jeor
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === "m" ? 5 : -161);
  const tdee = bmr * ACTIVITY[p.activity].f;
  const floor = p.sex === "m" ? 1500 : 1200; // mínimo seguro sem acompanhamento
  let target = tdee;
  let pace = 0;
  if (p.goal === "perder") {
    target = Math.max(tdee - (p.pace * 7700) / 7, floor);
    pace = ((tdee - target) * 7) / 7700;
  } else if (p.goal === "ganhar") {
    target = tdee + (p.pace * 7700) / 7;
    pace = p.pace;
  }
  const diff = p.goal === "manter" ? 0 : Math.abs(p.weight - p.target);
  const weeks = pace > 0 ? diff / pace : 0;
  const date = new Date(Date.now() + weeks * 7 * 864e5);
  const kcal = Math.round(target / 10) * 10;
  const protein = Math.round(clamp(1.8 * p.weight, 60, 220));
  const fat = Math.round((kcal * 0.27) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  const bmi = p.weight / (p.height / 100) ** 2;
  return {
    bmr: Math.round(bmr), tdee: Math.round(tdee), kcal, protein, fat, carbs,
    deficit: Math.round(tdee - kcal), pace, weeks, date, diff,
    water: Math.round((p.weight * 35) / 250) * 250, bmi,
    floored: p.goal === "perder" && tdee - (p.pace * 7700) / 7 < floor,
  };
}

/* =========================================================
   Questionário (onboarding)
   ========================================================= */
let draft = {
  name: "", goal: "", sex: "", age: "", height: "", weight: "", target: "",
  activity: "", pace: 0.5, obstacles: [], reminders: [],
};
let step = 0;

const STEPS = [
  { id: "welcome" }, { id: "goal" }, { id: "sex" }, { id: "body" }, { id: "weight" },
  { id: "target", skip: () => draft.goal === "manter" },
  { id: "activity" },
  { id: "pace", skip: () => draft.goal === "manter" },
  { id: "promise", skip: () => draft.goal === "manter" },
  { id: "demo" }, { id: "obstacles" }, { id: "reminders" }, { id: "plan" },
];
const visibleSteps = () => STEPS.filter((s) => !s.skip || !s.skip());

function hero(emoji, bg, chipHtml) {
  return `<div class="hero" style="background:${bg}">
    <svg class="art" viewBox="0 0 400 210" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <circle cx="330" cy="40" r="90" fill="rgba(255,255,255,.14)"/>
      <circle cx="60" cy="200" r="120" fill="rgba(255,255,255,.10)"/>
      <text x="300" y="150" font-size="110" text-anchor="middle">${emoji}</text>
    </svg>
    ${chipHtml ? `<div class="chip">${chipHtml}</div>` : ""}
  </div>`;
}

function opt({ key, on, emoji, title, sub, orange }) {
  return `<button class="opt ${on ? "on" : ""}" data-opt="${esc(key)}">
    <span class="ic ${orange ? "o" : ""}">${emoji}</span>
    <span class="tx"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</span>
    <span class="rd">${on ? ICON.check : ""}</span>
  </button>`;
}

function renderOnboarding() {
  const list = visibleSteps();
  step = clamp(step, 0, list.length - 1);
  const s = list[step].id;
  const pct = Math.round((step / (list.length - 1)) * 100);
  let body = "";
  let foot = "";
  let canNext = true;
  const cont = (label = "Continuar") =>
    `<button class="btn" id="next" ${canNext ? "" : "disabled"}>${label} ${ICON.arrow}</button>`;

  switch (s) {
    case "welcome":
      body = `${hero("🥗", "linear-gradient(135deg,#7cc8ff,#2f6bf0)", `<small>🔥 Hoje</small><b>1.420 / 1.900 kcal</b><div class="mini"><i style="width:74%"></i></div>`)}
        <h1>Conte calorias com <span class="hl">uma foto</span>.</h1>
        <p class="sub">Responda algumas perguntas rápidas e montamos um plano com quantas calorias você deve comer por dia — e quanto peso falta para sua meta.</p>
        <div class="field"><label>Como podemos te chamar? (opcional)</label>
          <input type="text" id="f-name" placeholder="Seu nome" value="${esc(draft.name)}" autocomplete="given-name"></div>`;
      foot = cont("Começar");
      break;

    case "goal":
      canNext = !!draft.goal;
      body = `<h1>Qual é o seu objetivo?</h1><p class="sub">Isso define se seu plano terá déficit ou superávit de calorias.</p>
        <div class="opts">
          ${opt({ key: "perder", on: draft.goal === "perder", emoji: "⬇️", title: "Perder peso", sub: "Emagrecer com segurança" })}
          ${opt({ key: "manter", on: draft.goal === "manter", emoji: "⚖️", title: "Manter o peso", sub: "Comer na medida certa" })}
          ${opt({ key: "ganhar", on: draft.goal === "ganhar", emoji: "💪", title: "Ganhar peso", sub: "Ganho de massa", orange: true })}
        </div>`;
      foot = cont();
      break;

    case "sex":
      canNext = !!draft.sex;
      body = `<h1>Qual é o seu sexo biológico?</h1><p class="sub">Usamos isso só para calcular seu gasto calórico basal.</p>
        <div class="opts">
          ${opt({ key: "f", on: draft.sex === "f", emoji: "♀️", title: "Feminino" })}
          ${opt({ key: "m", on: draft.sex === "m", emoji: "♂️", title: "Masculino" })}
        </div>`;
      foot = cont();
      break;

    case "body":
      canNext = draft.age >= 14 && draft.age <= 100 && draft.height >= 120 && draft.height <= 230;
      body = `<h1>Idade e altura</h1><p class="sub">Precisamos desses dados para estimar quanto você gasta por dia.</p>
        <div class="field"><label>Idade</label><div class="row"><input type="number" inputmode="numeric" id="f-age" placeholder="30" value="${esc(draft.age)}"><span class="unit">anos</span></div></div>
        <div class="field"><label>Altura</label><div class="row"><input type="number" inputmode="numeric" id="f-height" placeholder="165" value="${esc(draft.height)}"><span class="unit">cm</span></div></div>`;
      foot = cont();
      break;

    case "weight":
      canNext = draft.weight >= 30 && draft.weight <= 300;
      body = `<h1>Qual é o seu peso atual?</h1><p class="sub">Pode ser aproximado. Você atualiza depois na aba Progresso.</p>
        <div class="field"><label>Peso atual</label><div class="row"><input type="number" inputmode="decimal" step="0.1" id="f-weight" placeholder="71,2" value="${esc(draft.weight)}"><span class="unit">kg</span></div></div>`;
      foot = cont();
      break;

    case "target": {
      const w = +draft.weight, t = +draft.target;
      const okDir = draft.goal === "perder" ? t < w : t > w;
      canNext = t >= 30 && t <= 300 && okDir;
      const h = (+draft.height || 165) / 100;
      const healthy = `${fmt(18.5 * h * h, 1)} – ${fmt(24.9 * h * h, 1)} kg`;
      body = `<h1>Qual é o seu peso meta?</h1><p class="sub">Faixa de peso saudável para sua altura (IMC 18,5–24,9): <b>${healthy}</b>.</p>
        <div class="field"><label>Peso meta</label><div class="row"><input type="number" inputmode="decimal" step="0.1" id="f-target" placeholder="${draft.goal === "perder" ? "62" : "75"}" value="${esc(draft.target)}"><span class="unit">kg</span></div></div>
        <p class="err" id="t-err" ${t && !okDir ? "" : "hidden"}>${draft.goal === "perder" ? "A meta precisa ser menor que o peso atual." : "A meta precisa ser maior que o peso atual."}</p>`;
      foot = cont();
      break;
    }

    case "activity":
      canNext = !!draft.activity;
      body = `<h1>Qual é o seu nível de atividade?</h1><p class="sub">Inclua trabalho, caminhadas e treinos.</p>
        <div class="opts">${Object.entries(ACTIVITY).map(([k, a], i) =>
          opt({ key: k, on: draft.activity === k, emoji: a.e, title: a.t, sub: a.s, orange: i === 3 })).join("")}</div>`;
      foot = cont();
      break;

    case "pace": {
      const verb = draft.goal === "perder" ? "perder" : "ganhar";
      const plan = computePlan(profileFromDraft());
      body = `${hero("🏃", "linear-gradient(135deg,#9be2b5,#2f9e6b)", `<small>👟 Passos hoje</small><b>8.432</b><div class="mini"><i style="width:84%"></i></div>`)}
        <h1>Em que ritmo você deseja alcançar seu objetivo?</h1><p class="sub"></p>
        <div class="opts">${PACE.map(([k, p], i) =>
          opt({ key: k, on: +draft.pace === +k, emoji: p.e, title: p.t, sub: `${fmt(+k, 2).replace(/0$/, "")} kg por semana`, orange: i === 2 })).join("")}</div>
        <div class="proj"><small>SUA PROJEÇÃO</small>
          <p>${plan.pace > 0 ? `Você deve ${verb} <b>${fmt(plan.diff, 1)} kg</b> até <b>${plan.date.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" })}</b> comendo cerca de <b>${fmt(plan.kcal)} kcal/dia</b>.` : ""}</p>
          ${plan.floored ? `<p style="font-size:14px;font-weight:600;color:#8a4b10;margin-top:8px">Esse ritmo exigiria comer menos que o mínimo seguro, então limitamos a ${fmt(plan.kcal)} kcal/dia (≈ ${fmt(plan.pace, 2)} kg/semana).</p>` : ""}
        </div>`;
      foot = cont();
      break;
    }

    case "promise": {
      const p = profileFromDraft();
      const plan = computePlan(p);
      const verb = p.goal === "perder" ? "Eliminar" : "Ganhar";
      body = `${hero("🏖️", "linear-gradient(180deg,#8fd3ff,#3a8df5)", `<small>🏃 Corrida de hoje</small><b>5,2 km · 312 kcal</b><div class="mini"><i style="width:100%"></i></div>`)}
        <h1>${verb} <span class="hl">${fmt(plan.diff, 1)} kg</span> começa com um plano!</h1>
        <p class="sub">Para ajudar você a progredir com consistência, criaremos um plano personalizado para seus hábitos, metas e prazos.</p>
        ${trajectoryChart(p.weight, p.target, "Agora", "Meta")}`;
      foot = cont();
      break;
    }

    case "demo":
      body = `<h1>Uma foto. Calorias na hora.</h1><p class="sub">No app, toque no botão central, fotografe o prato e a IA identifica cada alimento e calcula calorias e macros.</p>
        <div class="scanbox" style="background:radial-gradient(circle at 50% 50%,#fff 0 36%,#f1ede6 37% 41%,#c79a6b 42%)">
          <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
          <svg viewBox="0 0 200 200" style="position:absolute;inset:0;width:100%;height:100%" aria-hidden="true">
            <text x="72" y="92" font-size="44" text-anchor="middle">🍗</text>
            <text x="130" y="88" font-size="40" text-anchor="middle">🥦</text>
            <text x="78" y="140" font-size="40" text-anchor="middle">🍚</text>
            <text x="132" y="138" font-size="38" text-anchor="middle">🫘</text>
          </svg>
          <span class="laser" style="display:block"></span>
        </div>
        <div class="card" style="margin-top:16px">
          <div class="result-total"><b>612</b><span>kcal · exemplo</span></div>
          <div class="macros" style="margin-top:8px">
            <div class="macro"><small>Proteína</small><b>48 <em>g</em></b></div>
            <div class="macro"><small>Carbo</small><b>62 <em>g</em></b></div>
            <div class="macro"><small>Gordura</small><b>17 <em>g</em></b></div>
          </div>
        </div>`;
      foot = cont();
      break;

    case "obstacles": {
      const OB = [
        ["consistencia", "📅", "Falta de consistência"],
        ["habitos", "🍔", "Hábitos alimentares desregulados"],
        ["apoio", "🤝", "Falta de apoio"],
        ["tempo", "⏰", "Agenda corrida"],
        ["inspiracao", "💡", "Falta de ideias de refeições"],
      ];
      body = `${hero("💻", "linear-gradient(135deg,#ffd9a8,#f0a24e)", "")}
        <h1>O que está impedindo você de alcançar suas metas?</h1><p class="sub">Pode marcar mais de uma.</p>
        <div class="opts">${OB.map(([k, e, t], i) => opt({ key: k, on: draft.obstacles.includes(k), emoji: e, title: t, orange: i === 2 })).join("")}</div>`;
      foot = cont();
      break;
    }

    case "reminders": {
      const T = ["08:00", "12:30", "19:00", "21:00"];
      body = `${hero("💧", "linear-gradient(135deg,#bfe3ff,#4f9bf7)", `<small>💧 Água hoje</small><b>1.250 <span style="font-size:15px;color:var(--muted)">/ 2.000 ml</span></b><div class="mini"><i style="width:62%;background:var(--blue-2)"></i></div>`)}
        <h1>Que horas te lembro de registrar?</h1><p class="sub">Marque um ou mais horários. Quem recebe lembrete registra muito mais.</p>
        <div class="times">${T.map((t) => `<button class="time ${draft.reminders.includes(t) ? "on" : ""}" data-time="${t}">${t}</button>`).join("")}</div>`;
      foot = `<button class="btn" id="next">${draft.reminders.length ? "Ativar lembrete" : "Continuar"}</button>
        <button class="link" id="skip">Agora não</button>`;
      break;
    }

    case "plan": {
      const p = profileFromDraft();
      const plan = computePlan(p);
      const goalTxt = p.goal === "manter" ? "manter seu peso" : `${p.goal === "perder" ? "perder" : "ganhar"} ${fmt(plan.diff, 1)} kg`;
      body = `<h1>${p.name ? esc(p.name) + ", seu" : "Seu"} plano está pronto! 🎉</h1>
        <p class="sub">Para ${goalTxt}${plan.weeks ? ` até <b>${plan.date.toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}</b>` : ""}, você deve comer:</p>
        <div class="plan-grid">
          <div class="stat big"><small>Coma por dia</small><b>${fmt(plan.kcal)} <em>kcal</em></b></div>
          <div class="stat"><small>${p.goal === "ganhar" ? "Falta ganhar" : "Falta perder"}</small><b>${fmt(plan.diff, 1)} <em>kg</em></b></div>
          <div class="stat"><small>Água</small><b>${fmt(plan.water)} <em>ml</em></b></div>
          <div class="stat"><small>Proteína</small><b>${plan.protein} <em>g</em></b></div>
          <div class="stat"><small>Carbo · Gordura</small><b>${plan.carbs}<em>g</em> · ${plan.fat}<em>g</em></b></div>
        </div>
        ${deficitCard(p, plan)}
        <p class="note">Gasto basal (Mifflin-St Jeor): ${fmt(plan.bmr)} kcal · IMC atual: ${fmt(plan.bmi, 1)}. Estimativas gerais, não substituem orientação de nutricionista ou médico — especialmente se você tem alguma condição de saúde, está grávida ou amamentando.</p>`;
      foot = `<button class="btn" id="finish">Começar a usar ${ICON.arrow}</button>`;
      break;
    }
  }

  $app.innerHTML = `<div class="ob">
    <div class="ob-top">
      <button class="back" id="back" aria-label="Voltar" ${step === 0 ? "disabled" : ""}>${ICON.back}</button>
      <div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.max(pct, 4)}%"></i></div>
      <span class="pct">${pct}%</span>
    </div>
    <div class="ob-body">${body}</div>
    <div class="ob-foot"><div>${foot}</div></div>
  </div>`;
  window.scrollTo(0, 0);
  bindOnboarding(s);
}

function profileFromDraft() {
  return {
    name: draft.name.trim(), goal: draft.goal || "perder", sex: draft.sex || "f",
    age: +draft.age || 30, height: +draft.height || 165, weight: +draft.weight || 70,
    target: draft.goal === "manter" ? +draft.weight : +draft.target || +draft.weight,
    activity: draft.activity || "sedentario", pace: +draft.pace || 0.5,
    obstacles: draft.obstacles, startWeight: +draft.weight, startDate: todayKey(),
  };
}

function bindOnboarding(s) {
  const next = () => { step++; renderOnboarding(); };
  document.getElementById("back").onclick = () => { step--; renderOnboarding(); };
  const nb = document.getElementById("next");
  if (nb) nb.onclick = next;

  const live = (id, prop) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      draft[prop] = el.value.replace(",", ".");
      const list = visibleSteps();
      const btn = document.getElementById("next");
      // revalida sem redesenhar a tela (mantém o teclado aberto)
      if (btn) btn.disabled = !validStep(list[step].id);
    });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" && validStep(s)) next(); });
  };
  live("f-name", "name"); live("f-age", "age"); live("f-height", "height");
  live("f-weight", "weight"); live("f-target", "target");
  if (s === "target") {
    const el = document.getElementById("f-target"), err = document.getElementById("t-err");
    el.addEventListener("input", () => {
      const t = +draft.target, w = +draft.weight;
      err.hidden = !(t >= 30 && (draft.goal === "perder" ? t >= w : t <= w));
    });
  }

  document.querySelectorAll("[data-opt]").forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.opt;
      if (s === "goal") draft.goal = k;
      if (s === "sex") draft.sex = k;
      if (s === "activity") draft.activity = k;
      if (s === "pace") draft.pace = +k;
      if (s === "obstacles") {
        draft.obstacles = draft.obstacles.includes(k) ? draft.obstacles.filter((x) => x !== k) : [...draft.obstacles, k];
      }
      renderOnboarding();
    };
  });
  document.querySelectorAll("[data-time]").forEach((b) => {
    b.onclick = () => {
      const t = b.dataset.time;
      draft.reminders = draft.reminders.includes(t) ? draft.reminders.filter((x) => x !== t) : [...draft.reminders, t];
      renderOnboarding();
    };
  });
  if (s === "reminders") {
    nb.onclick = async () => {
      if (draft.reminders.length && "Notification" in window && Notification.permission === "default") {
        try { await Notification.requestPermission(); } catch (_) { /* ignora */ }
      }
      next();
    };
    document.getElementById("skip").onclick = () => { draft.reminders = []; next(); };
  }
  const fin = document.getElementById("finish");
  if (fin) fin.onclick = () => {
    const p = profileFromDraft();
    state.profile = p;
    state.reminders = draft.reminders;
    state.weights = [{ date: todayKey(), kg: p.weight }];
    save();
    tab = "hoje";
    render();
    if (needKey()) setTimeout(() => openKeySheet(true), 400);
  };
}

function validStep(s) {
  const w = +draft.weight, t = +draft.target;
  switch (s) {
    case "body": return draft.age >= 14 && draft.age <= 100 && draft.height >= 120 && draft.height <= 230;
    case "weight": return w >= 30 && w <= 300;
    case "target": return t >= 30 && t <= 300 && (draft.goal === "perder" ? t < w : t > w);
    default: return true;
  }
}

// A conta do déficit em linguagem simples: gasta − come = déficit.
// eaten: quanto já comeu hoje (só na tela Hoje); sem ele mostra o plano.
function deficitCard(p, plan, eaten) {
  const gain = p.goal === "ganhar", keep = p.goal === "manter";
  const word = gain ? "superávit" : "déficit";
  const weekKg = (Math.abs(plan.deficit) * 7) / 7700;
  if (eaten === undefined) {
    const explain = keep
      ? `Comendo o mesmo que gasta, seu peso fica estável.`
      : gain
        ? `Comendo <b>${fmt(Math.abs(plan.deficit))} kcal a mais</b> do que gasta, todo dia, você ganha cerca de <b>${fmt(weekKg, 2)} kg por semana</b>.`
        : `Comendo <b>${fmt(plan.kcal)} kcal</b>, faltam <b>${fmt(plan.deficit)} kcal</b> para o que seu corpo gasta. Ele tira essa diferença da gordura guardada: ${fmt(plan.deficit)} × 7 dias = ${fmt(plan.deficit * 7)} kcal por semana ≈ <b>${fmt(weekKg, 2)} kg a menos por semana</b> (1 kg de gordura ≈ 7.700 kcal).`;
    return `<div class="eq">
      <h3>${keep ? "Sua conta do dia" : `Sua conta do ${word}`}</h3>
      <div class="eq-row"><span>🔥 Seu corpo gasta por dia</span><b>${fmt(plan.tdee)} kcal</b></div>
      <div class="eq-row"><span>🍽️ Você deve comer por dia</span><b>${gain ? "" : "− "}${fmt(plan.kcal)} kcal</b></div>
      <div class="eq-row total"><span>= ${keep ? "Diferença" : word[0].toUpperCase() + word.slice(1) + " por dia"}</span><b>${fmt(Math.abs(plan.deficit))} kcal</b></div>
      <p>${explain}</p>
      ${!keep && !gain ? `<p>Quer comer mais? Exercício aumenta o gasto: 30 min de caminhada (~150 kcal) deixam você comer ~150 kcal a mais com o mesmo déficit.</p>` : ""}
    </div>`;
  }
  const now = plan.tdee - eaten; // positivo = déficit
  let msg;
  if (gain) msg = eaten >= plan.kcal ? `✅ Meta batida: superávit de ${fmt(eaten - plan.tdee)} kcal.` : `Coma mais ${fmt(plan.kcal - eaten)} kcal para chegar ao superávit de ${fmt(Math.abs(plan.deficit))}.`;
  else if (keep) msg = eaten <= plan.kcal ? `Ainda pode comer ${fmt(plan.kcal - eaten)} kcal hoje.` : `Passou ${fmt(eaten - plan.kcal)} kcal do que gasta.`;
  else if (eaten <= plan.kcal) msg = `✅ Dentro do plano. Pode comer mais <b>${fmt(plan.kcal - eaten)} kcal</b> e ainda terá o déficit de ${fmt(plan.deficit)} kcal.`;
  else if (now > 0) msg = `⚠️ Passou da meta de comer, mas ainda tem déficit de ${fmt(now)} kcal (o plano era ${fmt(plan.deficit)}).`;
  else msg = `⚠️ Hoje você comeu ${fmt(-now)} kcal a mais do que seu corpo gasta: sem déficit hoje.`;
  return `<div class="card eq">
      <h3>${keep ? "Sua conta de hoje" : `Seu ${word} de hoje`}</h3>
      <div class="eq-row"><span>🔥 Seu corpo gasta hoje</span><b>${fmt(plan.tdee)} kcal</b></div>
      <div class="eq-row"><span>🍽️ Você comeu</span><b>− ${fmt(eaten)} kcal</b></div>
      <div class="eq-row total ${now < 0 && !gain ? "bad" : ""}"><span>= ${now >= 0 ? "Déficit" : "Superávit"} até agora</span><b>${fmt(Math.abs(now))} kcal</b></div>
      <p>${msg}</p>
    </div>`;
}

function trajectoryChart(from, to, l1, l2) {
  // curva suave de "agora" até a meta (estilo da tela de projeção)
  const down = to < from;
  const y1 = down ? 50 : 190, y2 = down ? 190 : 50;
  // Em perda de peso a linha desce; o gráfico mostra a queda visualmente.
  const path = `M40 ${y1} C 120 ${y1}, 150 ${(y1 + y2) / 2 + (down ? -10 : 10)}, 210 ${(y1 + y2) / 2} S 300 ${y2}, 330 ${y2}`;
  return `<div class="chart-card">
    <div class="hd"><small>TRAJETÓRIA DO PESO</small><span>${down ? "Perda prevista" : "Ganho previsto"}</span></div>
    <svg viewBox="0 0 370 230" role="img" aria-label="Peso de ${fmt(from, 1)} kg até ${fmt(to, 1)} kg">
      <line x1="40" y1="215" x2="330" y2="215" stroke="#dfe6f5" stroke-width="2"/>
      <path d="${path}" fill="none" stroke="#2f6bf0" stroke-width="4.5" stroke-linecap="round"/>
      <circle cx="40" cy="${y1}" r="9" fill="#fff" stroke="#5b6478" stroke-width="3.5"/>
      <circle cx="330" cy="${y2}" r="10" fill="#fff" stroke="#2f6bf0" stroke-width="4"/>
      <text x="40" y="${y1 - 18}" font-size="16" font-weight="800" fill="#1f2a44" font-family="Nunito">${fmt(from, 1)} kg</text>
      <text x="330" y="${y2 - 18}" font-size="16" font-weight="800" fill="#2f6bf0" text-anchor="end" font-family="Nunito">${fmt(to, 1)} kg</text>
    </svg>
    <div class="ax"><span>${l1}</span><span>${l2}</span></div>
  </div>`;
}

/* =========================================================
   Tela de criar conta / entrar
   ========================================================= */
let authMode = "signup";
let pendingEmail = "";
function renderAuth() {
  const signup = authMode === "signup";
  $app.innerHTML = `<div class="ob auth">
    <div class="ob-body" style="padding-bottom:40px">
      ${hero("🥗", "linear-gradient(135deg,#7cc8ff,#2f6bf0)", `<small>🔥 Hoje</small><b>1.420 / 1.900 kcal</b><div class="mini"><i style="width:74%"></i></div>`)}
      <h1>${signup ? "Crie sua conta" : "Entrar"}</h1>
      <p class="sub">${signup ? "Coloque seu e-mail e crie uma senha para começar." : "Use o e-mail e a senha da sua conta."}</p>
      <form id="auth-form" novalidate>
        <div class="field"><label for="a-email">E-mail</label>
          <input type="text" inputmode="email" id="a-email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="voce@email.com" value="${esc(pendingEmail)}"></div>
        <div class="field"><label for="a-pass">Senha</label>
          <input type="password" id="a-pass" autocomplete="${signup ? "new-password" : "current-password"}" placeholder="${signup ? "Mínimo 6 caracteres" : "Sua senha"}"></div>
        ${signup ? `<div class="field"><label for="a-pass2">Confirme a senha</label>
          <input type="password" id="a-pass2" autocomplete="new-password" placeholder="Repita a senha"></div>` : ""}
        <p class="err" id="a-err" hidden></p>
        <button class="btn" type="submit" id="a-submit">${signup ? "Criar conta" : "Entrar"} ${ICON.arrow}</button>
      </form>
      <button class="link" id="a-switch">${signup ? "Já tenho conta · <b>Entrar</b>" : "Não tem conta? <b>Criar conta</b>"}</button>
      <p class="note" style="text-align:center">Sua conta fica salva neste aparelho.</p>
    </div>
  </div>`;
  window.scrollTo(0, 0);
  const err = document.getElementById("a-err");
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  document.getElementById("a-switch").onclick = () => { authMode = signup ? "login" : "signup"; renderAuth(); };
  document.getElementById("auth-form").onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    const email = normEmail(document.getElementById("a-email").value);
    const pass = document.getElementById("a-pass").value;
    if (!validEmail(email)) return fail("Digite um e-mail válido.");
    if (!crypto?.subtle) return fail("Este navegador não permite criar conta. Abra o app pelo Safari ou Chrome.");
    const btn = document.getElementById("a-submit");
    btn.disabled = true;
    try {
      const a = readAccounts();
      if (signup) {
        if (pass.length < 6) return fail("A senha precisa ter pelo menos 6 caracteres.");
        if (pass !== document.getElementById("a-pass2").value) return fail("As senhas não são iguais.");
        if (a.users[email]) return fail("Já existe uma conta com esse e-mail neste aparelho. Toque em Entrar.");
        a.users[email] = await hashPassword(pass);
        a.current = email;
        // quem já usava o app antes das contas leva os dados para a primeira conta
        try {
          const legacy = localStorage.getItem(LEGACY_KEY);
          if (legacy && Object.keys(a.users).length === 1) {
            localStorage.setItem(`${LEGACY_KEY}:${email}`, legacy);
            localStorage.removeItem(LEGACY_KEY);
          }
        } catch (_) { /* ignora */ }
        if (!writeAccounts(a)) return fail("Não foi possível salvar a conta neste aparelho.");
        draft = { name: "", goal: "", sex: "", age: "", height: "", weight: "", target: "", activity: "", pace: 0.5, obstacles: [], reminders: [] };
        step = 0;
      } else {
        const u = a.users[email];
        if (!u) {
          fail("Não encontramos essa conta aqui. Cada lugar onde o app é aberto (Safari, ícone da tela inicial, link do Claude) guarda suas próprias contas. Se você criou a conta em outro lugar, abra o app por lá. Ou crie a conta aqui:");
          const mk = document.createElement("button");
          mk.type = "button"; mk.className = "btn ghost small"; mk.style.marginTop = "10px";
          mk.textContent = "Criar conta com este e-mail";
          mk.onclick = () => { authMode = "signup"; pendingEmail = email; renderAuth(); };
          err.append(document.createElement("br"), mk);
          return;
        }
        const { hash } = await hashPassword(pass, u.salt);
        if (hash !== u.hash) return fail("Senha incorreta.");
        a.current = email;
        writeAccounts(a);
      }
      startSession(email);
      render();
      toast(signup ? "✅ Conta criada" : "👋 Que bom te ver de novo");
    } finally {
      btn.disabled = false;
    }
  };
}

/* =========================================================
   App principal
   ========================================================= */
let tab = "hoje";
let scan = null; // estado da tela de escanear

function render() {
  if (!KEY) return renderAuth();
  if (!state.profile) return renderOnboarding();
  const pages = { hoje: pageToday, escanear: pageScan, progresso: pageProgress, ajustes: pageSettings };
  $app.innerHTML = pages[tab]() + tabbar();
  bindTabbar();
  ({ hoje: bindToday, escanear: bindScan, progresso: bindProgress, ajustes: bindSettings })[tab]();
}

function tabbar() {
  const b = (id, icon, label) => `<button data-tab="${id}" class="${tab === id ? "on" : ""}">${icon}<span>${label}</span></button>`;
  return `<nav class="tabbar">
    ${b("hoje", ICON.home, "Hoje")}
    ${b("progresso", ICON.chart, "Progresso")}
    <button class="scan" data-tab="escanear" aria-label="Escanear prato">${ICON.scan}</button>
    ${b("plano", ICON.plan, "Plano")}
    ${b("ajustes", ICON.gear, "Ajustes")}
  </nav>`;
}
function bindTabbar() {
  document.querySelectorAll("[data-tab]").forEach((b) => {
    b.onclick = () => {
      if (b.dataset.tab === "plano") return openPlanSheet();
      tab = b.dataset.tab;
      if (tab === "escanear" && scan?.saved) scan = null;
      render();
      window.scrollTo(0, 0);
    };
  });
}

function totals(meals) {
  return meals.reduce((a, m) => ({
    kcal: a.kcal + m.kcal, p: a.p + m.p, c: a.c + m.c, f: a.f + m.f,
  }), { kcal: 0, p: 0, c: 0, f: 0 });
}

function pageToday() {
  const p = state.profile, plan = computePlan(p), d = day();
  const t = totals(d.meals);
  const left = plan.kcal - t.kcal;
  const ratio = clamp(t.kcal / plan.kcal, 0, 1);
  const R = 62, C = 2 * Math.PI * R;
  const over = left < 0;
  const hour = new Date().getHours();
  const hi = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const bar = (v, max, cls = "") => `<div class="pbar ${cls} ${v > max * 1.05 ? "over" : ""}"><i style="width:${clamp((v / max) * 100, 0, 100)}%"></i></div>`;
  return `<div class="page">
    <div class="page-h"><div><small>${hi}${p.name ? ", " + esc(p.name) : ""} 👋</small><h1>Hoje</h1></div>
      <small>${new Date().toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" })}</small></div>

    <div class="card">
      <div class="ring-wrap">
        <div class="ring">
          <svg viewBox="0 0 150 150"><defs><linearGradient id="rg" x1="0" x2="1"><stop offset="0" stop-color="#4fb0f7"/><stop offset="1" stop-color="#1f45d8"/></linearGradient></defs>
            <circle cx="75" cy="75" r="${R}" fill="none" stroke="#e3ecfd" stroke-width="14"/>
            <circle cx="75" cy="75" r="${R}" fill="none" stroke="${over ? "#e5484d" : "url(#rg)"}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - ratio)}"/>
          </svg>
          <div class="c"><b>${fmt(Math.abs(left))}</b><small>${over ? "kcal acima da meta" : "kcal para comer"}</small></div>
        </div>
        <div class="ring-side">
          <div class="kv">Comer hoje <b>${fmt(plan.kcal)}</b></div>
          <div class="kv">Já comeu <b>${fmt(t.kcal)}</b></div>
          <div class="kv">Corpo gasta <b>${fmt(plan.tdee)}</b></div>
          <div class="kv">${p.goal === "ganhar" ? "Falta ganhar" : p.goal === "perder" ? "Falta perder" : "Peso"} <b>${p.goal === "manter" ? fmt(currentWeight(), 1) : fmt(Math.abs(currentWeight() - p.target), 1)} kg</b></div>
        </div>
      </div>
    </div>

    ${deficitCard(p, plan, t.kcal)}

    <div class="card">
      <div class="macros">
        <div class="macro"><small>Proteína</small><b>${fmt(t.p)}<em>/${plan.protein}g</em></b>${bar(t.p, plan.protein)}</div>
        <div class="macro"><small>Carbo</small><b>${fmt(t.c)}<em>/${plan.carbs}g</em></b>${bar(t.c, plan.carbs, "o")}</div>
        <div class="macro"><small>Gordura</small><b>${fmt(t.f)}<em>/${plan.fat}g</em></b>${bar(t.f, plan.fat, "g")}</div>
      </div>
    </div>

    <div class="card water">
      <div class="info"><small style="color:var(--muted);font-weight:700">💧 Água hoje</small><br>
        <b>${fmt(d.water)}</b> <span>/ ${fmt(plan.water)} ml</span>${bar(d.water, plan.water)}</div>
      <button class="btn small" id="water-add">+ 250 ml</button>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">Refeições</h3>
        <button class="link" id="manual" style="margin:0;color:var(--blue-2)">+ Manual</button></div>
      ${d.meals.length ? d.meals.map((m, i) => `<div class="meal">
          ${m.thumb ? `<img src="${m.thumb}" alt="">` : `<span class="ph">${mealEmoji(m.type)}</span>`}
          <div class="mt"><b>${esc(m.name)}</b><span>${esc(m.type)} · ${m.time} · P${fmt(m.p)} C${fmt(m.c)} G${fmt(m.f)}</span></div>
          <span class="kc">${fmt(m.kcal)} kcal</span>
          <button class="del" data-del="${i}" aria-label="Remover">×</button></div>`).join("")
        : `<p class="empty">Nenhuma refeição ainda. Toque no botão azul para fotografar seu prato.</p>`}
    </div>
  </div>`;
}
const mealEmoji = (t) => ({ "Café da manhã": "☕", "Almoço": "🍛", "Jantar": "🍽️", "Lanche": "🍎" }[t] || "🍽️");
function currentWeight() {
  const w = state.weights;
  return w.length ? w[w.length - 1].kg : state.profile.weight;
}

function bindToday() {
  document.getElementById("water-add").onclick = () => {
    day().water += 250; save(); render();
  };
  document.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = async () => {
      if (!(await askConfirm("Remover esta refeição?", "Remover"))) return;
      day().meals.splice(+b.dataset.del, 1); save(); render();
    };
  });
  document.getElementById("manual").onclick = openManualSheet;
}

/* ---------- Escanear ---------- */
function guessMealType() {
  const h = new Date().getHours();
  if (h < 10) return "Café da manhã";
  if (h < 15) return "Almoço";
  if (h < 18) return "Lanche";
  return "Jantar";
}

function pageScan() {
  if (!scan) scan = { status: "idle", type: guessMealType(), portion: 1 };
  const s = scan;
  const box = `<div class="scanbox ${s.status === "busy" ? "busy" : ""}" id="scanbox" role="button" aria-label="Fotografar prato" tabindex="0">
      ${s.image ? `<img src="${s.image}" alt="Foto do prato">` : ""}
      <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
      <span class="laser"></span>
      ${s.status !== "done" ? `<span class="center">${ICON.scan}</span>` : ""}
    </div>
    <input type="file" accept="image/*" capture="environment" id="cam" hidden>
    <input type="file" accept="image/*" id="gal" hidden>`;

  if (s.status === "done" && s.result) {
    const r = s.result;
    const t = itemsTotal(r.itens);
    return `<div class="page">
      <div class="page-h"><h1>${esc(r.prato || "Resultado")}</h1></div>
      ${box}
      ${r.observacao ? `<div class="warn" style="margin-top:14px">💡 ${esc(r.observacao)}</div>` : ""}
      <div class="card" style="margin-top:14px">
        <div class="result-total"><b id="t-kcal">${fmt(t.kcal)}</b><span>kcal</span></div>
        <div class="macros" style="margin:8px 0 6px">
          <div class="macro"><small>Proteína</small><b><span id="t-p">${fmt(t.p)}</span> <em>g</em></b></div>
          <div class="macro"><small>Carbo</small><b><span id="t-c">${fmt(t.c)}</span> <em>g</em></b></div>
          <div class="macro"><small>Gordura</small><b><span id="t-f">${fmt(t.f)}</span> <em>g</em></b></div>
        </div>
        <p class="help" style="margin:4px 0 0">Comeu outra quantidade? Toque no número e corrija.</p>
        ${r.itens.map((it, i) => `<div class="item">
          <div class="it"><b>${esc(it.nome)}</b><span>${esc(it.porcao_estimada)}</span></div>
          ${it.base.g > 0 ? `<label class="qty"><input type="number" inputmode="decimal" min="0" step="any" data-qty="${i}" id="qty-${i}" value="${Math.round(it.gramas)}" aria-label="Quantidade de ${esc(it.nome)} em ${it.unidade}"><span>${it.unidade}</span></label>` : ""}
          <span class="kc" id="kc-${i}">${fmt(scaled(it).kcal)}</span>
          <button data-rm="${i}" aria-label="Remover item">×</button></div>`).join("")}
      </div>
      <div class="card"><h3>Porção do prato todo</h3>
        <div class="portion">${[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => `<button data-por="${v}" class="${s.portion === v ? "on" : ""}">${String(v).replace(".", ",")}×</button>`).join("")}</div>
        <h3 style="margin-top:16px">Refeição</h3>
        <div class="mealtypes">${["Café da manhã", "Almoço", "Lanche", "Jantar"].map((m) => `<button data-mt="${m}" class="${s.type === m ? "on" : ""}">${m === "Café da manhã" ? "Café" : m}</button>`).join("")}</div>
      </div>
      <button class="btn" id="save-meal" ${r.itens.length ? "" : "disabled"}>Adicionar ao diário ${ICON.check}</button>
      <button class="link" id="again">Escanear outra foto</button>
    </div>`;
  }

  return `<div class="page">
    <div class="page-h"><div><h1>Uma foto. Calorias na hora.</h1></div></div>
    ${box}
    <div class="scan-hint">
      ${s.status === "busy" ? `<h2>Analisando seu prato…</h2><p>A IA está identificando cada alimento.</p>`
        : `<h2>👆 Toque para fotografar</h2><p>A IA identifica cada alimento e calcula calorias e macros.</p>`}
    </div>
    ${s.status !== "busy" ? `<div class="row-btns"><button class="btn" id="b-cam">📷 Câmera</button><button class="btn ghost" id="b-gal">🖼️ Galeria</button></div>` : ""}
    ${s.error ? `<div class="err">${esc(s.error)}</div>` : ""}
    ${needKey() ? `<div class="warn" style="margin-top:14px">Para analisar fotos, cadastre sua chave da IA em <b>Ajustes</b>. <button class="link" id="goto-key" style="display:inline;margin:0;padding:0;color:var(--blue-2)">Cadastrar agora</button></div>` : ""}
  </div>`;
}

// Valores do item na quantidade atual (proporcional ao que a IA estimou).
function scaled(it) {
  const k = it.base.g > 0 ? it.gramas / it.base.g : 1;
  return { kcal: it.base.kcal * k, p: it.base.p * k, c: it.base.c * k, f: it.base.f * k };
}
function itemsTotal(items) {
  return items.reduce((a, it) => {
    const v = scaled(it);
    return { kcal: a.kcal + v.kcal, p: a.p + v.p, c: a.c + v.c, f: a.f + v.f };
  }, { kcal: 0, p: 0, c: 0, f: 0 });
}
function withBase(result) {
  result.itens.forEach((it) => {
    it.unidade = it.unidade === "ml" ? "ml" : "g";
    it.base = { g: it.gramas, kcal: it.calorias, p: it.proteina_g, c: it.carboidratos_g, f: it.gorduras_g };
  });
  return result;
}

function bindScan() {
  const cam = document.getElementById("cam"), gal = document.getElementById("gal");
  const pick = (input) => { if (scan.status !== "busy") input.click(); };
  const box = document.getElementById("scanbox");
  if (scan.status !== "done") {
    box.onclick = () => pick(cam);
    box.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") pick(cam); };
  }
  const bc = document.getElementById("b-cam"); if (bc) bc.onclick = () => pick(cam);
  const bg = document.getElementById("b-gal"); if (bg) bg.onclick = () => pick(gal);
  const gk = document.getElementById("goto-key"); if (gk) gk.onclick = () => openKeySheet(false);
  [cam, gal].forEach((inp) => inp.onchange = () => { if (inp.files[0]) handlePhoto(inp.files[0]); });

  document.querySelectorAll("[data-por]").forEach((b) => b.onclick = () => {
    scan.portion = +b.dataset.por;
    scan.result.itens.forEach((it) => { it.gramas = it.base.g * scan.portion; });
    render();
  });
  // editar a quantidade de um item: atualiza os números sem redesenhar a tela
  document.querySelectorAll("[data-qty]").forEach((inp) => inp.addEventListener("input", () => {
    const it = scan.result.itens[+inp.dataset.qty];
    const v = parseFloat(inp.value.replace(",", "."));
    it.gramas = v >= 0 ? v : 0;
    document.getElementById("kc-" + inp.dataset.qty).textContent = fmt(scaled(it).kcal);
    const t = itemsTotal(scan.result.itens);
    document.getElementById("t-kcal").textContent = fmt(t.kcal);
    document.getElementById("t-p").textContent = fmt(t.p);
    document.getElementById("t-c").textContent = fmt(t.c);
    document.getElementById("t-f").textContent = fmt(t.f);
    scan.portion = null;
    document.querySelectorAll("[data-por]").forEach((b) => b.classList.remove("on"));
  }));
  document.querySelectorAll("[data-mt]").forEach((b) => b.onclick = () => { scan.type = b.dataset.mt; render(); });
  document.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => { scan.result.itens.splice(+b.dataset.rm, 1); render(); });
  const again = document.getElementById("again");
  if (again) again.onclick = () => { scan = null; render(); };
  const sv = document.getElementById("save-meal");
  if (sv) sv.onclick = async () => {
    const r = scan.result, t = itemsTotal(r.itens);
    const now = new Date();
    day().meals.push({
      name: r.prato || r.itens.map((i) => i.nome).join(", "),
      type: scan.type, time: now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      kcal: Math.round(t.kcal), p: Math.round(t.p), c: Math.round(t.c), f: Math.round(t.f),
      thumb: await thumbnail(scan.image),
    });
    save();
    scan = { saved: true };
    tab = "hoje";
    render();
    toast("✅ Refeição adicionada");
  };
}

async function handlePhoto(file) {
  if (needKey()) { openKeySheet(false); return; }
  try {
    const dataUrl = await resizeImage(file, 1280, 0.85);
    scan = { ...scan, status: "busy", image: dataUrl, error: "" };
    render();
    const result = await AI.analyzeFoodPhoto({ apiKey: state.apiKey, dataUrl, profile: state.profile });
    if (!result.e_comida || !result.itens.length) {
      scan = { ...scan, status: "idle", error: result.observacao || "Não identifiquei comida nessa foto. Tente fotografar o prato de cima, com boa luz." };
    } else {
      scan = { ...scan, status: "done", result: withBase(result), portion: 1 };
    }
  } catch (e) {
    console.error(e);
    scan = { ...scan, status: "idle", error: e instanceof AI.ScanError ? e.message : `Não foi possível ler essa imagem. Tente outra foto. (detalhe: ${String(e?.message || e).slice(0, 120)})` };
  }
  if (tab === "escanear") render();
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}
async function resizeImage(file, max, q) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", q);
  } finally { URL.revokeObjectURL(url); }
}
async function thumbnail(dataUrl) {
  if (!dataUrl) return "";
  try {
    const img = await loadImage(dataUrl);
    const s = 112, c = document.createElement("canvas");
    c.width = c.height = s;
    const m = Math.min(img.naturalWidth, img.naturalHeight);
    c.getContext("2d").drawImage(img, (img.naturalWidth - m) / 2, (img.naturalHeight - m) / 2, m, m, 0, 0, s, s);
    return c.toDataURL("image/jpeg", 0.7);
  } catch (_) { return ""; }
}

/* ---------- Progresso ---------- */
function pageProgress() {
  const p = state.profile, plan = computePlan(p);
  const ws = state.weights;
  const cur = currentWeight();
  const lost = p.startWeight - cur;
  const total = Math.abs(p.startWeight - p.target) || 1;
  const done = p.goal === "manter" ? 1 : clamp((p.goal === "perder" ? lost : -lost) / total, 0, 1);

  // últimos 7 dias de calorias
  const days = [...Array(7)].map((_, i) => {
    const d = new Date(Date.now() - (6 - i) * 864e5);
    const k = todayKey(d);
    return { label: d.toLocaleDateString("pt-BR", { weekday: "narrow" }), kcal: totals(state.log[k]?.meals || []).kcal };
  });
  const maxK = Math.max(plan.kcal * 1.2, ...days.map((d) => d.kcal));
  const bars = days.map((d, i) => {
    const h = (d.kcal / maxK) * 120, x = 18 + i * 46;
    return `<rect x="${x}" y="${140 - h}" width="28" height="${Math.max(h, 2)}" rx="8" fill="${d.kcal > plan.kcal * 1.05 ? "#e5484d" : "url(#bg)"}"/>
      <text x="${x + 14}" y="160" font-size="13" font-weight="800" fill="#5b6478" text-anchor="middle" font-family="Nunito">${d.label.toUpperCase()}</text>`;
  }).join("");
  const goalY = 140 - (plan.kcal / maxK) * 120;

  return `<div class="page">
    <div class="page-h"><h1>Progresso</h1></div>
    <div class="card">
      <div class="kv">Peso inicial <b>${fmt(p.startWeight, 1)} kg</b></div>
      <div class="kv" style="margin-top:6px">Peso atual <b>${fmt(cur, 1)} kg</b></div>
      <div class="kv" style="margin-top:6px">Meta <b>${fmt(p.target, 1)} kg</b></div>
      <div class="pbar g" style="height:12px;margin-top:12px"><i style="width:${done * 100}%"></i></div>
      <p class="help" style="margin:8px 0 0">${p.goal === "manter" ? "Objetivo: manter o peso." : `${fmt(done * 100)}% do caminho · ${p.goal === "perder" ? "falta perder" : "falta ganhar"} ${fmt(Math.max(0, p.goal === "perder" ? cur - p.target : p.target - cur), 1)} kg`}</p>
    </div>
    <div class="card"><h3>Registrar peso de hoje</h3>
      <div style="display:flex;gap:10px;align-items:center">
        <div class="field" style="flex:1;margin:0;box-shadow:none;background:var(--blue-soft)"><div class="row"><input type="number" inputmode="decimal" step="0.1" id="w-in" placeholder="${fmt(cur, 1)}"><span class="unit">kg</span></div></div>
        <button class="btn small" id="w-save">Salvar</button>
      </div>
    </div>
    ${ws.length >= 2 ? `<div class="card"><h3>Evolução do peso</h3>${weightChart(ws, p.target)}</div>` : ""}
    <div class="card"><h3>Calorias — últimos 7 dias</h3>
      <svg viewBox="0 0 340 170" style="width:100%;height:auto" role="img" aria-label="Calorias por dia na última semana">
        <defs><linearGradient id="bg" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#4fb0f7"/><stop offset="1" stop-color="#1f45d8"/></linearGradient></defs>
        <line x1="10" x2="335" y1="${goalY}" y2="${goalY}" stroke="#3cbf7a" stroke-width="2" stroke-dasharray="6 6"/>
        <text x="335" y="${goalY - 6}" font-size="12" font-weight="800" fill="#3cbf7a" text-anchor="end" font-family="Nunito">meta ${fmt(plan.kcal)}</text>
        ${bars}
      </svg>
    </div>
    ${ws.length ? `<div class="card"><h3>Histórico</h3>${[...ws].reverse().slice(0, 12).map((w) => `<div class="wlog"><span>${new Date(w.date + "T12:00").toLocaleDateString("pt-BR")}</span><b>${fmt(w.kg, 1)} kg</b></div>`).join("")}</div>` : ""}
  </div>`;
}

function weightChart(ws, target) {
  const pts = ws.slice(-30);
  const vals = [...pts.map((w) => w.kg), target];
  const lo = Math.min(...vals) - 1, hi = Math.max(...vals) + 1;
  const X = (i) => 20 + (i / Math.max(1, pts.length - 1)) * 300;
  const Y = (v) => 150 - ((v - lo) / (hi - lo)) * 130;
  const d = pts.map((w, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(w.kg).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 340 165" style="width:100%;height:auto" role="img" aria-label="Evolução do peso">
    <line x1="10" x2="335" y1="${Y(target)}" y2="${Y(target)}" stroke="#3cbf7a" stroke-width="2" stroke-dasharray="6 6"/>
    <text x="335" y="${Y(target) - 6}" font-size="12" font-weight="800" fill="#3cbf7a" text-anchor="end" font-family="Nunito">meta ${fmt(target, 1)}</text>
    <path d="${d}" fill="none" stroke="#2f6bf0" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${pts.map((w, i) => `<circle cx="${X(i)}" cy="${Y(w.kg)}" r="4.5" fill="#fff" stroke="#2f6bf0" stroke-width="2.5"/>`).join("")}
  </svg>`;
}

function bindProgress() {
  document.getElementById("w-save").onclick = () => {
    const v = parseFloat(document.getElementById("w-in").value.replace(",", "."));
    if (!(v >= 30 && v <= 300)) return toast("Digite um peso válido");
    const k = todayKey();
    state.weights = state.weights.filter((w) => w.date !== k);
    state.weights.push({ date: k, kg: v });
    state.weights.sort((a, b) => a.date.localeCompare(b.date));
    state.profile.weight = v; // recalcula o plano com o peso novo
    save(); render(); toast("⚖️ Peso registrado");
  };
}

/* ---------- Ajustes ---------- */
function pageSettings() {
  const p = state.profile;
  const goal = { perder: "Perder peso", manter: "Manter", ganhar: "Ganhar peso" }[p.goal];
  return `<div class="page">
    <div class="page-h"><h1>Ajustes</h1></div>
    ${AI.needsKey ? `<div class="card"><h3>Chave da IA (${AI.keyInfo.provider})</h3>
      <p class="help" style="margin-top:0">${AI.keyInfo.valid(state.apiKey) ? "✅ Chave cadastrada: …" + esc(state.apiKey.slice(-4)) : "Nenhuma chave cadastrada — necessária para analisar fotos."}</p>
      <button class="btn small" id="key">${AI.keyInfo.valid(state.apiKey) ? "Trocar chave" : "Cadastrar chave"}</button>
    </div>` : ""}
    <div class="card"><h3>Meu perfil</h3>
      <div class="set-row">Objetivo <span>${goal}</span></div>
      <div class="set-row">Peso meta <span>${fmt(p.target, 1)} kg</span></div>
      <div class="set-row">Nível de atividade <span>${ACTIVITY[p.activity].t}</span></div>
      ${p.goal !== "manter" ? `<div class="set-row">Ritmo <span>${fmt(p.pace, 2)} kg/semana</span></div>` : ""}
      <div class="set-row">Lembretes <span>${state.reminders.length ? state.reminders.join(", ") : "Desligados"}</span></div>
      <button class="btn ghost small" id="redo" style="margin-top:12px">Refazer questionário</button>
    </div>
    <div class="card"><h3>Conta</h3>
      <div class="set-row">E-mail <span>${esc(readAccounts().current || "")}</span></div>
      <button class="btn ghost small" id="logout" style="margin-top:12px">Sair da conta</button>
    </div>
    <div class="card"><h3>Dados</h3>
      <p class="help" style="margin-top:0">Sua conta e seus dados ficam salvos só neste aparelho. As fotos são enviadas à IA apenas para análise.</p>
      <button class="danger" id="wipe">Apagar minha conta e dados</button>
    </div>
  </div>`;
}
function bindSettings() {
  const kb = document.getElementById("key");
  if (kb) kb.onclick = () => openKeySheet(false);
  document.getElementById("redo").onclick = () => {
    const p = state.profile;
    draft = { name: p.name, goal: p.goal, sex: p.sex, age: p.age, height: p.height, weight: currentWeight(),
      target: p.goal === "manter" ? "" : p.target, activity: p.activity, pace: p.pace, obstacles: p.obstacles || [], reminders: state.reminders };
    step = 1;
    const keep = { log: state.log, weights: state.weights };
    state.profile = null; save();
    Object.assign(state, keep);
    render();
  };
  document.getElementById("logout").onclick = logout;
  document.getElementById("wipe").onclick = async () => {
    if (!(await askConfirm("Apagar sua conta, perfil, refeições e pesos? Isso não pode ser desfeito.", "Apagar tudo"))) return;
    const a = readAccounts();
    try { localStorage.removeItem(KEY); } catch (_) { /* ignora */ }
    delete a.users[a.current];
    writeAccounts(a);
    authMode = "signup";
    logout();
    authMode = "signup"; render();
  };
}

/* ---------- Folhas (modais) ---------- */
function sheet(html, onBind) {
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  bg.addEventListener("click", (e) => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
  onBind?.(bg, () => bg.remove());
}

// Confirmação dentro da página (alguns visualizadores bloqueiam confirm()).
function askConfirm(msg, okLabel) {
  return new Promise((resolve) => {
    sheet(`<h2>${esc(msg)}</h2>
      <button class="btn" id="c-ok" style="background:var(--red)">${esc(okLabel)}</button>
      <button class="link" id="c-no">Cancelar</button>`,
    (el, close) => {
      el.querySelector("#c-ok").onclick = () => { close(); resolve(true); };
      el.querySelector("#c-no").onclick = () => { close(); resolve(false); };
      el.addEventListener("click", (e) => { if (e.target === el) resolve(false); });
    });
  });
}

function openKeySheet(first) {
  const K = AI.keyInfo;
  sheet(`<h2>${first ? "Último passo: ativar a IA" : `Chave da IA (${K.provider})`}</h2>
    <p class="help">${K.help}</p>
    <div class="field"><label for="k-in">Chave (começa com ${K.prefix})</label>
      <input type="password" id="k-in" placeholder="${K.prefix}..." autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(K.valid(state.apiKey) ? state.apiKey : "")}"></div>
    <button class="btn" id="k-save">Salvar chave</button>
    <button class="link" id="k-close">${first ? "Fazer depois" : "Cancelar"}</button>`,
  (el, close) => {
    el.querySelector("#k-close").onclick = close;
    el.querySelector("#k-save").onclick = () => {
      const v = el.querySelector("#k-in").value.trim();
      if (v && !K.valid(v)) return toast(`A chave deve começar com ${K.prefix}`);
      state.apiKey = v; save(); close(); render();
      toast(v ? "🔑 Chave salva" : "Chave removida");
    };
  });
}

function openManualSheet() {
  sheet(`<h2>Adicionar manualmente</h2>
    <div class="field"><label>O que você comeu?</label><input type="text" id="m-name" placeholder="Ex.: Pão com ovo"></div>
    <div class="field"><label>Calorias</label><div class="row"><input type="number" inputmode="numeric" id="m-kcal" placeholder="300"><span class="unit">kcal</span></div></div>
    <div class="macros" style="margin-bottom:14px">
      <div class="field" style="margin:0;padding:12px"><label>Prot. (g)</label><input type="number" inputmode="numeric" id="m-p" placeholder="0" style="font-size:22px"></div>
      <div class="field" style="margin:0;padding:12px"><label>Carbo (g)</label><input type="number" inputmode="numeric" id="m-c" placeholder="0" style="font-size:22px"></div>
      <div class="field" style="margin:0;padding:12px"><label>Gord. (g)</label><input type="number" inputmode="numeric" id="m-f" placeholder="0" style="font-size:22px"></div>
    </div>
    <button class="btn" id="m-save">Adicionar</button>
    <button class="link" id="m-close">Cancelar</button>`,
  (el, close) => {
    el.querySelector("#m-close").onclick = close;
    el.querySelector("#m-save").onclick = () => {
      const n = (id) => Math.max(0, +el.querySelector(id).value || 0);
      const kcal = n("#m-kcal");
      if (!kcal) return toast("Informe as calorias");
      day().meals.push({
        name: el.querySelector("#m-name").value.trim() || "Refeição", type: guessMealType(),
        time: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        kcal, p: n("#m-p"), c: n("#m-c"), f: n("#m-f"), thumb: "",
      });
      save(); close(); render(); toast("✅ Refeição adicionada");
    };
  });
}

function openPlanSheet() {
  const p = state.profile, plan = computePlan({ ...p, weight: currentWeight() });
  sheet(`<h2>Seu plano</h2>
    <div class="plan-grid" style="margin-top:0">
      <div class="stat big"><small>Coma por dia</small><b>${fmt(plan.kcal)} <em>kcal</em></b></div>
      <div class="stat"><small>${p.goal === "ganhar" ? "Falta ganhar" : "Falta perder"}</small><b>${fmt(plan.diff, 1)} <em>kg</em></b></div>
      <div class="stat"><small>Previsão</small><b style="font-size:18px">${plan.weeks ? plan.date.toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" }) : "—"}</b></div>
      <div class="stat"><small>IMC</small><b>${fmt(plan.bmi, 1)}</b></div>
      <div class="stat"><small>Proteína</small><b>${plan.protein} <em>g</em></b></div>
      <div class="stat"><small>Carbo · Gordura</small><b>${plan.carbs}<em>g</em> · ${plan.fat}<em>g</em></b></div>
      <div class="stat"><small>Gasto basal (em repouso)</small><b>${fmt(plan.bmr)} <em>kcal</em></b></div>
    </div>
    ${deficitCard(p, plan)}
    ${p.goal !== "manter" ? trajectoryChart(currentWeight(), p.target, "Agora", "Meta") : ""}
    <p class="note">Estimativas pela fórmula de Mifflin-St Jeor. Não substituem orientação profissional.</p>
    <button class="btn" id="p-close" style="margin-top:12px">Fechar</button>`,
  (el, close) => { el.querySelector("#p-close").onclick = close; });
}

/* =========================================================
   Lembretes (funcionam enquanto o app estiver aberto)
   ========================================================= */
setInterval(() => {
  if (!state.profile || !state.reminders.length) return;
  const now = new Date();
  const hm = now.toTimeString().slice(0, 5);
  const stamp = todayKey() + " " + hm;
  if (state.reminders.includes(hm) && state.lastReminder !== stamp) {
    state.lastReminder = stamp; save();
    const msg = "Hora de registrar sua refeição 🍽️";
    toast(msg);
    try { if ("Notification" in window && Notification.permission === "granted") new Notification("FotoCal", { body: msg, icon: "icons/icon-192.png" }); } catch (_) { /* iOS pode bloquear */ }
  }
}, 20000);

if (AI.useServiceWorker && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

{
  const a = readAccounts();
  if (a.current && a.users[a.current]) startSession(a.current);
  else authMode = Object.keys(a.users).length ? "login" : "signup";
}
render();
