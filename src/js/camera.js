/**
 * Camera Module
 * Handles camera transformations, orbit controls, and touch gestures
 */

// Unit quaternions { w, x, y, z } for the 3D camera orientation
function quatMul(a, b) {
    return {
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w
    };
}

// Rotation by |(x, y, z)| radians about the axis (x, y, z)
function quatFromRotationVector(x, y, z) {
    const angle = Math.hypot(x, y, z);
    if (angle === 0) return { w: 1, x: 0, y: 0, z: 0 };
    const s = Math.sin(angle / 2) / angle;
    return { w: Math.cos(angle / 2), x: x * s, y: y * s, z: z * s };
}

function quatNormalize(q) {
    const n = Math.hypot(q.w, q.x, q.y, q.z);
    return { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n };
}

class Camera {
    constructor() {
        // 3D view: an orbit around `target`. `orientation` rotates the camera's own
        // axes (right = X, up = Y, back = Z, from target toward the camera) into
        // machine coordinates; the identity is the standard CNC top view (X right,
        // Y up on screen). Mouse and touch orbit like a Z-up turntable; a 3D mouse
        // rotates about the screen axes like in CAD programs, so it can also roll.
        this.target = { x: 0, y: 0, z: 0 };
        this.orientation = { w: 1, x: 0, y: 0, z: 0 };
        this.distance = 100;
        this.orthoScale = 100;
        this.targetOrthoScale = this.orthoScale;

        // For smooth interpolation
        this.targetTarget = { ...this.target };
        this.targetOrientation = { ...this.orientation };

        // 2D pan/zoom
        this.pan2d = { x: 0, y: 0 };
        this.zoom2d = 1;
        this.targetPan2d = { ...this.pan2d };
        this.targetZoom2d = this.zoom2d;

        // Initial zoom values for relative zoom display (100% = fit-to-bounds)
        this.initialZoom2d = 1;
        this.initialOrthoScale = 100;
    }

    /**
     * Fit camera to bounds
     */
    fitToBounds(bounds, padding = 0.1, canvasWidth = 800, canvasHeight = 600) {
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;
        const centerZ = (bounds.minZ + bounds.maxZ) / 2;

        this.target = { x: centerX, y: centerY, z: centerZ };
        this.targetTarget = { x: centerX, y: centerY, z: centerZ };

        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;
        const depth = bounds.maxZ - bounds.minZ;

        const maxDim = Math.max(width, height, depth) || 100;
        // Reduce orthoScale for tighter 3D view (was 1 + padding, now 0.6 + padding/2)
        this.orthoScale = this.targetOrthoScale = maxDim * (0.6 + padding / 2);

        // Calculate 2D zoom to fit bounds in canvas
        // Use default dimensions if canvas is not visible/sized yet
        const safeCanvasWidth = canvasWidth > 0 ? canvasWidth : 800;
        const safeCanvasHeight = canvasHeight > 0 ? canvasHeight : 600;

        // Reduce padding for tighter fit - use smaller padding for 2D view
        const paddedWidth = Math.max(width * (1 + padding * 0.5), 1);
        const paddedHeight = Math.max(height * (1 + padding * 0.5), 1);

        const scaleX = safeCanvasWidth / paddedWidth;
        const scaleY = safeCanvasHeight / paddedHeight;
        const fitZoom = Math.min(scaleX, scaleY);

        console.log('Camera fitToBounds:', {
            bounds: { width, height },
            canvas: { width: safeCanvasWidth, height: safeCanvasHeight },
            center: { x: centerX, y: centerY },
            scales: { x: scaleX, y: scaleY, chosen: fitZoom }
        });

        // Reset 2D view centered and fitted
        this.pan2d = { x: centerX, y: centerY };
        this.zoom2d = fitZoom;
        this.targetPan2d = { ...this.pan2d };
        this.targetZoom2d = this.zoom2d;

        // Store initial zoom values for relative zoom display
        this.initialZoom2d = fitZoom;
        this.initialOrthoScale = this.orthoScale;

        // Reset 3D view to the standard CNC top view: X right, Y up on screen
        this.distance = maxDim * 2;
        this.orientation = { w: 1, x: 0, y: 0, z: 0 };
        this.targetOrientation = { ...this.orientation };
    }

    /**
     * Update camera with smooth interpolation
     */
    update(deltaTime = 16) {
        const smoothness = 0.15;

        // Smooth 2D pan
        this.pan2d.x += (this.targetPan2d.x - this.pan2d.x) * smoothness;
        this.pan2d.y += (this.targetPan2d.y - this.pan2d.y) * smoothness;

        // Smooth 2D zoom
        this.zoom2d += (this.targetZoom2d - this.zoom2d) * smoothness;

        // Smooth 3D target
        this.target.x += (this.targetTarget.x - this.target.x) * smoothness;
        this.target.y += (this.targetTarget.y - this.target.y) * smoothness;
        this.target.z += (this.targetTarget.z - this.target.z) * smoothness;

        // Smooth 3D orbit: normalized lerp, taking the short way round
        const q = this.orientation, t = this.targetOrientation;
        const s = q.w * t.w + q.x * t.x + q.y * t.y + q.z * t.z < 0 ? -1 : 1;
        this.orientation = quatNormalize({
            w: q.w + (s * t.w - q.w) * smoothness,
            x: q.x + (s * t.x - q.x) * smoothness,
            y: q.y + (s * t.y - q.y) * smoothness,
            z: q.z + (s * t.z - q.z) * smoothness
        });

        // Smooth 3D zoom
        this.orthoScale += (this.targetOrthoScale - this.orthoScale) * smoothness;
    }

