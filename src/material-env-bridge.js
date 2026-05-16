import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { RGBELoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/RGBELoader.js";

const CUSTOM_REFLECTION_HDRI_URL = "assets/mirror_reflection.hdr";
const MIRROR_MATERIAL_NAMES = ["mirror", "καθρεφ"];
const CUSTOM_ENV_MAP_INTENSITY = 2.0;

let activeRenderer = null;
let pendingRoots = new Set();
let customReflectionEnvMapPromise = null;
let customReflectionEnvMap = null;
let loggedMaterialNames = false;
let applyScheduled = false;

function materialNameMatches(material) {
    const name = String(material?.name || "").toLowerCase();
    return MIRROR_MATERIAL_NAMES.some((term) => name.includes(term));
}

function loadCustomReflectionEnvMap() {
    if (customReflectionEnvMap) return Promise.resolve(customReflectionEnvMap);
    if (customReflectionEnvMapPromise) return customReflectionEnvMapPromise;
    if (!activeRenderer) return Promise.resolve(null);

    customReflectionEnvMapPromise = new Promise((resolve) => {
        const pmrem = new THREE.PMREMGenerator(activeRenderer);

        new RGBELoader().load(
            CUSTOM_REFLECTION_HDRI_URL,
            (hdrTexture) => {
                hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
                customReflectionEnvMap = pmrem.fromEquirectangular(hdrTexture).texture;

                hdrTexture.dispose();
                pmrem.dispose();

                console.info("Custom Mirror material reflection HDRI loaded:", CUSTOM_REFLECTION_HDRI_URL);
                resolve(customReflectionEnvMap);
            },
            undefined,
            (error) => {
                console.warn(`Custom Mirror material reflection HDRI not applied. Could not load ${CUSTOM_REFLECTION_HDRI_URL}.`, error);
                pmrem.dispose();
                customReflectionEnvMapPromise = null;
                resolve(null);
            }
        );
    });

    return customReflectionEnvMapPromise;
}

function logMaterialNamesOnce(root) {
    if (loggedMaterialNames || !root) return;
    loggedMaterialNames = true;

    const names = new Set();
    root.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) names.add(material?.name || "unnamed");
    });

    console.info("GLB material names:", Array.from(names).sort());
}

function applyMirrorEnvMap(root, envMap) {
    if (!root || !envMap) return;

    logMaterialNamesOnce(root);

    root.traverse((child) => {
        if (!child.isMesh || !child.material) return;

        const applyToMaterial = (material) => {
            if (!materialNameMatches(material)) return material;

            material.envMap = envMap;
            material.envMapIntensity = CUSTOM_ENV_MAP_INTENSITY;
            material.needsUpdate = true;

            console.info("Applied custom reflection only to Mirror material:", material.name || "unnamed material", "on mesh:", child.name || "unnamed mesh");
            return material;
        };

        if (Array.isArray(child.material)) child.material = child.material.map(applyToMaterial);
        else child.material = applyToMaterial(child.material);
    });
}

function scheduleApply() {
    if (applyScheduled || !activeRenderer || pendingRoots.size === 0) return;
    applyScheduled = true;

    loadCustomReflectionEnvMap().then((envMap) => {
        applyScheduled = false;
        if (!envMap) return;

        for (const root of pendingRoots) applyMirrorEnvMap(root, envMap);
    });
}

const originalLoad = GLTFLoader.prototype.load;
GLTFLoader.prototype.load = function patchedMaterialEnvLoad(url, onLoad, onProgress, onError) {
    return originalLoad.call(
        this,
        url,
        (gltf) => {
            pendingRoots.add(gltf.scene);
            scheduleApply();
            onLoad?.(gltf);
            requestAnimationFrame(scheduleApply);
            setTimeout(scheduleApply, 250);
            setTimeout(scheduleApply, 1000);
        },
        onProgress,
        onError
    );
};

const originalRender = THREE.WebGLRenderer.prototype.render;
THREE.WebGLRenderer.prototype.render = function patchedRender(scene, camera) {
    activeRenderer = this;
    scheduleApply();
    return originalRender.call(this, scene, camera);
};

console.info("Custom Mirror-only reflection bridge active.");
