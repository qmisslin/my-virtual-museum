
import * as THREE from 'three';

export class AtlasRenderer {
    static PADDING = 4;
    static AMBIENT_LEVEL = 0.6;
    static AO_STRENGTH = 0.55;

    constructor() {
        this.renderer = new THREE.WebGLRenderer({
            antialias: false,
            alpha: true
        });

        this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.camera = new THREE.Camera();
    }

    materialShader(material, mode) {
        const texture = (key) => material[key] || null;

        const transform = (key) => {
            const map = texture(key);
            if (map?.matrixAutoUpdate) map.updateMatrix();
            return map?.matrix?.clone() || new THREE.Matrix3();
        };

        return new THREE.RawShaderMaterial({
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false,
            transparent: false,
            uniforms: {
                uMode: { value: mode },
                uColor: {
                    value: material.color?.clone() || new THREE.Color(1, 1, 1)
                },
                uEmissive: {
                    value: material.emissive?.clone() || new THREE.Color(0, 0, 0)
                },
                uEmissionStrength: {
                    value: material.emissiveIntensity ?? 1
                },
                uOpacity: {
                    value: material.opacity ?? 1
                },
                uRoughness: {
                    value: material.roughness ?? 1
                },
                uMap: { value: texture('map') },
                uAlphaMap: { value: texture('alphaMap') },
                uRoughnessMap: { value: texture('roughnessMap') },
                uEmissiveMap: { value: texture('emissiveMap') },
                uHasMap: { value: Boolean(texture('map')) },
                uHasAlphaMap: { value: Boolean(texture('alphaMap')) },
                uHasRoughnessMap: { value: Boolean(texture('roughnessMap')) },
                uHasEmissiveMap: { value: Boolean(texture('emissiveMap')) },
                uMapTransform: { value: transform('map') },
                uAlphaTransform: { value: transform('alphaMap') },
                uRoughnessTransform: { value: transform('roughnessMap') },
                uEmissiveTransform: { value: transform('emissiveMap') }
            },
            vertexShader: `
        attribute vec2 uv;
        attribute vec2 uv1;
        varying vec2 vSourceUv;

        void main() {
          vSourceUv = uv;
          gl_Position = vec4(uv1 * 2.0 - 1.0, 0.0, 1.0);
        }
      `,
            fragmentShader: `
        precision highp float;

        varying vec2 vSourceUv;

        uniform int uMode;
        uniform vec3 uColor;
        uniform vec3 uEmissive;
        uniform float uEmissionStrength;
        uniform float uOpacity;
        uniform float uRoughness;

        uniform sampler2D uMap;
        uniform sampler2D uAlphaMap;
        uniform sampler2D uRoughnessMap;
        uniform sampler2D uEmissiveMap;

        uniform bool uHasMap;
        uniform bool uHasAlphaMap;
        uniform bool uHasRoughnessMap;
        uniform bool uHasEmissiveMap;

        uniform mat3 uMapTransform;
        uniform mat3 uAlphaTransform;
        uniform mat3 uRoughnessTransform;
        uniform mat3 uEmissiveTransform;

        void main() {
          vec4 base = vec4(uColor, uOpacity);

          if (uHasMap) {
            base *= texture2D(
              uMap,
              (uMapTransform * vec3(vSourceUv, 1.0)).xy
            );
          }

          if (uHasAlphaMap) {
            base.a *= texture2D(
              uAlphaMap,
              (uAlphaTransform * vec3(vSourceUv, 1.0)).xy
            ).g;
          }

          float roughness = uRoughness;

          if (uHasRoughnessMap) {
            roughness *= texture2D(
              uRoughnessMap,
              (uRoughnessTransform * vec3(vSourceUv, 1.0)).xy
            ).g;
          }

          vec3 emission = uEmissive * uEmissionStrength;

          if (uHasEmissiveMap) {
            emission *= texture2D(
              uEmissiveMap,
              (uEmissiveTransform * vec3(vSourceUv, 1.0)).xy
            ).rgb;
          }

          if (uMode == 0) {
            float intensity = max(
              max(emission.r, emission.g),
              emission.b
            );

            gl_FragColor = vec4(
              clamp(base.a, 0.0, 1.0),
              clamp(roughness, 0.0, 1.0),
              clamp(intensity, 0.0, 1.0),
              1.0
            );
          } else if (uMode == 1) {
            gl_FragColor = vec4(
              clamp(base.rgb, 0.0, 1.0),
              1.0
            );
          } else {
            gl_FragColor = vec4(
              clamp(emission, 0.0, 1.0),
              1.0
            );
          }
        }
      `
        });
    }

