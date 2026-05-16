import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const MIRROR_MESH_NAME = "BathroomMirror1Mesh";
const MIRROR_ENV_INTENSITY = 0.9;
const MIRROR_ROUGHNESS = 0.5;
const MIRROR_METALNESS = 1.0;
const MIRROR_CLEARCOAT = 0.5;
const MIRROR_CLEARCOAT_ROUGHNESS = 0.08;

const tunedMaterials = new WeakSet();

function tuneMirrorMaterial(material) {
    if (!material || tunedMaterials.has(material)) return;

    if ("envMapIntensity" in material) material.envMapIntensity = MIRROR_ENV_INTENSITY;
    if ("roughness" in material) material.roughness = MIRROR_ROUGHNESS;
    if ("metalness" in material) material.metalness = MIRROR_METALNESS;
    if ("clearcoat" in material) material.clearcoat = MIRROR_CLEARCOAT;
    if ("clearcoatRoughness" in material) material.clearcoatRoughness = MIRROR_CLEARCOAT_ROUGHNESS;

    material.needsUpdate = true;
    tunedMaterials.add(material);

    console.info("Tuned bathroom mirror material:", material.name || "unnamed material");
}

function tuneMirrorInObject(root) {
    if (!root?.traverse) return;

    root.traverse((child) => {
        if (!child.isMesh || child.name !== MIRROR_MESH_NAME || !child.material) return;

        if (Array.isArray(child.material)) child.material.forEach(tuneMirrorMaterial);
        else tuneMirrorMaterial(child.material);
    });
}

const originalAdd = THREE.Object3D.prototype.add;
THREE.Object3D.prototype.add = function patchedAdd(...objects) {
    const result = originalAdd.apply(this, objects);
    for (const object of objects) tuneMirrorInObject(object);
    return result;
};

console.info("Bathroom mirror material tuning bridge active.");
