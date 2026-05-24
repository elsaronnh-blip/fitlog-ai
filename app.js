const STORAGE_KEY = "fitlog-ai-data-v1";
const SUPABASE_URL = "https://yprrhwioawdfrwidhvgn.supabase.co";
const SUPABASE_KEY = "sb_publishable_V93_2jmZ4s5879_MsmrsRg_UDUFBIBL";
const PHOTO_BUCKET = "meal-photos";

const state = loadState();
const startupLocalState = JSON.parse(JSON.stringify(state));
const today = new Date().toISOString().slice(0, 10);
let selectedFoodPhoto = null;
let currentUser = null;
let cloudClient = null;

const views = {
  dashboard: "Dashboard",
  food: "Food",
  exercise: "Exercise",
  weight: "Weight",
  settings: "Sync",
};

document.querySelector("#todayLabel").textContent = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
}).format(new Date());

document.querySelector('input[name="date"]').value = today;

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => setView(tab.dataset.view));
});

document.querySelector('#foodForm input[name="photo"]').addEventListener("change", async (event) => {
  const [file] = event.target.files;
  selectedFoodPhoto = file ? await prepareMealPhoto(file) : null;
  renderFoodPhotoPreview();
});

document.querySelector("#foodForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const description = form.get("description").trim();
  const entry = {
    id: crypto.randomUUID(),
    date: today,
    meal: form.get("meal").trim(),
    description,
    calories: Number(form.get("calories")) || estimateCalories(description, selectedFoodPhoto),
    photo: selectedFoodPhoto,
  };
  await saveFoodEntry(entry);
  selectedFoodPhoto = null;
  formElement.reset();
  renderFoodPhotoPreview();
  saveAndRender();
});

document.querySelector("#estimateFood").addEventListener("click", async () => {
  const form = document.querySelector("#foodForm");
  const description = form.elements.description.value.trim();
  if (!description && !selectedFoodPhoto) return;
  form.elements.calories.value = await estimateFoodWithAI(description, selectedFoodPhoto);
});

document.querySelector("#estimateExercise").addEventListener("click", async () => {
  const form = document.querySelector("#exerciseForm");
  form.elements.minutes.value = form.elements.minutes.value || inferWorkoutMinutes(form.elements.link.value);
  form.elements.calories.value = await estimateExerciseWithAI({
    name: form.elements.name.value,
    minutes: Number(form.elements.minutes.value),
    intensity: form.elements.intensity.value,
    link: form.elements.link.value,
  });
});

document.querySelector("#exerciseForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const exercise = {
    id: crypto.randomUUID(),
    date: today,
    name: form.get("name").trim(),
    minutes: Number(form.get("minutes")),
    intensity: form.get("intensity"),
    link: form.get("link").trim(),
    calories: Number(form.get("calories")) || estimateExerciseCalories({
      name: form.get("name").trim(),
      minutes: Number(form.get("minutes")),
      intensity: form.get("intensity"),
      link: form.get("link").trim(),
    }),
  };
  await saveExerciseEntry(exercise);
  formElement.reset();
  saveAndRender();
});

document.querySelector("#weightForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const weight = Number(form.get("weight"));
  const height = Number(form.get("height"));
  await saveWeightEntry({
    id: crypto.randomUUID(),
    date: form.get("date"),
    weight,
    height,
    bmi: calculateBmi(weight, height),
  });
  formElement.reset();
  document.querySelector('input[name="date"]').value = today;
  prefillLatestHeight();
  saveAndRender();
});

document.querySelector("#clearFood").addEventListener("click", () => clearCollection("food"));
document.querySelector("#clearExercise").addEventListener("click", () => clearCollection("exercise"));
document.querySelector("#clearWeight").addEventListener("click", () => clearCollection("weight"));