    rasterize(model, width, height, mode) {
        const stage = new THREE.Scene();
        const shaders = [];

        model.traverse((object) => {
            if (!object.isMesh) return;

            if (
                !object.geometry.getAttribute('uv') ||
                !object.geometry.getAttribute('uv1')
            ) {
                throw new Error(`Mesh ${object.name} is missing uv/uv1`);
            }

            const material = Array.isArray(object.material)
                ? object.material[0]
                : object.material;

            const shader = this.materialShader(material, mode);
            const mesh = new THREE.Mesh(object.geometry, shader);

            mesh.frustumCulled = false;
            stage.add(mesh);
            shaders.push(shader);
        });

        const target = new THREE.WebGLRenderTarget(width, height, {
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
            depthBuffer: false,
            stencilBuffer: false,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter
        });

        target.texture.colorSpace = THREE.NoColorSpace;

        const pixels = new Uint8Array(width * height * 4);

        try {
            this.renderer.setSize(width, height, false);
            this.renderer.setRenderTarget(target);
            this.renderer.setClearColor(0x000000, 0);
            this.renderer.clear(true, true, true);
            this.renderer.render(stage, this.camera);

            this.renderer.readRenderTargetPixels(
                target,
                0,
                0,
                width,
                height,
                pixels
            );
        } finally {
            this.renderer.setRenderTarget(null);
            target.dispose();

            for (const shader of shaders) shader.dispose();
        }

        // Direct readback aligns the atlas with glTF top-left UV coordinates.
        return pixels;
    }

    pad(pixels, width, height) {
        const count = width * height;
        const distance = new Int16Array(count).fill(-1);
        const source = new Int32Array(count);
        const queue = new Int32Array(count);

        let head = 0;
        let tail = 0;

        for (let i = 0; i < count; i++) {
            if (pixels[i * 4 + 3] > 0) {
                distance[i] = 0;
                source[i] = i;
                queue[tail++] = i;
            }
        }

        const output = pixels.slice();

        while (head < tail) {
            const current = queue[head++];
            const distanceFromIsland = distance[current];

            if (distanceFromIsland >= AtlasRenderer.PADDING) continue;

            const x = current % width;
            const y = Math.floor(current / width);
            const neighbors = [];

            if (x > 0) neighbors.push(current - 1);
            if (x + 1 < width) neighbors.push(current + 1);
            if (y > 0) neighbors.push(current - width);
            if (y + 1 < height) neighbors.push(current + width);

            for (const neighbor of neighbors) {
                if (distance[neighbor] !== -1) continue;

                distance[neighbor] = distanceFromIsland + 1;
                source[neighbor] = source[current];

                output.set(
                    pixels.subarray(
                        source[current] * 4,
                        source[current] * 4 + 4
                    ),
                    neighbor * 4
                );

                queue[tail++] = neighbor;
            }
        }

        return output;
    }

