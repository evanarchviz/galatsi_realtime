import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { RGBELoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/RGBELoader.js";

const CUSTOM_REFLECTION_HDRI_URL = "assets/mirror_reflection.hdr";
const TARGET_MIRROR_MESH_NAMES = ["BathroomMirror1Mesh"];
const CUSTOM_ENV_MAP_INTENSITY = 2.0;
const MIRROR_ROUGHNESS = 0.02;
const MIRROR_METALNESS = 1.0;

let activeRenderer = null;
let pendingRoots = new Set();
let customReflectionEnvMapPromise = null;
let customReflectionEnvMap = null;
let loggedMeshNames = false;
let applyScheduled = false;

const processedMeshes = new WeakSet();

function isTargetMirrorMesh(child) {
    return TARGET_MIRROR_MESH_NAMES.includes(child?.name || "");
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

                console.info("Custom bathroom mirror reflection HDRI loaded:", CUSTOM_REFLECTION_HDRI_URL);
                resolve(customReflectionEnvMap);
            },
            undefined,
            (error) => {
                console.warn(`Custom bathroom mirror reflection HDRI not applied. Could not load ${CUSTOM_REFLECTION_HDRI_URL}.`, error);
                pmrem.dispose();
                customReflectionEnvMapPromise = null;
                resolve(null);
            }
        );
    });

    return customReflectionEnvMapPromise;
}

function logMeshNamesOnce(root) {
    if (loggedMeshNames || !root) return;
    loggedMeshNames = true;

    const names = new Set();
    root.traverse((child) => {
        if (child.isMesh) names.add(child.name || "unnamed");
    });

    console.info("GLB mesh names:", Array.from(names).sort());
}

function cloneAndOverrideMaterial(material, envMap) {
    const mirrorMaterial = material?.clone ? material.clone() : new THREE.MeshStandardMaterial();

    mirrorMaterial.name = `${material?.name || "Mirror"}_BathroomMirrorCustomReflection`;
    mirrorMaterial.envMap = envMap;
    mirrorMaterial.envMapIntensity = CUSTOM_ENV_MAP_INTENSITY;

    if ("metalness" in mirrorMaterial) mirrorMaterial.metalness = MIRROR_METALNESS;
    if ("roughness" in mirrorMaterial) mirrorMaterial.roughness = MIRROR_ROUGHNESS;

    mirrorMaterial.needsUpdate = true;
    return mirrorMaterial;
}

function applyMirrorEnvMap(root, envMap) {
    if (!root || !envMap) return;

    logMeshNamesOnce(root);

    root.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        if (!isTargetMirrorMesh(child)) return;
        if (processedMeshes.has(child)) return;

        if (Array.isArray(child.material)) {
            child.material = child.material.map((material) => cloneAndOverrideMaterial(material, envMap));
        } else {
            child.material = cloneAndOverrideMaterial(child.material, envMap);
        }

        processedMeshes.add(child);
        console.info("Applied custom reflection to target mirror mesh:", child.name);
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

console.info("Custom bathroom mirror mesh reflection bridge active.");
