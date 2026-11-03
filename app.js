import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// DOM elements
const viewport = document.getElementById('viewport');
const assetsContainer = document.getElementById('assets');
const statusElement = document.getElementById('status');

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202020);

// Camera
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
camera.position.set(12, 12, 12);
camera.lookAt(0, 0, 0);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

viewport.appendChild(renderer.domElement);

// Camera controls
const controls = new OrbitControls(camera, renderer.domElement);

controls.enableDamping = true;
controls.target.set(0, 0, 0);

controls.mouseButtons = {
    LEFT: null,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE
};

controls.touches = {
    ONE: null,
    TWO: THREE.TOUCH.DOLLY_PAN
};

controls.update();

renderer.domElement.addEventListener('contextmenu', event => {
    event.preventDefault();
});

// Lighting
scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 2));

const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
directionalLight.position.set(10, 20, 10);
scene.add(directionalLight);

// Grid: 100 meters, 1 meter per cell
const grid = new THREE.GridHelper(100, 100, 0x777777, 0x444444);
scene.add(grid);

// Ground plane for raycasting
const groundPlane = new THREE.Plane(
    new THREE.Vector3(0, 1, 0),
    0
);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// Asset library
const library = new Map();
const selectedIndices = new Map();
const assetButtons = new Map();
const previewCache = new WeakMap();

// Placed instances
const instances = [];

let selectedName = null;
let dragState = null;

// Thumbnail renderer
const previewWidth = 180;
const previewHeight = 120;

const previewRenderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true
});

previewRenderer.setPixelRatio(1);
previewRenderer.setSize(previewWidth, previewHeight);
previewRenderer.setClearColor(0x333333);
previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
previewRenderer.toneMappingExposure = 1.2;

const previewScene = new THREE.Scene();

previewScene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 2));

const previewLight = new THREE.DirectionalLight(0xffffff, 3);
previewLight.position.set(5, 10, 8);
previewScene.add(previewLight);

const previewCamera = new THREE.OrthographicCamera(
    -1, 1, 1, -1, 0.01, 1000
);

// Generate a thumbnail for a model
function getThumbnail(source) {
    if (previewCache.has(source)) {
        return previewCache.get(source);
    }

    const model = source.clone(true);
    model.position.set(0, 0, 0);

    previewScene.add(model);
    previewScene.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(model);

    if (bounds.isEmpty()) {
        previewScene.remove(model);
        return '';
    }

    const center = bounds.getCenter(new THREE.Vector3());
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());

    const radius = Math.max(sphere.radius, 0.5);
    const aspect = previewWidth / previewHeight;
    const halfHeight = radius * 1.3;
    const distance = radius * 4 + 1;

    previewCamera.left = -halfHeight * aspect;
    previewCamera.right = halfHeight * aspect;
    previewCamera.top = halfHeight;
    previewCamera.bottom = -halfHeight;

    previewCamera.near = 0.01;
    previewCamera.far = distance + radius * 3;

    previewCamera.position.copy(center).add(
        new THREE.Vector3(1, 0.8, 1)
            .normalize()
            .multiplyScalar(distance)
    );

    previewCamera.lookAt(center);
    previewCamera.updateProjectionMatrix();

    previewRenderer.render(previewScene, previewCamera);

    const image = previewRenderer.domElement.toDataURL('image/png');

    previewScene.remove(model);
    previewCache.set(source, image);

    return image;
}

// Build sidebar buttons
function buildSidebar() {
    assetsContainer.replaceChildren();
    assetButtons.clear();

    const names = [...library.keys()].sort((a, b) => {
        return a.localeCompare(b);
    });

    for (const name of names) {
        const variations = library.get(name);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'asset';

        const image = document.createElement('img');
        image.alt = name;
        image.src = getThumbnail(variations[0].source);

        const label = document.createElement('span');
        label.textContent = name;

        const variationLabel = document.createElement('small');
        variationLabel.textContent = `0 / ${variations.length}`;

        button.append(image, label, variationLabel);

        button.addEventListener('click', () => {
            selectAsset(name);
        });

        assetsContainer.appendChild(button);

        assetButtons.set(name, {
            button,
            image,
            variationLabel
        });
    }
}

// Select an asset and cycle through its variations
function selectAsset(name) {
    const variations = library.get(name);

    if (!variations) {
        return;
    }

    const previousIndex = selectedIndices.get(name) ?? -1;
    const nextIndex = (previousIndex + 1) % variations.length;

    selectedIndices.set(name, nextIndex);
    selectedName = name;

    const selected = variations[nextIndex];
    const elements = assetButtons.get(name);

    elements.image.src = getThumbnail(selected.source);
    elements.variationLabel.textContent =
        `${selected.variation} / ${variations.length}`;

    for (const [assetName, item] of assetButtons) {
        const active = assetName === name;

        item.button.classList.toggle('active', active);
        item.button.setAttribute('aria-pressed', String(active));
    }

    statusElement.textContent =
        `Selected: ${name}_${selected.variation} | Left drag: place / move`;
}

