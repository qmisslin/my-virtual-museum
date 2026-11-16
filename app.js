
import * as THREE from 'three';
import { Assets } from './assets.js';
import { MuseumScene } from './scene.js';
import { MuseumIO } from './io.js';

export class MuseumApp {
    constructor() {
        this.assets = new Assets();
        this.editor = null;
        this.io = null;
        this.thumbnails = new Map();
        this.activeCategory = null;
        this.categories = document.getElementById('categories');
        this.variations = document.getElementById('variations');
        this.status = document.getElementById('status');
        this.selectionPanel = document.getElementById('selection-panel');
        this.selectionCount = document.getElementById('selection-count');
        this.fileInput = document.getElementById('file-input');
        this.previewRenderer = null;
    }

    async start() {
        try {
            this.setStatus('Loading assets...');
            await this.assets.load();
            this.editor = new MuseumScene(document.getElementById('scene'), this.assets, () => this.updateSelectionPanel());
            this.io = new MuseumIO(this.editor, this.assets, (message) => this.setStatus(message));
            this.bindUI();
            this.renderCategories();
            this.setStatus('');
        } catch (error) {
            this.setStatus(`Error: ${error.message}`);
            console.error(error);
        }
    }

    setStatus(message) {
        this.status.textContent = message;
    }

    bindUI() {
        document.getElementById('import-glb').addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', async () => {
            const file = this.fileInput.files?.[0];
            if (file) await this.runOperation(() => this.io.importGLB(file));
            this.fileInput.value = '';
        });
        document.getElementById('export-glb').addEventListener('click', () => this.runOperation(() => this.io.exportGLB()));
        document.getElementById('export-png').addEventListener('click', () => this.runOperation(() => this.io.exportPNG()));
        document.getElementById('clear').addEventListener('click', () => {
            this.editor.clear();
            this.setStatus('Scene cleared');
        });
        document.getElementById('rotate-cw').addEventListener('click', () => this.editor.rotateSelection(true));
        document.getElementById('rotate-ccw').addEventListener('click', () => this.editor.rotateSelection(false));
        document.getElementById('delete-selection').addEventListener('click', () => this.editor.removeSelection());
        window.addEventListener('keydown', (event) => {
            if ((event.key === 'Delete' || event.key === 'Backspace') && !event.repeat && this.editor.selection.length) {
                if (event.target instanceof HTMLInputElement) return;
                event.preventDefault();
                this.editor.removeSelection();
            }
        });
    }

    async runOperation(operation) {
        const buttons = document.querySelectorAll('#toolbar button');
        for (const button of buttons) button.disabled = true;
        try {
            await operation();
        } catch (error) {
            this.setStatus(`Error: ${error.message}`);
            console.error(error);
        } finally {
            for (const button of buttons) button.disabled = false;
        }
    }

    updateSelectionPanel() {
        const count = this.editor?.selection.length || 0;
        this.selectionPanel.hidden = count === 0;
        this.selectionCount.textContent = `${count} object${count > 1 ? 's' : ''}`;
    }

    renderCategories() {
        this.categories.replaceChildren();
        for (const category of this.assets.categories.keys()) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = category;
            button.classList.toggle('active', category === this.activeCategory);
            button.addEventListener('click', () => this.openCategory(category));
            this.categories.append(button);
        }
        const first = this.assets.categories.keys().next().value;
        if (first) this.openCategory(first);
    }

    openCategory(category) {
        this.activeCategory = category;
        for (const button of this.categories.children) button.classList.toggle('active', button.textContent === category);
        this.variations.replaceChildren();
        for (const id of this.assets.categories.get(category) || []) {
            const tile = document.createElement('div');
            tile.className = 'asset-tile';
            tile.draggable = true;
            tile.dataset.assetId = id;
            const image = document.createElement('img');
            image.alt = id;
            image.src = this.thumbnail(id);
            const label = document.createElement('span');
            label.textContent = id;
            tile.append(image, label);
            tile.addEventListener('dragstart', (event) => {
                event.dataTransfer.setData('application/x-museum-asset', id);
                event.dataTransfer.effectAllowed = 'copy';
                this.editor.startPlacement(id);
            });
            tile.addEventListener('dragend', () => this.editor.stopPlacement());
            this.variations.append(tile);
        }
    }

    thumbnail(id) {
        if (this.thumbnails.has(id)) return this.thumbnails.get(id);
        if (!this.previewRenderer) {
            this.previewRenderer = new THREE.WebGLRenderer({
                antialias: true,
                alpha: true,
                preserveDrawingBuffer: true
            });
            this.previewRenderer.setPixelRatio(1);
            this.previewRenderer.setSize(160, 118);
            this.previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
            this.previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
        }
        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#edf2f6');
        scene.add(new THREE.AmbientLight(0xffffff, 1.8));
        const light = new THREE.DirectionalLight(0xffffff, 2.5);
        light.position.set(-6, 12, 9);
        scene.add(light);
        const root = this.assets.instantiate(id);
        scene.add(root);
        const bounds = new THREE.Box3().setFromObject(root);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
        const extent = Math.max(4.5, size.x, size.z, size.y * 1.4);
        const height = extent * 1.22;
        const camera = new THREE.OrthographicCamera(-height * 160 / 236, height * 160 / 236, height / 2, -height / 2, 0.1, 100);
        const direction = new THREE.Vector3(1, 2.85, 1).normalize();
        camera.position.copy(center).addScaledVector(direction, 30);
        camera.lookAt(center);
        this.previewRenderer.render(scene, camera);
        const data = this.previewRenderer.domElement.toDataURL('image/png');
        this.thumbnails.set(id, data);
        root.traverse((node) => {
            node.geometry?.dispose();
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            for (const material of materials) material?.dispose();
        });
        return data;
    }
}

new MuseumApp().start();