    composeDiffuse(albedo, emission, result) {
        const { width, height } = result;
        const output = new Uint8Array(albedo.length);

        for (let i = 0; i < width * height; i++) {
            const pixel = i * 4;

            if (!albedo[pixel + 3]) continue;

            const light = i * 3;
            const hasLightmapSample = Boolean(result.coverage[i]);

            const ao = hasLightmapSample
                ? THREE.MathUtils.clamp(result.ao[i], 0, 1)
                : 1;

            const ambient = AtlasRenderer.AMBIENT_LEVEL *
                (1 - AtlasRenderer.AO_STRENGTH * (1 - ao));

            for (let channel = 0; channel < 3; channel++) {
                const base = albedo[pixel + channel] / 255;
                const emitted = emission[pixel + channel] / 255;

                const irradiance = hasLightmapSample
                    ? Math.max(0, result.lightmap[light + channel])
                    : 0;

                // AO affects ambient illumination only.
                const linear = Math.max(
                    0,
                    base * (ambient + irradiance) + emitted
                );

                const toneMapped = linear / (1 + linear);

                const srgb = toneMapped <= 0.0031308
                    ? 12.92 * toneMapped
                    : 1.055 * Math.pow(toneMapped, 1 / 2.4) - 0.055;

                output[pixel + channel] = Math.round(
                    255 * THREE.MathUtils.clamp(srgb, 0, 1)
                );
            }

            output[pixel + 3] = 255;
        }

        return output;
    }

    async generate(model, result) {
        const { width, height } = result;

        const properties = this.rasterize(model, width, height, 0);
        const albedo = this.rasterize(model, width, height, 1);
        const emission = this.rasterize(model, width, height, 2);

        // Dilate the final shaded pixels, not the unlit albedo.
        const diffuse = this.pad(
            this.composeDiffuse(albedo, emission, result),
            width,
            height
        );

        const material = this.pad(properties, width, height);

        const [diffusePNG, materialPNG] = await Promise.all([
            this.encodePNG(width, height, diffuse, false),
            this.encodePNG(width, height, material, true)
        ]);

        return { diffusePNG, materialPNG };
    }

    crc32(bytes) {
        let crc = 0xffffffff;

        for (const value of bytes) {
            crc ^= value;

            for (let i = 0; i < 8; i++) {
                crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
            }
        }

        return (crc ^ 0xffffffff) >>> 0;
    }

    chunk(name, payload) {
        const bytes = new Uint8Array(payload.length + 12);
        const view = new DataView(bytes.buffer);

        view.setUint32(0, payload.length, false);

        for (let i = 0; i < 4; i++) {
            bytes[4 + i] = name.charCodeAt(i);
        }

        bytes.set(payload, 8);

        view.setUint32(
            bytes.length - 4,
            this.crc32(bytes.subarray(4, bytes.length - 4)),
            false
        );

        return bytes;
    }

    async encodePNG(width, height, pixels, linear) {
        const rows = new Uint8Array(height * (1 + width * 4));

        for (let y = 0; y < height; y++) {
            rows.set(
                pixels.subarray(y * width * 4, (y + 1) * width * 4),
                y * (width * 4 + 1) + 1
            );
        }

        const compressed = new Uint8Array(
            await new Response(
                new Blob([rows]).stream().pipeThrough(
                    new CompressionStream('deflate')
                )
            ).arrayBuffer()
        );

        const header = new Uint8Array(13);
        const view = new DataView(header.buffer);

        view.setUint32(0, width, false);
        view.setUint32(4, height, false);

        header[8] = 8;
        header[9] = 6;

        const signature = new Uint8Array([
            137, 80, 78, 71, 13, 10, 26, 10
        ]);

        const colorProfile = linear
            ? this.chunk(
                'gAMA',
                new Uint8Array([0x00, 0x01, 0x86, 0xa0])
            )
            : this.chunk(
                'sRGB',
                new Uint8Array([0])
            );

        return new Blob([
            signature,
            this.chunk('IHDR', header),
            colorProfile,
            this.chunk('IDAT', compressed),
            this.chunk('IEND', new Uint8Array())
        ], { type: 'image/png' });
    }

    dispose() {
        this.renderer.dispose();
    }
}
