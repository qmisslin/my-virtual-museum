
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { LightmapBaker, SceneCompiler } from 'three-gpu-baker';
import { generateAtlas, prepareCoreScene } from 'three-gpu-baker/core';
import { AtlasRenderer } from './render.js';

class MuseumAtlasCompiler extends SceneCompiler {
    compile(scene, options) {
        const atlas = generateAtlas(scene.triangles, options.width, options.height, {
            ...options,
            uvMode: 'preserve'
        });

        // Preserve existing UVs and enable conservative coverage for small charts.
        atlas.mode = 'generate';

        return prepareCoreScene(scene, options, atlas);
    }
}

export class MuseumIO {
    static ATLAS_SIZE = 512;
    static PADDING = 4;
    static SAMPLES_GPU = 512;
    static SAMPLES_CPU = 64;

    constructor(editor, assets, report) {
        this.editor = editor;
        this.assets = assets;
        this.report = report;
        this.atlasRenderer = new AtlasRenderer();
        this.atlasCache = null;
        this.bakeCache = null;
        this.pendingAtlas = null;
        this.pendingBake = null;
    }

    manifest() {
        return {
            format: 'my-virtual-museum',
            version: 1,
            instances: this.editor.instances.map((instance) => ({
                assetId: instance.userData.assetId,
                instanceId: instance.userData.instanceId,
                position: instance.position.toArray(),
                quaternion: instance.quaternion.toArray(),
                scale: instance.scale.toArray()
            }))
        };
    }

    async importGLB(file) {
        const bytes = await file.arrayBuffer();
        const gltf = await new GLTFLoader().parseAsync(bytes, '');
        let manifest = null;

        gltf.scene.traverse((node) => {
            if (node.userData?.museum?.format === 'my-virtual-museum') {
                manifest = node.userData.museum;
            }
        });

        let instances = manifest?.instances;

        if (!Array.isArray(instances)) {
            const collected = new Map();

            gltf.scene.traverse((node) => {
                const id = node.userData?.assetId || (this.assets.templates.has(node.name) ? node.name : null);
                if (!id || !this.assets.templates.has(id)) return;

                const key = node.userData?.instanceId || node.uuid;
                if (!collected.has(key)) {
                    collected.set(key, {
                        assetId: id,
                        instanceId: key,
                        position: node.position.toArray(),
                        quaternion: node.quaternion.toArray(),
                        scale: node.scale.toArray()
                    });
                }
            });

            instances = [...collected.values()];
        }

        const valid = instances.filter((entry) => this.assets.templates.has(entry.assetId));
        if (!valid.length) throw new Error('No known asset instances found in this GLB');

        this.editor.clear();

        for (const entry of valid) {
            const root = this.editor.add(
                entry.assetId,
                new THREE.Vector3().fromArray(entry.position || [0, 0, 0])
            );

            if (Array.isArray(entry.quaternion)) root.quaternion.fromArray(entry.quaternion);
            if (Array.isArray(entry.scale)) root.scale.fromArray(entry.scale);

            root.position.y = 0;
            root.userData.instanceId = entry.instanceId || root.userData.instanceId;
        }

        this.editor.setSelection([]);
        this.editor.changed();
        this.report(`${valid.length} assets imported`);
    }

    isTransparent(material) {
        return Boolean(material && (
            material.transparent ||
            (material.opacity ?? 1) < 0.9999 ||
            material.alphaMap ||
            (material.alphaTest ?? 0) > 0 ||
            (material.transmission ?? 0) > 0
        ));
    }

