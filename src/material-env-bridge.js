import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { RGBELoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/RGBELoader.js";

const CUSTOM_REFLECTION_HDRI_URL = "assets/mirror_reflection.hdr";
const MATERIAL_NAME_MATCHES = ["mirror", "καθρεφ"];
const CUSTOM_ENV_MAP_INTENSITY = 1.5;

let activeRenderer = null;
let customReflectionEnvMapPromise = null;

const originalSetSize = THREE.WebGLRenderer.prototype.setSize;
THREE.WebGLRenderer.prototype.setSize = function patchedSetSize(...args) {
    activeRenderer = this;
    return originalSetSize.apply(this, args);
};

function materialNameMatches(material) {
    const name = String(material?.name || "").toLowerCase();
    return MATERIAL_NAME_MATCHES.some((term) => name.includes(term));
}

function loadCustomReflectionEnvMap() {
    if (customReflectionEnvMapPromise) return customReflectionEnvMapPromise;

    customReflectionEnvMapPromise = new Promise((resolve) => {
        if (!activeRenderer) {
            console.warn("Custom reflection HDRI skipped: renderer not ready yet.");
            resolve(null);
            return;
        }

        const pmrem = new THREE.PMREMGenerator(activeRenderer);

        new RGBELoader().load(
            CUSTOM_REFLECTION_HDRI_URL,
            (hdrTexture) => {
                hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
                const envMap = pmrem.fromEquirectangular(hdrTexture).texture;

                hdrTexture.dispose();
                pmrem.dispose();

                console.info("Custom material reflection HDRI loaded:", CUSTOM_REFLECTION_HDRI_URL);
                resolve(envMap);
            },
            undefined,
            (error) => {
                console.warn(`Custom reflection HDRI not applied. Could not load ${CUSTOM_REFLECTION_HDRI_URL}.`, error);
                pmrem.dispose();
                resolve(null);
            }
        );
    });

    return customReflectionEnvMapPromise;
}

function applyCustomReflectionEnvMap(root, envMap) {
    if (!root || !envMap) return;

    root.traverse((child) => {
        if (!child.isMesh || !child.material) return;

        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
            if (!materialNameMatches(material)) continue;

            material.envMap = envMap;
            material.envMapIntensity = CUSTOM_ENV_MAP_INTENSITY;
            material.needsUpdate = true;

            console.info("Applied custom reflection HDRI to material:", material.name || "unnamed material");
        }
    });
}

const originalLoad = GLTFLoader.prototype.load;
GLTFLoader.prototype.load = function patchedMaterialEnvLoad(url, onLoad, onProgress, onError) {
    return originalLoad.call(
        this,
        url,
        async (gltf) => {
            const envMap = await loadCustomReflectionEnvMap();
            applyCustomReflectionEnvMap(gltf.scene, envMap);
            onLoad?.(gltf);
        },
        onProgress,
        onError
    );
};
