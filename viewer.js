// viewer.js — ES module using Three.js examples via unpkg (modern browsers)
// Задачи: получить список моделей с /models/models.json (или парсить /models/), показать список и загружать модель при выборе.

// Используем esm.sh — CDN, который корректно резолвит вложенные импорт-спецификаторы для браузера
import * as THREE from 'https://esm.sh/three@0.152.2';
import { OrbitControls } from 'https://esm.sh/three@0.152.2/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://esm.sh/three@0.152.2/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'https://esm.sh/three@0.152.2/examples/jsm/loaders/OBJLoader.js';

const MODELS_PATH = 'models/'; // относительный путь к папке с моделями на сервере

const dom = {
  modelsList: document.getElementById('modelsList'),
  reloadBtn: document.getElementById('reloadList'),
  filter: document.getElementById('filter'),
  canvasContainer: document.getElementById('canvasContainer'),
  modelName: document.getElementById('modelName'),
  loading: document.getElementById('loading')
  ,errorBox: document.getElementById('errorBox')
};

let scene, camera, renderer, controls, currentModel = null;
let currentMode = 'standard';
let ambientLight, directionalLight;

init();

function setLoading(v, text) {
  dom.loading.style.display = v ? 'block' : 'none';
  dom.loading.textContent = text || 'Загрузка...';
}

async function init() {
  setupThree();
  // ensure lights follow the initial display mode
  setLights(currentMode !== 'wireframe');
  dom.reloadBtn.addEventListener('click', loadModelList);
  dom.filter.addEventListener('input', () => populateList(lastModels));
  window.addEventListener('resize', onWindowResize);
  // Если страница открыта через file:// — fetch не будет работать для локальных файлов.
  if (location.protocol === 'file:') {
    dom.modelsList.textContent = 'Внимание: вы открыли файл напрямую (file://). Запустите локальный HTTP‑сервер (см. README) и откройте через http://localhost:8000, чтобы загрузить модели.';
    console.warn('viewer: running under file:// — fetch will fail. Start an HTTP server.');
  } else {
    await loadModelList();
  }
  animate();
}

