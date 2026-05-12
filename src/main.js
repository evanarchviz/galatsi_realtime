import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "https://unpkg.com/three@0.160.0/examples/jsm/libs/meshopt_decoder.module.js";
import { RGBELoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/RGBELoader.js";
import { VRButton } from "https://unpkg.com/three@0.160.0/examples/jsm/webxr/VRButton.js";

let scene, camera, renderer;
let model;
let clock = new THREE.Clock();

let move = {
    forward:false,
    backward:false,
    left:false,
    right:false
};

let canMove = false;
let isMobile = false;

let yawObject;
let pitchObject;
let pitch = 0;

const playerHeight = 1.7;
const playerRadius = 0.35;
const speed = 2;
const vrSpeed = 2;
const stepHeight = 0.2;

let playerBaseY = 0;

const SPAWN = new THREE.Vector3(
    0,
    1.5,
    0
);

init();

function detectMobile() {

    const uaMobile =
        /Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i
            .test(navigator.userAgent);

    const coarsePointer =
        window.matchMedia("(pointer: coarse)").matches;

    const smallScreen =
        window.innerWidth < 900;

    return uaMobile || (coarsePointer && smallScreen);
}

async function init(){

    isMobile = detectMobile();

    const container =
        document.getElementById("container") ||
        document.body;

    const startScreen =
        document.getElementById("startScreen");

    const controlsText =
        document.getElementById("controlsText");

    if (controlsText) {

        controlsText.innerText = isMobile
            ? "Left side = Move • Right side = Look"
            : "WASD to move • Mouse to look • ESC to unlock";
    }

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        800
    );

    renderer = new THREE.WebGLRenderer({
        antialias:true
    });

    renderer.outputColorSpace =
        THREE.SRGBColorSpace;

    renderer.setPixelRatio(
        Math.min(window.devicePixelRatio, 2)
    );

    renderer.setSize(
        window.innerWidth,
        window.innerHeight
    );

    renderer.xr.enabled = true;

    container.appendChild(renderer.domElement);

    document.body.appendChild(
        VRButton.createButton(renderer)
    );

    window.addEventListener("resize", () => {

        camera.aspect =
            window.innerWidth / window.innerHeight;

        camera.updateProjectionMatrix();

        renderer.setSize(
            window.innerWidth,
            window.innerHeight
        );
    });

    yawObject = new THREE.Object3D();
    pitchObject = new THREE.Object3D();

    yawObject.position.copy(SPAWN);

    yawObject.add(pitchObject);

    pitchObject.add(camera);

    scene.add(yawObject);

    playerBaseY = SPAWN.y - playerHeight;

    const pmrem =
        new THREE.PMREMGenerator(renderer);

    new RGBELoader()
        .setPath("assets/")
        .load(
            "fouriesburg_mountain_midday_2k.hdr",

            (hdrTexture) => {

                hdrTexture.mapping =
                    THREE.EquirectangularReflectionMapping;

                hdrTexture.center.set(0.5, 0.5);

                hdrTexture.rotation =
                    Math.PI / 2;

                scene.background =
                    hdrTexture;

                scene.environment =
                    pmrem
                        .fromEquirectangular(hdrTexture)
                        .texture;

                pmrem.dispose();
            }
        );

    await MeshoptDecoder.ready;

    const loader = new GLTFLoader();

    loader.setMeshoptDecoder(MeshoptDecoder);

    loader.load(
        "assets/scene.glb",

        (gltf) => {

            model = gltf.scene;

            model.traverse((child) => {

                if (!child.isMesh) return;

                // Hide helper cube
                if (child.name === "Cube") {

                    child.visible = false;

                    child.userData.ignoreCollision = true;

                    return;
                }

                const glassNames = [
                    "M_Glass_Darker",
                    "glass",
                    "win_glass"
                ];

                function replaceMaterial(mat) {

                    if (!mat || !mat.name)
                        return mat;

                    console.log(
                        "Material found:",
                        mat.name
                    );

                    // Glass materials
                    if (
                        glassNames.some(name =>
                            mat.name.includes(name)
                        )
                    ) {

                        return new THREE.MeshPhysicalMaterial({

                            color: 0xffffff,

                            transmission: 1,

                            transparent: true,

                            opacity: 0.08,

                            roughness: 0,

                            metalness: 0,

                            thickness: 0,

                            ior: 1.45,

                            depthWrite: false,

                            side: THREE.DoubleSide

                        });
                    }

                    // Black material
                    if (
                        mat.name.includes("Black")
                    ) {

                        return new THREE.MeshBasicMaterial({

                            color: 0x000000

                        });
                    }

                    return mat;
                }

                if (
                    Array.isArray(child.material)
                ) {

                    child.material =
                        child.material.map(
                            replaceMaterial
                        );

                } else {

                    child.material =
                        replaceMaterial(
                            child.material
                        );
                }

            });

            scene.add(model);
        }
    );

    if (!isMobile) {

        startScreen?.addEventListener(
            "click",
            () => {

                document.body.requestPointerLock();
            }
        );

        document.addEventListener(
            "pointerlockchange",
            () => {

                if (renderer.xr.isPresenting)
                    return;

                if (
                    document.pointerLockElement ===
                    document.body
                ) {

                    if (startScreen)
                        startScreen.style.display = "none";

                    canMove = true;

                } else {

                    if (startScreen)
                        startScreen.style.display = "flex";

                    canMove = false;
                }
            }
        );

        document.addEventListener(
            "mousemove",
            (e) => {

                if (renderer.xr.isPresenting)
                    return;

                if (
                    document.pointerLockElement !==
                    document.body
                ) return;

                yawObject.rotation.y -=
                    e.movementX * 0.002;

                pitch -=
                    e.movementY * 0.002;

                pitch = Math.max(
                    -Math.PI / 2,
                    Math.min(Math.PI / 2, pitch)
                );

                pitchObject.rotation.x =
                    pitch;
            }
        );

    } else {

        startScreen?.addEventListener(
            "click",

            async () => {

                startScreen.style.display =
                    "none";

                canMove = true;

                if (
                    document.documentElement
                        .requestFullscreen
                ) {

                    try {

                        await document
                            .documentElement
                            .requestFullscreen();

                    } catch(e){}
                }

                setupMobileControls();
            }
        );
    }

    renderer.xr.addEventListener(
        "sessionstart",
        () => {

            canMove = true;

            if (startScreen)
                startScreen.style.display =
                    "none";

            document.exitPointerLock?.();

            yawObject.rotation.set(0,0,0);

            pitchObject.rotation.set(0,0,0);

            pitch = 0;
        }
    );

    renderer.xr.addEventListener(
        "sessionend",
        () => {

            canMove = false;

            if (startScreen) {

                startScreen.style.display =
                    "flex";

                if (controlsText) {

                    controlsText.innerText =
                        isMobile
                            ? "Left side = Move • Right side = Look"
                            : "WASD to move • Mouse to look • ESC to unlock";
                }
            }
        }
    );

    document.addEventListener(
        "keydown",
        (e) => {

            if (e.code === "KeyW")
                move.forward = true;

            if (e.code === "KeyS")
                move.backward = true;

            if (e.code === "KeyA")
                move.left = true;

            if (e.code === "KeyD")
                move.right = true;
        }
    );

    document.addEventListener(
        "keyup",
        (e) => {

            if (e.code === "KeyW")
                move.forward = false;

            if (e.code === "KeyS")
                move.backward = false;

            if (e.code === "KeyA")
                move.left = false;

            if (e.code === "KeyD")
                move.right = false;
        }
    );

    renderer.setAnimationLoop(animate);
}

