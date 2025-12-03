// static/js/boids-visualizer.js

// Using the canonical, official paths from the three.js package via a reliable CDN.
import * as THREE from "https://esm.sh/three@0.160.0";
import { OrbitControls } from "https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js";

/**
 * Initializes a 3D Three.js scene.
 */
export function initScene(container, sceneType, ui) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.z = 8;
    camera.position.y = 2;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    // The container now has position: relative, so we can append UI directly to it.
    container.appendChild(ui.uiPanel);
    container.appendChild(ui.overlay);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 2;
    controls.maxDistance = 50;

    const onResize = () => {
        if (container.clientWidth > 0 && container.clientHeight > 0) {
            camera.aspect = container.clientWidth / container.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(container.clientWidth, container.clientHeight);
        }
    };
    window.addEventListener("resize", onResize);

    switch (sceneType) {
        case "hello-cube":
            setupHelloCube(scene);
            break;
        case "boids-rules":
            setupBoidsRulesScene(scene, camera, controls, container, ui);
            break;
        case "on2-problem":
            setupON2Scene(scene, camera, controls, ui);
            break;
        case "spatial-grid":
            setupSpatialGridScene(scene, camera, controls, ui);
            break;
        // cases for future 3D scenes will go here...
        default:
            setupErrorScene(scene);
            break;
    }

    const clock = new THREE.Clock();
    let isAnimating = true;

    function animate() {
        if (!isAnimating) return;
        requestAnimationFrame(animate);
        if (scene.userData.animate) scene.userData.animate(clock.getDelta());
        controls.update();
        renderer.render(scene, camera);
    }

    // Cleanup logic
    const observer = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
            if (mutation.removedNodes) {
                mutation.removedNodes.forEach((node) => {
                    if (node.contains && node.contains(container.parentElement)) {
                        isAnimating = false;
                        window.removeEventListener("resize", onResize);
                        renderer.dispose();
                        controls.dispose();
                        observer.disconnect();
                    }
                });
            }
        }
    });
    observer.observe(container.parentElement.parentElement, { childList: true });
    animate();
}