function setupThree() {
  scene = new THREE.Scene();
  // Градиентный skybox через canvas-текстуру
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 1024; skyCanvas.height = 1024;
  const ctx = skyCanvas.getContext('2d');
  // Вертикальный градиент: более тёмный светло-серый skybox (нейтральный фон для моделей)
  const grad = ctx.createLinearGradient(0, 0, 0, skyCanvas.height);
  // чуть более тёмные стопы, чтобы фон выглядел глубже
  grad.addColorStop(0, '#e6e7e9');
  grad.addColorStop(0.6, '#d6d7d9');
  grad.addColorStop(1, '#c6c7c9');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, skyCanvas.width, skyCanvas.height);
  // const skyTex = new THREE.CanvasTexture(skyCanvas);
  // scene.background = skyTex; // отключаем, чтобы фон был прозрачным и был виден CSS

  camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 2, 5);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  // append canvas then set size to container
  dom.canvasContainer.appendChild(renderer.domElement);
  // Удалить .canvas-fallback после инициализации WebGL
  const fallback = dom.canvasContainer.querySelector('.canvas-fallback');
  if (fallback) fallback.remove();
  const setRendererToContainer = () => {
    const w = dom.canvasContainer.clientWidth || 800;
    const h = dom.canvasContainer.clientHeight || 600;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  setRendererToContainer();
  // keep reference to function for resize
  window.__setRendererToContainer = setRendererToContainer;

  // Ensure canvas element scales to container (helps in fullscreen)
  if (renderer.domElement && renderer.domElement.style) {
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
  }

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(5, 10, 7.5);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 0.5;
  directionalLight.shadow.camera.far = 500;
  const d = 25;
  directionalLight.shadow.camera.left = -d;
  directionalLight.shadow.camera.right = d;
  directionalLight.shadow.camera.top = d;
  directionalLight.shadow.camera.bottom = -d;
  directionalLight.shadow.bias = -0.0005;
  scene.add(directionalLight);

  // enable renderer shadows
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // ground plane to receive shadows (transparent / shadow-only)
  const groundGeo = new THREE.PlaneGeometry(200, 200);
  const groundMat = new THREE.ShadowMaterial({ opacity: 0.5 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.receiveShadow = true;
  ground.renderOrder = 0;
  scene.add(ground);

  // (GridHelper убран)
}

function setLights(state) {
  // state: true -> lights on, false -> off
  if (ambientLight) ambientLight.visible = !!state;
  if (directionalLight) directionalLight.visible = !!state;
}

function onWindowResize() {
  if (window.__setRendererToContainer) window.__setRendererToContainer();
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

let lastModels = [];

async function loadModelList() {
  setLoading(true, 'Получаем список моделей...');
  try {
    // 1) попытка получить manifest JSON
    const url = MODELS_PATH + 'models.json';
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      lastModels = normalizeManifest(data);
      populateList(lastModels);
      // автозагрузка первой модели, если есть
      if (lastModels.length > 0) {
        // небольшая задержка, чтобы UI успел отрисоваться
        setTimeout(() => {
          try { loadModel(lastModels[0]); } catch (e) { console.warn(e); }
        }, 100);
      }
      setLoading(false);
      return;
    }

    // 2) fallback: запрашиваем индекс каталога и парсим ссылки (работает если сервер отдаёт HTML с перечислением файлов)
    const idx = await fetch(MODELS_PATH);
    if (idx.ok) {
      const txt = await idx.text();
      const files = parseLinksFromIndex(txt);
      lastModels = files.map(f => ({ name: f.split('/').pop(), url: MODELS_PATH + f }));
      populateList(lastModels);
      setLoading(false);
      return;
    }

    dom.modelsList.textContent = 'Не удалось получить список моделей. Поместите models/models.json или включите индекс папки.';
  } catch (err) {
    console.error(err);
    dom.modelsList.textContent = 'Ошибка при загрузке списка моделей. Смотрите консоль.';
  } finally {
    setLoading(false);
  }
}

function normalizeManifest(data) {
  // поддерживаем формат: [ {name, url}, "file.glb", ... ]
  if (!Array.isArray(data)) return [];
  return data.map(item => {
    if (typeof item === 'string') return { name: item.split('/').pop(), url: MODELS_PATH + item };
    return { name: item.name || (item.url || '').split('/').pop(), url: item.url.startsWith('http') ? item.url : MODELS_PATH + (item.url || '') };
  });
}

function parseLinksFromIndex(html) {
  // ищем href, содержащие расширения .glb .gltf .obj
  const re = /href\s*=\s*"([^"']+\.(glb|gltf|obj))"/gi;
  const res = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = decodeURIComponent(m[1]);
    // если ссылка абсолютная внутри /models, уберём префикс
    if (href.startsWith('/')) {
      if (href.startsWith('/' + MODELS_PATH)) res.push(href.replace('/' + MODELS_PATH, ''));
      else res.push(href);
    } else {
      res.push(href);
    }
  }
  // уникализируем
  return Array.from(new Set(res));
}

function populateList(models) {
  const q = (dom.filter.value || '').toLowerCase();
  dom.modelsList.innerHTML = '';
  const filtered = models.filter(m => m.name.toLowerCase().includes(q));
  if (filtered.length === 0) {
    dom.modelsList.textContent = 'Модели не найдены.';
    return;
  }
  for (const m of filtered) {
    const el = document.createElement('button');
    el.className = 'model-item';
    // показываем имя без расширения, но сохраняем оригинал в data-атрибуте
    const displayName = (m.name || '').replace(/\.[^/.]+$/, '');
    el.textContent = displayName;
    el.dataset.filename = m.name;
    el.addEventListener('click', () => {
      // mark selected button
      const all = dom.modelsList.querySelectorAll('button.model-item');
      all.forEach(b => b.classList.remove('selected'));
      el.classList.add('selected');
      loadModel(m);
    });
    dom.modelsList.appendChild(el);
  }
}

async function loadModel(entry) {
  if (!entry || !entry.url) return;
  clearError();
  const strippedNameForLoading = (entry.name || '').replace(/\.[^/.]+$/, '');
  setLoading(true, 'Загружаю ' + strippedNameForLoading + ' ...');
  try {
    // clear previous model
    if (currentModel) {
      scene.remove(currentModel);
      disposeObject(currentModel);
      currentModel = null;
    }


    // request a short-lived signed URL from server to avoid exposing permanent direct paths
    let url = entry.url;
    try {
      const infoRes = await fetch(`/api/getSignedUrl?name=${encodeURIComponent(entry.name)}&ttl=60`, { cache: 'no-store' });
      if (infoRes.ok) {
        const info = await infoRes.json();
        if (info && info.url) url = info.url; // relative URL to protected endpoint
      } else {
        console.warn('Failed to get signed URL, falling back to entry.url');
      }
    } catch (e) { console.warn('signed url request failed', e); }

    const ext = (url.split('?')[0] || '').split('.').pop().toLowerCase();
    if (ext === 'glb' || ext === 'gltf') {
      const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
      currentModel = gltf.scene || gltf.scenes[0];
      scene.add(currentModel);
      // ensure meshes cast/receive shadows
      currentModel.traverse(node => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = false;
        }
      });
      // bring model base to y=0 so shadows land on ground
      try {
        const bbox = new THREE.Box3().setFromObject(currentModel);
        const minY = bbox.min.y;
        if (isFinite(minY) && Math.abs(minY) > 1e-5) {
          currentModel.position.y -= minY;
          currentModel.updateMatrixWorld(true);
        }
      } catch (e) { /* ignore bbox errors */ }
    } else if (ext === 'obj') {
      const loader = new OBJLoader();
  const obj = await loader.loadAsync(url);
      currentModel = obj;
      scene.add(currentModel);
      currentModel.traverse(node => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = false;
        }
      });
      try {
        const bbox = new THREE.Box3().setFromObject(currentModel);
        const minY = bbox.min.y;
        if (isFinite(minY) && Math.abs(minY) > 1e-5) {
          currentModel.position.y -= minY;
          currentModel.updateMatrixWorld(true);
        }
      } catch (e) { }
    } else {
      alert('Формат не поддерживается: ' + ext);
      return;
    }

  const details = document.getElementById('modelDetails');
  const modelName = document.getElementById('modelName');
  // показываем имя без расширения
  const stripped = (entry.name || '').replace(/\.[^/.]+$/, '');
  if (details) details.textContent = `Имя: ${stripped}`;
  if (modelName) modelName.textContent = stripped;

  // Mark the corresponding button in the list as selected (if present)
  try {
    const all = dom.modelsList.querySelectorAll('button.model-item');
    all.forEach(b => {
      if (b.dataset && b.dataset.filename === entry.name) b.classList.add('selected');
      else b.classList.remove('selected');
    });
  } catch (e) { /* ignore if modelsList not ready */ }

  // применить текущий режим отображения
  applyDisplayMode(currentMode);
  // синхронизировать состояние освещения: в Standard свет включён, в Wireframe выключён
  setLights(currentMode !== 'wireframe');
    // обновить статистику
    updateModelStats(currentModel);

    // center and frame
    frameModel(currentModel);
  } catch (err) {
    console.error(err);
    // Попробуем собрать информацию о проблеме с помощью fetch и показать пользователю
    showError('Ошибка при загрузке модели: ' + err.message);
    try {
      inspectUrl(url);
    } catch (e) {
      console.warn('inspect failed', e);
    }
  } finally {
    setLoading(false);
  }
}

