import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";

let scene, camera, renderer, controls;
let model;
let clock = new THREE.Clock();

let move = { forward:false, backward:false, left:false, right:false };
let canMove = false;
let isMobile = false;

let yawObject;
let pitchObject;

const playerHeight = 1.5;
const playerRadius = 0.35;
const speed = 4.5;
const stepHeight = 0.2;
let playerBaseY = 0;

const SPAWN = new THREE.Vector3(0, 1.5, 5);

init();

function detectMobile() {
    return (
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (navigator.maxTouchPoints && navigator.maxTouchPoints > 2)
    );
}

async function init(){

    isMobile = detectMobile();

    const container = document.getElementById("container");
    const startScreen = document.getElementById("startScreen");

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        800 // reduced far plane for better precision
    );

    renderer = new THREE.WebGLRenderer({ antialias:true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    window.addEventListener("resize", () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // --- FPS hierarchy ---
    yawObject = new THREE.Object3D();
    pitchObject = new THREE.Object3D();

    yawObject.add(pitchObject);
    pitchObject.add(camera);
    scene.add(yawObject);

    yawObject.position.copy(SPAWN);

    // --- HDR background ONLY (no lighting) ---
    const rgbeLoader = new RGBELoader();
    rgbeLoader.setPath("./assets/");
    rgbeLoader.load("fouriesburg_mountain_midday_2k.hdr", (hdrTexture) => {
        hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
        scene.background = hdrTexture;
    });

    await MeshoptDecoder.ready;

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    loader.load("./assets/scene.glb", (gltf) => {
        model = gltf.scene;
        scene.add(model);
        model.traverse((child) => {
    if (child.isMesh && child.name === "Cube") {
        child.visible = false;
    }
});
        playerBaseY = SPAWN.y - playerHeight;
    });

    controls = new PointerLockControls(camera, document.body);

    if (!isMobile) {
        startScreen.addEventListener("click", () => controls.lock());
    } else {
        startScreen.addEventListener("click", async () => {
            startScreen.style.display = "none";
            canMove = true;

            if (document.documentElement.requestFullscreen) {
                try { await document.documentElement.requestFullscreen(); } catch(e){}
            }

            setupMobileControls();
        });
    }

    controls.addEventListener("lock", () => {
        startScreen.style.display = "none";
        canMove = true;
    });

    controls.addEventListener("unlock", () => {
        if (!isMobile) {
            startScreen.style.display = "flex";
            canMove = false;
        }
    });

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

    animate();
}

function setupMobileControls() {

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
    let pitch = 0;

    document.addEventListener("touchstart", (e) => {
        for (let touch of e.changedTouches) {

            if (touch.clientX < window.innerWidth / 2 && joystickTouchId === null) {
                joystickTouchId = touch.identifier;

                const rect = joystick.getBoundingClientRect();
                centerX = rect.left + rect.width / 2;
                centerY = rect.top + rect.height / 2;
            }

            else if (touch.clientX >= window.innerWidth / 2 && lookTouchId === null) {
                lookTouchId = touch.identifier;
                lastLookX = touch.clientX;
                lastLookY = touch.clientY;
            }
        }
    });

    document.addEventListener("touchmove", (e) => {
        for (let touch of e.changedTouches) {

            if (touch.identifier === joystickTouchId) {

                const dx = touch.clientX - centerX;
                const dy = touch.clientY - centerY;

                const dist = Math.min(Math.sqrt(dx*dx + dy*dy), 40);
                const angle = Math.atan2(dy, dx);

                stick.style.transform =
                    `translate(${Math.cos(angle)*dist}px, ${Math.sin(angle)*dist}px)`;

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

                yawObject.rotation.y -= deltaX * 0.002;

                pitch -= deltaY * 0.002;
                pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, pitch));
                pitchObject.rotation.x = pitch;
            }
        }
    });

    document.addEventListener("touchend", (e) => {
        for (let touch of e.changedTouches) {

            if (touch.identifier === joystickTouchId) {
                joystickTouchId = null;
                stick.style.transform = "translate(0,0)";
                move.forward = move.backward = move.left = move.right = false;
            }

            if (touch.identifier === lookTouchId) {
                lookTouchId = null;
            }
        }
    });
}

function animate(){
    requestAnimationFrame(animate);

    const delta = clock.getDelta();

    if (canMove && model){

        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();

        const right = new THREE.Vector3();
        right.crossVectors(forward, new THREE.Vector3(0,1,0)).normalize();

        const movement = new THREE.Vector3();

        if (move.forward) movement.add(forward);
        if (move.backward) movement.addScaledVector(forward, -1);
        if (move.left) movement.addScaledVector(right, -1);
        if (move.right) movement.add(right);

        if (movement.length() > 0){
            movement.normalize();
            movement.multiplyScalar(speed * delta);
        }

        const proposed = yawObject.position.clone().add(movement);

        if (movement.length() > 0){
            const midHeight = playerBaseY + playerHeight * 0.5;

            const ray = new THREE.Raycaster(
                new THREE.Vector3(
                    yawObject.position.x,
                    midHeight,
                    yawObject.position.z
                ),
                movement.clone().normalize(),
                0,
                playerRadius
            );

            const hits = ray.intersectObject(model, true);

            if (hits.length === 0){
                yawObject.position.copy(proposed);
            }
        }

        const footRay = new THREE.Raycaster(
            new THREE.Vector3(
                yawObject.position.x,
                playerBaseY + stepHeight,
                yawObject.position.z
            ),
            new THREE.Vector3(0,-1,0),
            0,
            stepHeight + 0.5
        );

        const groundHits = footRay.intersectObject(model, true);

        if (groundHits.length > 0){
            playerBaseY = groundHits[0].point.y;
        }

        yawObject.position.y = playerBaseY + playerHeight;
    }

    renderer.render(scene, camera);
}







