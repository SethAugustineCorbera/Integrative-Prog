/* Counter scanner: reads a clearance-slip QR code with the device camera and fills the Verify Slip form.
   Uses the built-in BarcodeDetector when the browser has it, otherwise the bundled jsQR decoder.
   Cameras need HTTPS (or localhost). */
(function () {
    "use strict";
    const form = document.getElementById("verify-form");
    const tokenInput = document.getElementById("slip-token-input");
    const codeInput = document.getElementById("slip-code-input");
    if (!form || !tokenInput) return;

    const open = document.createElement("button");
    open.type = "button";
    open.className = "btn btn-outline scan-open";
    open.textContent = "Scan QR with camera";
    form.insertBefore(open, document.getElementById("verify-btn"));

    const dialog = document.createElement("dialog");
    dialog.id = "scan-dialog";
    dialog.setAttribute("aria-labelledby", "scan-title");
    dialog.innerHTML = '<div class="scan-box"><h2 id="scan-title">Scan clearance slip</h2>'
        + '<div class="scan-frame"><video id="scan-video" playsinline muted></video><i class="scan-aim" aria-hidden="true"></i></div>'
        + '<p id="scan-status" class="scan-status" role="status" aria-live="polite">Starting camera&hellip;</p>'
        + '<div class="scan-actions"><button class="btn btn-outline" id="scan-close" type="button">Cancel</button></div></div>';
    document.body.appendChild(dialog);
    const video = dialog.querySelector("#scan-video");
    const status = dialog.querySelector("#scan-status");

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let stream = null;
    let running = false;
    let detector = null;

    function decodeCanvas() {
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const result = window.jsQR ? window.jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" }) : null;
        return result ? result.data : "";
    }

    function stop() {
        running = false;
        if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
        stream = null;
        video.srcObject = null;
    }

    function finish(text) {
        stop();
        dialog.close();
        const value = String(text).trim();
        if (/^ECH-[A-Z0-9]+$/i.test(value) && codeInput) {
            codeInput.value = value.toUpperCase();
            tokenInput.value = "";
        } else {
            tokenInput.value = value.slice(0, 512);
            if (codeInput) codeInput.value = "";
        }
        if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event("submit", { cancelable: true }));
    }

    async function frame() {
        if (!running) return;
        try {
            if (video.readyState >= 2 && video.videoWidth) {
                let found = "";
                if (detector) {
                    const codes = await detector.detect(video);
                    if (codes.length) found = codes[0].rawValue;
                } else {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    context.drawImage(video, 0, 0);
                    found = decodeCanvas();
                }
                if (found) { finish(found); return; }
            }
        } catch (error) { /* keep scanning */ }
        setTimeout(function () { requestAnimationFrame(frame); }, 120);
    }

    async function start() {
        status.textContent = "Starting camera…";
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            status.textContent = "This browser cannot open the camera here. Use HTTPS or localhost, or paste the code instead.";
            return;
        }
        try {
            if ("BarcodeDetector" in window) {
                try { detector = new BarcodeDetector({ formats: ["qr_code"] }); } catch (error) { detector = null; }
            }
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
            video.srcObject = stream;
            await video.play();
            status.textContent = "Point the camera at the student's QR code.";
            running = true;
            frame();
        } catch (error) {
            status.textContent = error && error.name === "NotAllowedError"
                ? "Camera permission was denied. Allow camera access or paste the code instead."
                : "No camera could be started. Paste the code instead.";
        }
    }

    open.addEventListener("click", function () { dialog.showModal(); start(); });
    dialog.querySelector("#scan-close").addEventListener("click", function () { stop(); dialog.close(); });
    dialog.addEventListener("close", stop);
    window.HubScanner = { decodeCanvas: decodeCanvas, canvas: canvas, context: context };
})();