// Применяет режим отображения к модели
function applyDisplayMode(mode) {
  if (!currentModel) return;
  currentModel.traverse(obj => {
    if (obj.isMesh && obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach(mat => setMatMode(mat, mode));
      } else {
        setMatMode(obj.material, mode);
      }
    }
  });
}

function setMatMode(mat, mode) {
  if (!mat) return;
  if (mode === 'wireframe') {
    mat.wireframe = true;
    if (mat.flatShading !== undefined) mat.flatShading = false;
    mat.needsUpdate = true;
  } else if (mode === 'flat') {
    mat.wireframe = false;
    if (mat.flatShading !== undefined) mat.flatShading = true;
    mat.needsUpdate = true;
  } else {
    mat.wireframe = false;
    if (mat.flatShading !== undefined) mat.flatShading = false;
    mat.needsUpdate = true;
  }
}

// Считает статистику по модели
function updateModelStats(obj) {
  const stats = { meshes: 0, tris: 0, verts: 0, materials: new Set() };
  obj.traverse(o => {
    if (o.isMesh && o.geometry) {
      stats.meshes++;
      // Треугольники
      if (o.geometry.index) {
        stats.tris += o.geometry.index.count / 3;
      } else if (o.geometry.attributes.position) {
        stats.tris += o.geometry.attributes.position.count / 3;
      }
      // Вершины
      if (o.geometry.attributes.position) {
        stats.verts += o.geometry.attributes.position.count;
      }
      // Материалы
      if (Array.isArray(o.material)) o.material.forEach(m => stats.materials.add(m.uuid));
      else if (o.material) stats.materials.add(o.material.uuid);
    }
  });
  const statsBox = document.getElementById('modelStats');
  if (statsBox) {
    statsBox.textContent = `Мешей: ${stats.meshes}\nПолигоны: ${Math.round(stats.tris)}\nВершины: ${Math.round(stats.verts)}\nМатериалов: ${stats.materials.size}`;
  }
}

