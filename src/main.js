import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "https://unpkg.com/three@0.160.0/examples/jsm/libs/meshopt_decoder.module.js";
import { RGBELoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/RGBELoader.js";
import { VRButton } from "https://unpkg.com/three@0.160.0/examples/jsm/webxr/VRButton.js";
import { XRControllerModelFactory } from "https://unpkg.com/three@0.160.0/examples/jsm/webxr/XRControllerModelFactory.js";

let scene, camera, renderer, model, yawObject, pitchObject;
let collisionMesh = null;
let navMeshes = [];
let rightController = null;
let rightTeleportRay = null;
let teleportMarker = null;
let pendingTeleportHit = null;
let teleportReleaseReady = false;

const clock = new THREE.Clock();
const move = { forward: false, backward: false, left: false, right: false };
const controllerModels = [];

let canMove = false;
let isMobile = false;
let pitch = 0;
let playerBaseY = 0;
let verticalVelocity = 0;
let isGrounded = false;
let rightTurnReady = true;

const playerHeight = 1.5;
const playerRadius = 0.35;
const speed = 2;
const vrSpeed = 2;
const stepHeight = 0.2;
const gravity = 9.8;
const maxFallSpeed = 18;
const groundSnapDownDistance = 0.28;
const rightTurnAngle = THREE.MathUtils.degToRad(30);
const rightTurnThreshold = 0.75;
const rightTurnResetThreshold = 0.25;
const rightTeleportThreshold = 0.75;
const rightTeleportResetThreshold = 0.25;
const teleportRayDistance = 25;
const teleportMarkerYOffset = 0.025;
const SPAWN = new THREE.Vector3(0, 1.8, 0);

const ui = {
    loadingScreen: document.getElementById("loadingScreen"),
    loadingStatus: document.getElementById("loadingStatus"),
    loadingProgress: document.getElementById("loadingProgress"),
    loadingPercent: document.getElementById("loadingPercent"),
    loadingError: document.getElementById("loadingError"),
    reloadButton: document.getElementById("reloadButton"),
    startScreen: document.getElementById("startScreen")
};

setStartScreenEnabled(false);
setLoadingProgress(0, "Starting renderer...");
init().catch((error) => showFatalError("Experience failed to start.", error));

function detectMobile() {
    return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(navigator.userAgent) ||
        (window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 900);
}

function setStartScreenEnabled(enabled) {
    if (!ui.startScreen) return;
    ui.startScreen.classList.toggle("is-hidden", !enabled);
    ui.startScreen.style.pointerEvents = enabled ? "auto" : "none";
}

function setLoadingProgress(value, status = "Loading...") {
    const percent = Math.max(0, Math.min(100, Math.round(value)));
    ui.loadingScreen?.classList.remove("is-hidden");
    if (ui.loadingStatus) ui.loadingStatus.textContent = status;
    if (ui.loadingProgress) ui.loadingProgress.style.width = `${percent}%`;
    if (ui.loadingPercent) ui.loadingPercent.textContent = `${percent}%`;
}

function hideLoadingScreen() {
    ui.loadingScreen?.classList.add("is-hidden");
}

function showFatalError(title, error) {
    console.error(title, error);
    setStartScreenEnabled(false);
    ui.loadingScreen?.classList.remove("is-hidden");
    if (ui.loadingStatus) ui.loadingStatus.textContent = title;
    if (ui.loadingProgress) ui.loadingProgress.style.width = "100%";
    if (ui.loadingPercent) ui.loadingPercent.textContent = "Failed";
    if (ui.loadingError) {
        ui.loadingError.style.display = "block";
        ui.loadingError.textContent = error?.message || String(error || "Unknown error.");
    }
    if (ui.reloadButton) {
        ui.reloadButton.style.display = "inline-block";
        ui.reloadButton.onclick = () => window.location.reload();
    }
}

function loadHDRI(pmrem) {
    return new Promise((resolve) => {
        setLoadingProgress(10, "Loading environment...");
        new RGBELoader().setPath("assets/").load(
            "fouriesburg_mountain_midday_2k.hdr",
            (hdrTexture) => {
                hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
                hdrTexture.center.set(0.5, 0.5);
                hdrTexture.rotation = Math.PI / 2;
                scene.background = hdrTexture;
                scene.environment = pmrem.fromEquirectangular(hdrTexture).texture;
                pmrem.dispose();
                setLoadingProgress(25, "Environment ready...");
                resolve(true);
            },
            undefined,
            (error) => {
                console.warn("HDRI failed to load. Continuing with fallback lighting.", error);
                scene.background = new THREE.Color(0x050505);
                scene.environment = null;
                scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 1.2));
                pmrem.dispose();
                setLoadingProgress(25, "Environment fallback active...");
                resolve(false);
            }
        );
    });
}