// =============================================================================
// --- ALL 3D SCENE SETUP FUNCTIONS (EXISTING)                               ---
// =============================================================================
function setupHelloCube(scene) {
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);
    const geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    const material = new THREE.MeshStandardMaterial({ color: 0x007bff, roughness: 0.5 });
    const cube = new THREE.Mesh(geometry, material);
    scene.add(cube);
    scene.userData.animate = (delta) => {
        cube.rotation.x += 1.0 * delta;
        cube.rotation.y += 1.0 * delta;
    };
}
function setupErrorScene(scene) {
    const geometry = new THREE.BoxGeometry(3, 1, 0.1);
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const errorMesh = new THREE.Mesh(geometry, material);
    scene.add(errorMesh);
}
const BOID_PARAMS = {
    CohesionWeight: 1.0,
    SeparationWeight: 1.5,
    AlignmentWeight: 1.0,
    ContainmentWeight: 2.5,
    NeighborRadius: 3.5,
    SeparationDistance: 1.5,
};
class Boid {
    /* ... full boid class ... */ constructor(id, bounds) {
        this.id = id;
        this.bounds = bounds;
        this.position = new THREE.Vector3(
            THREE.MathUtils.randFloatSpread(bounds.x * 0.9),
            THREE.MathUtils.randFloatSpread(bounds.y * 0.9),
            THREE.MathUtils.randFloatSpread(bounds.z * 0.9)
        );
        this.velocity = new THREE.Vector3().randomDirection().multiplyScalar(Math.random() * 2 + 2);
        this.acceleration = new THREE.Vector3();
        this.maxSpeed = 3.5;
        this.maxForce = 0.05;
        const geometry = new THREE.ConeGeometry(0.1, 0.4, 8);
        geometry.rotateX(Math.PI / 2);
        const material = new THREE.MeshStandardMaterial({ color: 13370889 });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.boidId = id;
    }
    flock(boids, weights) {
        const neighbors = [],
            separationNeighbors = [];
        for (const other of boids) {
            if (other === this) continue;
            const distanceSq = this.position.distanceToSquared(other.position);
            distanceSq < BOID_PARAMS.NeighborRadius * BOID_PARAMS.NeighborRadius && neighbors.push(other);
            distanceSq < BOID_PARAMS.SeparationDistance * BOID_PARAMS.SeparationDistance &&
                separationNeighbors.push(other);
        }
        const separationForce = this.separation(separationNeighbors).multiplyScalar(weights.SeparationWeight),
            alignmentForce = this.alignment(neighbors).multiplyScalar(weights.AlignmentWeight),
            cohesionForce = this.cohesion(neighbors).multiplyScalar(weights.CohesionWeight),
            boundaryForce = this.boundaryContainment().multiplyScalar(weights.ContainmentWeight);
        this.acceleration.add(separationForce).add(alignmentForce).add(cohesionForce).add(boundaryForce);
        this.lastForces = { cohesionForce, neighbors, separationNeighbors };
    }
    update(delta) {
        this.velocity.add(this.acceleration);
        this.velocity.clampLength(0, this.maxSpeed);
        this.position.add(this.velocity.clone().multiplyScalar(delta));
        this.acceleration.set(0, 0, 0);
        this.mesh.position.copy(this.position);
        this.velocity.lengthSq() > 0.001 &&
            this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.velocity.clone().normalize());
    }
    steer(target) {
        const desired = new THREE.Vector3().subVectors(target, this.position).normalize().multiplyScalar(this.maxSpeed);
        return new THREE.Vector3().subVectors(desired, this.velocity).clampLength(0, this.maxForce);
    }
    separation(neighbors) {
        let steer = new THREE.Vector3();
        return neighbors.length === 0
            ? steer
            : (neighbors.forEach((other) => {
                  let diff = new THREE.Vector3().subVectors(this.position, other.position);
                  steer.add(diff.normalize().divideScalar(diff.length() || 1));
              }),
              steer.divideScalar(neighbors.length).clampLength(0, this.maxForce));
    }
    alignment(neighbors) {
        let avgVelocity = new THREE.Vector3();
        return neighbors.length === 0
            ? avgVelocity
            : (neighbors.forEach((other) => avgVelocity.add(other.velocity)),
              avgVelocity.divideScalar(neighbors.length).clampLength(0, this.maxForce));
    }
    cohesion(neighbors) {
        let centerOfMass = new THREE.Vector3();
        return neighbors.length === 0
            ? centerOfMass
            : (neighbors.forEach((other) => centerOfMass.add(other.position)),
              this.steer(centerOfMass.divideScalar(neighbors.length)));
    }
    boundaryContainment() {
        let force = new THREE.Vector3(),
            checkDist = 3,
            boxMin = new THREE.Vector3(-this.bounds.x / 2, -this.bounds.y / 2, -this.bounds.z / 2),
            boxMax = new THREE.Vector3(this.bounds.x / 2, this.bounds.y / 2, this.bounds.z / 2);
        this.position.x < boxMin.x + checkDist
            ? (force.x = 1)
            : this.position.x > boxMax.x - checkDist && (force.x = -1);
        this.position.y < boxMin.y + checkDist
            ? (force.y = 1)
            : this.position.y > boxMax.y - checkDist && (force.y = -1);
        this.position.z < boxMin.z + checkDist
            ? (force.z = 1)
            : this.position.z > boxMax.z - checkDist && (force.z = -1);
        return force.normalize().multiplyScalar(this.maxForce);
    }
}
function createButton(text, id, container, callback) {
    const button = document.createElement("button");
    button.id = id;
    button.textContent = text;
    Object.assign(button.style, {
        backgroundColor: "#fff",
        border: "1px solid #ccc",
        padding: "4px 8px",
        margin: "2px",
        borderRadius: "3px",
        cursor: "pointer",
        outline: "none",
        width: "80px",
    });
    button.addEventListener("click", () => callback(button));
    container.appendChild(button);
    return button;
}
function setupBoidsRulesScene(scene, camera, controls, container, ui) {
    ui.uiPanel.style.display = "block";
    ui.helpText.innerText = "Click a boid to see forces.";
    const activeWeights = { ...BOID_PARAMS };
    const toggleActiveStyle = (btn) =>
        (btn.style.backgroundColor = btn.classList.toggle("active") ? "#a0e0a0" : "#fff");
    const sepBtn = createButton("Separation", "boids-sep", ui.controlsContainer, (btn) => {
            toggleActiveStyle(btn);
            activeWeights.SeparationWeight = btn.classList.contains("active") ? BOID_PARAMS.SeparationWeight : 0;
        }),
        aliBtn = createButton("Alignment", "boids-ali", ui.controlsContainer, (btn) => {
            toggleActiveStyle(btn);
            activeWeights.AlignmentWeight = btn.classList.contains("active") ? BOID_PARAMS.AlignmentWeight : 0;
        }),
        cohBtn = createButton("Cohesion", "boids-coh", ui.controlsContainer, (btn) => {
            toggleActiveStyle(btn);
            activeWeights.CohesionWeight = btn.classList.contains("active") ? BOID_PARAMS.CohesionWeight : 0;
        });
    [sepBtn, aliBtn, cohBtn].forEach((btn) => btn.click());
    camera.position.set(0, 5, 20);
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(5, 10, 7);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5), sun);
    const BOUNDS = { x: 20, y: 12, z: 20 };
    scene.add(new THREE.BoxHelper(new THREE.Mesh(new THREE.BoxGeometry(BOUNDS.x, BOUNDS.y, BOUNDS.z)), 0xaaaaaa));
    const boids = Array.from({ length: 50 }, (_, i) => new Boid(i, BOUNDS));
    boids.forEach((boid) => scene.add(boid.mesh));
    let selectedBoid = null,
        originalMaterial = new THREE.MeshStandardMaterial({ color: 0x336699 }),
        selectedMaterial = new THREE.MeshStandardMaterial({ color: 0xff4500, emissive: 0xff4500 }),
        alignmentHelper = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 2, 0x00ff00, 0.5, 0.2),
        cohesionHelper = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 2, 0x0000ff, 0.5, 0.2);
    scene.add(alignmentHelper, cohesionHelper);
    let separationLines = [],
        raycaster = new THREE.Raycaster();
    container.addEventListener("click", (event) => {
        const rect = container.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            (-(event.clientY - rect.top) / rect.height) * 2 + 1
        );
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(boids.map((b) => b.mesh));
        if (selectedBoid) selectedBoid.mesh.material = originalMaterial;
        selectedBoid = intersects.length > 0 ? boids.find((b) => b.id === intersects[0].object.boidId) : null;
        if (selectedBoid) selectedBoid.mesh.material = selectedMaterial;
    });
    scene.userData.animate = (delta) => {
        boids.forEach((boid) => boid.flock(boids, activeWeights));
        boids.forEach((boid) => {
            boid.acceleration.multiplyScalar(delta * 60);
            boid.update(delta);
        });
        alignmentHelper.visible = cohesionHelper.visible = false;
        separationLines.forEach((l) => l.removeFromParent());
        separationLines = [];
        if (selectedBoid) {
            const { cohesionForce, neighbors, separationNeighbors } = selectedBoid.lastForces;
            if (neighbors.length > 0) {
                if (cohesionForce.lengthSq() > 0.001) {
                    const centerOfMass = neighbors
                        .reduce((acc, n) => acc.add(n.position), new THREE.Vector3())
                        .divideScalar(neighbors.length);
                    cohesionHelper.position.copy(selectedBoid.position);
                    cohesionHelper.setDirection(
                        new THREE.Vector3().subVectors(centerOfMass, selectedBoid.position).normalize()
                    );
                    cohesionHelper.setLength(selectedBoid.position.distanceTo(centerOfMass), 0.5, 0.2);
                    cohesionHelper.visible = activeWeights.CohesionWeight > 0;
                }
                const avgVel = neighbors
                    .reduce((acc, n) => acc.add(n.velocity), new THREE.Vector3())
                    .divideScalar(neighbors.length);
                alignmentHelper.position.copy(selectedBoid.position);
                alignmentHelper.setDirection(avgVel.clone().normalize());
                alignmentHelper.setLength(2.5, 0.5, 0.2);
                alignmentHelper.visible = activeWeights.AlignmentWeight > 0;
            }
            if (separationNeighbors.length > 0 && activeWeights.SeparationWeight > 0) {
                separationNeighbors.forEach((other) => {
                    const line = new THREE.Line(
                        new THREE.BufferGeometry().setFromPoints([other.position, selectedBoid.position]),
                        new THREE.LineBasicMaterial({ color: 0xff0000 })
                    );
                    separationLines.push(line);
                    scene.add(line);
                });
            }
        }
    };
}
function setupON2Scene(scene, camera, controls, ui) {
    ui.overlay.style.display = "block";
    camera.position.set(0, 15, 25);
    controls.target.set(0, 0, 0);
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(10, 20, 15);
    scene.add(new THREE.AmbientLight(0xffffff, 0.7), sun, new THREE.GridHelper(30, 30));
    const fishCount = 50,
        fishMeshes = [],
        checkLines = [],
        defaultMaterial = new THREE.MeshStandardMaterial({ color: 0x336699 }),
        activeMaterial = new THREE.MeshStandardMaterial({ color: 0xff8c00, emissive: 0xff8c00 }),
        lineMaterial = new THREE.LineBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5 });
    const sphereGeom = new THREE.SphereGeometry(0.3, 16, 8),
        bounds = { x: 25, y: 10, z: 25 };
    for (let i = 0; i < fishCount; i++) {
        const mesh = new THREE.Mesh(sphereGeom, defaultMaterial.clone());
        mesh.position.set(
            THREE.MathUtils.randFloatSpread(bounds.x),
            THREE.MathUtils.randFloat(0.5, bounds.y),
            THREE.MathUtils.randFloatSpread(bounds.z)
        );
        fishMeshes.push(mesh);
        scene.add(mesh);
    }
    for (let i = 0; i < fishCount; i++) {
        const line = new THREE.Line(new THREE.BufferGeometry(), lineMaterial);
        line.visible = false;
        checkLines.push(line);
        scene.add(line);
    }
    let currentFishIndex = 0,
        frameCounter = 0;
    scene.userData.animate = () => {
        if (frameCounter++ % 5 === 0) {
            fishMeshes[currentFishIndex].material = defaultMaterial;
            currentFishIndex = (currentFishIndex + 1) % fishCount;
            const activeFish = fishMeshes[currentFishIndex];
            activeFish.material = activeMaterial;
            let checks = 0;
            checkLines.forEach((line) => (line.visible = false));
            for (let i = 0; i < fishCount; i++) {
                if (i === currentFishIndex) continue;
                checkLines[checks].geometry.setFromPoints([activeFish.position, fishMeshes[i].position]);
                checkLines[checks].visible = true;
                checks++;
            }
            ui.overlay.innerHTML = `Fish ${currentFishIndex + 1}/${fishCount} checking...<br>Checks this tick: ${checks}`;
        }
    };
}
class SpatialGrid {
    constructor(bounds, cellSize) {
        this.bounds = bounds;
        this.cellSize = cellSize;
        this.grid = new Map();
    }
    getCellCoord(position) {
        return new THREE.Vector3(
            Math.floor((position.x + this.bounds.x / 2) / this.cellSize),
            Math.floor((position.y + this.bounds.y / 2) / this.cellSize),
            Math.floor((position.z + this.bounds.z / 2) / this.cellSize)
        );
    }
    addToGrid(fish) {
        const coord = this.getCellCoord(fish.position);
        const key = `${coord.x},${coord.y},${coord.z}`;
        if (!this.grid.has(key)) {
            this.grid.set(key, []);
        }
        this.grid.get(key).push(fish);
    }
    getNeighbors(fish, radius) {
        const neighbors = [],
            checkedCells = new Set(),
            originCoord = this.getCellCoord(fish.position),
            radiusInCells = Math.ceil(radius / this.cellSize);
        for (let z = -radiusInCells; z <= radiusInCells; z++)
            for (let y = -radiusInCells; y <= radiusInCells; y++)
                for (let x = -radiusInCells; x <= radiusInCells; x++) {
                    const checkCoord = new THREE.Vector3(originCoord.x + x, originCoord.y + y, originCoord.z + z);
                    const key = `${checkCoord.x},${checkCoord.y},${checkCoord.z}`;
                    checkedCells.add(key);
                    if (this.grid.has(key))
                        for (const other of this.grid.get(key)) if (other !== fish) neighbors.push(other);
                }
        return { neighbors, checkedCells };
    }
}
function createSlider(id, label, min, max, step, value, container, callback) {
    const sliderContainer = document.createElement("div");
    Object.assign(sliderContainer.style, { display: "flex", alignItems: "center", margin: "4px 0" });
    const labelElem = document.createElement("label");
    labelElem.htmlFor = id;
    labelElem.textContent = label;
    Object.assign(labelElem.style, { marginRight: "8px", width: "120px" });
    const slider = document.createElement("input");
    slider.type = "range";
    slider.id = id;
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = value;
    const valueElem = document.createElement("span");
    valueElem.textContent = value;
    Object.assign(valueElem.style, { marginLeft: "8px", width: "30px" });
    slider.addEventListener("input", () => {
        valueElem.textContent = slider.value;
        callback(parseFloat(slider.value));
    });
    sliderContainer.appendChild(labelElem);
    sliderContainer.appendChild(slider);
    sliderContainer.appendChild(valueElem);
    container.appendChild(sliderContainer);
}
function setupSpatialGridScene(scene, camera, controls, ui) {
    ui.uiPanel.style.display = "block";
    ui.overlay.style.display = "block";
    let fishNeighborRadius = 4.0;
    createSlider(
        "radius-slider",
        "Neighbor Radius:",
        1,
        10,
        0.5,
        fishNeighborRadius,
        ui.controlsContainer,
        (newValue) => {
            fishNeighborRadius = newValue;
        }
    );
    camera.position.set(0, 20, 35);
    controls.target.set(0, 5, 0);
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(10, 20, 15);
    scene.add(sun, new THREE.AmbientLight(0xffffff, 0.7));
    const bounds = new THREE.Vector3(30, 15, 30),
        cellSize = 5.0,
        spatialGrid = new SpatialGrid(bounds, cellSize);
    scene.add(new THREE.GridHelper(bounds.x, bounds.x / cellSize, 0x888888, 0xcccccc));
    const fishCount = 50,
        fishes = [],
        sphereGeom = new THREE.SphereGeometry(0.3, 16, 8),
        defaultMaterial = new THREE.MeshStandardMaterial({ color: 0x0077be }),
        activeMaterial = new THREE.MeshStandardMaterial({ color: 0xff8c00, emissive: 0xff8c00 });
    for (let i = 0; i < fishCount; i++) {
        const mesh = new THREE.Mesh(sphereGeom, defaultMaterial.clone());
        mesh.position.set(
            THREE.MathUtils.randFloatSpread(bounds.x),
            THREE.MathUtils.randFloat(0.5, bounds.y),
            THREE.MathUtils.randFloatSpread(bounds.z)
        );
        fishes.push(mesh);
        scene.add(mesh);
    }
    fishes.forEach((fish) => spatialGrid.addToGrid(fish));
    let activeFish = fishes[0];
    activeFish.material = activeMaterial;
    let frameCounter = 0;
    const neighborLines = [];
    for (let i = 0; i < fishCount; i++) {
        const line = new THREE.Line(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.7 })
        );
        line.visible = false;
        neighborLines.push(line);
        scene.add(line);
    }
    const gridCellHelpers = [],
        cellHelperMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            wireframe: true,
            transparent: true,
            opacity: 0.4,
        }),
        cellGeom = new THREE.BoxGeometry(cellSize, cellSize, cellSize);
    scene.userData.animate = () => {
        if (frameCounter++ % 15 === 0) {
            activeFish.material = defaultMaterial;
            const newIndex = (fishes.indexOf(activeFish) + 1) % fishCount;
            activeFish = fishes[newIndex];
            activeFish.material = activeMaterial;
        }
        neighborLines.forEach((l) => (l.visible = false));
        gridCellHelpers.forEach((h) => (h.visible = false));
        const { neighbors, checkedCells } = spatialGrid.getNeighbors(activeFish, fishNeighborRadius);
        let neighborCount = 0,
            checks = 0;
        for (const other of neighbors) {
            if (activeFish.position.distanceTo(other.position) < fishNeighborRadius) {
                neighborLines[neighborCount].geometry.setFromPoints([activeFish.position, other.position]);
                neighborLines[neighborCount].visible = true;
                neighborCount++;
            }
            checks++;
        }
        let cellHelperIdx = 0;
        for (const cellKey of checkedCells) {
            const coords = cellKey.split(",").map(Number);
            const helper = gridCellHelpers[cellHelperIdx] || new THREE.Mesh(cellGeom, cellHelperMaterial);
            helper.position.set(
                coords[0] * cellSize + cellSize / 2 - bounds.x / 2,
                coords[1] * cellSize + cellSize / 2 - bounds.y / 2,
                coords[2] * cellSize + cellSize / 2 - bounds.z / 2
            );
            if (!gridCellHelpers[cellHelperIdx]) {
                gridCellHelpers.push(helper);
                scene.add(helper);
            }
            helper.visible = true;
            cellHelperIdx++;
        }
        ui.overlay.innerHTML = `Full Scan: ${fishCount - 1} checks<br>Grid Scan: <strong style="color: #00ff00">${checks} checks</strong> (${checkedCells.size} cells)`;
    };
}