function setupMobileControls() {

    if (document.querySelector(".joystick"))
        return;

    const joystick =
        document.createElement("div");

    joystick.className = "joystick";

    document.body.appendChild(joystick);

    const stick =
        document.createElement("div");

    stick.className = "stick";

    joystick.appendChild(stick);

    let joystickTouchId = null;
    let lookTouchId = null;

    let centerX = 0;
    let centerY = 0;

    let lastLookX = 0;
    let lastLookY = 0;

    document.addEventListener(
        "touchstart",
        (e) => {

            for (let touch of e.changedTouches) {

                if (
                    touch.clientX <
                        window.innerWidth / 2 &&
                    joystickTouchId === null
                ) {

                    joystickTouchId =
                        touch.identifier;

                    const rect =
                        joystick.getBoundingClientRect();

                    centerX =
                        rect.left + rect.width / 2;

                    centerY =
                        rect.top + rect.height / 2;
                }

                else if (
                    touch.clientX >=
                        window.innerWidth / 2 &&
                    lookTouchId === null
                ) {

                    lookTouchId =
                        touch.identifier;

                    lastLookX =
                        touch.clientX;

                    lastLookY =
                        touch.clientY;
                }
            }
        },
        { passive:false }
    );

    document.addEventListener(
        "touchmove",
        (e) => {

            e.preventDefault();

            for (let touch of e.changedTouches) {

                if (
                    touch.identifier ===
                    joystickTouchId
                ) {

                    const dx =
                        touch.clientX - centerX;

                    const dy =
                        touch.clientY - centerY;

                    const dist = Math.min(
                        Math.sqrt(dx*dx + dy*dy),
                        40
                    );

                    const angle =
                        Math.atan2(dy, dx);

                    stick.style.transform =
                        `translate(${Math.cos(angle)*dist}px, ${Math.sin(angle)*dist}px)`;

                    move.forward = dy < -10;
                    move.backward = dy > 10;
                    move.left = dx < -10;
                    move.right = dx > 10;
                }

                if (
                    touch.identifier ===
                    lookTouchId
                ) {

                    const deltaX =
                        touch.clientX - lastLookX;

                    const deltaY =
                        touch.clientY - lastLookY;

                    lastLookX =
                        touch.clientX;

                    lastLookY =
                        touch.clientY;

                    yawObject.rotation.y -=
                        deltaX * 0.01;

                    pitch -=
                        deltaY * 0.01;

                    pitch = Math.max(
                        -Math.PI / 2,
                        Math.min(Math.PI / 2, pitch)
                    );

                    pitchObject.rotation.x =
                        pitch;
                }
            }
        },
        { passive:false }
    );

    document.addEventListener(
        "touchend",
        (e) => {

            for (let touch of e.changedTouches) {

                if (
                    touch.identifier ===
                    joystickTouchId
                ) {

                    joystickTouchId = null;

                    stick.style.transform =
                        "translate(0,0)";

                    move.forward = false;
                    move.backward = false;
                    move.left = false;
                    move.right = false;
                }

                if (
                    touch.identifier ===
                    lookTouchId
                ) {

                    lookTouchId = null;
                }
            }
        }
    );
}