    prepareAtlasSource() {
        const source = new THREE.Group();
        const references = new Map();

        for (const instance of this.editor.instances) {
            instance.updateWorldMatrix(true, true);

            instance.traverse((original) => {
                if (!original.isMesh || original.userData.isLightPath) return;

                const materials = Array.isArray(original.material)
                    ? original.material
                    : [original.material];

                const placeholders = materials.map(() => new THREE.MeshStandardMaterial({
                    color: 0xffffff,
                    roughness: 1,
                    metalness: 0,
                    side: THREE.DoubleSide
                }));

                const mesh = new THREE.Mesh(
                    original.geometry,
                    Array.isArray(original.material) ? placeholders : placeholders[0]
                );

                mesh.name = `${instance.userData.assetId}/${original.name}`;
                mesh.matrixAutoUpdate = false;
                mesh.matrix.copy(original.matrixWorld);

                source.add(mesh);
                references.set(mesh.uuid, { instance, original });
            });
        }

        return { source, references };
    }

    sourceMaterial(reference, triangleIndex) {
        const { original } = reference;

        if (!Array.isArray(original.material)) return original.material;

        const offset = triangleIndex * 3;
        const group = original.geometry.groups.find(
            (item) => offset >= item.start && offset < item.start + item.count
        );

        return original.material[group?.materialIndex ?? 0];
    }


    createExportMaterial() {
        if (!this.sharedExportMaterial) {
            this.sharedExportMaterial = new THREE.MeshStandardMaterial({
                name: 'MuseumWhite',
                color: 0xffffff,
                emissive: 0x000000,
                roughness: 1,
                metalness: 0,
                opacity: 1,
                transparent: false,
                side: THREE.DoubleSide
            });
        }

        return this.sharedExportMaterial;
    }


    bakeMaterial(material) {
        return new THREE.MeshStandardMaterial({
            name: material.name,
            color: material.color?.clone() || new THREE.Color(0xffffff),
            emissive: material.emissive?.clone() || new THREE.Color(0x000000),
            emissiveIntensity: material.emissiveIntensity ?? 1,
            metalness: material.metalness ?? 0,
            roughness: material.roughness ?? 1,
            map: material.map || null,
            emissiveMap: material.emissiveMap || null,
            side: material.side === THREE.BackSide
                ? THREE.DoubleSide
                : (material.side ?? THREE.FrontSide)
        });
    }


    copySpots(target) {
        let count = 0;

        for (const instance of this.editor.instances) {
            instance.updateWorldMatrix(true, true);

            instance.traverse((node) => {
                if (!node.isSpotLight || !node.userData.isMuseumSpot) return;

                const light = new THREE.SpotLight(node.color, node.intensity);

                light.name = node.name;
                light.distance = node.distance;
                light.angle = node.angle;
                light.penumbra = node.penumbra;
                light.decay = node.decay;
                light.position.setFromMatrixPosition(node.matrixWorld);

                const aim = new THREE.Object3D();

                node.target.updateWorldMatrix(true, false);
                aim.position.setFromMatrixPosition(node.target.matrixWorld);

                light.target = aim;
                target.add(light, aim);

                count++;
            });
        }

        console.info(`[Museum] ${count} spotlights submitted to baker`);

        if (count === 0) {
            console.warn(
                '[Museum] No spotlights found. Check light-path materials and Blender GLB Loose Edges export.'
            );
        }

        return count;
    }


    disposeAtlas(cache) {
        if (!cache) return;

        for (const root of [cache.model, cache.output]) {
            root.traverse((node) => {
                if (!node.isMesh) return;

                node.geometry.dispose();

                const materials = Array.isArray(node.material)
                    ? node.material
                    : [node.material];

                for (const material of materials) material?.dispose();
            });
        }
    }

    async ensureAtlas() {
        const version = this.editor.revision;

        if (this.atlasCache?.version === version) return this.atlasCache;
        if (this.pendingAtlas) return this.pendingAtlas;

        this.pendingAtlas = this.buildAtlas(version);

        try {
            const cache = await this.pendingAtlas;

            if (version !== this.editor.revision) {
                this.disposeAtlas(cache);
                throw new Error('The scene changed during UV generation; retry export');
            }

            this.disposeAtlas(this.atlasCache);
            this.atlasCache = cache;
            this.bakeCache = null;

            return cache;
        } finally {
            this.pendingAtlas = null;
        }
    }