// =================================================================================
// --- 2D VISUALIZATIONS (EXISTING)                                              ---
// =================================================================================

export function initMemoryLayoutScene2D(container) {
    const styles = `
        .html-diagram-container { font-family: monospace; color: #333; height: 100%; display: flex; flex-direction: column; }
        .memory-race-panels { display: flex; flex-grow: 1; }
        .memory-panel { position: relative; flex: 1; padding: 15px; border-right: 1px solid #ddd; overflow-y: auto; display: flex; flex-direction: column;}
        .memory-panel:last-child { border-right: none; }
        .memory-title { font-size: 1.1em; font-weight: bold; text-align: center; margin-bottom: 5px; flex-shrink: 0; }
        .fetch-counter { font-size: 1.0em; text-align: center; margin-bottom: 15px; font-weight: bold; color: #dc3545; height: 20px; flex-shrink: 0;}
        .memory-content { position: relative; flex-grow: 1;}
        .memory-struct { display: flex; align-items: center; margin-bottom: 8px; border: 1px solid #aaa; padding: 4px; border-radius: 4px; background: #fff; }
        .struct-label { font-weight: bold; margin-right: 8px; padding: 6px; border-radius: 3px; font-size: 0.8em; }
        .data-block { padding: 6px 4px; margin: 0 1px; border-radius: 3px; font-size: 0.8em; min-width: 30px; text-align: center; flex-shrink: 0; }
        .array-row { display: flex; border: 1px solid #aaa; padding: 4px; border-radius: 4px; background: #fff; margin-bottom: 8px; }
        .scanner-highlight { position: absolute; background: rgba(255, 255, 0, 0.4); border: 1px solid #ccaa00; z-index: 1; transition: all 0.1s ease-in-out; box-sizing: border-box; opacity: 0;}
        .restart-button { margin: 15px; padding: 8px 15px; border: 1px solid #666; background: #fff; cursor: pointer; border-radius: 4px; font-family: monospace; align-self: center; flex-shrink: 1; }
    `;
    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    container.innerHTML = `<div class="memory-race-panels"><div class="memory-panel" id="aos-panel"></div><div class="memory-panel" id="soa-panel"></div></div><button class="restart-button" id="restart-anim">Restart Animation</button>`;
    const aosPanel = container.querySelector("#aos-panel"),
        soaPanel = container.querySelector("#soa-panel");
    aosPanel.innerHTML = `<div class="memory-title">Array of Structs (AoS)</div><div class="fetch-counter" id="aos-fetches">Fetches: 0</div><div class="memory-content" id="aos-content"></div>`;
    soaPanel.innerHTML = `<div class="memory-title">Structure of Arrays (SoA)</div><div class="fetch-counter" id="soa-fetches">Fetches: 0</div><div class="memory-content" id="soa-content"></div>`;

    const NUM_ELEMENTS = 5;
    const aosContent = aosPanel.querySelector("#aos-content"),
        soaContent = soaPanel.querySelector("#soa-content");
    const dataColors = { Pos: "#007bff", Vel: "#28a745", ID: "#ffc107" },
        dataLabels = ["Pos", "Vel", "ID"];

    const aosStructs = Array.from({ length: NUM_ELEMENTS }, (_, i) => {
        const el = document.createElement("div");
        el.className = "memory-struct";
        el.innerHTML =
            `<div class="struct-label" style="background:#6c757d; color: white;">Fish[${i}]</div>` +
            dataLabels
                .map((l) => `<div class="data-block" style="background:${dataColors[l]}; color:white;">${l}</div>`)
                .join("");
        aosContent.appendChild(el);
        return el;
    });
    const soaRows = dataLabels.map((label) => {
        const el = document.createElement("div");
        el.className = "array-row";
        for (let i = 0; i < NUM_ELEMENTS; i++)
            el.innerHTML += `<div class="data-block" style="background:${dataColors[label]}; color:white;">[${i}]</div>`;
        soaContent.appendChild(el);
        return el;
    });

    const aosScanner = document.createElement("div"),
        soaScanner = document.createElement("div");
    aosScanner.className = "scanner-highlight";
    soaScanner.className = "scanner-highlight";
    aosContent.appendChild(aosScanner);
    soaContent.appendChild(soaScanner);
    const aosCounter = aosPanel.querySelector("#aos-fetches"),
        soaCounter = soaPanel.querySelector("#soa-fetches");

    let animIntervals = [];
    function runAnimation() {
        animIntervals.forEach(clearInterval);
        animIntervals = [];
        let aosFetch = 0,
            soaFetch = 0;
        aosCounter.innerText = "Fetches: 0";
        soaCounter.innerText = "Fetches: 0";
        [aosScanner, soaScanner].forEach((s) => (s.style.opacity = 0));

        const aosRace = setInterval(() => {
            if (aosFetch >= NUM_ELEMENTS) {
                clearInterval(aosRace);
                return;
            }
            aosCounter.innerText = `Fetches: ${aosFetch + 1}`;
            const targetStruct = aosStructs[aosFetch];
            const pRect = aosContent.getBoundingClientRect(),
                sRect = targetStruct.getBoundingClientRect();
            aosScanner.style.opacity = 1;
            aosScanner.style.top = `${targetStruct.offsetTop}px`;
            aosScanner.style.left = `${targetStruct.offsetLeft}px`;
            aosScanner.style.width = `${targetStruct.offsetWidth}px`;
            aosScanner.style.height = `${targetStruct.offsetHeight}px`;
            aosFetch++;
        }, 400);
        animIntervals.push(aosRace);

        const soaRace = setInterval(() => {
            if (soaFetch >= dataLabels.length) {
                clearInterval(soaRace);
                return;
            }
            soaCounter.innerText = `Fetches: ${soaFetch + 1}`;
            const targetRow = soaRows[soaFetch];
            const pRect = soaContent.getBoundingClientRect(),
                sRect = targetRow.getBoundingClientRect();
            soaScanner.style.opacity = 1;
            soaScanner.style.top = `${targetRow.offsetTop}px`;
            soaScanner.style.left = `${targetRow.offsetLeft}px`;
            soaScanner.style.width = `${targetRow.offsetWidth}px`;
            soaScanner.style.height = `${targetRow.offsetHeight}px`;
            soaFetch++;
        }, 400);
        animIntervals.push(soaRace);
    }
    container.querySelector("#restart-anim").addEventListener("click", runAnimation);
    setTimeout(runAnimation, 500);
}
export function initParallelismScene(container) {
    const styles = `
        .parallel-container { padding: 20px; font-family: monospace; color: #333; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; box-sizing: border-box;}
        .parallel-title { font-size: 1.2em; font-weight: bold; margin-bottom: 20px; }
        .cpu-cores { display: flex; gap: 20px; margin-bottom: 20px; width: 100%; justify-content: center;}
        .cpu-core { padding: 8px; border-radius: 4px; border-bottom: 4px solid; color: #333; font-weight: bold; flex: 1; max-width: 120px; }
        .core-label { font-size: 0.9em; text-align: center; }
        .parallel-arrays { width: 100%; max-width: 700px;}
        .parallel-array { display: flex; padding: 5px; border-radius: 4px; background: #fff; margin-bottom: 8px;}
        .parallel-data-block { flex: 1; padding: 8px 5px; margin: 0 2px; border-radius: 3px; font-size: 0.8em; text-align: center; color: #333; background: #e9ecef; transition: background-color 0.1s linear, color 0.1s linear; }
        .restart-button { margin-top: 20px; padding: 8px 15px; border: 1px solid #666; background: #fff; cursor: pointer; border-radius: 4px; font-family: monospace; font-size: 1em; }
    `;
    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);
    container.classList.add("parallel-container");

    container.innerHTML = `<div class="parallel-title">ParallelFor Processing with SoA Data</div><div class="cpu-cores" id="cpu-cores"></div><div class="parallel-arrays" id="data-arrays"></div><button id="restart-anim" class="restart-button">Restart Simulation</button>`;

    const coreColors = ["#dc3545", "#198754", "#0d6efd", "#6f42c1"];
    const numCores = 4;
    const numElements = 12;
    const chunkSize = numElements / numCores;

    const dataBlocks = { Positions: [], Velocities: [], IDs: [] };
    const dataLabels = ["Pos", "Vel", "ID"];

    Object.keys(dataBlocks).forEach((key, idx) => {
        const arrayEl = document.createElement("div");
        arrayEl.className = "parallel-array";
        for (let i = 0; i < numElements; i++) {
            const block = document.createElement("div");
            block.className = "parallel-data-block";
            block.innerText = `${dataLabels[idx]}[${i}]`;
            arrayEl.appendChild(block);
            dataBlocks[key].push(block);
        }
        container.querySelector("#data-arrays").appendChild(arrayEl);
    });

    for (let i = 0; i < numCores; i++) {
        container.querySelector("#cpu-cores").innerHTML +=
            `<div class="cpu-core" style="border-color:${coreColors[i]};"><span class="core-label">Thread ${i}</span></div>`;
    }

    let animInterval;
    function runParallelAnimation() {
        if (animInterval) clearInterval(animInterval);

        let phase = 0; // 0=Pos, 1=Vel, 2=IDs
        let progressInPhase = 0;

        Object.values(dataBlocks)
            .flat()
            .forEach((block) => {
                block.style.backgroundColor = "#e9ecef";
                block.style.color = "#333";
            });

        animInterval = setInterval(() => {
            if (phase >= dataLabels.length) {
                clearInterval(animInterval);
                return;
            }

            const currentArray = Object.values(dataBlocks)[phase];
            for (let core = 0; core < numCores; core++) {
                const blockToColorIndex = core * chunkSize + progressInPhase;
                if (blockToColorIndex < core * chunkSize + chunkSize) {
                    currentArray[blockToColorIndex].style.backgroundColor = coreColors[core];
                    currentArray[blockToColorIndex].style.color = "white";
                }
            }
            progressInPhase++;
            if (progressInPhase >= chunkSize) {
                phase++;
                progressInPhase = 0;
            }
        }, 150);
    }
    container.querySelector("#restart-anim").addEventListener("click", runParallelAnimation);
    setTimeout(runParallelAnimation, 500);
}