async function loadSceneModel() {
    setLoadingProgress(30, "Preparing model decoder...");
    await MeshoptDecoder.ready;

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    return new Promise((resolve, reject) => {
        loader.load(
            "assets/scene.glb",
            (gltf) => {
                model = gltf.scene;
                collisionMesh = null;
                navMeshes = [];
                processModel(model);
                scene.add(model);
                setLoadingProgress(100, "Scene ready.");
                resolve(model);
            },
            (event) => {
                if (!event.lengthComputable || !event.total) return setLoadingProgress(55, "Loading scene...");
                setLoadingProgress(30 + (event.loaded / event.total) * 70, "Loading scene...");
            },
            (error) => reject(new Error(`Could not load assets/scene.glb. ${error?.message || "Check the file path and hosting."}`))
        );
    });
}

function addVRButton() {
    if (document.getElementById("VRButton")) return;
    document.body.appendChild(VRButton.createButton(renderer));
}

function getCollisionTarget() {
    return collisionMesh || model;
}

function makeMeshDoubleSided(mesh) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
        if (!material) continue;
        material.side = THREE.DoubleSide;
        material.needsUpdate = true;
    }
}

function processModel(root) {
    const glassNames = ["M_Glass_Darker", "glass", "win_glass"];

    function replaceMaterial(mat) {
        if (!mat || !mat.name) return mat;
        if (glassNames.some((name) => mat.name.includes(name))) {
            return new THREE.MeshPhysicalMaterial({
                color: 0xffffff,
                transmission: 1,
                transparent: true,
                opacity: 0.15,
                roughness: 0.2,
                metalness: 0,
                thickness: 0,
                ior: 1.45,
                depthWrite: false,
                side: THREE.DoubleSide
            });
        }
        if (mat.name.includes("Black")) return new THREE.MeshBasicMaterial({ color: 0x000000 });
        return mat;
    }

    root.traverse((child) => {
        if (!child.isMesh) return;
        const meshName = child.name.toLowerCase();

        if (meshName.includes("collision")) {
            collisionMesh = child;
            child.visible = false;
            child.userData.ignoreCollision = false;
            console.info("Using GLB mesh containing 'collision' as the continuous-movement collision target:", child.name);
            return;
        }

        if (meshName.includes("navmesh")) {
            navMeshes.push(child);
            child.visible = false;
            child.userData.ignoreCollision = true;
            makeMeshDoubleSided(child);
            console.info("Using GLB mesh containing 'navmesh' as a VR teleport target:", child.name);
            return;
        }

        if (child.name === "Cube") {
            child.visible = false;
            child.userData.ignoreCollision = true;
            return;
        }

        child.material = Array.isArray(child.material)
            ? child.material.map(replaceMaterial)
            : replaceMaterial(child.material);
    });

    if (!collisionMesh) console.info("No GLB mesh containing 'collision' found. Falling back to full-scene continuous-movement collision.");
    if (navMeshes.length === 0) console.info("No GLB mesh containing 'navmesh' found. VR teleport will stay disabled.");
    else console.info(`VR teleport navmesh targets found: ${navMeshes.length}`);
}

