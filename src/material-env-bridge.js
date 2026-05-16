import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { RGBELoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/RGBELoader.js";

const CUSTOM_REFLECTION_HDRI_URL = "assets/mirror_reflection.hdr";
const NAME_MATCHES = ["mirror", "καθρεφ"];
const CUSTOM_ENV_MAP_INTENSITY = 2.0;
const MIRROR_ROUGHNESS = 0.02;
const MIRROR_METALNESS = 1.0;

let activeRenderer = null;
let customReflectionEnvMapPromise = null;
let customReflectionEnvMap = null;
let loggedMaterialNames = false;
let isLoadingEnvMap = false;

const processedMaterials = new WeakSet();

function nameMatches(value) {
    const name = String(value || "").toLowerCase();
    return NAME_MATCHES.some((term) => name.includes(term));
}

function shouldOverrideMaterial(child, material) {
    return nameMatches(material?.name) || nameMatches(child?.name);
}

function loadCustomReflectionEnvMap() {
    if (customReflectionEnvMap) return Promise.resolve(customReflectionEnvMap);
    if (customReflectionEnvMapPromise) return customReflectionEnvMapPromise;
    if (!activeRenderer) return Promise.resolve(null);

    isLoadingEnvMap = true;

    customReflectionEnvMapPromise = new Promise((resolve) => {
        const pmrem = new THREE.PMREMGenerator(activeRenderer);

        new RGBELoader().load(
            CUSTOM_REFLECTION_HDRI_URL,
            (hdrTexture) => {
                hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
                customReflectionEnvMap = pmrem.fromEquirectangular(hdrTexture).texture;

                hdrTexture.dispose();
                pmrem.dispose();
                isLoadingEnvMap = false;

                console.info("Custom mirror reflection HDRI loaded:", CUSTOM_REFLECTION_HDRI_URL);
                resolve(customReflectionEnvMap);
            },
            undefined,
            (error) => {
                console.warn(`Custom mirror reflection HDRI not applied. Could not load ${CUSTOM_REFLECTION_HDRI_URL}.`, error);
                pmrem.dispose();
                isLoadingEnvMap = false;
                customReflectionEnvMapPromise = null;
                resolve(null);
            }
        );
    });

    return customReflectionEnvMapPromise;
}

function makeMirrorMaterial(child, sourceMaterial, envMap) {
    const isPbr = sourceMaterial?.isMeshStandardMaterial || sourceMaterial?.isMeshPhysicalMaterial;

    const material = isPbr
        ? sourceMaterial
        : new THREE.MeshStandardMaterial({
            name: sourceMaterial?.name || child?.name || "Mirror",
            color: sourceMaterial?.color ? sourceMaterial.color.clone() : new THREE.Color(0xffffff),
            map: sourceMaterial?.map || null,
            normalMap: sourceMaterial?.normalMap || null,
            roughnessMap: sourceMaterial?.roughnessMap || null,
            metalnessMap: sourceMaterial?.metalnessMap || null,
            alphaMap: sourceMaterial?.alphaMap || null,
            transparent: Boolean(sourceMaterial?.transparent || (sourceMaterial?.opacity ?? 1) < 1),
            opacity: sourceMaterial?.opacity ?? 1,
            side: sourceMaterial?.side ?? THREE.FrontSide,
            depthWrite: sourceMaterial?.depthWrite ?? true,
            depthTest: sourceMaterial?.depthTest ?? true
        });

    material.envMap = envMap;
    material.envMapIntensity = CUSTOM_ENV_MAP_INTENSITY;
    material.metalness = MIRROR_METALNESS;
    material.roughness = MIRROR_ROUGHNESS;
    material.needsUpdate = true;

    processedMaterials.add(material);
    return material;
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

function applyCustomReflectionEnvMap(root, envMap) {
    if (!root || !envMap) return;

    logMaterialNamesOnce(root);

    root.traverse((child) => {
        if (!child.isMesh || !child.material) return;

        if (Array.isArray(child.material)) {
            child.material = child.material.map((material) => {
                if (!shouldOverrideMaterial(child, material)) return material;
                if (processedMaterials.has(material)) return material;

                const mirrorMaterial = makeMirrorMaterial(child, material, envMap);
                console.info("Applied custom mirror reflection to material:", mirrorMaterial.name || "unnamed material", "on mesh:", child.name || "unnamed mesh");
                return mirrorMaterial;
            });
        } else if (shouldOverrideMaterial(child, child.material) && !processedMaterials.has(child.material)) {
            child.material = makeMirrorMaterial(child, child.material, envMap);
            console.info("Applied custom mirror reflection to material:", child.material.name || "unnamed material", "on mesh:", child.name || "unnamed mesh");
        }
    });
}

function requestReflectionApply(sceneRoot) {
    if (!sceneRoot || isLoadingEnvMap) return;

    loadCustomReflectionEnvMap().then((envMap) => {
        if (!envMap) return;
        applyCustomReflectionEnvMap(sceneRoot, envMap);
    });
}

const originalRender = THREE.WebGLRenderer.prototype.render;
THREE.WebGLRenderer.prototype.render = function patchedRender(scene, camera) {
    activeRenderer = this;
    requestReflectionApply(scene);
    return originalRender.call(this, scene, camera);
};

console.info("Custom mirror reflection bridge active. Waiting for renderer...");