// =================================================================================
// --- NEW VISUALIZATION: ISM Rendering (Actors vs Instances)                    ---
// =================================================================================

export function initIsmScene(leftContainer, rightContainer) {
    const NUM_FISH = 500;
    const BOUNDS = new THREE.Vector3(25, 15, 25);

    // --- Shared Assets ---
    const fishGeometry = new THREE.ConeGeometry(0.15, 0.5, 8);
    fishGeometry.rotateX(Math.PI / 2);
    const actorMaterial = new THREE.MeshStandardMaterial({ color: 0xdc3545 });
    const ismMaterial = new THREE.MeshStandardMaterial({ color: 0x198754 });
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(5, 10, 7);

    // --- Left Scene (Actors) ---
    const sceneLeft = new THREE.Scene();
    sceneLeft.background = new THREE.Color(0xf0f0f0);
    const cameraLeft = new THREE.PerspectiveCamera(60, leftContainer.clientWidth / leftContainer.clientHeight, 0.1, 1000);
    cameraLeft.position.set(0, 10, 30);
    const rendererLeft = new THREE.WebGLRenderer({ antialias: true });
    rendererLeft.setSize(leftContainer.clientWidth, leftContainer.clientHeight);
    leftContainer.appendChild(rendererLeft.domElement);
    sceneLeft.add(ambientLight.clone(), directionalLight.clone());
    
    const actorGroup = new THREE.Group();
    const actors = [];
    for (let i = 0; i < NUM_FISH; i++) {
        const mesh = new THREE.Mesh(fishGeometry, actorMaterial);
        mesh.position.set(
            THREE.MathUtils.randFloatSpread(BOUNDS.x),
            THREE.MathUtils.randFloatSpread(BOUNDS.y),
            THREE.MathUtils.randFloatSpread(BOUNDS.z)
        );
        mesh.userData.offset = Math.random() * 2 * Math.PI;
        actorGroup.add(mesh);
        actors.push(mesh);
    }
    sceneLeft.add(actorGroup);

    // --- Right Scene (Instanced Static Mesh) ---
    const sceneRight = new THREE.Scene();
    sceneRight.background = new THREE.Color(0xf0f0f0);
    const cameraRight = cameraLeft.clone(); // Clone to start, will be synced
    const rendererRight = new THREE.WebGLRenderer({ antialias: true });
    rendererRight.setSize(rightContainer.clientWidth, rightContainer.clientHeight);
    rightContainer.appendChild(rendererRight.domElement);
    sceneRight.add(ambientLight.clone(), directionalLight.clone());

    const instancedMesh = new THREE.InstancedMesh(fishGeometry, ismMaterial, NUM_FISH);
    const dummy = new THREE.Object3D();
    const initialPositions = [];
    for (let i = 0; i < NUM_FISH; i++) {
        dummy.position.copy(actors[i].position); // Use same initial positions
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(i, dummy.matrix);
        initialPositions.push(dummy.position.clone());
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
    sceneRight.add(instancedMesh);

    // --- Controls (Control left, sync right) ---
    const controls = new OrbitControls(cameraLeft, rendererLeft.domElement);
    controls.enableDamping = true;

    // --- UI Overlays ---
    function createOverlay(container, title, color, count) {
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'absolute', top: '10px', left: '10px',
            background: 'rgba(0,0,0,0.6)', color: 'white',
            padding: '8px 12px', borderRadius: '5px',
            fontFamily: 'monospace', fontSize: '14px',
            textAlign: 'left',
        });
        overlay.innerHTML = `<strong style="color: ${color};">${title}</strong><br>Draw Calls: ${count}`;
        container.appendChild(overlay);
    }
    createOverlay(leftContainer, 'Actors / Individual Meshes', '#ffc107', NUM_FISH);
    createOverlay(rightContainer, 'Instanced Static Mesh (ISM)', '#28a745', 1);

    // --- Animation Loop ---
    const clock = new THREE.Clock();
    function animate() {
        requestAnimationFrame(animate);
        const elapsedTime = clock.getElapsedTime();

        // Animate actors
        actors.forEach(actor => {
            actor.position.y = Math.sin(elapsedTime * 1.5 + actor.userData.offset) * 2;
        });

        // Animate instances
        for (let i = 0; i < NUM_FISH; i++) {
            dummy.position.x = initialPositions[i].x;
            dummy.position.y = Math.sin(elapsedTime * 1.5 + actors[i].userData.offset) * 2;
            dummy.position.z = initialPositions[i].z;
            dummy.updateMatrix();
            instancedMesh.setMatrixAt(i, dummy.matrix);
        }
        instancedMesh.instanceMatrix.needsUpdate = true;

        controls.update();
        cameraRight.position.copy(cameraLeft.position);
        cameraRight.quaternion.copy(cameraLeft.quaternion);

        rendererLeft.render(sceneLeft, cameraLeft);
        rendererRight.render(sceneRight, cameraRight);
    }
    animate();
}