function createTeleportRay() {
    const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1)
    ]);
    const material = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.85 });
    const ray = new THREE.Line(geometry, material);
    ray.name = "right-teleport-ray";
    ray.visible = false;
    ray.scale.z = teleportRayDistance;
    return ray;
}

function createTeleportMarker() {
    const geometry = new THREE.RingGeometry(0.22, 0.32, 48);
    const material = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const marker = new THREE.Mesh(geometry, material);
    marker.name = "teleport-marker";
    marker.rotation.x = -Math.PI / 2;
    marker.visible = false;
    return marker;
}

function getControllerMaterialSource(child, material, index = 0) {
    if (!child.userData.controllerOriginalMaterials) child.userData.controllerOriginalMaterials = [];
    if (!child.userData.controllerOriginalMaterials[index]) {
        child.userData.controllerOriginalMaterials[index] = material;
    }
    return child.userData.controllerOriginalMaterials[index];
}

function getControllerUnlitMaterial(child, material, index = 0) {
    if (!child.userData.controllerUnlitMaterials) child.userData.controllerUnlitMaterials = [];

    const source = getControllerMaterialSource(child, material, index);
    const hasVertexColors = Boolean(child.geometry?.attributes?.color);
    const map = source?.map || material?.map || null;
    const alphaMap = source?.alphaMap || material?.alphaMap || null;

    if (map) {
        map.colorSpace = THREE.SRGBColorSpace;
        map.needsUpdate = true;
    }

    let unlit = child.userData.controllerUnlitMaterials[index];
    if (!unlit) {
        unlit = new THREE.MeshBasicMaterial({
            name: source?.name || material?.name || "controller-unlit",
            toneMapped: false
        });
        child.userData.controllerUnlitMaterials[index] = unlit;
    }

    unlit.map = map;
    unlit.alphaMap = alphaMap;
    unlit.vertexColors = hasVertexColors;
    unlit.transparent = Boolean(source?.transparent || material?.transparent || alphaMap || (source?.opacity ?? material?.opacity ?? 1) < 1);
    unlit.opacity = source?.opacity ?? material?.opacity ?? 1;
    unlit.side = source?.side ?? material?.side ?? THREE.FrontSide;
    unlit.depthTest = source?.depthTest ?? material?.depthTest ?? true;
    unlit.depthWrite = source?.depthWrite ?? material?.depthWrite ?? true;
    unlit.toneMapped = false;

    if (map || hasVertexColors) {
        unlit.color.set(0xffffff);
    } else if (source?.color) {
        unlit.color.copy(source.color);
    } else if (material?.color) {
        unlit.color.copy(material.color);
    } else {
        unlit.color.set(0xffffff);
    }

    unlit.needsUpdate = true;
    return unlit;
}

function updateControllerModelMaterials() {
    for (const controllerModel of controllerModels) {
        controllerModel.traverse((child) => {
            if (!child.isMesh || !child.material) return;

            if (Array.isArray(child.material)) {
                child.material = child.material.map((material, index) => getControllerUnlitMaterial(child, material, index));
            } else {
                child.material = getControllerUnlitMaterial(child, child.material, 0);
            }
        });
    }
}

function addVRControllers() {
    const controllerModelFactory = new XRControllerModelFactory();

    for (let i = 0; i < 2; i++) {
        const controller = renderer.xr.getController(i);
        const grip = renderer.xr.getControllerGrip(i);

        controller.addEventListener("connected", (event) => {
            if (event.data?.handedness !== "right") return;
            rightController = controller;
            if (!rightTeleportRay) {
                rightTeleportRay = createTeleportRay();
                controller.add(rightTeleportRay);
            }
        });

        controller.addEventListener("disconnected", () => {
            if (rightTeleportRay && rightTeleportRay.parent === controller) {
                controller.remove(rightTeleportRay);
                rightTeleportRay = null;
            }
            if (rightController === controller) rightController = null;
        });

        const controllerModel = controllerModelFactory.createControllerModel(grip);
        controllerModels.push(controllerModel);
        grip.add(controllerModel);

        yawObject.add(controller);
        yawObject.add(grip);
    }
}