document.querySelector("#exportData").addEventListener("click", () => {
  const file = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `fitlog-ai-${today}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

document.querySelector("#importData").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  const imported = JSON.parse(await file.text());
  state.food = Array.isArray(imported.food) ? imported.food : [];
  state.exercise = Array.isArray(imported.exercise) ? imported.exercise : [];
  state.weight = Array.isArray(imported.weight) ? imported.weight : [];
  saveAndRender();
});

document.querySelector("#signIn")?.addEventListener("click", () => signInOrUp("signIn"));
document.querySelector("#signUp")?.addEventListener("click", () => signInOrUp("signUp"));
document.querySelector("#signOut")?.addEventListener("click", signOut);
document.querySelector("#syncToCloud")?.addEventListener("click", syncLocalDataToCloud);

render();
prefillLatestHeight();
initCloud();

async function initCloud() {
  if (!window.supabase) {
    updateAuthStatus("Supabase library did not load. Local browser saving is still active.");
    return;
  }
  cloudClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data, error } = await cloudClient.auth.getSession();
  if (error) {
    updateAuthStatus(error.message);
    return;
  }
  await setSession(data.session);
  cloudClient.auth.onAuthStateChange(async (_event, session) => {
    await setSession(session);
  });
}

async function setSession(session) {
  currentUser = session?.user || null;
  if (!currentUser) {
    updateAuthStatus("Signed out. Data is saved only in this browser.");
    render();
    return;
  }
  updateAuthStatus(`Signed in as ${currentUser.email}. Loading cloud data...`);
  await loadCloudData();
  updateAuthStatus(`Signed in as ${currentUser.email}. Cloud sync is active.`);
}

async function signInOrUp(mode) {
  if (!cloudClient) return updateAuthStatus("Supabase is not ready yet.");
  const form = document.querySelector("#authForm");
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;
  if (!email || !password) return updateAuthStatus("Enter an email and password first.");
  const request =
    mode === "signUp"
      ? cloudClient.auth.signUp({ email, password })
      : cloudClient.auth.signInWithPassword({ email, password });
  const { data, error } = await request;
  if (error) return updateAuthStatus(error.message);
  await setSession(data.session);
  updateAuthStatus(mode === "signUp" && !data.session ? "Check your email to confirm your account." : "Signed in.");
}

async function signOut() {
  if (!cloudClient) return;
  await cloudClient.auth.signOut();
  currentUser = null;
  updateAuthStatus("Signed out. Data is saved only in this browser.");
}

function updateAuthStatus(message) {
  const status = document.querySelector("#authStatus");
  if (status) status.textContent = message;
}

function setView(view) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((panel) => {
    panel.classList.toggle("is-visible", panel.id === view);
  });
  document.querySelector("#viewTitle").textContent = views[view];
}

function loadState() {
  const fallback = { food: [], exercise: [], weight: [] };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
  } catch {
    return fallback;
  }
}

function saveAndRender() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
}

async function saveFoodEntry(entry) {
  if (!currentUser || !cloudClient) {
    state.food.push(entry);
    return;
  }
  let photoPath = entry.photo?.path || null;
  if (entry.photo?.dataUrl && !entry.photo.path) {
    photoPath = `${currentUser.id}/${entry.id}.jpg`;
    const { error: uploadError } = await cloudClient.storage
      .from(PHOTO_BUCKET)
      .upload(photoPath, dataUrlToBlob(entry.photo.dataUrl), { contentType: "image/jpeg", upsert: true });
    if (uploadError) throwError(uploadError);
  }
  const row = {
    id: entry.id,
    user_id: currentUser.id,
    date: entry.date,
    meal: entry.meal,
    description: entry.description,
    calories: entry.calories,
    photo_url: photoPath,
  };
  const { error } = await cloudClient.from("food_entries").insert(row);
  if (error) throwError(error);
  state.food.push({ ...entry, photo: entry.photo ? { ...entry.photo, path: photoPath } : null });
}

async function saveExerciseEntry(entry) {
  if (!currentUser || !cloudClient) {
    state.exercise.push(entry);
    return;
  }
  const { error } = await cloudClient.from("exercise_entries").insert({
    id: entry.id,
    user_id: currentUser.id,
    date: entry.date,
    name: entry.name,
    minutes: entry.minutes,
    intensity: entry.intensity,
    link: entry.link,
    calories: entry.calories,
  });
  if (error) throwError(error);
  state.exercise.push(entry);
}

async function saveWeightEntry(entry) {
  if (!currentUser || !cloudClient) {
    state.weight.push(entry);
    return;
  }
  const { error } = await cloudClient.from("weight_entries").insert({
    id: entry.id,
    user_id: currentUser.id,
    date: entry.date,
    weight: entry.weight,
    height: entry.height,
    bmi: entry.bmi,
  });
  if (error) throwError(error);
  state.weight.push(entry);
}

async function loadCloudData() {
  if (!currentUser || !cloudClient) return;
  const [foodResult, exerciseResult, weightResult] = await Promise.all([
    cloudClient.from("food_entries").select("*").order("date", { ascending: true }),
    cloudClient.from("exercise_entries").select("*").order("date", { ascending: true }),
    cloudClient.from("weight_entries").select("*").order("date", { ascending: true }),
  ]);
  [foodResult, exerciseResult, weightResult].forEach((result) => {
    if (result.error) throwError(result.error);
  });
  state.food = await Promise.all(foodResult.data.map(mapCloudFood));
  state.exercise = exerciseResult.data.map((item) => ({
    id: item.id,
    date: item.date,
    name: item.name,
    minutes: item.minutes,
    intensity: item.intensity,
    link: item.link || "",
    calories: item.calories,
  }));
  state.weight = weightResult.data.map((item) => ({
    id: item.id,
    date: item.date,
    weight: Number(item.weight),
    height: Number(item.height),
    bmi: Number(item.bmi),
  }));
  saveAndRender();
  prefillLatestHeight();
}

async function mapCloudFood(item) {
  const photo = item.photo_url ? await getSignedPhoto(item.photo_url) : null;
  return {
    id: item.id,
    date: item.date,
    meal: item.meal,
    description: item.description || "",
    calories: item.calories,
    photo,
  };
}

async function getSignedPhoto(path) {
  const { data, error } = await cloudClient.storage.from(PHOTO_BUCKET).createSignedUrl(path, 60 * 60);
  if (error) return { path, dataUrl: "" };
  return { path, dataUrl: data.signedUrl };
}

async function syncLocalDataToCloud() {
  if (!currentUser || !cloudClient) return updateAuthStatus("Sign in before syncing local data.");
  const localCopy = startupLocalState;
  for (const item of localCopy.food) {
    if (!state.food.some((saved) => saved.id === item.id)) await saveFoodEntry({ ...item, id: item.id || crypto.randomUUID() });
  }
  for (const item of localCopy.exercise) {
    if (!state.exercise.some((saved) => saved.id === item.id)) await saveExerciseEntry({ ...item, id: item.id || crypto.randomUUID() });
  }
  for (const item of localCopy.weight) {
    if (!state.weight.some((saved) => saved.id === item.id)) await saveWeightEntry({ ...item, id: item.id || crypto.randomUUID() });
  }
  await loadCloudData();
  updateAuthStatus("Local data synced to Supabase.");
}

function throwError(error) {
  updateAuthStatus(error.message);
  throw error;
}

async function clearCollection(key) {
  if (!state[key].length) return;
  if (currentUser && cloudClient) {
    const table = {
      food: "food_entries",
      exercise: "exercise_entries",
      weight: "weight_entries",
    }[key];
    const { error } = await cloudClient.from(table).delete().eq("user_id", currentUser.id);
    if (error) return throwError(error);
  }
  state[key] = [];
  saveAndRender();
}

function render() {
  const foodToday = state.food.filter((item) => item.date === today);
  const exerciseToday = state.exercise.filter((item) => item.date === today);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  const caloriesToday = sum(foodToday, "calories");
  const minutesToday = sum(exerciseToday, "minutes");
  const weekFood = state.food.filter((item) => new Date(item.date) >= startOfDay(sevenDaysAgo));
  const weekExercise = state.exercise.filter((item) => new Date(item.date) >= startOfDay(sevenDaysAgo));
  const sortedWeight = [...state.weight].sort((a, b) => a.date.localeCompare(b.date));
  const currentWeight = sortedWeight.at(-1);
  const currentBmi = currentWeight ? getEntryBmi(currentWeight) : null;

  document.querySelector("#todayCalories").textContent = caloriesToday.toLocaleString();
  document.querySelector("#todayExercise").textContent = minutesToday.toLocaleString();
  document.querySelector("#weekCalories").textContent = `${sum(weekFood, "calories").toLocaleString()} cal`;
  document.querySelector("#weekExercise").textContent = `${sum(weekExercise, "minutes").toLocaleString()} min`;
  document.querySelector("#currentWeight").textContent = currentWeight ? `${currentWeight.weight} kg` : "--";
  document.querySelector("#currentBmi").textContent = currentBmi ? `${currentBmi.toFixed(1)} ${bmiCategory(currentBmi)}` : "--";

  renderFood();
  renderExercise();
  renderWeight(sortedWeight);
  renderRecentActivity();
  drawBmiChart(sortedWeight);
  drawWeightChart(sortedWeight);
}

function renderFood() {
  const list = document.querySelector("#foodList");
  list.innerHTML = "";
  const entries = [...state.food].sort(sortByNewest);
  if (!entries.length) return addEmpty(list);
  entries.forEach((item) => {
    list.append(foodRow(item));
  });
}

function renderExercise() {
  const list = document.querySelector("#exerciseList");
  list.innerHTML = "";
  const entries = [...state.exercise].sort(sortByNewest);
  if (!entries.length) return addEmpty(list);
  entries.forEach((item) => {
    list.append(exerciseRow(item));
  });
}

function renderWeight(entries) {
  const list = document.querySelector("#weightList");
  list.innerHTML = "";
  const newest = [...entries].sort(sortByNewest);
  if (!newest.length) return addEmpty(list);
  newest.forEach((item) => {
    const bmi = getEntryBmi(item);
    const meta = item.height ? `${item.date} · ${item.height} cm` : `${item.date} · add height for BMI`;
    const value = bmi ? `BMI ${bmi.toFixed(1)}` : `${item.weight} kg`;
    list.append(row(`${item.weight} kg`, meta, value));
  });
}

function renderRecentActivity() {
  const container = document.querySelector("#recentActivity");
  const recent = [
    ...state.food.map((item) => ({ type: "Food", title: item.meal, value: `${item.calories} cal`, date: item.date })),
    ...state.exercise.map((item) => ({
      type: "Exercise",
      title: item.name,
      value: `${item.minutes} min · ${getExerciseCalories(item)} cal`,
      date: item.date,
    })),
    ...state.weight.map((item) => {
      const bmi = getEntryBmi(item);
      return { type: "Weight", title: `${item.weight} kg`, value: bmi ? `BMI ${bmi.toFixed(1)}` : item.date, date: item.date };
    }),
  ]
    .sort(sortByNewest)
    .slice(0, 3);

  container.innerHTML = "";
  if (!recent.length) return addEmpty(container);
  recent.forEach((item) => {
    const element = document.createElement("article");
    element.className = "activity-item";
    element.innerHTML = `<small>${item.type}</small><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.value)}</span>`;
    container.append(element);
  });
}

function drawBmiChart(entries) {
  const canvas = document.querySelector("#bmiChart");
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const bmiEntries = entries
    .map((item) => ({ ...item, bmi: getEntryBmi(item) }))
    .filter((item) => item.bmi);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "#dce3e8";
  context.lineWidth = 2;
  for (let i = 0; i < 5; i += 1) {
    const y = 36 + i * 52;
    context.beginPath();
    context.moveTo(42, y);
    context.lineTo(width - 28, y);
    context.stroke();
  }

  if (bmiEntries.length < 2) {
    context.fillStyle = "#697783";
    context.font = "22px system-ui";
    context.fillText("Add two weight and height entries to build your BMI trend.", 42, 160);
    document.querySelector("#bmiTrendNote").textContent = "Add weight and height to see BMI movement.";
    return;
  }

  const bmis = bmiEntries.map((item) => item.bmi);
  const min = Math.min(...bmis) - 1;
  const max = Math.max(...bmis) + 1;
  const xStep = (width - 90) / Math.max(bmiEntries.length - 1, 1);
  const points = bmiEntries.map((item, index) => ({
    x: 42 + index * xStep,
    y: height - 36 - ((item.bmi - min) / (max - min)) * (height - 72),
    bmi: item.bmi,
  }));

  context.strokeStyle = "#0a7893";
  context.lineWidth = 5;
  context.lineJoin = "round";
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.stroke();

  points.forEach((point) => {
    context.fillStyle = "#ffffff";
    context.strokeStyle = "#277a5b";
    context.lineWidth = 4;
    context.beginPath();
    context.arc(point.x, point.y, 8, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });

  context.fillStyle = "#182026";
  context.font = "18px system-ui";
  points.forEach((point) => {
    context.fillText(point.bmi.toFixed(1), point.x - 16, point.y - 16);
  });

  const delta = bmis.at(-1) - bmis[0];
  const direction = delta === 0 ? "stable" : delta > 0 ? `up ${delta.toFixed(1)}` : `down ${Math.abs(delta).toFixed(1)}`;
  document.querySelector("#bmiTrendNote").textContent = `Since first BMI entry: ${direction}.`;
}

function drawWeightChart(entries) {
  const canvas = document.querySelector("#weightChart");
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const weightEntries = entries.filter((item) => item.weight);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "#dce3e8";
  context.lineWidth = 2;
  for (let i = 0; i < 5; i += 1) {
    const y = 36 + i * 52;
    context.beginPath();
    context.moveTo(42, y);
    context.lineTo(width - 28, y);
    context.stroke();
  }

  if (weightEntries.length < 2) {
    context.fillStyle = "#697783";
    context.font = "22px system-ui";
    context.fillText("Add two weight entries to build your weight trend.", 42, 160);
    document.querySelector("#weightTrendNote").textContent = "Add two weight entries to see movement.";
    return;
  }

  const weights = weightEntries.map((item) => Number(item.weight));
  const min = Math.min(...weights) - 1;
  const max = Math.max(...weights) + 1;
  const xStep = (width - 90) / Math.max(weightEntries.length - 1, 1);
  const points = weightEntries.map((item, index) => ({
    x: 42 + index * xStep,
    y: height - 36 - ((item.weight - min) / (max - min)) * (height - 72),
    weight: Number(item.weight),
  }));

  context.strokeStyle = "#d76143";
  context.lineWidth = 5;
  context.lineJoin = "round";
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.stroke();

  points.forEach((point) => {
    context.fillStyle = "#ffffff";
    context.strokeStyle = "#b18216";
    context.lineWidth = 4;
    context.beginPath();
    context.arc(point.x, point.y, 8, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });

  context.fillStyle = "#182026";
  context.font = "18px system-ui";
  points.forEach((point) => {
    context.fillText(`${point.weight.toFixed(1)}kg`, point.x - 28, point.y - 16);
  });

  const delta = weights.at(-1) - weights[0];
  const direction =
    delta === 0 ? "stable" : delta > 0 ? `up ${delta.toFixed(1)} kg` : `down ${Math.abs(delta).toFixed(1)} kg`;
  document.querySelector("#weightTrendNote").textContent = `Since first weight entry: ${direction}.`;
}

function row(title, meta, value) {
  const element = document.createElement("article");
  element.className = "log-row";
  element.innerHTML = `<div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(meta)}</small></div><span class="tag">${escapeHtml(value)}</span>`;
  return element;
}

function foodRow(item) {
  const element = document.createElement("article");
  element.className = item.photo ? "log-row food-row has-photo" : "log-row food-row";
  const title = item.description ? `${item.meal}: ${item.description}` : item.meal;
  const photo = item.photo
    ? `<img class="meal-thumb" src="${item.photo.dataUrl}" alt="${escapeHtml(item.meal)} meal photo" />`
    : "";
  element.innerHTML = `
    ${photo}
    <div>
      <strong>${escapeHtml(title)}</strong>
      <small>${escapeHtml(item.date)}${item.photo ? " · photo saved" : ""}</small>
    </div>
    <span class="tag">${escapeHtml(item.calories)} cal</span>
  `;
  return element;
}

function exerciseRow(item) {
  const element = document.createElement("article");
  element.className = "log-row exercise-row";
  const link = validUrl(item.link)
    ? `<a class="workout-link" href="${escapeHtml(item.link)}" target="_blank" rel="noopener">Open workout</a>`
    : "";
  element.innerHTML = `
    <div>
      <strong>${escapeHtml(item.name)}</strong>
      <small>${escapeHtml(item.date)} · ${escapeHtml(item.intensity)} · ${escapeHtml(item.minutes)} min ${link}</small>
    </div>
    <span class="tag">${escapeHtml(getExerciseCalories(item))} cal</span>
  `;
  return element;
}

function renderFoodPhotoPreview() {
  const preview = document.querySelector("#foodPhotoPreview");
  preview.innerHTML = "";
  if (!selectedFoodPhoto) {
    preview.innerHTML = "<span>No photo selected</span>";
    return;
  }
  const image = document.createElement("img");
  image.src = selectedFoodPhoto.dataUrl;
  image.alt = "Selected meal preview";
  const note = document.createElement("span");
  note.textContent = "Photo ready for AI estimate";
  preview.append(image, note);
}

async function prepareMealPhoto(file) {
  const image = await loadImage(file);
  const maxSide = 900;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.72),
    name: file.name,
    type: "image/jpeg",
    capturedAt: new Date().toISOString(),
  };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(image.src);
      resolve(image);
    };
    image.onerror = reject;
    image.src = URL.createObjectURL(file);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] || "image/jpeg";
  const bytes = atob(base64);
  const buffer = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) {
    buffer[index] = bytes.charCodeAt(index);
  }
  return new Blob([buffer], { type: mime });
}

function addEmpty(container) {
  container.append(document.querySelector("#emptyState").content.cloneNode(true));
}

function sum(items, key) {
  return items.reduce((total, item) => total + (Number(item[key]) || 0), 0);
}

function sortByNewest(a, b) {
  return b.date.localeCompare(a.date);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function prefillLatestHeight() {
  const heightInput = document.querySelector('#weightForm input[name="height"]');
  const latestHeight = getLatestHeight();
  if (heightInput && latestHeight && !heightInput.value) heightInput.value = latestHeight;
}

function calculateBmi(weight, heightCm) {
  if (!weight || !heightCm) return null;
  const heightM = heightCm / 100;
  return weight / (heightM * heightM);
}

function getEntryBmi(item) {
  return Number(item.bmi) || calculateBmi(Number(item.weight), Number(item.height) || getLatestHeight());
}

function getLatestHeight() {
  return [...state.weight]
    .filter((item) => item.height)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1)?.height;
}

function bmiCategory(bmi) {
  if (bmi < 18.5) return "Low";
  if (bmi < 25) return "Healthy";
  if (bmi < 30) return "High";
  return "Very high";
}

function estimateExerciseCalories({ name = "", minutes = 0, intensity = "Moderate", link = "" }) {
  const text = `${name} ${link}`.toLowerCase();
  const duration = Number(minutes) || inferWorkoutMinutes(link) || 30;
  const met = inferExerciseMet(text, intensity);
  const latestWeight = [...state.weight].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.weight || 75;
  return Math.round((met * 3.5 * latestWeight * duration) / 200);
}

async function estimateFoodWithAI(description, photo) {
  try {
    const response = await fetch("/api/estimate-food", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meal: description, photo: photo?.dataUrl || null }),
    });
    if (!response.ok) throw new Error("AI estimate unavailable");
    const data = await response.json();
    return Number(data.calories) || estimateCalories(description, photo);
  } catch {
    return estimateCalories(description, photo);
  }
}

async function estimateExerciseWithAI(exercise) {
  try {
    const response = await fetch("/api/estimate-exercise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exercise),
    });
    if (!response.ok) throw new Error("AI estimate unavailable");
    const data = await response.json();
    return Number(data.calories) || estimateExerciseCalories(exercise);
  } catch {
    return estimateExerciseCalories(exercise);
  }
}

function getExerciseCalories(item) {
  return Number(item.calories) || estimateExerciseCalories(item);
}

function inferWorkoutMinutes(text = "") {
  const durationMatch = text.match(/(?:^|[^0-9])([1-9][0-9]?)(?:\s|-)*(?:min|minute|minutes|m)(?:[^a-z]|$)/i);
  return durationMatch ? Number(durationMatch[1]) : "";
}

function inferExerciseMet(text, intensity) {
  const rules = [
    [/hiit|tabata|sprint|burpee|boxing|kickboxing/, 9.5],
    [/run|running|jog|treadmill/, 8.3],
    [/cycle|cycling|spin|bike/, 7.5],
    [/strength|weights|dumbbell|barbell|kettlebell|resistance/, 6],
    [/dance|zumba|aerobic|cardio/, 6.8],
    [/pilates|yoga|stretch|mobility/, 3.2],
    [/walk|walking/, 3.5],
  ];
  const base = rules.find(([pattern]) => pattern.test(text))?.[1] || 5.5;
  const multiplier = intensity === "Hard" ? 1.18 : intensity === "Easy" ? 0.78 : 1;
  return base * multiplier;
}

function validUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function estimateCalories(description, photo = null) {
  const text = description.toLowerCase();
  const foodRules = [
    [/pizza|burger|fries|chips/, 760],
    [/rice|pasta|noodle|potato/, 420],
    [/chicken|turkey|fish|salmon|tuna/, 360],
    [/beef|pork|lamb/, 520],
    [/salad|vegetable|veg|greens/, 180],
    [/egg|omelette/, 230],
    [/yogurt|oat|porridge|cereal/, 300],
    [/smoothie|juice|latte/, 240],
    [/cake|cookie|chocolate|dessert/, 460],
    [/avocado|nuts|peanut/, 310],
  ];
  const matches = foodRules.filter(([pattern]) => pattern.test(text)).map(([, calories]) => calories);
  const fallbackPhotoEstimate = photo ? 520 : 350;
  const base = matches.length ? Math.round(matches.reduce((a, b) => a + b, 0) / matches.length) : fallbackPhotoEstimate;
  const portionBoost = /large|big|double|extra/.test(text) ? 1.35 : /small|half|light/.test(text) ? 0.72 : 1;
  const visualBoost = photo && !/small|half|light/.test(text) ? 1.08 : 1;
  return Math.round(base * portionBoost * visualBoost);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}