// =================================================================================
// --- NEW VISUALIZATION: Double Buffering for Parallelism                       ---
// =================================================================================

export function initDoubleBufferScene(container) {
    const styles = `
        .db-container { padding: 20px; font-family: monospace; color: #333; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; box-sizing: border-box; }
        .db-title { font-size: 1.2em; font-weight: bold; margin-bottom: 15px; }
        .db-frame-counter { font-size: 1em; margin-bottom: 20px; color: #555; }
        .db-threads { display: flex; gap: 15px; margin-bottom: 20px; width: 100%; justify-content: center; }
        .db-thread { padding: 8px; border-radius: 4px; border: 2px solid #aaa; color: #333; font-weight: bold; text-align: center; width: 100px; transition: all 0.2s; }
        .db-buffers { display: flex; gap: 30px; width: 100%; justify-content: center; align-items: flex-start; }
        .db-buffer-wrapper { display: flex; flex-direction: column; align-items: center; }
        .db-buffer-label { font-weight: bold; padding: 4px 8px; border-radius: 4px; color: white; margin-bottom: 10px; width: 80px; text-align: center; transition: background-color 0.3s; }
        .db-buffer { display: flex; flex-direction: column; gap: 5px; border: 2px solid #ccc; padding: 8px; border-radius: 4px; background: #fff; }
        .db-data-block { width: 150px; padding: 6px; border-radius: 3px; font-size: 0.9em; text-align: center; background: #e9ecef; transition: all 0.15s; }
        .db-arrow { font-size: 2em; font-weight: bold; margin-top: 50px; color: #888; }
        .restart-button { margin-top: 25px; padding: 8px 15px; border: 1px solid #666; background: #fff; cursor: pointer; border-radius: 4px; font-family: monospace; font-size: 1em; }
    `;
    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);
    container.classList.add("db-container");

    container.innerHTML = `
        <div class="db-title">Parallel Simulation with Double Buffering</div>
        <div class="db-frame-counter" id="frame-counter">Frame: 1</div>
        <div class="db-threads" id="db-threads"></div>
        <div class="db-buffers">
            <div class="db-buffer-wrapper">
                <div class="db-buffer-label" id="buffer-0-label">READ</div>
                <div class="db-buffer" id="buffer-0"></div>
            </div>
            <div class="db-arrow">→</div>
            <div class="db-buffer-wrapper">
                <div class="db-buffer-label" id="buffer-1-label">WRITE</div>
                <div class="db-buffer" id="buffer-1"></div>
            </div>
        </div>
        <button id="restart-anim" class="restart-button">Restart Animation</button>
    `;

    const NUM_THREADS = 3;
    const NUM_ELEMENTS = 6;
    const threadsContainer = container.querySelector('#db-threads');
    const buffer0Container = container.querySelector('#buffer-0');
    const buffer1Container = container.querySelector('#buffer-1');
    const buffer0Label = container.querySelector('#buffer-0-label');
    const buffer1Label = container.querySelector('#buffer-1-label');
    const frameCounterEl = container.querySelector('#frame-counter');

    for (let i = 0; i < NUM_THREADS; i++) {
        threadsContainer.innerHTML += `<div class="db-thread" id="thread-${i}">Thread ${i}</div>`;
    }
    for (let i = 0; i < NUM_ELEMENTS; i++) {
        buffer0Container.innerHTML += `<div class="db-data-block" id="b0-data-${i}">Data[${i}]</div>`;
        buffer1Container.innerHTML += `<div class="db-data-block" id="b1-data-${i}"></div>`;
    }
    
    const threads = Array.from({length: NUM_THREADS}, (_, i) => container.querySelector(`#thread-${i}`));
    const buffer0Blocks = Array.from({length: NUM_ELEMENTS}, (_, i) => container.querySelector(`#b0-data-${i}`));
    const buffer1Blocks = Array.from({length: NUM_ELEMENTS}, (_, i) => container.querySelector(`#b1-data-${i}`));

    let animInterval;
    function runAnimation() {
        if (animInterval) clearInterval(animInterval);

        let frame = 1;
        let readIndex = 0;
        let step = 0; // 0: idle, 1: reading, 2: writing, 3: flipping
        let progress = 0;
        
        const resetState = () => {
            buffer0Blocks.forEach((b, i) => {
                b.style.background = '#e9ecef';
                b.innerText = `Data[${i}]`;
            });
            buffer1Blocks.forEach(b => {
                b.style.background = '#e9ecef';
                b.innerText = '';
            });
            threads.forEach(t => t.style.borderColor = '#aaa');
            frame = 1;
            readIndex = 0;
            step = 0;
            progress = 0;
        };
        
        resetState();

        animInterval = setInterval(() => {
            const readBufferBlocks = readIndex === 0 ? buffer0Blocks : buffer1Blocks;
            const writeBufferBlocks = readIndex === 0 ? buffer1Blocks : buffer0Blocks;
            const readLabel = readIndex === 0 ? buffer0Label : buffer1Label;
            const writeLabel = readIndex === 0 ? buffer1Label : buffer0Label;

            // Update labels and styles based on current state
            frameCounterEl.innerText = `Frame: ${frame}`;
            readLabel.innerText = 'READ';
            readLabel.style.backgroundColor = '#0d6efd';
            writeLabel.innerText = 'WRITE';
            writeLabel.style.backgroundColor = '#198754';

            if (step === 0) { // Start of frame, prepare to read
                step = 1;
                progress = 0;
                threads.forEach(t => t.style.borderColor = '#0d6efd'); // Reading color
            } else if (step === 1) { // Reading phase
                if (progress < NUM_ELEMENTS) {
                    readBufferBlocks[progress].style.background = '#cfe2ff'; // Highlight read
                    progress++;
                } else {
                    step = 2;
                    progress = 0;
                    threads.forEach(t => t.style.borderColor = '#198754'); // Writing color
                }
            } else if (step === 2) { // Writing phase
                if (progress < NUM_ELEMENTS) {
                    writeBufferBlocks[progress].style.background = '#d1e7dd'; // Highlight write
                    writeBufferBlocks[progress].innerText = `NewData[${progress}]`;
                    progress++;
                } else {
                    step = 3;
                }
            } else if (step === 3) { // Flip buffers
                readIndex = (readIndex + 1) % 2;
                frame++;
                step = 0;
                // Reset styles for next frame
                readBufferBlocks.forEach(b => b.style.background = '#e9ecef');
                threads.forEach(t => t.style.borderColor = '#aaa');
            }
        }, 400);
    }

    container.querySelector("#restart-anim").addEventListener("click", runAnimation);
    setTimeout(runAnimation, 500);
}