async function init() {
    isMobile = detectMobile();

    const container = document.getElementById("container") || document.body;
    const controlsText = document.getElementById("controlsText");
    if (controlsText) {
        controlsText.innerText = isMobile
            ? "Left side = Move • Right side = Look"
            : "WASD to move • Mouse to look • ESC to unlock";
    }

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 800);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    window.addEventListener("resize", () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    yawObject = new THREE.Object3D();
    pitchObject = new THREE.Object3D();
    yawObject.position.copy(SPAWN);
    yawObject.add(pitchObject);
    pitchObject.add(camera);
    scene.add(yawObject);

    addVRControllers();
    teleportMarker = createTeleportMarker();
    scene.add(teleportMarker);

    playerBaseY = SPAWN.y - playerHeight;
    verticalVelocity = 0;
    isGrounded = false;

    await loadHDRI(new THREE.PMREMGenerator(renderer));
    await loadSceneModel();
    setupInputControls();
    renderer.setAnimationLoop(animate);

    setTimeout(() => {
        hideLoadingScreen();
        setStartScreenEnabled(true);
        addVRButton();
    }, 250);
}

function setupInputControls() {
    if (!isMobile) {
        ui.startScreen?.addEventListener("click", () => document.body.requestPointerLock());

        document.addEventListener("pointerlockchange", () => {
            if (renderer.xr.isPresenting) return;
            const locked = document.pointerLockElement === document.body;
            if (ui.startScreen) ui.startScreen.style.display = locked ? "none" : "flex";
            canMove = locked;
        });

        document.addEventListener("mousemove", (e) => {
            if (renderer.xr.isPresenting || document.pointerLockElement !== document.body) return;
            yawObject.rotation.y -= e.movementX * 0.002;
            pitch -= e.movementY * 0.002;
            pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
            pitchObject.rotation.x = pitch;
        });
    } else {
        ui.startScreen?.addEventListener("click", async () => {
            ui.startScreen.style.display = "none";
            canMove = true;
            if (document.documentElement.requestFullscreen) {
                try { await document.documentElement.requestFullscreen(); }
                catch (error) { console.warn("Fullscreen request failed. Continuing without fullscreen.", error); }
            }
            setupMobileControls();
        });
    }

    renderer.xr.addEventListener("sessionstart", () => {
        canMove = true;
        rightTurnReady = true;
        teleportReleaseReady = false;
        pendingTeleportHit = null;
        verticalVelocity = 0;
        isGrounded = false;
        hideTeleportVisuals();
        if (ui.startScreen) ui.startScreen.style.display = "none";
        document.exitPointerLock?.();
        yawObject.rotation.set(0, 0, 0);
        pitchObject.rotation.set(0, 0, 0);
        pitch = 0;
    });

    renderer.xr.addEventListener("sessionend", () => window.location.reload());

    document.addEventListener("keydown", (e) => {
        if (e.code === "KeyW") move.forward = true;
        if (e.code === "KeyS") move.backward = true;
        if (e.code === "KeyA") move.left = true;
        if (e.code === "KeyD") move.right = true;
    });

    document.addEventListener("keyup", (e) => {
        if (e.code === "KeyW") move.forward = false;
        if (e.code === "KeyS") move.backward = false;
        if (e.code === "KeyA") move.left = false;
        if (e.code === "KeyD") move.right = false;
    });
}