    async buildAtlas(version) {
        if (!this.editor.instances.length) throw new Error('The scene is empty');

        const { source, references } = this.prepareAtlasSource();
        if (!references.size) throw new Error('No exportable meshes found');

        const size = MuseumIO.ATLAS_SIZE;

        const baker = new LightmapBaker({
            backend: 'cpu',
            uvMode: 'generate',
            sourceUVChannel: 0,
            lightmapUVChannel: 1,
            width: size,
            height: size,
            padding: MuseumIO.PADDING,
            samples: 1,
            maxMemoryMB: 512
        });

        let model;

        try {
            this.report('Generating UV atlas...');
            await baker.prepare(source);
            model = await baker.createModel();
        } finally {
            await baker.dispose();

            source.traverse((node) => {
                if (!node.isMesh) return;

                const materials = Array.isArray(node.material)
                    ? node.material
                    : [node.material];

                for (const material of materials) material?.dispose();
            });
        }

        const output = new THREE.Group();
        output.name = 'My Virtual Museum';
        output.userData.museum = this.manifest();

        const groups = new Map();
        const entries = [];

        for (const instance of this.editor.instances) {
            const group = new THREE.Group();

            group.name = instance.userData.assetId;
            group.userData.assetId = instance.userData.assetId;
            group.userData.instanceId = instance.userData.instanceId;
            group.position.copy(instance.position);
            group.quaternion.copy(instance.quaternion);
            group.scale.copy(instance.scale);

            output.add(group);
            groups.set(instance, group);
        }

        for (const mesh of model.children) {
            if (!mesh.isMesh) continue;

            const mapping = mesh.userData.geometryMappings?.[0]?.source;
            const reference = references.get(mapping?.mesh);

            if (!reference) {
                throw new Error(`Missing source mapping for ${mesh.name}`);
            }

            const originalMaterial = this.sourceMaterial(reference, mapping.triangle);
            if (!originalMaterial) {
                throw new Error(`Missing material for ${mesh.name}`);
            }

            const previous = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const material of previous) material?.dispose();

            mesh.material = originalMaterial.clone();

            entries.push({
                mesh,
                instance: reference.instance,
                material: originalMaterial
            });

            // Keep the original atlas model in world space for lighting and rasterization.
            const geometry = mesh.geometry.clone();
            geometry.applyMatrix4(reference.instance.matrixWorld.clone().invert());

            // Export geometry and both UV channels, without any embedded texture.
            const exported = new THREE.Mesh(
                geometry,
                this.createExportMaterial(originalMaterial)
            );

            exported.name = mesh.name;
            exported.userData.assetId = reference.instance.userData.assetId;
            exported.userData.instanceId = reference.instance.userData.instanceId;

            groups.get(reference.instance).add(exported);
        }