    /**
     * Pan 2D view
     */
    pan2D(dx, dy) {
        this.targetPan2d.x -= dx / this.zoom2d;
        this.targetPan2d.y += dy / this.zoom2d; // + instead of - because Y is flipped in renderer
    }

    /**
     * Zoom 2D view
     * @param {number} delta - The zoom delta (wheel deltaY or pinch distance change)
     * @param {number} canvasX - Mouse/touch X position on canvas
     * @param {number} canvasY - Mouse/touch Y position on canvas
     * @param {number} canvasWidth - Canvas width
     * @param {number} canvasHeight - Canvas height
     * @param {boolean} isTouch - Whether this is from a touch gesture (uses different sensitivity)
     */
    zoom2D(delta, canvasX, canvasY, canvasWidth, canvasHeight, isTouch = false) {
        // Use different sensitivity for touch vs mouse wheel
        // Mouse wheel deltas are ~100-120 per tick, touch pinch deltas are ~1-10 pixels
        const zoomSpeed = isTouch ? 0.015 : 0.001;
        const zoomFactor = 1 - (delta * zoomSpeed);

        // Get current transform
        const transform = this.get2DTransform(canvasWidth, canvasHeight);

        // Convert canvas coordinates to world coordinates before zoom
        // Account for flipped Y-axis
        const worldX = (canvasX - transform.translateX) / transform.scale;
        const worldY = (canvasY - transform.translateY) / transform.scale; // Removed negation

        const oldZoom = this.targetZoom2d;
        this.targetZoom2d *= zoomFactor;
        // Limit to 10% - 1000% relative zoom (0.1x to 10x of initial fit-to-bounds)
        const minZoom = this.initialZoom2d * 0.1;
        const maxZoom = this.initialZoom2d * 10;
        this.targetZoom2d = Math.max(minZoom, Math.min(maxZoom, this.targetZoom2d));

        // Adjust pan to keep world coordinates under mouse the same
        const newTranslateX = canvasX - worldX * this.targetZoom2d;
        const newTranslateY = canvasY - worldY * this.targetZoom2d; // Changed + to -

        this.targetPan2d.x = (canvasWidth / 2 - newTranslateX) / this.targetZoom2d;
        this.targetPan2d.y = -(canvasHeight / 2 - newTranslateY) / this.targetZoom2d; // Added negation
    }

    /**
     * Rotate camera (turntable orbit around target)
     * deltaX: horizontal drag - spins the model around machine Z (drag right = model turns right)
     * deltaY: vertical drag - tilts between top view and level (drag up = tilt toward the front view)
     */
    rotate(deltaX, deltaY) {
        const sensitivity = 0.01;
        // Spin about machine Z (a world axis, so it multiplies on the left)
        let q = quatMul(quatFromRotationVector(0, 0, -deltaX * sensitivity), this.targetOrientation);

        // Tilt about screen right (a camera axis, so it multiplies on the right).
        // A positive camera rotation about right lowers the elevation.
        let tilt = -deltaY * sensitivity;
        const { right, up, back } = this.getBasis(q);
        if (Math.abs(right.z) < 1e-4 && up.z > -1e-4) {
            // Upright view (not rolled by a 3D mouse): stop at straight down / straight up
            const elevation = Math.asin(Math.max(-1, Math.min(1, back.z)));
            tilt = elevation - Math.max(-Math.PI / 2, Math.min(Math.PI / 2, elevation - tilt));
        }
        q = quatMul(q, quatFromRotationVector(tilt, 0, 0));
        this.targetOrientation = quatNormalize(q);
    }

    /**
     * Rotate the camera about its own axes (radians), as a 3D mouse does in CAD programs:
     * pitch about screen right, yaw about screen up, roll about the view direction.
     * Positive angles turn the camera counter-clockwise about each axis, so the model
     * appears to turn the opposite way.
     */
    rotateView(pitch, yaw, roll) {
        this.targetOrientation = quatNormalize(
            quatMul(this.targetOrientation, quatFromRotationVector(pitch, yaw, roll)));
    }

    /**
     * Camera basis vectors for an orientation (all unit length)
     *   back  - from target toward the camera
     *   right - screen right
     *   up    - screen up
     */
    getBasis(q = this.orientation) {
        const { w, x, y, z } = q;
        return {
            right: { x: 1 - 2 * (y * y + z * z), y: 2 * (x * y + w * z), z: 2 * (x * z - w * y) },
            up:    { x: 2 * (x * y - w * z), y: 1 - 2 * (x * x + z * z), z: 2 * (y * z + w * x) },
            back:  { x: 2 * (x * z + w * y), y: 2 * (y * z - w * x), z: 1 - 2 * (x * x + y * y) }
        };
    }