function setupMobileControls() {
    if (document.querySelector(".joystick")) return;

    const joystick = document.createElement("div");
    joystick.className = "joystick";
    document.body.appendChild(joystick);

    const stick = document.createElement("div");
    stick.className = "stick";
    joystick.appendChild(stick);

    let joystickTouchId = null;
    let lookTouchId = null;
    let centerX = 0;
    let centerY = 0;
    let lastLookX = 0;
    let lastLookY = 0;

    document.addEventListener("touchstart", (e) => {
        for (const touch of e.changedTouches) {
            if (touch.clientX < window.innerWidth / 2 && joystickTouchId === null) {
                joystickTouchId = touch.identifier;
                const rect = joystick.getBoundingClientRect();
                centerX = rect.left + rect.width / 2;
                centerY = rect.top + rect.height / 2;
            } else if (touch.clientX >= window.innerWidth / 2 && lookTouchId === null) {
                lookTouchId = touch.identifier;
                lastLookX = touch.clientX;
                lastLookY = touch.clientY;
            }
        }
    }, { passive: false });

    document.addEventListener("touchmove", (e) => {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            if (touch.identifier === joystickTouchId) {
                const dx = touch.clientX - centerX;
                const dy = touch.clientY - centerY;
                const dist = Math.min(Math.sqrt(dx * dx + dy * dy), 40);
                const angle = Math.atan2(dy, dx);
                stick.style.transform = `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px)`;
                move.forward = dy < -10;
                move.backward = dy > 10;
                move.left = dx < -10;
                move.right = dx > 10;
            }

            if (touch.identifier === lookTouchId) {
                const deltaX = touch.clientX - lastLookX;
                const deltaY = touch.clientY - lastLookY;
                lastLookX = touch.clientX;
                lastLookY = touch.clientY;
                yawObject.rotation.y -= deltaX * 0.01;
                pitch -= deltaY * 0.01;
                pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
                pitchObject.rotation.x = pitch;
            }
        }
    }, { passive: false });

    document.addEventListener("touchend", (e) => {
        for (const touch of e.changedTouches) {
            if (touch.identifier === joystickTouchId) {
                joystickTouchId = null;
                stick.style.transform = "translate(0,0)";
                move.forward = false;
                move.backward = false;
                move.left = false;
                move.right = false;
            }
            if (touch.identifier === lookTouchId) lookTouchId = null;
        }
    });
}

function getDesktopMovementVector(delta) {
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    const movement = new THREE.Vector3();
    if (move.forward) movement.add(forward);
    if (move.backward) movement.addScaledVector(forward, -1);
    if (move.left) movement.addScaledVector(right, -1);
    if (move.right) movement.add(right);

    if (movement.length() > 0) movement.normalize().multiplyScalar(speed * delta);
    return movement;
}

function getRightInputSource() {
    const session = renderer.xr.getSession();
    if (!session) return null;
    for (const source of session.inputSources) {
        if (source.handedness === "right") return source;
    }
    return null;
}

function getRightStickAxes() {
    const source = getRightInputSource();
    const gamepad = source?.gamepad;
    if (!gamepad || !gamepad.axes || gamepad.axes.length < 2) return { x: 0, y: 0 };
    return gamepad.axes.length >= 4
        ? { x: gamepad.axes[2], y: gamepad.axes[3] }
        : { x: gamepad.axes[0], y: gamepad.axes[1] };
}

function rotateRigAroundHead(angle) {
    const xrCamera = renderer.xr.getCamera(camera);
    const headBefore = new THREE.Vector3();
    const headAfter = new THREE.Vector3();

    xrCamera.getWorldPosition(headBefore);
    yawObject.rotation.y += angle;
    yawObject.updateMatrixWorld(true);
    xrCamera.getWorldPosition(headAfter);
    yawObject.position.add(headBefore.sub(headAfter));
}

function handleRightStickTurn(turnX) {
    if (Math.abs(turnX) < rightTurnResetThreshold) {
        rightTurnReady = true;
        return;
    }
    if (!rightTurnReady || Math.abs(turnX) < rightTurnThreshold) return;
    rotateRigAroundHead(turnX > 0 ? -rightTurnAngle : rightTurnAngle);
    rightTurnReady = false;
}

function getRightControllerRay() {
    if (!rightController) return null;
    rightController.updateMatrixWorld(true);

    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3(0, 0, -1);
    const quaternion = new THREE.Quaternion();

    rightController.getWorldPosition(origin);
    rightController.getWorldQuaternion(quaternion);
    direction.applyQuaternion(quaternion).normalize();

    return { origin, direction };
}

