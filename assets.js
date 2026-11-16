
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class Assets {
    static URL = './all.glb';
    static NAME_PATTERN = /^(.*?)\.(\d+)(?:_\d+)?$/;
    static LIGHT_COLOR = 0xffd36b;
    static SPOT_INTENSITY = 35;
    static SPOT_DISTANCE = 12;

    constructor() {
        this.loader = new GLTFLoader();
        this.templates = new Map();
        this.categories = new Map();
    }


    async load() {
        const gltf = await this.loader.loadAsync(Assets.URL);
        const found = [];
        const { json, associations } = gltf.parser;

        const getOriginalName = (node) => {
            const nodeIndex = associations.get(node)?.nodes;
            return nodeIndex !== undefined
                ? (json.nodes[nodeIndex]?.name ?? node.name)
                : node.name;
        };

        gltf.scene.traverse((node) => {
            const match = Assets.NAME_PATTERN.exec(getOriginalName(node));
            if (!match) return;

            let parent = node.parent;
            while (parent && parent !== gltf.scene) {
                if (Assets.NAME_PATTERN.test(getOriginalName(parent))) return;
                parent = parent.parent;
            }

            found.push({
                node,
                category: match[1],
                variation: Number(match[2])
            });
        });

        for (const { node, category, variation } of found) {
            const id = `${category}.${String(variation).padStart(3, '0')}`;

            if (this.templates.has(id)) {
                throw new Error(`Duplicate asset: ${id}`);
            }

            this.templates.set(id, node);

            if (!this.categories.has(category)) {
                this.categories.set(category, []);
            }

            this.categories.get(category).push(id);
        }

        for (const ids of this.categories.values()) {
            ids.sort((a, b) =>
                Number(a.split('.').at(-1)) - Number(b.split('.').at(-1))
            );
        }

        if (!this.templates.size) {
            throw new Error('No NAME.000 assets found in all.glb');
        }
    }


    instantiate(id) {
        const source = this.templates.get(id);
        if (!source) throw new Error(`Unknown asset: ${id}`);
        const root = source.clone(true);
        root.name = id;
        root.position.set(0, 0, 0);
        root.rotation.set(0, 0, 0);
        root.scale.copy(source.scale);
        root.userData = { assetId: id, instanceId: THREE.MathUtils.generateUUID() };
        root.traverse((node) => {
            if (!node.isMesh && !node.isLine && !node.isLineSegments) return;
            if (node.geometry) node.geometry = node.geometry.clone();
            const originals = Array.isArray(node.material) ? node.material : [node.material];
            const materials = originals.map((material) => {
                if (!material) return material;
                const copy = material.clone();
                if (copy.name.toLowerCase() === 'light' && copy.isMeshStandardMaterial) {
                    copy.emissive.setHex(Assets.LIGHT_COLOR);
                    copy.emissiveIntensity = Math.max(copy.emissiveIntensity, 3);
                }
                return copy;
            });
            node.material = Array.isArray(node.material) ? materials : materials[0];
            const isLightPathMaterial = materials.some((material) =>
                /^light-path(?:\.\d+)?$/i.test(material?.name?.trim() || '')
            );

            const isLightPathGeometry = node.isLineSegments ||
                (node.isLine && !node.isLineLoop);

            if (isLightPathMaterial || isLightPathGeometry) {
                node.visible = false;
                node.userData.isLightPath = true;
            }
        });
        this.attachSpots(root);
        return root;
    }


    attachSpots(root) {
        root.updateMatrixWorld(true);

        const inverse = root.matrixWorld.clone().invert();
        const segments = [];
        let pathObjects = 0;

        root.traverse((node) => {
            if (!node.userData.isLightPath) return;

            pathObjects++;

            const position = node.geometry?.getAttribute('position');
            if (!position) {
                console.warn(`[Museum] Missing light-path geometry: ${node.name}`);
                return;
            }

            const index = node.geometry.index;
            const count = index ? index.count : position.count;

            const vertex = (i) => {
                const vertexIndex = index ? index.getX(i) : i;

                return new THREE.Vector3()
                    .fromBufferAttribute(position, vertexIndex)
                    .applyMatrix4(node.matrixWorld)
                    .applyMatrix4(inverse);
            };

            const addSegment = (a, b) => {
                let start = vertex(a);
                let end = vertex(b);

                if (start.y < end.y) {
                    [start, end] = [end, start];
                }

                if (start.distanceToSquared(end) < 1e-8) return;

                segments.push([start, end]);
            };

            if (node.isLineSegments) {
                for (let i = 0; i + 1 < count; i += 2) {
                    addSegment(i, i + 1);
                }
            } else if (node.isLine && !node.isLineLoop) {
                for (let i = 0; i + 1 < count; i++) {
                    addSegment(i, i + 1);
                }
            } else {
                console.warn(
                    `[Museum] light-path must use line geometry: ${node.name}`,
                    node
                );
            }
        });

        for (const [start, end] of segments) {
            const spot = new THREE.SpotLight(
                Assets.LIGHT_COLOR,
                Assets.SPOT_INTENSITY
            );

            spot.name = 'MuseumSpot';
            spot.distance = Assets.SPOT_DISTANCE;
            spot.decay = 2;
            spot.angle = Math.PI / 5;
            spot.penumbra = 0.45;
            spot.position.copy(start);
            spot.userData.isMuseumSpot = true;

            const target = new THREE.Object3D();
            target.name = 'MuseumSpotTarget';
            target.position.copy(end);

            spot.target = target;

            root.add(target, spot);
        }

        root.userData.spotCount = segments.length;

        console.info(
            `[Museum] ${root.name}: ${pathObjects} light-path objects, ${segments.length} spots`
        );

        if (pathObjects > 0 && segments.length === 0) {
            console.warn(
                `[Museum] No valid light segments found in ${root.name}. Check GLB line primitives.`
            );
        }

        return segments.length;
    }

}