    /**
     * Camera position (derived from target and orientation)
     */
    get position() {
        const { back } = this.getBasis();
        return {
            x: this.target.x + back.x * this.distance,
            y: this.target.y + back.y * this.distance,
            z: this.target.z + back.z * this.distance
        };
    }

    /**
     * Pan 3D view in screen space - the model follows the drag
     * dx, dy: mouse movement in pixels (dx > 0 = right, dy > 0 = down)
     */
    pan3D(dx, dy) {
        // Use the target zoom so panning while a zoom is still easing stays consistent
        const panSpeed = this.targetOrthoScale * 0.002;
        const { right, up } = this.getBasis(this.targetOrientation);
        // Moving the view opposite to the drag makes the model follow the pointer
        const mx = -dx * panSpeed, my = dy * panSpeed;
        this.targetTarget.x += mx * right.x + my * up.x;
        this.targetTarget.y += mx * right.y + my * up.y;
        this.targetTarget.z += mx * right.z + my * up.z;
    }

    /**
     * Zoom 3D view
     * delta > 0 zooms out (larger view volume), delta < 0 zooms in - matching the mouse wheel's deltaY
     */
    zoom3D(delta) {
        // Reduce sensitivity for mouse wheel (delta is typically 100)
        // For 3D mouse, delta is much smaller (< 1)
        const wheelSensitivity = Math.abs(delta) > 10 ? 0.001 : 1.0;
        const adjustedDelta = delta * wheelSensitivity;

        this.setOrthoScale(this.targetOrthoScale * (1 + adjustedDelta), true);
    }

    /**
     * Set the 3D zoom (ortho half-height), clamped to 10% - 1000% relative zoom.
     * smooth = true eases toward it in update(); false jumps straight there.
     */
    setOrthoScale(scale, smooth = false) {
        const minScale = this.initialOrthoScale * 0.1;  // 1000% zoom (10x closer)
        const maxScale = this.initialOrthoScale * 10;   // 10% zoom (10x farther)
        this.targetOrthoScale = Math.max(minScale, Math.min(maxScale, scale));
        if (!smooth) this.orthoScale = this.targetOrthoScale;
    }

    /**
     * Get 2D transformation for canvas
     */
    get2DTransform(canvasWidth, canvasHeight) {
        return {
            translateX: canvasWidth / 2 - this.pan2d.x * this.zoom2d,
            translateY: canvasHeight / 2 + this.pan2d.y * this.zoom2d, // + instead of - because Y is flipped in renderer
            scale: this.zoom2d
        };
    }

    /**
     * Get orthographic projection matrix for 3D
     */
    getProjectionMatrix(aspect) {
        const scale = this.orthoScale;
        const left = -scale * aspect;
        const right = scale * aspect;
        const bottom = -scale;
        const top = scale;
        const near = -10000;
        const far = 10000;

        const rl = right - left;
        const tb = top - bottom;
        const fn = far - near;

        return [
            2 / rl, 0, 0, 0,
            0, 2 / tb, 0, 0,
            0, 0, -2 / fn, 0,
            -(right + left) / rl, -(top + bottom) / tb, -(far + near) / fn, 1
        ];
    }

    /**
     * Get view matrix for 3D, built directly from the camera basis
     */
    getViewMatrix() {
        const { back: zAxis, right: xAxis, up: yAxis } = this.getBasis();
        const eye = this.position;

        // View matrix (column-major for WebGL)
        return [
            xAxis.x, yAxis.x, zAxis.x, 0,
            xAxis.y, yAxis.y, zAxis.y, 0,
            xAxis.z, yAxis.z, zAxis.z, 0,
            -(xAxis.x * eye.x + xAxis.y * eye.y + xAxis.z * eye.z),
            -(yAxis.x * eye.x + yAxis.y * eye.y + yAxis.z * eye.z),
            -(zAxis.x * eye.x + zAxis.y * eye.y + zAxis.z * eye.z),
            1
        ];
    }

    /**
     * Multiply two 4x4 matrices (column-major)
     */
    multiplyMatrices(a, b) {
        const result = new Array(16);
        for (let col = 0; col < 4; col++) {
            for (let row = 0; row < 4; row++) {
                result[col * 4 + row] =
                    a[0 * 4 + row] * b[col * 4 + 0] +
                    a[1 * 4 + row] * b[col * 4 + 1] +
                    a[2 * 4 + row] * b[col * 4 + 2] +
                    a[3 * 4 + row] * b[col * 4 + 3];
            }
        }
        return result;
    }

    /**
     * Get combined MVP matrix
     */
    getMVPMatrix(aspect) {
        const projection = this.getProjectionMatrix(aspect);
        const view = this.getViewMatrix();
        return this.multiplyMatrices(projection, view);
    }
}
