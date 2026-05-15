import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

const DEFAULT_SCENE_URL = "assets/scene.glb";
const VISUAL_MODEL_URL = "assets/visual.glb";
const COLLISION_MODEL_URL = "assets/collision.glb";

const originalLoad = GLTFLoader.prototype.load;

GLTFLoader.prototype.load = function splitModelLoad(url, onLoad, onProgress, onError) {
    if (url !== DEFAULT_SCENE_URL) {
        return originalLoad.call(this, url, onLoad, onProgress, onError);
    }

    return originalLoad.call(
        this,
        VISUAL_MODEL_URL,
        (visualGltf) => {
            originalLoad.call(
                this,
                COLLISION_MODEL_URL,
                (collisionGltf) => {
                    visualGltf.scene.add(collisionGltf.scene);
                    console.info("Loaded split GLB scene:", VISUAL_MODEL_URL, "+", COLLISION_MODEL_URL);
                    onLoad?.(visualGltf);
                },
                undefined,
                (error) => {
                    const wrappedError = new Error(`Could not load ${COLLISION_MODEL_URL}. ${error?.message || "Check the file path and hosting."}`);
                    onError?.(wrappedError);
                }
            );
        },
        onProgress,
        (error) => {
            const wrappedError = new Error(`Could not load ${VISUAL_MODEL_URL}. ${error?.message || "Check the file path and hosting."}`);
            onError?.(wrappedError);
        }
    );
};