// sidebar toggle & fullscreen handlers
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggleSidebar');
  const left = document.querySelector('.sidebar.left');
  if (toggle && left) {
    toggle.addEventListener('click', () => {
      left.classList.toggle('collapsed');
      // update renderer size after layout change
      setTimeout(() => { if (window.__setRendererToContainer) window.__setRendererToContainer(); }, 310); // 310ms to be safe
    });
  }

  const fsBtn = document.getElementById('fullscreenBtn');
  if (fsBtn) {
    fsBtn.addEventListener('click', async () => {
      const viewer = document.getElementById('viewerWrap');
      try {
        if (!document.fullscreenElement) await viewer.requestFullscreen();
        else await document.exitFullscreen();
      } catch (e) { console.warn('fullscreen failed', e); }
      // resize will be handled by fullscreenchange listener below
    });
  }

  // display modes
  const modeBtns = document.querySelectorAll('.mode-btn');
  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      currentMode = btn.dataset.mode;
      applyDisplayMode(currentMode);
      // lights: on for standard, off for wireframe
      setLights(currentMode !== 'wireframe');
      modeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === currentMode));
      if (currentModel) updateModelStats(currentModel);
    });
  });
});

// Handle resize and re-centering when entering/exiting fullscreen.
// Use short delays to allow the browser to apply layout changes.
function onFullScreenChange() {
  // run a couple times: immediate and after layout settles
  const doResize = () => {
    try {
      if (window.__setRendererToContainer) window.__setRendererToContainer();
      if (currentModel) frameModel(currentModel);
    } catch (e) { console.warn('fullscreen resize error', e); }
  };
  doResize();
  setTimeout(doResize, 180);
}
document.addEventListener('fullscreenchange', onFullScreenChange);
document.addEventListener('webkitfullscreenchange', onFullScreenChange);
document.addEventListener('mozfullscreenchange', onFullScreenChange);

function showError(msg) {
  if (!dom.errorBox) return;
  dom.errorBox.style.display = 'block';
  dom.errorBox.textContent = msg;
}

function clearError() {
  if (!dom.errorBox) return;
  dom.errorBox.style.display = 'none';
  dom.errorBox.textContent = '';
}

async function inspectUrl(url) {
  // выполняем запрос HEAD если поддерживается, иначе GET (без body чтения) — чтобы получить заголовки
  try {
    let res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) {
      // если HEAD не поддерживается (некоторые сервера возвращают 405), попробуем GET и прочитаем только заголовки
      res = await fetch(url, { method: 'GET' });
    }
    const info = [`HTTP ${res.status} ${res.statusText}`];
    for (const [k, v] of res.headers.entries()) {
      if (k === 'set-cookie') continue;
      if (k === 'content-length' || k === 'content-type' || k === 'content-disposition' || k === 'access-control-allow-origin') {
        info.push(`${k}: ${v}`);
      }
    }
    const details = info.join('\n');
    console.info('Model fetch info:\n' + details);
    showError('Ошибка при загрузке модели. Подробнее в консоли.\n' + details);
  } catch (e) {
    console.warn('inspectUrl failed', e);
    showError('Не удалось получить заголовки модели: ' + e.message);
  }
}

function disposeObject(obj) {
  obj.traverse(node => {
    if (node.geometry) {
      node.geometry.dispose();
    }
    if (node.material) {
      if (Array.isArray(node.material)) node.material.forEach(m => m.dispose());
      else node.material.dispose();
    }
  });
}

function frameModel(object3d) {
  // compute bounding box
  const box = new THREE.Box3().setFromObject(object3d);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  // position camera
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)); // хорошая starting dist
  cameraZ *= 1.8; // fudge

  camera.position.copy(center);
  camera.position.x += cameraZ * 0.7;
  camera.position.y += cameraZ * 0.4;
  camera.position.z += cameraZ * 0.7;
  camera.near = Math.max(0.1, maxDim / 100);
  camera.far = cameraZ * 10 + maxDim * 10;
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}

export { };
