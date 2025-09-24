// Configuración de Supabase
const SUPABASE_URL = "https://kmlcyvqepoofmmxuqcir.supabase.co"; // <- cambia
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttbGN5dnFlcG9vZm1teHVxY2lyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg2NzY2ODQsImV4cCI6MjA3NDI1MjY4NH0.eo2JPLgUP_hqH-QKSgFiDznsfAlPLxEuD0zVuQMiKto";                   // <- cambia
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 2 } }
});

// Variables de Estado
const state = {
  user: null,
  profile: null,
  currentGame: null,
  entries: [],
  balls: [],
  isAdmin: false,
};

// Funciones de UI
const el = (id) => document.getElementById(id);
const userArea = el("userArea");
const creditsEl = el("credits");
const rolesEl = el("roles");
const authStateEl = el("authState");
const gameIdEl = el("gameId");
const potEl = el("pot");
const ballsEl = el("balls");
const boardsEl = el("boards");
const countdownEl = el("countdown");

// Autenticación
const btnSignIn = el("btnSignIn");
btnSignIn.onclick = async () => {
  if (state.user) {
    await supabase.auth.signOut();
    return;
  }
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: "google" });
  if (error) alert(error.message);
};

// Manejo de cambios en el estado de autenticación
supabase.auth.onAuthStateChange(async (_ev, session) => {
  state.user = session?.user ?? null;
  authStateEl.textContent = state.user ? "Conectado" : "Desconectado";
  userArea.innerHTML = state.user
    ? `<div class="small">${state.user.email}</div><button id="btnOut" class="ghost">Salir</button>`
    : `<button id="btnSignIn">Iniciar sesión</button>`;
  if (state.user) {
    document.getElementById("btnOut").onclick = () => supabase.auth.signOut();
    await refreshProfile();
  } else {
    creditsEl.textContent = "0";
    rolesEl.textContent = "-";
    document.getElementById("adminPanel").classList.add("hidden");
  }
});

// Actualización de perfil
async function refreshProfile() {
  const { data: p } = await supabase.from("profiles").select("*").eq("id", state.user.id).maybeSingle();
  state.profile = p;
  state.isAdmin = !!p?.is_admin;
  creditsEl.textContent = p?.credits ?? 0;
  rolesEl.textContent = state.isAdmin ? "admin" : "cliente";
  el("pricePerCard").textContent = 1;
  if (state.isAdmin) document.getElementById("adminPanel").classList.remove("hidden");
}

// Funciones de recarga y compra
el("btnTopup").onclick = async () => {
  if (!state.user) return alert("Inicia sesión");
  const amt = parseInt(document.getElementById("amountTopup").value || "0", 10);
  if (amt <= 0) return alert("Monto inválido");
  const { error } = await supabase.from("topups").insert({ amount: amt, status: "pending" });
  el("topupMsg").textContent = error ? `Error: ${error.message}` : "Solicitud creada. Espera aprobación.";
};

el("btnBuy").onclick = async () => {
  if (!state.user) return alert("Inicia sesión");
  const qty = Math.max(1, Math.min(6, parseInt(document.getElementById("qty").value || "1", 10)));
  const { data, error } = await supabase.rpc("buy_cards", { qty, price_per_card: 1 });
  el("buyMsg").textContent = error ? `Error: ${error.message}` : `Compraste ${qty} cartón(es).`;
  await refreshProfile();
};

// Función de temporizador de juego
function roundStartTimeFromNow() {
  const now = new Date();
  const ms = now.getTime();
  const period = 3 * 60 * 1000; // 3 minutos
  const next = Math.floor(ms / period) * period + period; // inicio próximo múltiplo
  return new Date(next);
}

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

async function tick() {
  await supabase.rpc("ensure_current_game", { round_minutes: 3, draw_interval_secs: 5, price_per_card: 1 });

  const { data: g } = await supabase.from("games").select("*").eq("status", "running").order("start_time", { ascending: false }).limit(1).maybeSingle();
  if (g) {
    state.currentGame = g;
    gameIdEl.textContent = g.id;
    potEl.textContent = g.pot;
  }

  const next = roundStartTimeFromNow();
  const msLeft = next - new Date();
  countdownEl.textContent = fmt(msLeft);
}

setInterval(tick, 1000);

// Función de bolas
supabase.channel("rt-games")
  .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games" }, payload => {
    const g = payload.new;
    if (state.currentGame && g.id === state.currentGame.id) {
      state.currentGame = g;
      potEl.textContent = g.pot;
      renderBalls(g.balls_drawn || []);
    }
  })
  .subscribe();

function renderBalls(list) {
  state.balls = list;
  ballsEl.innerHTML = "";
  for (const n of Array.from({ length: 75 }, (_, i) => i + 1)) {
    const d = document.createElement("div");
    d.className = "ball" + (list.includes(n) ? " hit" : "");
    d.textContent = n;
    ballsEl.appendChild(d);
  }
  renderBoards();
}

async function loadMyEntries() {
  if (!state.user) {
    boardsEl.innerHTML = "";
    return;
  }
  const { data } = await supabase.from("v_my_current_entries").select("*");
  state.entries = data || [];
  renderBoards();
}

function renderBoards() {
  boardsEl.innerHTML = "";
  const balls = new Set(state.balls);
  for (const e of state.entries) {
    const wrapper = document.createElement("div");
    wrapper.className = "card";
    const grid = document.createElement("div");
    grid.className = "board";
    const nums = e.card_numbers;
    const marks = nums.map((n, idx) => idx === 12 ? true : balls.has(n)); // centro libre
    for (let i = 0; i < 25; i++) {
      const c = document.createElement("div");
      c.className = "cell" + (marks[i] ? " on" : "");
      c.textContent = i === 12 ? "★" : nums[i];
      grid.appendChild(c);
    }
    wrapper.appendChild(grid);
    boardsEl.appendChild(wrapper);
  }
  el("btnClaim").disabled = state.entries.length === 0;
}

// Reclamar Bingo
el("btnClaim").onclick = async () => {
  if (state.entries.length === 0) return;
  const ids = state.entries.map(e => e.entry_id);
  const { data, error } = await supabase.rpc("claim_bingo", { entry_ids: ids });
  document.getElementById("claimMsg").textContent = error ? error.message : (data?.message || "Revisado");
  await refreshProfile();
};

// Función asincrónica para iniciar el juego
async function startGame() {
  await tick();
  await loadMyEntries();
}

// Llama a la función cuando el script cargue
startGame();