function getNavmeshHitFromRightController() {
    if (navMeshes.length === 0) return null;
    const controllerRay = getRightControllerRay();
    if (!controllerRay) return null;

    for (const mesh of navMeshes) mesh.updateMatrixWorld(true);

    const raycaster = new THREE.Raycaster(controllerRay.origin, controllerRay.direction, 0, teleportRayDistance);
    const hits = raycaster.intersectObjects(navMeshes, true);
    return hits.length > 0 ? hits[0] : null;
}

function hideTeleportVisuals() {
    if (rightTeleportRay) rightTeleportRay.visible = false;
    if (teleportMarker) teleportMarker.visible = false;
}

function updateTeleportMarker(hit) {
    if (!teleportMarker) return;
    teleportMarker.visible = false;
    if (!hit) return;
    teleportMarker.visible = true;
    teleportMarker.position.set(hit.point.x, hit.point.y + teleportMarkerYOffset, hit.point.z);
    teleportMarker.rotation.set(-Math.PI / 2, 0, 0);
}

function updateTeleportAim(stickY) {
    hideTeleportVisuals();

    if (!rightTeleportRay || !renderer.xr.isPresenting) {
        pendingTeleportHit = null;
        return;
    }

    if (Math.abs(stickY) < rightTeleportResetThreshold) {
        pendingTeleportHit = null;
        return;
    }

    rightTeleportRay.visible = true;

    const hit = getNavmeshHitFromRightController();
    pendingTeleportHit = hit;
    rightTeleportRay.scale.z = hit ? hit.distance : teleportRayDistance;
    updateTeleportMarker(hit);

    if (Math.abs(stickY) >= rightTeleportThreshold && hit) {
        teleportReleaseReady = true;
    }
}

function teleportToNavmeshHit(hit) {
    playerBaseY = hit.point.y;
    verticalVelocity = 0;
    isGrounded = true;
    yawObject.position.set(hit.point.x, playerBaseY, hit.point.z);
}

function handleRightStickTeleport(stickY) {
    const isNeutral = Math.abs(stickY) < rightTeleportResetThreshold;

    if (!isNeutral) {
        updateTeleportAim(stickY);
        return;
    }

    if (teleportReleaseReady && pendingTeleportHit) {
        teleportToNavmeshHit(pendingTeleportHit);
    }

    teleportReleaseReady = false;
    pendingTeleportHit = null;
    hideTeleportVisuals();
}

function handleVRRightStickActions() {
    const axes = getRightStickAxes();
    handleRightStickTurn(axes.x);
    handleRightStickTeleport(axes.y);
}

function getXRViewerForward(frame) {
    if (!frame) return null;

    const referenceSpace = renderer.xr.getReferenceSpace();
    if (!referenceSpace) return null;

    const viewerPose = frame.getViewerPose(referenceSpace);
    if (!viewerPose) return null;

    const orientation = viewerPose.transform.orientation;
    const hmdQuaternion = new THREE.Quaternion(
        orientation.x,
        orientation.y,
        orientation.z,
        orientation.w
    );

    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(hmdQuaternion);
    forward.applyQuaternion(yawObject.quaternion);
    forward.y = 0;

    return forward.lengthSq() > 0.0001 ? forward.normalize() : null;
}

function getVRHeadMovementBasis(frame) {
    let forward = getXRViewerForward(frame);

    if (!forward) {
        const xrCamera = renderer.xr.getCamera(camera);
        xrCamera.updateMatrixWorld(true);

        const headCamera = xrCamera.cameras?.[0] || xrCamera;
        headCamera.updateMatrixWorld(true);

        forward = new THREE.Vector3();
        headCamera.getWorldDirection(forward);
        forward.y = 0;

        if (forward.lengthSq() < 0.0001) {
            forward.set(0, 0, -1).applyQuaternion(yawObject.quaternion);
            forward.y = 0;
        }

        forward.normalize();
    }

    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    return { forward, right };
}

