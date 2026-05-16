import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { RGBELoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/RGBELoader.js";

const CUSTOM_REFLECTION_HDRI_URL = "assets/mirror_reflection.hdr";
const NAME_MATCHES = ["mirror", "καθρεφ"];
const CUSTOM_ENV_MAP_INTENSITY = 2.0;
const MIRROR_ROUGHNESS = 0.02;
const MIRROR_METALNESS = 1.0;

let customReflectionEnvMapPromise = null;
let customReflectionEnvMap = null;
let loggedMaterialNames = false;

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

    customReflectionEnvMapPromise = new Promise((resolve) => {
        let tempRenderer = null;
        let pmrem = null;

        try {
            tempRenderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "low-power" });
            tempRenderer.setSize(16, 16, false);
            pmrem = new THREE.PMREMGenerator(tempRenderer);
        } catch (error) {
            console.warn("Custom mirror reflection HDRI not applied. Could not create temporary PMREM renderer.", error);
            resolve(null);
            return;
        }

        new RGBELoader().load(
            CUSTOM_REFLECTION_HDRI_URL,
            (hdrTexture) => {
                hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
                customReflectionEnvMap = pmrem.fromEquirectangular(hdrTexture).texture;

                hdrTexture.dispose();
                pmrem.dispose();
                tempRenderer.dispose();
                tempRenderer.domElement?.remove?.();

                console.info("Custom mirror reflection HDRI loaded:", CUSTOM_REFLECTION_HDRI_URL);
                resolve(customReflectionEnvMap);
            },
            undefined,
            (error) => {
                console.warn(`Custom mirror reflection HDRI not applied. Could not load ${CUSTOM_REFLECTION_HDRI_URL}.`, error);
                pmrem?.dispose();
                tempRenderer?.dispose();
                tempRenderer?.domElement?.remove?.();
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
                const mirrorMaterial = makeMirrorMaterial(child, material, envMap);
                console.info("Applied custom mirror reflection to material:", mirrorMaterial.name || "unnamed material", "on mesh:", child.name || "unnamed mesh");
                return mirrorMaterial;
            });
        } else if (shouldOverrideMaterial(child, child.material)) {
            child.material = makeMirrorMaterial(child, child.material, envMap);
            console.info("Applied custom mirror reflection to material:", child.material.name || "unnamed material", "on mesh:", child.name || "unnamed mesh");
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
            requestAnimationFrame(() => applyCustomReflectionEnvMap(gltf.scene, envMap));
            setTimeout(() => applyCustomReflectionEnvMap(gltf.scene, envMap), 250);
            setTimeout(() => applyCustomReflectionEnvMap(gltf.scene, envMap), 1000);
        },
        onProgress,
        onError
    );
};

console.info("Custom mirror reflection bridge active.");
