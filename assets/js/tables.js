/* Mobile tables: copies each column heading onto its cells (data-label) so the stylesheet can show every row as a
   stacked card on small screens. Works for tables that are filled in later by the page scripts. */
(function () {
    "use strict";
    var queued = false;

    function label(table) {
        var heads = Array.prototype.map.call(table.querySelectorAll("thead th"), function (th) { return th.textContent.trim(); });
        Array.prototype.forEach.call(table.querySelectorAll("tbody tr"), function (row) {
            Array.prototype.forEach.call(row.children, function (cell, index) {
                if (cell.colSpan > 1 || !heads[index]) {
                    cell.removeAttribute("data-label");
                } else if (cell.getAttribute("data-label") !== heads[index]) {
                    cell.setAttribute("data-label", heads[index]);
                }
            });
        });
    }

    function run() {
        queued = false;
        Array.prototype.forEach.call(document.querySelectorAll("table"), label);
    }

    function schedule() {
        if (queued) return;
        queued = true;
        (window.requestAnimationFrame || window.setTimeout)(run);
    }

    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    schedule();
})();