        return { version, model, output, entries };
    }

    emptyBakeResult(size) {
        const count = size * size;

        return {
            width: size,
            height: size,
            lightmap: new Float32Array(count * 3),
            ao: new Float32Array(count).fill(1),
            coverage: new Uint8Array(count)
        };
    }

    async ensureTextures() {
        const atlas = await this.ensureAtlas();

        if (this.bakeCache?.version === atlas.version) return this.bakeCache;
        if (this.pendingBake) return this.pendingBake;

        this.pendingBake = this.buildTextures(atlas);

        try {
            const cache = await this.pendingBake;

            if (atlas.version !== this.editor.revision) {
                throw new Error('The scene changed during baking; retry export');
            }

            this.bakeCache = cache;
            return cache;
        } finally {
            this.pendingBake = null;
        }
    }

    async buildTextures(atlas) {
        const lighting = new THREE.Group();
        let opaqueCount = 0;

        for (const { mesh, material } of atlas.entries) {
            if (this.isTransparent(material)) continue;

            const litMesh = new THREE.Mesh(
                mesh.geometry,
                this.bakeMaterial(material)
            );

            litMesh.frustumCulled = false;
            lighting.add(litMesh);
            opaqueCount++;
        }

        lighting.add(new THREE.AmbientLight(0xffffff, 0.45));
        this.copySpots(lighting);

        const size = MuseumIO.ATLAS_SIZE;
        let result = this.emptyBakeResult(size);

        try {
            if (opaqueCount) {
                const gpu = Boolean(navigator.gpu);

                const baker = new LightmapBaker({
                    backend: gpu ? 'tsl' : 'cpu',
                    uvMode: 'preserve',
                    sourceUVChannel: 0,
                    lightmapUVChannel: 1,
                    width: size,
                    height: size,
                    samples: gpu ? MuseumIO.SAMPLES_GPU : MuseumIO.SAMPLES_CPU,
                    bounces: 2,
                    padding: MuseumIO.PADDING,
                    maxMemoryMB: 512
                }, new MuseumAtlasCompiler());

                try {
                    this.report('Preparing lightmap...');

                    await baker.prepare(lighting);

                    await baker.bake({
                        onProgress: (progress) => {
                            this.report(`Baking ${Math.round(progress.fraction * 100)}%`);
                        }
                    });


                    const { denoiseSpatial } = await import('three-gpu-baker');

                    this.report('Denoising lightmap...');

                    result = await baker.getResult({
                        denoise: {
                            type: 'museum-atrous',

                            async run(raw) {
                                const indirect = await denoiseSpatial(raw, {
                                    type: 'atrous',
                                    channels: ['indirect', 'ao'],
                                    iterations: 4,
                                    normalPower: 32,
                                    positionSigma: 0.25,
                                    colorSigma: 1
                                });

                                const directInput = {
                                    ...raw,
                                    direct: new Float32Array(raw.direct.length),
                                    indirect: raw.direct.slice()
                                };

                                const direct = await denoiseSpatial(directInput, {
                                    type: 'atrous',
                                    channels: ['indirect'],
                                    iterations: 3,
                                    normalPower: 48,
                                    positionSigma: 0.15,
                                    colorSigma: 0.65
                                });

                                const filteredDirect = direct.indirect;
                                const lightmap = new Float32Array(raw.lightmap.length);

                                for (let i = 0; i < lightmap.length; i++) {
                                    lightmap[i] = filteredDirect[i] + indirect.indirect[i];
                                }

                                return {
                                    ...indirect,
                                    direct: filteredDirect,
                                    lightmap,
                                    metadata: {
                                        ...indirect.metadata,
                                        denoiser: {
                                            type: 'museum-atrous',
                                            channels: ['direct', 'indirect', 'ao'],
                                            directIterations: 3,
                                            indirectIterations: 4
                                        }
                                    }
                                };
                            }
                        },
                        padding: true
                    });

                } finally {
                    await baker.dispose();
                }
            }
        } finally {
            lighting.traverse((node) => {
                if (node.isMesh) node.material.dispose();
            });
        }

        this.report('Rasterizing diffuse and material atlases...');

        const images = await this.atlasRenderer.generate(atlas.model, result);

        return {
            version: atlas.version,
            images
        };
    }

    async exportGLB() {
        const { output } = await this.ensureAtlas();

        this.report('Encoding GLB...');

        const buffer = await new GLTFExporter().parseAsync(output, {
            binary: true,
            onlyVisible: true,
            trs: true,
            includeCustomExtensions: false
        });

        this.download(
            new Blob([buffer], { type: 'model/gltf-binary' }),
            'museum.glb'
        );

        this.report('GLB exported');
    }

    async exportPNG() {
        const { images } = await this.ensureTextures();

        this.download(images.diffusePNG, 'museum-diffuse.png');
        this.download(images.materialPNG, 'museum-material.png');

        this.report('PNG atlases exported');
    }

    download(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = filename;

        document.body.append(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(url), 30000);
    }

    dispose() {
        this.disposeAtlas(this.atlasCache);
        this.atlasCache = null;
        this.bakeCache = null;
        this.atlasRenderer.dispose();
    }
}
