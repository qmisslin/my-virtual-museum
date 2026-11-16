
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export class MuseumScene {
    static GRID_SIZE = 1;
    static VIEW_HEIGHT = 28;
    static EDGE_MARGIN = 65;

    constructor(canvas, assets, onUpdate) {
        this.canvas = canvas;
        this.assets = assets;
        this.onUpdate = onUpdate;
        this.root = new THREE.Scene();
        this.root.background = new THREE.Color('#e3e9ee');
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
        this.target = new THREE.Vector3();
        this.camera.position.set(17, 50, 17);
        this.camera.lookAt(this.target);
        this.instances = [];
        this.selection = [];
        this.revision = 0;
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        this.pointerDown = null;
        this.edgePointer = null;
        this.placement = null;
        this.gizmoDragging = false;
        this.lastGizmoPosition = new THREE.Vector3();
        this.dragOrigin = new THREE.Vector3();
        this.dragPositions = new Map();
        this.previousFrame = performance.now();
        this.initializeScene();
        this.initializeGizmo();
        this.initializeOutlines();
        this.attachEvents();
        this.resize();
        this.animate();
    }

    initializeScene() {
        const grid = new THREE.GridHelper(200, 200, 0xaab8c5, 0xcbd5de);
        grid.material.transparent = true;
        grid.material.opacity = 0.65;
        grid.position.y = -0.012;
        this.root.add(grid);
        this.root.add(new THREE.AmbientLight(0xffffff, 1.25));
        const sun = new THREE.DirectionalLight(0xffffff, 2.2);
        sun.position.set(-15, 30, 20);
        this.root.add(sun);
        this.gizmoPivot = new THREE.Object3D();
        this.root.add(this.gizmoPivot);
    }

    initializeGizmo() {
        this.gizmo = new TransformControls(this.camera, this.canvas);
        this.gizmo.setMode('translate');
        this.gizmo.setSpace('world');
        this.gizmo.setTranslationSnap(null);
        this.gizmo.showY = false;
        this.gizmo.setSize(0.85);
        this.root.add(this.gizmo.getHelper());
        this.gizmo.addEventListener('dragging-changed', (event) => {
            this.gizmoDragging = event.value;
            if (event.value) {
                this.dragOrigin.copy(this.gizmoPivot.position);
                this.dragPositions = new Map(this.selection.map((object) => [object, object.position.clone()]));
            }
            if (!event.value) {
                this.edgePointer = null;
                this.updateGizmo();
            }
        });
        this.gizmo.addEventListener('objectChange', () => {
            const delta = this.gizmoPivot.position.clone().sub(this.dragOrigin);
            delta.set(Math.round(delta.x), 0, Math.round(delta.z));
            let changed = false;
            for (const root of this.selection) {
                const origin = this.dragPositions.get(root);
                if (!origin) continue;
                const next = origin.clone().add(delta);
                if (!root.position.equals(next)) {
                    root.position.copy(next);
                    changed = true;
                }
            }
            if (changed) this.changed();
        });
    }

    initializeOutlines() {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.root, this.camera));
        this.otherOutline = this.createOutline('#43b7d3', 2.3);
        this.primaryOutline = this.createOutline('#ef9b38', 3.5);
        this.hoverOutline = this.createOutline('#f9fbff', 2.0);
        this.composer.addPass(this.otherOutline);
        this.composer.addPass(this.primaryOutline);
        this.composer.addPass(this.hoverOutline);
        this.composer.addPass(new OutputPass());
    }

    createOutline(color, strength) {
        const pass = new OutlinePass(new THREE.Vector2(1, 1), this.root, this.camera);
        pass.visibleEdgeColor.set(color);
        pass.hiddenEdgeColor.set(color);
        pass.edgeStrength = strength;
        pass.edgeThickness = 1.2;
        pass.selectedObjects = [];
        return pass;
    }

    attachEvents() {
        this.canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
        window.addEventListener('pointermove', (event) => this.onPointerMove(event));
        window.addEventListener('pointerup', (event) => this.onPointerUp(event));
        this.canvas.addEventListener('dblclick', (event) => {
            if (!this.pick(event)) this.setSelection([]);
        });
        this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
        this.canvas.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
        this.canvas.addEventListener('dragenter', (event) => this.onDragOver(event));
        this.canvas.addEventListener('dragover', (event) => this.onDragOver(event));
        this.canvas.addEventListener('drop', (event) => this.onDrop(event));
        window.addEventListener('dragend', () => this.stopPlacement());
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const width = Math.max(this.canvas.clientWidth, 1);
        const height = Math.max(this.canvas.clientHeight, 1);
        const half = MuseumScene.VIEW_HEIGHT / 2;
        const aspect = width / height;
        this.camera.left = -half * aspect;
        this.camera.right = half * aspect;
        this.camera.top = half;
        this.camera.bottom = -half;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
        this.composer.setSize(width, height);
    }

    screenToGround(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        return this.raycaster.ray.intersectPlane(this.plane, new THREE.Vector3());
    }

    snap(point) {
        if (!point) return null;
        return new THREE.Vector3(Math.round(point.x), 0, Math.round(point.z));
    }

    pick(event) {
        const rect = this.canvas.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientY < rect.top || event.clientX > rect.right || event.clientY > rect.bottom) return null;
        this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const intersections = this.raycaster.intersectObjects(this.instances, true);
        const hitRoots = [];
        for (const hit of intersections) {
            let parent = hit.object;
            while (parent && !this.instances.includes(parent)) parent = parent.parent;
            if (parent && !hitRoots.includes(parent)) hitRoots.push(parent);
        }
        return hitRoots[0] || null;
    }

    onPointerDown(event) {
        if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
        if (this.gizmo.axis || this.gizmoDragging || this.placement) return;
        this.pointerDown = {
            x: event.clientX,
            y: event.clientY,
            world: this.screenToGround(event.clientX, event.clientY),
            hit: this.pick(event),
            moved: false,
            button: event.button
        };
    }

    onPointerMove(event) {
        if (this.gizmoDragging) {
            this.edgePointer = { x: event.clientX, y: event.clientY };
            return;
        }
        if (this.placement) {
            this.movePlacement(event);
            return;
        }
        if (this.pointerDown) {
            const down = this.pointerDown;
            if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) down.moved = true;
            if (down.moved) {
                const world = this.screenToGround(event.clientX, event.clientY);
                if (world && down.world) this.pan(down.world.clone().sub(world));
            }
            return;
        }
        this.hoverOutline.selectedObjects = [];
        const hovered = this.pick(event);
        if (hovered && !this.selection.includes(hovered)) this.hoverOutline.selectedObjects = [hovered];
    }

    onPointerUp(event) {
        if (!this.pointerDown) return;
        const down = this.pointerDown;
        this.pointerDown = null;
        if (!down.moved && down.button === 0 && !this.gizmoDragging && !this.gizmo.axis) {
            if (down.hit) {
                if (event.shiftKey) {
                    const next = this.selection.filter((object) => object !== down.hit);
                    if (next.length === this.selection.length) next.push(down.hit);
                    this.setSelection(next);
                } else {
                    this.setSelection([down.hit]);
                }
            }
        }
    }

    onWheel(event) {
        event.preventDefault();
        const before = this.screenToGround(event.clientX, event.clientY);
        this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * Math.exp(-event.deltaY * 0.0012), 0.35, 5);
        this.camera.updateProjectionMatrix();
        const after = this.screenToGround(event.clientX, event.clientY);
        if (before && after) this.pan(before.sub(after));
    }

    pan(delta) {
        delta.y = 0;
        this.target.add(delta);
        this.camera.position.add(delta);
        this.camera.updateMatrixWorld();
    }

    add(id, position) {
        const root = this.assets.instantiate(id);
        root.position.copy(this.snap(position || new THREE.Vector3()));
        this.root.add(root);
        this.instances.push(root);
        this.setSelection([root]);
        this.changed();
        return root;
    }

    setSelection(roots) {
        this.selection = roots.filter((root) => this.instances.includes(root));
        this.primaryOutline.selectedObjects = this.selection.length ? [this.selection.at(-1)] : [];
        this.otherOutline.selectedObjects = this.selection.slice(0, -1);
        this.hoverOutline.selectedObjects = [];
        this.updateGizmo();
        this.onUpdate();
    }

    updateGizmo() {
        if (this.gizmoDragging) return;
        if (!this.selection.length) {
            this.gizmo.detach();
            return;
        }
        const center = new THREE.Vector3();
        for (const object of this.selection) center.add(object.position);
        center.multiplyScalar(1 / this.selection.length);
        const grid = new THREE.Vector3(Math.round(center.x), 0, Math.round(center.z));
        const cell = new THREE.Vector3(Math.round(center.x - 0.5) + 0.5, 0, Math.round(center.z - 0.5) + 0.5);
        const pivot = center.distanceToSquared(grid) <= center.distanceToSquared(cell) ? grid : cell;
        this.gizmoPivot.position.copy(pivot);
        this.lastGizmoPosition.copy(pivot);
        this.gizmo.attach(this.gizmoPivot);
    }

    rotateSelection(clockwise) {
        if (!this.selection.length) return;
        const pivot = this.gizmoPivot.position.clone();
        const radians = clockwise ? -Math.PI / 2 : Math.PI / 2;
        for (const object of this.selection) {
            object.position.sub(pivot).applyAxisAngle(THREE.Object3D.DEFAULT_UP || new THREE.Vector3(0, 1, 0), radians).add(pivot);
            object.position.set(Math.round(object.position.x), 0, Math.round(object.position.z));
            object.rotation.y += radians;
        }
        this.updateGizmo();
        this.changed();
    }

    removeSelection() {
        for (const root of this.selection) {
            this.root.remove(root);
            this.instances.splice(this.instances.indexOf(root), 1);
            root.traverse((node) => {
                node.geometry?.dispose();
                const materials = Array.isArray(node.material) ? node.material : [node.material];
                for (const material of materials) material?.dispose();
            });
        }
        this.setSelection([]);
        this.changed();
    }

    clear() {
        this.setSelection(this.instances.slice());
        this.removeSelection();
    }

    onDragOver(event) {
        const id = event.dataTransfer?.getData('application/x-museum-asset');
        const types = Array.from(event.dataTransfer?.types || []);
        if (!id && !types.includes('application/x-museum-asset')) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        if (id && (!this.placement || this.placement.id !== id)) this.startPlacement(id);
        this.movePlacement(event);
    }

    startPlacement(id) {
        this.stopPlacement();
        if (!this.assets.templates.has(id)) return;
        const ghost = this.assets.instantiate(id);
        ghost.traverse((node) => {
            if (!node.isMesh) return;
            const originals = Array.isArray(node.material) ? node.material : [node.material];
            const materials = originals.map((m) => {
                const copy = m.clone();
                copy.transparent = true;
                copy.opacity = Math.min(0.55, copy.opacity);
                copy.depthWrite = false;
                return copy;
            });
            node.material = Array.isArray(node.material) ? materials : materials[0];
        });
        this.placement = { id, ghost, point: null };
        this.root.add(ghost);
        this.hoverOutline.selectedObjects = [];
    }

    movePlacement(event) {
        if (!this.placement) return;
        const point = this.snap(this.screenToGround(event.clientX, event.clientY));
        if (point) {
            this.placement.ghost.position.copy(point);
            this.placement.point = point;
            this.edgePointer = { x: event.clientX, y: event.clientY };
        }
    }

    onDrop(event) {
        const id = event.dataTransfer?.getData('application/x-museum-asset') || this.placement?.id;
        if (!id || !this.assets.templates.has(id)) return;
        event.preventDefault();
        const point = this.snap(this.screenToGround(event.clientX, event.clientY));
        this.stopPlacement();
        if (point) this.add(id, point);
    }

    stopPlacement() {
        if (!this.placement) return;
        this.root.remove(this.placement.ghost);
        this.placement.ghost.traverse((node) => {
            node.geometry?.dispose();
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            for (const material of materials) material?.dispose();
        });
        this.placement = null;
        this.edgePointer = null;
    }

    autoPan(seconds) {
        if ((!this.placement && !this.gizmoDragging) || !this.edgePointer) return;
        const rect = this.canvas.getBoundingClientRect();
        const px = this.edgePointer.x - rect.left;
        const py = this.edgePointer.y - rect.top;
        const margin = MuseumScene.EDGE_MARGIN;
        const x = px < margin ? -(margin - px) / margin : px > rect.width - margin ? (px - rect.width + margin) / margin : 0;
        const y = py < margin ? (margin - py) / margin : py > rect.height - margin ? -(py - rect.height + margin) / margin : 0;
        if (!x && !y) return;
        const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).setY(0).normalize();
        const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).setY(0).normalize();
        const speed = 14 * seconds / this.camera.zoom;
        this.pan(right.multiplyScalar(x * speed).add(up.multiplyScalar(y * speed)));
        if (this.placement) {
            const point = this.snap(this.screenToGround(this.edgePointer.x, this.edgePointer.y));
            if (point) this.placement.ghost.position.copy(point);
        }
    }

    changed() {
        this.revision++;
        this.onUpdate();
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const now = performance.now();
        const dt = Math.min((now - this.previousFrame) / 1000, 0.05);
        this.previousFrame = now;
        this.autoPan(dt);
        this.composer.render();
    }
}