function getVRMovementVector(delta, frame) {
    const session = renderer.xr.getSession();
    if (!session) return new THREE.Vector3();

    const movement = new THREE.Vector3();
    const { forward, right } = getVRHeadMovementBasis(frame);

    for (const source of session.inputSources) {
        if (source.handedness === "right") continue;
        const gamepad = source.gamepad;
        if (!gamepad || !gamepad.axes || gamepad.axes.length < 2) continue;

        let x = gamepad.axes.length >= 4 ? gamepad.axes[2] : gamepad.axes[0];
        let y = gamepad.axes.length >= 4 ? gamepad.axes[3] : gamepad.axes[1];

        const deadzone = 0.15;
        if (Math.abs(x) < deadzone) x = 0;
        if (Math.abs(y) < deadzone) y = 0;
        if (x === 0 && y === 0) continue;

        movement.addScaledVector(forward, -y);
        movement.addScaledVector(right, x);
    }

    if (movement.length() > 0) movement.normalize().multiplyScalar(vrSpeed * delta);
    return movement;
}

function getGroundHit(maxDistance) {
    const collisionTarget = getCollisionTarget();
    if (!collisionTarget) return null;

    const raycaster = new THREE.Raycaster(
        new THREE.Vector3(yawObject.position.x, playerBaseY + stepHeight, yawObject.position.z),
        new THREE.Vector3(0, -1, 0),
        0,
        maxDistance
    );

    const hits = raycaster
        .intersectObject(collisionTarget, true)
        .filter((hit) => !hit.object.userData.ignoreCollision);

    return hits.length > 0 ? hits[0] : null;
}

function updateVerticalPosition(delta) {
    const nearbyGroundHit = getGroundHit(stepHeight + groundSnapDownDistance);

    if (nearbyGroundHit && verticalVelocity <= 0) {
        const groundY = nearbyGroundHit.point.y;
        const groundDelta = groundY - playerBaseY;

        if (groundDelta <= stepHeight && groundDelta >= -groundSnapDownDistance) {
            playerBaseY = groundY;
            verticalVelocity = 0;
            isGrounded = true;
            return;
        }
    }

    isGrounded = false;
    verticalVelocity = Math.max(verticalVelocity - gravity * delta, -maxFallSpeed);
    playerBaseY += verticalVelocity * delta;

    const landingHit = getGroundHit(stepHeight + Math.abs(verticalVelocity * delta) + groundSnapDownDistance);
    if (landingHit && verticalVelocity <= 0) {
        const groundY = landingHit.point.y;
        const groundDelta = groundY - playerBaseY;

        if (groundDelta <= stepHeight && groundDelta >= -groundSnapDownDistance) {
            playerBaseY = groundY;
            verticalVelocity = 0;
            isGrounded = true;
        }
    }
}

function applyMovement(movement, delta) {
    const collisionTarget = getCollisionTarget();
    if (!collisionTarget) return;

    const proposed = yawObject.position.clone().add(movement);

    if (movement.length() > 0) {
        const midHeight = playerBaseY + playerHeight * 0.5;
        const ray = new THREE.Raycaster(
            new THREE.Vector3(yawObject.position.x, midHeight, yawObject.position.z),
            movement.clone().normalize(),
            0,
            playerRadius
        );

        const hits = ray
            .intersectObject(collisionTarget, true)
            .filter((hit) => !hit.object.userData.ignoreCollision);

        if (hits.length === 0) yawObject.position.copy(proposed);
    }

    updateVerticalPosition(delta);

    yawObject.position.y = renderer.xr.isPresenting
        ? playerBaseY
        : playerBaseY + playerHeight;
}

function animate(time, frame) {
    const delta = clock.getDelta();

    updateControllerModelMaterials();

    if (canMove && model) {
        if (renderer.xr.isPresenting) handleVRRightStickActions();
        else hideTeleportVisuals();

        const movement = renderer.xr.isPresenting
            ? getVRMovementVector(delta, frame)
            : getDesktopMovementVector(delta);

        applyMovement(movement, delta);
    }

    renderer.render(scene, camera);
}