// Load and index GLB objects
async function loadAssets() {
    const loader = new GLTFLoader();
    const pattern = /^(.+)_(\d+)$/;

    try {
        const gltf = await loader.loadAsync('./all.glb');

        gltf.scene.traverse(object => {
            const match = object.name.match(pattern);

            if (!match) {
                return;
            }

            // Ignore nested objects belonging to another named asset
            let parent = object.parent;

            while (parent && parent !== gltf.scene) {
                if (pattern.test(parent.name)) {
                    return;
                }

                parent = parent.parent;
            }

            const name = match[1];
            const variation = Number(match[2]);

            if (!library.has(name)) {
                library.set(name, []);
            }

            const variations = library.get(name);

            if (variations.some(item => item.variation === variation)) {
                console.warn(`Duplicate asset: ${object.name}`);
                return;
            }

            variations.push({
                variation,
                source: object
            });
        });

        for (const variations of library.values()) {
            variations.sort((a, b) => a.variation - b.variation);
        }

        buildSidebar();

        if (library.size === 0) {
            statusElement.textContent = 'No assets found in all.glb';
        } else {
            statusElement.textContent =
                `${library.size} assets loaded | Select an asset to place`;
        }
    } catch (error) {
        console.error('GLB loading error:', error);
        statusElement.textContent = 'Failed to load all.glb';
    }
}

// Calculate pointer intersection with the ground plane
function getGroundPosition(event) {
    const rect = renderer.domElement.getBoundingClientRect();

    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);

    const position = new THREE.Vector3();

    if (!raycaster.ray.intersectPlane(groundPlane, position)) {
        return null;
    }

    return position;
}

// Snap a coordinate to the 1-meter grid
function snap(value) {
    return Math.round(value);
}

// Find an existing instance under the pointer
function getIntersectedInstance() {
    const intersections = raycaster.intersectObjects(instances, true);

    for (const intersection of intersections) {
        let object = intersection.object;

        while (object && !object.userData.editorInstance) {
            object = object.parent;
        }

        if (object?.userData.editorInstance) {
            return object;
        }
    }

    return null;
}

// Create a new instance from the selected asset
function createInstance(position) {
    if (selectedName === null) {
        return null;
    }

    const variations = library.get(selectedName);
    const index = selectedIndices.get(selectedName);
    const source = variations[index].source;

    const instance = source.clone(true);

    instance.position.set(
        snap(position.x),
        0,
        snap(position.z)
    );

    instance.userData.editorInstance = true;

    scene.add(instance);
    instances.push(instance);

    return instance;
}

// Start placement or movement
function onPointerDown(event) {
    if (event.button !== 0 || dragState) {
        return;
    }

    const position = getGroundPosition(event);

    if (!position) {
        return;
    }

    let instance = getIntersectedInstance();

    let offsetX = 0;
    let offsetZ = 0;

    if (instance) {
        offsetX = instance.position.x - position.x;
        offsetZ = instance.position.z - position.z;
    } else {
        instance = createInstance(position);
    }

    if (!instance) {
        return;
    }

    dragState = {
        instance,
        pointerId: event.pointerId,
        offsetX,
        offsetZ
    };

    renderer.domElement.setPointerCapture(event.pointerId);
    event.preventDefault();
}

// Move the instance on the XZ plane
function onPointerMove(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
    }

    const position = getGroundPosition(event);

    if (!position) {
        return;
    }

    dragState.instance.position.set(
        snap(position.x + dragState.offsetX),
        0,
        snap(position.z + dragState.offsetZ)
    );
}

// Finish placement or movement
function onPointerUp(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
    }

    dragState = null;

    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
    }
}

// Pointer events
renderer.domElement.addEventListener('pointerdown', onPointerDown);
renderer.domElement.addEventListener('pointermove', onPointerMove);
renderer.domElement.addEventListener('pointerup', onPointerUp);
renderer.domElement.addEventListener('pointercancel', onPointerUp);

// Resize viewport
const resizeObserver = new ResizeObserver(() => {
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;

    if (width === 0 || height === 0) {
        return;
    }

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height, false);
});

resizeObserver.observe(viewport);

// Render loop
function animate() {
    controls.update();
    renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

// Initialize
loadAssets();