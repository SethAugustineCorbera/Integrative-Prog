/* Signs the user out after a period of inactivity (data-privacy safeguard).
   Warns 60 seconds before. Set window.HUB_IDLE_MS before this script to change the limit. */
(function () {
    "use strict";
    if (!sessionStorage.getItem("token")) return;
    const LIMIT = Number(window.HUB_IDLE_MS) || 15 * 60 * 1000;
    const WARNING = Math.min(60 * 1000, Math.floor(LIMIT / 2));
    let lastActive = Date.now();
    let warned = false;

    const dialog = document.createElement("dialog");
    dialog.id = "idle-dialog";
    dialog.setAttribute("aria-labelledby", "idle-title");
    dialog.innerHTML = '<form method="dialog" class="idle-box">'
        + '<h2 id="idle-title">Still there?</h2>'
        + '<p>You will be signed out in <strong id="idle-seconds">60</strong> seconds because of inactivity.</p>'
        + '<div class="idle-actions"><button class="btn" id="idle-stay" type="button">Stay signed in</button>'
        + '<button class="btn btn-outline" id="idle-out" type="button">Log out now</button></div></form>';
    document.body.appendChild(dialog);

    function signOut(message) {
        try { if (window.HubApi && HubApi.logout) HubApi.logout().catch(function () {}); } catch (error) { /* ignore */ }
        sessionStorage.clear();
        sessionStorage.setItem("loginNotice", message);
        location.href = "../../index.html#login";
    }

    function activity() {
        if (warned) return; // once the warning shows, only the button keeps the session
        lastActive = Date.now();
    }
    ["pointerdown", "keydown", "scroll", "touchstart", "mousemove"].forEach(function (name) {
        window.addEventListener(name, activity, { passive: true });
    });

    document.getElementById("idle-stay").addEventListener("click", function () {
        warned = false;
        lastActive = Date.now();
        dialog.close();
    });
    document.getElementById("idle-out").addEventListener("click", function () { signOut("You have been logged out."); });
    dialog.addEventListener("cancel", function (event) { event.preventDefault(); });

    setInterval(function () {
        if (!sessionStorage.getItem("token")) return;
        const idle = Date.now() - lastActive;
        if (idle >= LIMIT) { signOut("You were signed out after " + Math.round(LIMIT / 60000) + " minutes of inactivity."); return; }
        if (idle >= LIMIT - WARNING) {
            if (!warned) { warned = true; if (!dialog.open) dialog.showModal(); }
            document.getElementById("idle-seconds").textContent = String(Math.max(0, Math.ceil((LIMIT - idle) / 1000)));
        }
    }, 500);
})();