function getDesktopMovementVector(delta) {

    const forward = new THREE.Vector3();

    camera.getWorldDirection(forward);

    forward.y = 0;

    forward.normalize();

    const right = new THREE.Vector3();

    right.crossVectors(
        forward,
        new THREE.Vector3(0,1,0)
    ).normalize();

    const movement =
        new THREE.Vector3();

    if (move.forward)
        movement.add(forward);

    if (move.backward)
        movement.addScaledVector(
            forward,
            -1
        );

    if (move.left)
        movement.addScaledVector(
            right,
            -1
        );

    if (move.right)
        movement.add(right);

    if (movement.length() > 0) {

        movement.normalize();

        movement.multiplyScalar(
            speed * delta
        );
    }

    return movement;
}

function getVRMovementVector(delta) {

    const session =
        renderer.xr.getSession();

    if (!session)
        return new THREE.Vector3();

    const movement =
        new THREE.Vector3();

    for (const source of session.inputSources) {

        const gamepad =
            source.gamepad;

        if (
            !gamepad ||
            !gamepad.axes ||
            gamepad.axes.length < 2
        ) continue;

        let x = 0;
        let y = 0;

        if (gamepad.axes.length >= 4) {

            x = gamepad.axes[2];
            y = gamepad.axes[3];

        } else {

            x = gamepad.axes[0];
            y = gamepad.axes[1];
        }

        const deadzone = 0.15;

        if (Math.abs(x) < deadzone) x = 0;
        if (Math.abs(y) < deadzone) y = 0;

        if (x === 0 && y === 0)
            continue;

        const xrCamera =
            renderer.xr.getCamera(camera);

        const forward =
            new THREE.Vector3();

        xrCamera.getWorldDirection(forward);

        forward.y = 0;

        forward.normalize();

        const right =
            new THREE.Vector3();

        right.crossVectors(
            forward,
            new THREE.Vector3(0,1,0)
        ).normalize();

        movement.addScaledVector(
            forward,
            -y
        );

        movement.addScaledVector(
            right,
            x
        );
    }

    if (movement.length() > 0) {

        movement.normalize();

        movement.multiplyScalar(
            vrSpeed * delta
        );
    }

    return movement;
}

function applyMovement(movement) {

    if (!model) return;

    const proposed =
        yawObject.position
            .clone()
            .add(movement);

    if (movement.length() > 0) {

        const midHeight =
            playerBaseY +
            playerHeight * 0.5;

        const ray =
            new THREE.Raycaster(

                new THREE.Vector3(
                    yawObject.position.x,
                    midHeight,
                    yawObject.position.z
                ),

                movement
                    .clone()
                    .normalize(),

                0,

                playerRadius
            );

        const hits =
            ray
                .intersectObject(model, true)
                .filter(
                    hit =>
                        !hit.object.userData.ignoreCollision
                );

        if (hits.length === 0) {

            yawObject.position.copy(proposed);
        }
    }

    const footRay =
        new THREE.Raycaster(

            new THREE.Vector3(
                yawObject.position.x,
                playerBaseY + stepHeight,
                yawObject.position.z
            ),

            new THREE.Vector3(0,-1,0),

            0,

            stepHeight + 0.5
        );

    const groundHits =
        footRay
            .intersectObject(model, true)
            .filter(
                hit =>
                    !hit.object.userData.ignoreCollision
            );

    if (groundHits.length > 0) {

        playerBaseY =
            groundHits[0].point.y;
    }

    if (renderer.xr.isPresenting) {

        yawObject.position.y =
            playerBaseY;

    } else {

        yawObject.position.y =
            playerBaseY + playerHeight;
    }
}

function animate(){

    const delta =
        clock.getDelta();

    if (canMove && model) {

        const movement =
            renderer.xr.isPresenting
                ? getVRMovementVector(delta)
                : getDesktopMovementVector(delta);

        applyMovement(movement);
    }

    renderer.render(scene, camera);
}
